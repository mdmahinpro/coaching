-- ============================================================
-- 2026-10-20 feature pack (+ Brevo email channel):
--   1. expenses        — money out (rent, salary, bills)
--   2. class_resources — Classes (YouTube) & Materials (Drive links)
--   3. auto fees       — pg_cron monthly generation, on/off via site_settings
--   4. portal_get_resources RPC — token-scoped portal read for resources
--   5. sms_logs ready to also log EMAIL sends (Brevo, type 'EMAIL:*')
--
-- Paste whole file into Supabase → SQL Editor → Run. Idempotent.
-- ============================================================

-- ── 1. EXPENSES ──────────────────────────────────────────────
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  expense_date date   not null default current_date,
  category    text   not null default 'other',
  description text   not null default '',
  amount      numeric(12,2) not null check (amount >= 0),
  created_by  text,
  created_at  timestamptz not null default now()
);

alter table public.expenses enable row level security;

drop policy if exists "admin_all_expenses" on public.expenses;
create policy "admin_all_expenses" on public.expenses
  for all to authenticated using (true) with check (true);

-- ── 2. CLASS RESOURCES (live classes + shared documents) ────
create table if not exists public.class_resources (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('video','document')),
  batch_id     uuid references public.batches(id) on delete set null,
  title        text not null,
  caption      text not null default '',
  url          text not null,
  youtube_id   text,
  order_index  int  not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists idx_class_resources_batch
  on public.class_resources (batch_id, kind, order_index);

alter table public.class_resources enable row level security;

drop policy if exists "admin_all_class_resources" on public.class_resources;
create policy "admin_all_class_resources" on public.class_resources
  for all to authenticated using (true) with check (true);

-- ── 3. MONTHLY FEE AUTOMATION ────────────────────────────────
-- Flag defaults (insert-only; Settings UI updates them)
insert into public.site_settings (key, value)
values ('fee_auto_enabled', 'false')
on conflict (key) do nothing;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Generates the CURRENT month's fees for every active student that does not
-- have one yet. Runs daily; the on/off flag is checked first, so nothing is
-- generated when automation is off.
-- Mid-month join rule: fees are always generated for the month the student
-- joined (the daily run picks up anyone who appeared after the 1st and gives
-- them THAT month's fee, nothing retroactive before their join date).
create or replace function public.auto_generate_monthly_fees()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled   text;
  v_month     text;
  v_due       date;
  v_created   int := 0;
begin
  select value into v_enabled
    from public.site_settings where key = 'fee_auto_enabled' limit 1;
  if v_enabled is distinct from 'true' then
    return 0;
  end if;

  -- 'Month YYYY', matching the format the app writes ('November 2026').
  v_month := to_char(now(), 'fmMonth YYYY');
  v_due   := (date_trunc('month', now()) + interval '9 day')::date;

  with ins as (
    insert into public.fees (student_id, batch_id, amount, month, status, due_date)
    select s.id,
           s.batch_id,
           coalesce(b.monthly_fee, 1500),
           v_month,
           'pending',
           v_due
    from public.students s
    left join public.batches b on b.id = s.batch_id
    where s.status = 'active'
      and s.created_at::date <= current_date          -- no fee before you joined
      and not exists (
            select 1 from public.fees f
             where f.student_id = s.id and f.month = v_month
          )
    returning id
  )
  select count(*) into v_created from ins;

  if v_created > 0 then
    insert into public.fee_audit_logs (action, admin_email, month, new_data)
    values ('fee_generated_auto', 'automation', v_month,
            jsonb_build_object('count', v_created, 'month', v_month, 'by', 'pg_cron'));
  end if;

  return v_created;
end;
$$;

-- Daily 00:30 UTC = 6:30 AM Bangladesh time. The function no-ops when the
-- flag is off, so the schedule can simply stay in place.
select cron.schedule(
  'monthly-fee-automation',
  '30 0 * * *',
  $$ select public.auto_generate_monthly_fees(); $$
)
where not exists (
  select 1 from cron.job where jobname = 'monthly-fee-automation'
);

-- ── 4. PORTAL RPC: resources for the student's batch (or global) ──
create or replace function public.portal_get_resources(p_token text, p_kind text default null)
returns table (
  id          uuid,
  kind        text,
  batch_id    uuid,
  batch_name  text,
  title       text,
  caption     text,
  url         text,
  youtube_id  text,
  order_index int,
  created_at  timestamptz
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
  select r.id, r.kind, r.batch_id, b.name, r.title, r.caption, r.url,
         r.youtube_id, r.order_index, r.created_at
  from public.class_resources r
  left join public.batches b on b.id = r.batch_id
  where r.is_published = true
    and (r.batch_id is null or r.batch_id = v_batch)
    and (p_kind is null or r.kind = p_kind)
  order by r.kind, r.order_index asc, r.created_at desc;
end;
$$;

grant execute on function public.portal_get_resources(text, text) to anon, authenticated;

-- ── verify ──
select 'expenses'     as object, to_regclass('public.expenses')::text    as exists
union all select 'class_resources', to_regclass('public.class_resources')::text
union all select 'auto_fee_fn',     to_regprocedure('public.auto_generate_monthly_fees()')::text
union all select 'portal_resources',to_regprocedure('public.portal_get_resources(text,text)')::text
union all select 'cron job',        (select jobname from cron.job where jobname = 'monthly-fee-automation');

-- ── 5. BREVO EMAIL CHANNEL ───────────────────────────────────
-- Emails are sent server-side (Brevo API, BREVO_API_KEY env on Render) and
-- logged in sms_logs with type 'EMAIL:*'. Only requirement: the phone column
-- must accept email addresses too. This is a no-op if it is already text.
alter table public.sms_logs alter column phone type text;

select 'sms_logs.phone:text' as object,
       (select data_type from information_schema.columns
         where table_schema='public' and table_name='sms_logs' and column_name='phone') as ok;
