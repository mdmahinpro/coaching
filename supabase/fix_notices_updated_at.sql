-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: "column n.updated_at does not exist"
--
-- portal_get_notices_v2() returns n.updated_at, but public.notices was created
-- without that column, so every call failed for students — the dashboard and
-- the notices page both died with that Postgres error.
--
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.notices
  add column if not exists updated_at timestamptz;

update public.notices
   set updated_at = created_at
 where updated_at is null;

alter table public.notices
  alter column updated_at set default now();

-- Verify: still_null must be 0
select count(*) filter (where updated_at is null) as still_null,
       count(*)                                 as total_notices
  from public.notices;
