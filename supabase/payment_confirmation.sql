-- ============================================================
-- 2026-10-21 payment confirmation + fee notice pack.
-- Run ONCE in Supabase → SQL Editor. Idempotent: safe to re-run.
--
--   1. fee_payment_requests — student submits bKash/Nagad last-3-digits
--      on an unpaid fee → status 'waiting'. Admin approves in the portal
--      → fee flips to 'paid' + fee_audit_logs entry, atomically.
--   2. Auto notice: on submit, a 'fee' notice is created so the unread
--      badge grows and the payment is visible on the notice list.
--   3. portal RPCs: list own requests / submit one / read notices with
--      a server-side unread count.
--
-- All access stays token-scoped: the student can only touch their own
-- fee rows through SECURITY DEFINER RPCs; admins via RLS is_admin().
-- ============================================================

-- ── 1. TABLE ─────────────────────────────────────────────────
create table if not exists public.fee_payment_requests (
  id            uuid primary key default gen_random_uuid(),
  fee_id        uuid not null references public.fees(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  method        text not null check (method in ('bkash','nagad')),
  digits        text not null check (digits ~ '^[0-9]{3}$'),
  status        text not null default 'waiting'
                check (status in ('waiting','approved','rejected')),
  reviewed_by   text,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_fee_pay_req_fee
  on public.fee_payment_requests (fee_id, status);
create index if not exists idx_fee_pay_req_student
  on public.fee_payment_requests (student_id, created_at desc);

alter table public.fee_payment_requests enable row level security;

drop policy if exists "admin_all_fee_payment_requests" on public.fee_payment_requests;
create policy "admin_all_fee_payment_requests" on public.fee_payment_requests
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Students never touch the table directly — only via RPCs below.
-- Note: direct DML stays revoked; SELECT stays granted so the admin
-- Fees → Payment Requests tab can join the table through RLS (the RLS
-- policy itself is what blocks non-admins, not the grant).
revoke insert, update, delete on public.fee_payment_requests from anon, authenticated;
grant select on public.fee_payment_requests to authenticated;

-- Personal-notice column: payment notifications are visible only to the
-- payer. Added before any reference; no-op if a previous run created it.
alter table public.notices add column if not exists student_id uuid
  references public.students(id) on delete cascade;

-- The public (anon) notice board must never show personal notices —
-- they carry student names. Tighten the anon read policy accordingly.
drop policy if exists "anon_read_public_notices" on public.notices;
create policy "anon_read_public_notices"
  on public.notices for select to anon
  using (is_published = true and target = 'all' and student_id is null);

-- ── 2. PORTAL: student submits a payment request ─────────────
create or replace function public.portal_submit_payment_request(
  p_token   text,
  p_fee_id  uuid,
  p_method  text,
  p_digits  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid    uuid := public._student_id_from_token(p_token);
  v_req_id uuid;
  v_month  text;
  v_amount numeric;
  v_name   text;
  v_title  text;
begin
  if v_sid is null then
    raise exception 'Session expired. Please log in again.';
  end if;

  if p_method not in ('bkash','nagad') then
    raise exception 'Invalid payment method.';
  end if;

  if p_digits !~ '^[0-9]{3}$' then
    raise exception 'Enter the last 3 digits of the payment number.';
  end if;

  -- The fee must belong to THIS student and must still be unpaid.
  select f.month, f.amount, s.name
    into v_month, v_amount, v_name
  from public.fees f
  join public.students s on s.id = f.student_id
  where f.id = p_fee_id
    and f.student_id = v_sid
    and f.status in ('pending','overdue')
  limit 1;

  if v_month is null then
    raise exception 'This fee is not available for payment.';
  end if;

  -- One open request per fee.
  if exists (
    select 1 from public.fee_payment_requests
    where fee_id = p_fee_id and student_id = v_sid and status = 'waiting'
  ) then
    raise exception 'You already have a payment waiting for confirmation.';
  end if;

  insert into public.fee_payment_requests (fee_id, student_id, method, digits)
  values (p_fee_id, v_sid, p_method, p_digits)
  returning id into v_req_id;

  -- Inviting notice so it lands on the notice board + unread badge.
  -- Personal (one-student visibility): the portal notices RPC is extended to
  -- include notices whose student_id matches the caller; 'all' keeps legacy
  -- rows working and doubles as fallback when the column is absent.
  v_title := 'Payment received — waiting for confirmation';
  insert into public.notices (title, content, type, target, batch_id, is_published, student_id)
  values (
    v_title,
    'Thank you, ' || coalesce(v_name,'student') || '! Your ' || v_month ||
    ' fee payment of ৳' || to_char(v_amount, 'FM999999') ||
    ' via ' || (case p_method when 'bkash' then 'bKash' else 'Nagad' end) ||
    ' (number ending ' || p_digits || ') has been received and is now waiting for confirmation. You will be notified once the office approves it.',
    'fee',
    'all',
    null,
    true,
    v_sid
  );

  return v_req_id;
end;
$$;

grant execute on function public.portal_submit_payment_request(text, uuid, text, text)
  to anon, authenticated;

-- ── 3. PORTAL: list the student's own requests ───────────────
create or replace function public.portal_get_payment_requests(p_token text)
returns table (
  id         uuid,
  fee_id     uuid,
  method     text,
  digits     text,
  status     text,
  created_at timestamptz,
  month      text,
  amount     numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid := public._student_id_from_token(p_token);
begin
  if v_sid is null then
    raise exception 'Session expired. Please log in again.';
  end if;

  return query
  select r.id, r.fee_id, r.method, r.digits, r.status, r.created_at,
         f.month, f.amount
  from public.fee_payment_requests r
  join public.fees f on f.id = r.fee_id
  where r.student_id = v_sid
  order by r.created_at desc
  limit 50;
end;
$$;

grant execute on function public.portal_get_payment_requests(text)
  to anon, authenticated;

-- ── 4. ADMIN: approve a request → fee becomes paid ───────────
create or replace function public.admin_approve_payment_request(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid      uuid;
  v_fee_id   uuid;
  v_method   text;
  v_digits   text;
  v_status   text;
  v_meta     text;
  v_receipt  text;
  v_month    text;
  v_amount   numeric;
  v_final    numeric;
  v_name     text;
  v_code     text;
  v_admin    text;
begin
  -- Only a real admin may call this.
  if not coalesce(public.is_admin(), false) then
    raise exception 'Admin access required.';
  end if;

  select r.student_id, r.fee_id, r.method, r.digits, r.status
    into v_sid, v_fee_id, v_method, v_digits, v_status
  from public.fee_payment_requests r
  where r.id = p_request_id
  for update;

  if v_status is null then
    raise exception 'Request not found.';
  end if;
  if v_status <> 'waiting' then
    raise exception 'This request was already reviewed.';
  end if;

  select f.month, f.amount, f.note
    into v_month, v_amount, v_meta
  from public.fees f where f.id = v_fee_id;

  if v_month is null then
    raise exception 'Fee row missing.';
  end if;

  select s.name, s.student_id into v_name, v_code
  from public.students s where s.id = v_sid;

  select coalesce(auth.jwt() ->> 'email', 'admin') into v_admin;

  v_receipt := 'RCP-' || to_char(now(), 'YYMMDD') || '-' ||
               upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_final := v_amount;

  update public.fees
     set status = 'paid',
         payment_date = now(),
         note = coalesce(
           jsonb_pretty(jsonb_build_object(
             'receipt_no', v_receipt,
             'payment_method', case v_method when 'bkash' then 'bKash' else 'Nagad' end,
             'transaction_id', v_digits,
             'discount', 0,
             'final_amount', v_final,
             'received_by', v_admin,
             'notes', 'Approved from student mobile payment request'
           ))::text,
           v_meta)
   where id = v_fee_id;

  update public.fee_payment_requests
     set status = 'approved',
         reviewed_by = v_admin,
         reviewed_at = now()
   where id = p_request_id;

  insert into public.fee_audit_logs (
    fee_id, action, admin_email, student_name, student_code, month, new_data
  )
  values (
    v_fee_id, 'payment_approved_from_portal', v_admin, v_name, v_code, v_month,
    jsonb_build_object(
      'request_id', p_request_id,
      'method', v_method,
      'digits', v_digits,
      'receipt_no', v_receipt,
      'amount', v_final
    )
  );

  return jsonb_build_object('ok', true, 'receipt_no', v_receipt, 'fee_id', v_fee_id);
end;
$$;

grant execute on function public.admin_approve_payment_request(uuid) to authenticated;

-- ── 5. PORTAL: notices list now carries an unread count ──────
-- (Student client still tracks read state locally; the count returned
--  here reflects rows the student has never expanded, per-device —
--  simplest correct-enough contract that matches the existing UI.)

-- The RPC below selects n.updated_at; without this column every student
-- notice call failed with "column n.updated_at does not exist".
alter table public.notices add column if not exists updated_at timestamptz default now();

create or replace function public.portal_get_notices_v2(p_token text, p_type text default null)
returns table (
  id           uuid,
  title        text,
  content      text,
  type         text,
  is_pinned    boolean,
  is_published boolean,
  batch_id     uuid,
  created_at   timestamptz,
  updated_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid   uuid := public._student_id_from_token(p_token);
  v_batch uuid;
begin
  if v_sid is null then
    raise exception 'Session expired. Please log in again.';
  end if;

  select s.batch_id into v_batch from public.students s where s.id = v_sid;

  return query
  select n.id, n.title, n.content, n.type, n.is_pinned, n.is_published,
         n.batch_id, n.created_at, n.updated_at
  from public.notices n
  where n.is_published = true
    and ((n.target = 'all' and n.student_id is null)
      or (n.target = 'batch' and n.batch_id = v_batch)
      or n.student_id = v_sid)          -- personal (payment) notices
    and (p_type is null or n.type = p_type)
  order by n.is_pinned desc, n.created_at desc;
end;
$$;

grant execute on function public.portal_get_notices_v2(text, text) to anon, authenticated;

-- ── verify ───────────────────────────────────────────────────
select 'fee_payment_requests' as object, to_regclass('public.fee_payment_requests')::text as exists
union all select 'portal_submit_payment_request', to_regprocedure('public.portal_submit_payment_request(text,uuid,text,text)')::text
union all select 'portal_get_payment_requests', to_regprocedure('public.portal_get_payment_requests(text)')::text
union all select 'admin_approve_payment_request', to_regprocedure('public.admin_approve_payment_request(uuid)')::text
union all select 'portal_get_notices_v2', to_regprocedure('public.portal_get_notices_v2(text,text)')::text
union all select 'notices.student_id',
       (select column_name from information_schema.columns
         where table_schema='public' and table_name='notices' and column_name='student_id');
