-- ============================================================
--  R2-M2. Exam access control, auto-start, strict penalty, notice reads
-- ============================================================
--  Covers: #10a auto-start, #10b access control, #7 strict penalty +
--  transparency, #9 notice read tracking.

--  #10b — anyone with an exam link could join: exam_join only gated on
--    status NOT IN (draft,upcoming); NO batch check and NO wall-clock
--    window. Only portal_get_exams was batch-aware. Fix: a shared internal
--    gate `_exam_gate` enforces (1) batch assignment against exams.batch_ids
--    (NULL = all batches), (2) the server wall-clock window against
--    start_time/end_time (never trust client clocks), (3) exam existence.
--    Applied at exam_join (entry, strict) and re-checked at
--    exam_get_questions / exam_submit / exam_get_my_submission /
--    exam_get_review. In-flight students may still fetch/submit after the
--    window closes (p_allow_ended=true), matching the existing behaviour.

--  #10a — auto-start: exam availability is derived from the WALL CLOCK.
--    An exam with status 'upcoming' is joinable once start_time is reached
--    (and before end_time) — no manual intervention, no cron dependency.

--  #7 — penalty was 10% of the STUDENT's score (wrong); requirement is 10%
--    of TOTAL MARKS per red card, capped at 10, only when the exam has
--    Strict Mode ON (default OFF). `exams.strict_mode` (default false) is
--    the per-exam toggle; the client only tracks red cards when ON.
--    `mcq_submissions.raw_score` (marks from correct answers) and
--    `penalty_marks` (deducted) are persisted so the result view can show
--    "mark +12 from correct, −6 penalty, final 6" instead of the confusing
--    "2/3 all correct" state.

--  #9 — notice read state was client-side localStorage only (per-browser,
--    not per-user). Fix: `notice_reads` table (RLS denies anon; only
--    SECURITY DEFINER RPCs touch it) + portal_mark_notice_read /
--    portal_get_notice_reads so reads persist per student.

--  Idempotent. Run in the Supabase SQL Editor.

BEGIN;

-- ═══════════ Schema ═══════════

DO $pre$
BEGIN
  IF TO_REGCLASS('public.exams') IS NULL THEN
    RAISE EXCEPTION 'public.exams missing — run 20250818000002 first.';
  END IF;
  IF TO_REGCLASS('public.mcq_submissions') IS NULL THEN
    RAISE EXCEPTION 'public.mcq_submissions missing.';
  END IF;
  IF TO_REGCLASS('public.notices') IS NULL THEN
    RAISE EXCEPTION 'public.notices missing.';
  END IF;
  IF TO_REGPROCEDURE('public.exam_join(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'exam_join missing — run P3 (20250827000003) first.';
  END IF;
END $pre$;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS strict_mode BOOLEAN DEFAULT false;
ALTER TABLE mcq_submissions ADD COLUMN IF NOT EXISTS raw_score INTEGER DEFAULT 0;
ALTER TABLE mcq_submissions ADD COLUMN IF NOT EXISTS penalty_marks INTEGER DEFAULT 0;

-- ═══════════ Shared exam authorization gate ═══════════
-- Internal only — revoked from all external roles.
DROP FUNCTION IF EXISTS _exam_gate(UUID, UUID, BOOLEAN);
CREATE FUNCTION _exam_gate(
  p_exam_id UUID,
  p_student_batch UUID,
  p_allow_ended BOOLEAN DEFAULT false
)
RETURNS TABLE (status TEXT, total_marks INTEGER, strict_mode BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_status    TEXT;
  v_start     TIMESTAMPTZ;
  v_end       TIMESTAMPTZ;
  v_batchids  UUID[];
  v_batchid   UUID;
  v_total     INTEGER;
  v_strict    BOOLEAN;
BEGIN
  SELECT e.status, e.start_time, e.end_time, e.batch_ids, e.batch_id,
         e.total_marks, e.strict_mode
    INTO v_status, v_start, v_end, v_batchids, v_batchid, v_total, v_strict
  FROM exams e WHERE e.id = p_exam_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'EXAM_NOT_FOUND';
  END IF;

  -- #10a auto-start: 'upcoming' becomes joinable once its window opens.
  IF v_status IN ('draft', 'upcoming') THEN
    IF v_start IS NULL OR now() < v_start THEN
      RAISE EXCEPTION 'EXAM_NOT_STARTED';
    END IF;
  END IF;

  -- Wall-clock end (or admin-ended): new entries rejected; in-flight may
  -- finish when p_allow_ended is true.
  IF v_status = 'ended' OR (v_end IS NOT NULL AND now() >= v_end) THEN
    IF NOT p_allow_ended THEN
      RAISE EXCEPTION 'EXAM_ENDED';
    END IF;
  END IF;

  -- #10b batch assignment (STRICT): an exam is joinable ONLY by a student of
  -- a batch it targets (`batch_ids` authoritative, `batch_id` legacy fallback).
  -- An exam with NO target batch is UNASSIGNED and no student may join it —
  -- it must never fall through to "everyone". Empty/NULL target arrays are
  -- rejected explicitly (ANY(ARRAY[NULL]) is NULL, so the plain check alone
  -- would wrongly admit everyone).
  IF p_student_batch IS NULL
     OR (v_batchids IS NULL AND v_batchid IS NULL)
     OR (v_batchids IS NOT NULL AND cardinality(v_batchids) = 0)
     OR NOT (p_student_batch = ANY(COALESCE(v_batchids, ARRAY[v_batchid]::uuid[])))
  THEN
    RAISE EXCEPTION 'EXAM_NOT_ASSIGNED';
  END IF;

  status := v_status;
  total_marks := v_total;
  strict_mode := v_strict;
  RETURN NEXT;
END;
$fn$;

REVOKE ALL ON FUNCTION _exam_gate(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ═══════════ exam_join — full authorization ═══════════
DROP FUNCTION IF EXISTS exam_join(UUID, TEXT, TEXT);
CREATE FUNCTION exam_join(
  p_exam_id      UUID,
  p_portal_token TEXT DEFAULT NULL,
  p_student_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  exam_token        TEXT,
  student_id        UUID,
  student_name      TEXT,
  student_code      TEXT,
  already_submitted BOOLEAN,
  exam_status       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_sid    UUID;
  v_sbatch UUID;
  v_status TEXT;
  v_appr   BOOLEAN;
  v_token  TEXT;
  v_done   BOOLEAN;
  v_estat  TEXT;
BEGIN
  IF p_portal_token IS NOT NULL AND p_portal_token <> '' THEN
    v_sid := _student_id_from_token(p_portal_token);
    IF v_sid IS NULL THEN
      RAISE EXCEPTION 'Session expired. Please log in again.';
    END IF;
  ELSIF p_student_code IS NOT NULL AND p_student_code <> '' THEN
    SELECT s.id INTO v_sid FROM students s
    WHERE s.student_id ILIKE p_student_code
    LIMIT 1;
    IF v_sid IS NULL THEN
      RAISE EXCEPTION 'STUDENT_NOT_FOUND';
    END IF;
  ELSE
    RAISE EXCEPTION 'Identity required';
  END IF;

  SELECT s.status, s.is_approved, s.batch_id INTO v_status, v_appr, v_sbatch
  FROM students s WHERE s.id = v_sid;
  IF NOT v_appr THEN
    RAISE EXCEPTION 'NOT_APPROVED';
  END IF;
  IF v_status = 'suspended' THEN
    RAISE EXCEPTION 'SUSPENDED';
  END IF;

  -- #10b authorization (batch + wall-clock window) — strict on entry.
  SELECT g.status INTO v_estat FROM _exam_gate(p_exam_id, v_sbatch, false) g;

  SELECT EXISTS (
    SELECT 1 FROM mcq_submissions m
    WHERE m.exam_id = p_exam_id AND m.student_id = v_sid
  ) INTO v_done;

  v_token := _exam_token_issue(p_exam_id, v_sid);

  RETURN QUERY
  SELECT v_token, s.id, s.name, s.student_id, v_done, v_estat
  FROM students s WHERE s.id = v_sid;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_join(UUID, TEXT, TEXT) TO anon, authenticated;

-- ═══════════ exam_get_questions — re-check authorization ═══════════
DROP FUNCTION IF EXISTS exam_get_questions(TEXT);
CREATE FUNCTION exam_get_questions(p_exam_token TEXT)
RETURNS TABLE (
  id            UUID,
  question_text TEXT,
  option_a      TEXT,
  option_b      TEXT,
  option_c      TEXT,
  option_d      TEXT,
  marks         INTEGER,
  order_num     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_exam   UUID;
  v_sid    UUID;
  v_sbatch UUID;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  SELECT s.batch_id INTO v_sbatch FROM students s WHERE s.id = v_sid;
  -- In-flight students may keep fetching even as the window closes.
  PERFORM * FROM _exam_gate(v_exam, v_sbatch, true);

  RETURN QUERY
  SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
         q.marks, q.order_num
  FROM mcq_questions q
  WHERE q.exam_id = v_exam
  ORDER BY q.order_num;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_get_questions(TEXT) TO anon, authenticated;

-- ═══════════ exam_submit — strict-gated penalty + transparency ═══════════
DROP FUNCTION IF EXISTS exam_submit(TEXT, JSONB, INTEGER, INTEGER);
CREATE FUNCTION exam_submit(
  p_exam_token TEXT,
  p_answers    JSONB,
  p_time_taken INTEGER DEFAULT 0,
  p_red_cards  INTEGER DEFAULT 0
)
RETURNS TABLE (
  id            UUID,
  score         INTEGER,
  raw_score     INTEGER,
  penalty_marks INTEGER,
  correct_count INTEGER,
  wrong_count   INTEGER,
  time_taken    INTEGER,
  rank          INTEGER,
  red_cards     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_exam    UUID;
  v_sid     UUID;
  v_sbatch  UUID;
  v_estat   TEXT;
  v_total   INTEGER;
  v_strict  BOOLEAN;
  v_score   INTEGER := 0;
  v_final   INTEGER;
  v_penalty INTEGER := 0;
  v_correct INTEGER := 0;
  v_wrong   INTEGER := 0;
  v_answered INTEGER := 0;
  v_cards   INTEGER;
  v_rank    INTEGER;
  v_new_id  UUID;
  q         RECORD;
  v_ans     TEXT;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  -- Reject duplicate submission.
  IF EXISTS (
    SELECT 1 FROM mcq_submissions m
    WHERE m.exam_id = v_exam AND m.student_id = v_sid
  ) THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END IF;

  -- #10b: batch + window; in-flight may finish.
  SELECT s.batch_id INTO v_sbatch FROM students s WHERE s.id = v_sid;
  SELECT g.status, g.total_marks, g.strict_mode INTO v_estat, v_total, v_strict
  FROM _exam_gate(v_exam, v_sbatch, true) g;

  -- Grade server-side against the authoritative answer key.
  FOR q IN
    SELECT mq.id, mq.correct_option, mq.marks
    FROM mcq_questions mq
    WHERE mq.exam_id = v_exam
  LOOP
    v_ans := lower(COALESCE(p_answers ->> q.id::text, ''));
    IF v_ans <> '' THEN
      v_answered := v_answered + 1;
      IF v_ans = lower(q.correct_option) THEN
        v_correct := v_correct + 1;
        v_score := v_score + COALESCE(q.marks, 1);
      ELSE
        v_wrong := v_wrong + 1;
      END IF;
    END IF;
  END LOOP;

  -- #7 penalty: 10% of TOTAL MARKS per card, cap 10 cards; only when Strict
  -- Mode is ON for this exam.
  v_cards := LEAST(GREATEST(COALESCE(p_red_cards, 0), 0), 10);
  IF v_strict THEN
    v_penalty := v_cards * CEIL(COALESCE(v_total, 0) * 0.10);
  END IF;
  v_final := GREATEST(v_score - v_penalty, 0);

  -- Rank = 1 + submissions that beat this (penalized) score.
  SELECT COUNT(*) + 1 INTO v_rank
  FROM mcq_submissions m
  WHERE m.exam_id = v_exam
    AND (m.score > v_final OR (m.score = v_final AND m.time_taken < p_time_taken));

  INSERT INTO mcq_submissions
    (exam_id, student_id, answers, score, raw_score, penalty_marks,
     correct_count, wrong_count, time_taken, rank, red_cards, submitted_at)
  VALUES
    (v_exam, v_sid, p_answers, v_final, v_score, v_penalty,
     v_correct, v_wrong, COALESCE(p_time_taken, 0), v_rank, v_cards, NOW())
  RETURNING mcq_submissions.id INTO v_new_id;

  RETURN QUERY
  SELECT v_new_id, v_final, v_score, v_penalty, v_correct, v_wrong,
         COALESCE(p_time_taken, 0), v_rank, v_cards;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_submit(TEXT, JSONB, INTEGER, INTEGER) TO anon, authenticated;

-- ═══════════ exam_get_my_submission — expose breakdown ═══════════
DROP FUNCTION IF EXISTS exam_get_my_submission(TEXT);
CREATE FUNCTION exam_get_my_submission(p_exam_token TEXT)
RETURNS TABLE (
  id            UUID,
  score         INTEGER,
  raw_score     INTEGER,
  penalty_marks INTEGER,
  correct_count INTEGER,
  wrong_count   INTEGER,
  time_taken    INTEGER,
  rank          INTEGER,
  answers       JSONB,
  red_cards     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_exam   UUID;
  v_sid    UUID;
  v_sbatch UUID;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  SELECT s.batch_id INTO v_sbatch FROM students s WHERE s.id = v_sid;
  PERFORM * FROM _exam_gate(v_exam, v_sbatch, true);

  RETURN QUERY
  SELECT m.id, m.score, m.raw_score, m.penalty_marks, m.correct_count, m.wrong_count,
         m.time_taken, m.rank, m.answers, m.red_cards
  FROM mcq_submissions m
  WHERE m.exam_id = v_exam AND m.student_id = v_sid
  LIMIT 1;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_get_my_submission(TEXT) TO anon, authenticated;

-- ═══════════ exam_get_review — batch re-check ═══════════
DROP FUNCTION IF EXISTS exam_get_review(UUID, TEXT, TEXT);
CREATE FUNCTION exam_get_review(
  p_exam_id      UUID,
  p_portal_token TEXT DEFAULT NULL,
  p_exam_token   TEXT DEFAULT NULL
)
RETURNS TABLE (
  question_id    UUID,
  question_text  TEXT,
  option_a       TEXT,
  option_b       TEXT,
  option_c       TEXT,
  option_d       TEXT,
  correct_option TEXT,
  marks          INTEGER,
  order_num      INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_sid    UUID;
  v_ex     UUID;
  v_sbatch UUID;
BEGIN
  IF p_portal_token IS NOT NULL AND p_portal_token <> '' THEN
    v_sid := _student_id_from_token(p_portal_token);
  ELSIF p_exam_token IS NOT NULL AND p_exam_token <> '' THEN
    SELECT r.student_id, r.exam_id INTO v_sid, v_ex FROM _exam_token_resolve(p_exam_token) r;
  END IF;

  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;

  -- Only reveal if this student has a submission for this exam.
  IF NOT EXISTS (
    SELECT 1 FROM mcq_submissions WHERE exam_id = p_exam_id AND student_id = v_sid
  ) THEN
    RAISE EXCEPTION 'NO_SUBMISSION';
  END IF;

  -- #10b: still must be assigned to the exam's batch.
  SELECT s.batch_id INTO v_sbatch FROM students s WHERE s.id = v_sid;
  PERFORM * FROM _exam_gate(p_exam_id, v_sbatch, true);

  RETURN QUERY
  SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
         q.correct_option, q.marks, q.order_num
  FROM mcq_questions q
  WHERE q.exam_id = p_exam_id
  ORDER BY q.order_num;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_get_review(UUID, TEXT, TEXT) TO anon, authenticated;

-- ═══════════ exam_get_meta — expose strict_mode to the client ═══════════
DROP FUNCTION IF EXISTS exam_get_meta(UUID);
CREATE FUNCTION exam_get_meta(p_exam_id UUID)
RETURNS TABLE (
  id               UUID,
  title            TEXT,
  subject          TEXT,
  batch_name       TEXT,
  duration_minutes INTEGER,
  total_marks      INTEGER,
  pass_marks       INTEGER,
  instructions     TEXT,
  status           TEXT,
  start_time       TIMESTAMPTZ,
  end_time         TIMESTAMPTZ,
  timer_enabled    BOOLEAN,
  strict_mode      BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  RETURN QUERY
  SELECT e.id, e.title, e.subject, b.name, e.duration_minutes,
         e.total_marks, e.pass_marks, e.instructions, e.status,
         e.start_time, e.end_time, e.timer_enabled, e.strict_mode
  FROM exams e
  LEFT JOIN batches b ON b.id = e.batch_id
  WHERE e.id = p_exam_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_get_meta(UUID) TO anon, authenticated;

-- ═══════════ portal_get_submissions — expose breakdown ═══════════
DROP FUNCTION IF EXISTS portal_get_submissions(TEXT);
CREATE FUNCTION portal_get_submissions(p_token TEXT)
RETURNS TABLE (
  id UUID, exam_id UUID, score INTEGER, raw_score INTEGER, penalty_marks INTEGER,
  correct_count INTEGER, wrong_count INTEGER, time_taken INTEGER, rank INTEGER,
  answers JSONB, submitted_at TIMESTAMPTZ, exam_title TEXT, exam_subject TEXT,
  total_marks INTEGER, pass_marks INTEGER, red_cards INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  RETURN QUERY
  SELECT m.id, m.exam_id, m.score, m.raw_score, m.penalty_marks,
         m.correct_count, m.wrong_count, m.time_taken, m.rank, m.answers,
         m.submitted_at, e.title, e.subject, e.total_marks, e.pass_marks, m.red_cards
  FROM mcq_submissions m JOIN exams e ON e.id = m.exam_id
  WHERE m.student_id = v_sid ORDER BY m.submitted_at DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION portal_get_submissions(TEXT) TO anon, authenticated;

-- ═══════════ #9 notice read tracking ═══════════
CREATE TABLE IF NOT EXISTS notice_reads (
  notice_id  UUID NOT NULL REFERENCES notices(id)   ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notice_id, student_id)
);

ALTER TABLE notice_reads ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policy → direct table access denied; the SECURITY
-- DEFINER RPCs below are the only paths (portal students act as anon).

DROP FUNCTION IF EXISTS portal_mark_notice_read(TEXT, UUID);
CREATE FUNCTION portal_mark_notice_read(p_token TEXT, p_notice_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  INSERT INTO notice_reads (notice_id, student_id, read_at)
  VALUES (p_notice_id, v_sid, NOW())
  ON CONFLICT (notice_id, student_id)
  DO UPDATE SET read_at = NOW();
END;
$fn$;

DROP FUNCTION IF EXISTS portal_get_notice_reads(TEXT);
CREATE FUNCTION portal_get_notice_reads(p_token TEXT)
RETURNS TABLE (notice_id UUID, read_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  RETURN QUERY
  SELECT nr.notice_id, nr.read_at FROM notice_reads nr WHERE nr.student_id = v_sid;
END;
$fn$;

GRANT EXECUTE ON FUNCTION portal_mark_notice_read(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION portal_get_notice_reads(TEXT) TO anon, authenticated;

COMMIT;

-- ═══════════ Verification (post-COMMIT) ═══════════
DO $verify$
DECLARE
  v_col BOOLEAN;
  v_probe INT; -- holds COUNT(*) results, NOT a uuid (was UUID -> 22P02 on re-run)
  v_sid UUID; v_b1 UUID; v_b2 UUID; v_exam UUID;
  v_x TEXT;
  v_cards INT;
BEGIN
  -- Schema present.
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='exams' AND column_name='strict_mode') INTO v_col;
  IF NOT v_col THEN RAISE EXCEPTION 'exams.strict_mode missing'; END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mcq_submissions' AND column_name='raw_score') INTO v_col;
  IF NOT v_col THEN RAISE EXCEPTION 'mcq_submissions.raw_score missing'; END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mcq_submissions' AND column_name='penalty_marks') INTO v_col;
  IF NOT v_col THEN RAISE EXCEPTION 'mcq_submissions.penalty_marks missing'; END IF;

  -- _exam_gate not externally reachable.
  IF HAS_FUNCTION_PRIVILEGE('anon', 'public._exam_gate(uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '_exam_gate is exposed to anon — must be internal-only.';
  END IF;

  -- Singular, granted entry points.
  SELECT COUNT(*) INTO v_probe FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='exam_join';
  IF v_probe <> 1 THEN RAISE EXCEPTION 'expected 1 exam_join, found %', v_probe; END IF;
  IF NOT HAS_FUNCTION_PRIVILEGE('anon','public.exam_join(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'anon lost exam_join EXECUTE';
  END IF;
  IF NOT HAS_FUNCTION_PRIVILEGE('anon','public.exam_submit(text,jsonb,integer,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'anon lost exam_submit EXECUTE';
  END IF;

  -- #7 penalty math (strict, 10% of TOTAL):
  -- 60-mark exam, 1 card -> 60*0.10=6 penalty.
  IF (SELECT 10 * CEIL(60 * 0.10)) <> 6 THEN
    RAISE EXCEPTION 'penalty math: 1 card on 60 total should be 6, got %', 10*CEIL(60*0.10);
  END IF;
  -- 60-mark, 10 cards -> 60 penalty (full wipe).
  IF (SELECT LEAST(10,10) * CEIL(60*0.10)) <> 60 THEN
    RAISE EXCEPTION 'penalty math: 10 cards on 60 should be 60';
  END IF;
  -- Strict OFF → zero penalty regardless of cards.
  -- 40-mark, 3 cards, 25 raw, strict OFF → final 25.
  IF (SELECT GREATEST(25 - (CASE WHEN false THEN 3*CEIL(40*0.10) ELSE 0 END), 0)) <> 25 THEN
    RAISE EXCEPTION 'penalty math: strict OFF must not deduct';
  END IF;

  -- #10b functional probe: a batch-scoped draft/upcoming exam rejects a
  -- student from an unassigned batch, and an auto-started (start_time passed)
  -- exam accepts an assigned student. Build disposable rows, then clean up.
  INSERT INTO batches (name, capacity, is_active) VALUES ('__m2b__', 10, true) RETURNING id INTO v_b1;
  INSERT INTO batches (name, capacity, is_active) VALUES ('__m2b2__', 10, true) RETURNING id INTO v_b2;
  INSERT INTO students (name, phone, student_id, password, is_approved, status, batch_id)
  VALUES ('__m2s__', '__m2s__'||random()::text, '__m2s__'||random()::text,
          crypt('x', gen_salt('bf')), true, 'active', v_b1) RETURNING id INTO v_sid;

  -- Exam scoped to b1, already started (auto-start), still open.
  INSERT INTO exams (title, subject, status, start_time, end_time, batch_ids, total_marks, strict_mode, type)
  VALUES ('__m2e__', 'x', 'upcoming', NOW() - INTERVAL '5 minutes', NOW() + INTERVAL '20 minutes',
          ARRAY[v_b1], 60, false, 'mcq') RETURNING id INTO v_exam;

  -- Student IS in b1 → join must pass the gate (ends only on realm issues).
  BEGIN
    SELECT exam_token INTO v_x FROM exam_join(v_exam, NULL, (SELECT student_id FROM students WHERE id=v_sid));
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'assigned, auto-started exam join failed: % %', SQLSTATE, SQLERRM;
  END;

  -- Move student to unassigned batch b2 → join must raise EXAM_NOT_ASSIGNED.
  UPDATE students SET batch_id = v_b2 WHERE id = v_sid;
  BEGIN
    SELECT exam_token INTO v_x FROM exam_join(v_exam, NULL, (SELECT student_id FROM students WHERE id=v_sid));
    RAISE EXCEPTION 'unassigned-batch student joined — EXAM_NOT_ASSIGNED not enforced';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%EXAM_NOT_ASSIGNED%' THEN
      RAISE EXCEPTION 'expected EXAM_NOT_ASSIGNED, got % %', SQLSTATE, SQLERRM;
    END IF;
  END;

  -- Cleanup.
  DELETE FROM exam_tokens WHERE token = v_x;
  DELETE FROM students WHERE id = v_sid;
  DELETE FROM exams WHERE id = v_exam;
  DELETE FROM batches WHERE id IN (v_b1, v_b2);

  RAISE NOTICE 'M2 verified: exam auth gates, auto-start, strict penalty math, notice_reads table ready.';
END $verify$;

NOTIFY pgrst, 'reload schema';
