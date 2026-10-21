-- ─────────────────────────────────────────────────────────────────────────────
-- Configurable SMS gateway
-- Run this once in the Supabase SQL editor. Until it is run, the server keeps
-- using the SMS_API_KEY / SMS_SENDER_ID environment variables.
--
-- The table holds the API key, so it is NOT world-readable like site_settings:
-- only admins (is_admin()) may read or write it, and `anon` is revoked.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.sms_gateway_config (
  id          smallint primary key default 1,
  provider    text not null default 'zendsms',
  base_url    text,
  sender_id   text,
  api_key     text,
  http_method text not null default 'GET',
  updated_at  timestamptz not null default now(),
  constraint sms_gateway_config_single_row check (id = 1),
  constraint sms_gateway_config_provider   check (provider in ('zendsms', 'custom')),
  constraint sms_gateway_config_method     check (http_method in ('GET', 'POST'))
);

alter table public.sms_gateway_config enable row level security;

revoke all on public.sms_gateway_config from anon;
grant select, insert, update on public.sms_gateway_config to authenticated;

drop policy if exists "sms_gateway_admin_only" on public.sms_gateway_config;
create policy "sms_gateway_admin_only" on public.sms_gateway_config
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Single empty row so the first save is an update, not a manual insert.
insert into public.sms_gateway_config (id) values (1) on conflict (id) do nothing;

-- Verify: should return the row for you (admin) and nothing for other users.
-- select id, provider, base_url, sender_id, http_method, updated_at,
--        (api_key is not null and api_key <> '') as has_key
-- from public.sms_gateway_config;
