-- ============================================================
-- keep_alive.sql — anti-sleep heartbeat for free-tier services
-- ============================================================
-- What it does:
--   1. Supabase free projects pause after ~7 days of inactivity.
--      A pg_cron job touching a table every 7 minutes keeps the DB active.
--   2. Render free web services spin down after ~15 min without inbound
--      traffic. A pg_cron + pg_net HTTP self-ping to the Render URL keeps
--      the service warm. (Requires the pg_net extension.)
--
-- Run ONCE in Supabase -> SQL Editor. Safe to re-run (idempotent).
-- ============================================================

-- ── 1. Extensions ─────────────────────────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 2. Heartbeat table ────────────────────────────────────────────────────
-- One row, rewritten every run: current timestamp + run counter.
create table if not exists public.keep_alive (
  id          int primary key default 1,
  heartbeat   timestamptz not null default now(),
  beats       bigint      not null default 0
);

-- site_settings is created by RUN_THIS_IN_SQL_EDITOR.sql; make this pack
-- self-sufficient in case it hasn't run on a fresh project.
create table if not exists public.site_settings (
  key   text primary key,
  value text not null default ''
);

-- Row is locked down: RLS on, no policies -> only the cron job
-- (which runs as the table owner / postgres role) can touch it.
alter table public.keep_alive enable row level security;
revoke all on public.keep_alive from anon, authenticated;

insert into public.keep_alive (id) values (1)
on conflict (id) do update set heartbeat = now(), beats = keep_alive.beats;

-- ── 3. The beat function ──────────────────────────────────────────────────
-- Writes the CURRENT time into the row (and counts the beat). This alone
-- keeps the Supabase project from pausing.
create or replace function public.keep_alive_beat()
returns void
language sql
security definer
set search_path = public
as $$
  update public.keep_alive
     set heartbeat = now(),
         beats     = beats + 1
   where id = 1;
$$;

revoke execute on function public.keep_alive_beat() from anon, authenticated;

-- ── 4. Render self-ping (optional, only if p_render_url is non-empty) ─────
-- pg_net's http_post fires async, so the cron run never blocks. A GET is
-- enough to count as inbound traffic on Render's free tier.
create or replace function public.keep_alive_ping()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
begin
  select value into v_url
    from public.site_settings
   where key = 'keep_alive_render_url'
   limit 1;

  if v_url is not null and v_url <> '' then
    begin
      perform net.http_get(url => v_url, timeout_milliseconds => 5000);
    exception when others then
      -- Ping failures must never kill the heartbeat itself.
      null;
    end;
  end if;
end;
$$;

revoke execute on function public.keep_alive_ping() from anon, authenticated;

-- ── 5. Combined tick: beat always, ping best-effort ───────────────────────
create or replace function public.keep_alive_tick()
returns void
language plpgsql
as $$
begin
  perform public.keep_alive_beat();
  perform public.keep_alive_ping();
end;
$$;

revoke execute on function public.keep_alive_tick() from anon, authenticated;

-- ── 6. Schedule: every 7 minutes ──────────────────────────────────────────
-- Replaces the old daily-heartbeat job if it exists.
select cron.unschedule(jobid)
  from cron.job
 where jobname in ('keep-alive-7min', 'daily-heartbeat');

select cron.schedule(
  'keep-alive-7min',
  '*/7 * * * *',
  $$ select public.keep_alive_tick(); $$
);

-- ── 7. Configuration: point the ping at your Render URL ──────────────────
-- >>> EDIT the URL below, then run. This single line is what keeps the
--     Render free service awake. Site settings table already exists.
insert into public.site_settings (key, value)
values ('keep_alive_render_url', 'https://coaching-bs06.onrender.com/')
on conflict (key) do update set value = excluded.value;

-- ── 8. Verify ─────────────────────────────────────────────────────────────
-- After ~8 minutes you should see beats >= 1 and a fresh heartbeat:
select * from public.keep_alive;
select jobname, schedule, active from cron.job where jobname = 'keep-alive-7min';
select key, value from public.site_settings where key = 'keep_alive_render_url';
