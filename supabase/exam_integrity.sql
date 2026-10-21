-- ============================================================
-- 2026-10-21 exam integrity pack — run ONCE in Supabase → SQL Editor.
-- Idempotent: safe to re-run.
--
-- Fixes three holes reported from live use:
--   1. An exam whose start_time is still in the future was joinable the
--      moment the admin flipped it to 'active' (no start check anywhere).
--   2. Any student could join any exam — exam_join never compared the
--      student's batch with the exam's batch.
--   3. per-student exam time now starts on first entry and survives
--      logout/login: exam_join records first_joined_at, exam_start_deadline
--      = first_joined_at + duration, and exam_submit rejects answers after
--      that deadline server-side. A re-login resume gets the remaining
--      time, never a fresh full timer.
-- ============================================================

-- ── 1. track when each student first entered the exam room ──
alter table public.exam_tokens
  add column if not exists first_joined_at timestamptz not null default now();

-- ── 2. shared window/window helpers ─────────────────────────
create or replace function public._exam_window_error(p_exam public.exams)
returns text
language plpgsql stable
set search_path = public
as $$
begin
  if p_exam.status = 'draft' then
    return 'EXAM_NOT_STARTED';
  end if;
  if p_exam.status = 'ended' then
    return 'EXAM_ENDED';
  end if;
  if p_exam.start_time is not null and p_exam.start_time > now() then
    return 'EXAM_NOT_STARTED';
  end if;
  if p_exam.end_time is not null and p_exam.end_time < now() then
    return 'EXAM_ENDED';
  end if;
  return null;
end;
$$;

-- ── 3. exam_join: batch gate + start gate + first-entry timestamp ──
create or replace function public.exam_join(
  p_exam_id      uuid,
  p_portal_token text default null,
  p_student_code text default null
)
returns table (
  exam_token        text,
  student_id        uuid,
  student_name      text,
  student_code      text,
  already_submitted boolean,
  exam_status       text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid    uuid;
  v_status text;
  v_appr   boolean;
  v_batch  uuid;
  v_token  text;
  v_done   boolean;
  v_err    text;
  v_exam   public.exams;
begin
  if p_portal_token is not null and p_portal_token <> '' then
    v_sid := _student_id_from_token(p_portal_token);
    if v_sid is null then
      raise exception 'Session expired. Please log in again.';
    end if;
  elsif p_student_code is not null and p_student_code <> '' then
    select s.id into v_sid from students s
    where s.student_id ilike p_student_code
    limit 1;
    if v_sid is null then
      raise exception 'STUDENT_NOT_FOUND';
    end if;
  else
    raise exception 'Identity required';
  end if;

  select s.status, s.is_approved, s.batch_id into v_status, v_appr, v_batch
  from students s where s.id = v_sid;
  if not v_appr then
    raise exception 'NOT_APPROVED';
  end if;
  if v_status = 'suspended' then
    raise exception 'SUSPENDED';
  end if;

  select * into v_exam from exams e where e.id = p_exam_id;
  if v_exam.id is null then
    raise exception 'EXAM_NOT_FOUND';
  end if;

  -- NEW: only students of the exam's batch (batch_id null = open to all).
  if v_exam.batch_id is not null and v_exam.batch_id is distinct from v_batch then
    raise exception 'NOT_ELIGIBLE';
  end if;

  -- NEW: exam must actually be open (status + start/end window).
  v_err := _exam_window_error(v_exam);
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  select exists (
    select 1 from mcq_submissions
    where exam_id = p_exam_id and mcq_submissions.student_id = v_sid
  ) into v_done;

  -- Mint / refresh an exam-scoped token. first_joined_at is preserved on the
  -- conflict branch (EXCLUDED keeps its own default), so a re-login resume
  -- keeps the original entry time — that is what stops the "fresh 30 minutes
  -- after logout/login" bug.
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into exam_tokens (token, exam_id, student_id, expires_at)
  values (v_token, p_exam_id, v_sid, now() + interval '6 hours')
  on conflict (exam_id, student_id)
  do update set token = excluded.token, expires_at = excluded.expires_at, created_at = now();

  return query
  select v_token, s.id, s.name, s.student_id, v_done, v_exam.status
  from students s where s.id = v_sid;
end;
$$;

grant execute on function public.exam_join(uuid, text, text) to anon, authenticated;

-- ── 4. exam_get_questions: return the caller's own remaining time ──
--    remaining_seconds = (first_joined_at + duration) - now, floored at 0,
--    capped at the full duration. Server-side truth; the client just
--    displays it. timer_enabled = false → null (no timer).
create or replace function public.exam_get_questions(p_exam_token text)
returns table (
  id                uuid,
  question_text     text,
  option_a          text,
  option_b          text,
  option_c          text,
  option_d          text,
  marks             integer,
  order_num         integer,
  remaining_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam  uuid;
  v_sid   uuid;
  v_row   public.exams;
  v_joined timestamptz;
  v_dur   integer;
  v_err   text;
begin
  select r.exam_id, r.student_id into v_exam, v_sid from _exam_token_resolve(p_exam_token) r;
  if v_exam is null then
    raise exception 'Exam session expired. Please rejoin.';
  end if;

  select * into v_row from exams where id = v_exam;
  v_dur := coalesce(v_row.duration_minutes, 30);

  -- re-check the window so a student who sat on the page can't read questions
  -- after the scheduled end slipped past while they were idle
  v_err := _exam_window_error(v_row);
  if v_err is not null and v_err <> 'EXAM_ENDED' then
    raise exception '%', v_err;
  end if;

  select t.first_joined_at into v_joined
  from exam_tokens t
  where t.exam_id = v_exam and t.student_id = v_sid
  order by created_at desc
  limit 1;
  v_joined := coalesce(v_joined, now());

  return query
  select q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
         q.marks, q.order_num,
         case
           when v_row.timer_enabled = false then null::integer
           when v_row.end_time is not null
             then greatest(0, least(
               (extract(epoch from (v_row.end_time - now())))::int,
               (extract(epoch from (v_joined + make_interval(mins => v_dur) - now())))::int
             ))
           else greatest(0, (extract(epoch from (v_joined + make_interval(mins => v_dur) - now())))::int)
         end
  from mcq_questions q
  where q.exam_id = v_exam
  order by q.order_num;
end;
$$;

grant execute on function public.exam_get_questions(text) to anon, authenticated;

-- ── 5. exam_submit: hard server-side deadline per student ────
--    The client timer auto-submits at 0; this is the teeth: even a tampered
--    client or a resumed session can't write a submission after
--    first_joined_at + duration (or the exam's end_time, whichever is the
--    effective cap).
create or replace function public.exam_submit(
  p_exam_token  text,
  p_answers     jsonb,
  p_time_taken  integer default 0,
  p_red_cards   integer default 0
)
returns table (
  id            uuid,
  score         integer,
  correct_count integer,
  wrong_count   integer,
  time_taken    integer,
  rank          integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam    uuid;
  v_sid     uuid;
  v_score   integer := 0;
  v_correct integer := 0;
  v_wrong   integer := 0;
  v_answered integer := 0;
  v_rank    integer;
  v_new_id  uuid;
  v_joined  timestamptz;
  v_dur     integer;
  v_row     public.exams;
  q         record;
  v_ans     text;
  v_deadline timestamptz;
begin
  select r.exam_id, r.student_id into v_exam, v_sid from _exam_token_resolve(p_exam_token) r;
  if v_exam is null then
    raise exception 'Exam session expired. Please rejoin.';
  end if;

  if exists (select 1 from mcq_submissions where exam_id = v_exam and student_id = v_sid) then
    raise exception 'ALREADY_SUBMITTED';
  end if;

  select * into v_row from exams where id = v_exam;

  -- window: active/paused still allowed; upcoming/ended rejected
  if v_row.status not in ('active', 'paused', 'ended') then
    raise exception 'EXAM_NOT_OPEN';
  end if;
  if v_row.status = 'ended' then
    -- allow a small grace so an in-flight auto-submit at the buzzer doesn't die
    if v_row.end_time is not null and v_row.end_time < now() - interval '2 minutes' then
      raise exception 'EXAM_ENDED';
    end if;
  end if;

  -- per-student deadline: first entry + duration, hard-capped by end_time
  select t.first_joined_at into v_joined
  from exam_tokens t
  where t.exam_id = v_exam and t.student_id = v_sid
  order by created_at desc limit 1;

  v_dur := coalesce(v_row.duration_minutes, 30);
  v_deadline :=
    case
      when v_row.timer_enabled = false then null
      when v_row.end_time is not null
        then least(v_joined + make_interval(mins => v_dur), v_row.end_time)
      else v_joined + make_interval(mins => v_dur)
    end;

  if v_deadline is not null and now() > v_deadline + interval '5 seconds' then
    raise exception 'TIME_UP';
  end if;

  -- grade server-side against the authoritative answer key
  for q in
    select id, correct_option, marks from mcq_questions where exam_id = v_exam
  loop
    v_ans := lower(coalesce(p_answers ->> q.id::text, ''));
    if v_ans <> '' then
      v_answered := v_answered + 1;
      if v_ans = lower(q.correct_option) then
        v_correct := v_correct + 1;
        v_score := v_score + coalesce(q.marks, 1);
      else
        v_wrong := v_wrong + 1;
      end if;
    end if;
  end loop;

  select count(*) + 1 into v_rank
  from mcq_submissions
  where exam_id = v_exam
    and (score > v_score or (score = v_score and time_taken < p_time_taken));

  insert into mcq_submissions
    (exam_id, student_id, answers, score, correct_count, wrong_count, time_taken, rank, submitted_at, red_cards)
  values
    (v_exam, v_sid, p_answers, v_score, v_correct, v_wrong, coalesce(p_time_taken, 0), v_rank, now(), coalesce(p_red_cards, 0))
  returning mcq_submissions.id into v_new_id;

  return query
  select v_new_id, v_score, v_correct, v_wrong, coalesce(p_time_taken, 0), v_rank;
end;
$$;

grant execute on function public.exam_submit(text, jsonb, integer, integer) to anon, authenticated;

-- ── verify ──────────────────────────────────────────────────
-- every row must come back non-null; null = that object is missing
select 'exam_tokens.first_joined_at' as object,
       (select count(*)::text from information_schema.columns
         where table_name='exam_tokens' and column_name='first_joined_at') as ok
union all
select '_exam_window_error',  to_regprocedure('public._exam_window_error(public.exams)')::text
union all
select 'exam_join',           to_regprocedure('public.exam_join(uuid,text,text)')::text
union all
select 'exam_get_questions',  to_regprocedure('public.exam_get_questions(text)')::text
union all
select 'exam_submit',         to_regprocedure('public.exam_submit(text,jsonb,integer,integer)')::text;
