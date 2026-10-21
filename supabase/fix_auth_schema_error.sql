-- ============================================================
-- fix_auth_schema_error.sql — repair "Database error querying schema"
-- ============================================================
-- Run ONCE in Supabase → SQL Editor. Safe to re-run.
--
-- WHY: GoTrue scans auth.users / auth.identities rows into fixed Go structs.
-- Hand-inserted rows (our Add-Admin RPC, or any manual seed) can leave token /
-- metadata columns NULL where Supabase's own API always writes '' or '{}'.
-- One NULL column in the scanned row makes every auth query fail with the
-- generic message "Database error querying schema" — so nobody can log in,
-- not just the broken account.
--
-- This normalises every existing row, dedupes identities, and prints a
-- verification table at the end.
-- ============================================================

-- ── 1. Normalise NULLs in auth.users (only columns that exist here) ──────
do $$
declare
  r        record;
  v_cols   text[] := array[
    'confirmation_token', 'recovery_token', 'email_change',
    'email_change_token_new', 'email_change_token_current',
    'phone_change', 'phone_change_token', 'reauthentication_token'
  ];
  v_total  int := 0;
  v_hits   int;
begin
  -- TEXT token columns must be '' (never NULL) for the Go scanner.
  for r in
    select column_name
      from information_schema.columns
     where table_schema = 'auth'
       and table_name   = 'users'
       and column_name  = any (v_cols)
  loop
    execute format('update auth.users set %I = %L where %I is null', r.column_name, '', r.column_name);
    get diagnostics v_hits = row_count;
    v_total := v_total + v_hits;
  end loop;

  -- Metadata must be a json object, never NULL.
  update auth.users
     set raw_app_meta_data = coalesce(
           raw_app_meta_data,
           jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'))
         )
   where raw_app_meta_data is null;
  v_total := v_total + (case when found then 1 else 0 end);

  update auth.users set raw_user_meta_data = '{}'::jsonb where raw_user_meta_data is null;
  update auth.users
     set instance_id = '00000000-0000-0000-0000-000000000000'
   where instance_id is null;
  update auth.users set aud = 'authenticated' where aud is null;
  update auth.users set role = 'authenticated' where role is null;

  raise notice 'auth.users normalised (% token column values filled)', v_total;
end $$;


-- ── 2. Normalise the same NULLs on auth.identities ───────────────────────
do $$
begin
  update auth.identities
     set identity_data = jsonb_build_object(
           'sub', user_id::text,
           'email', coalesce(identity_data->>'email', ''),
           'email_verified', coalesce((identity_data->>'email_verified')::boolean, true)
         )
   where identity_data is null;

  update auth.identities
     set provider_id = coalesce(provider_id, user_id::text)
   where provider_id is null;

  update auth.identities
     set created_at = coalesce(created_at, now()),
         updated_at = coalesce(updated_at, now())
   where created_at is null or updated_at is null;

  raise notice 'auth.identities normalised';
end $$;


-- ── 3. Remove duplicate email identities (keep the oldest) ───────────────
delete from auth.identities i
 using auth.identities j
 where i.user_id = j.user_id
   and i.provider = j.provider
   and i.id <> j.id
   and i.created_at > j.created_at;


-- ── 4. Verification — paste this output if the error persists ────────────
select (select count(*) from auth.users u
         where u.raw_app_meta_data is null
            or u.raw_user_meta_data is null
            or u.instance_id is null
            or u.aud is null
            or u.role is null)                                  as users_with_nulls,
       (select count(*) from auth.identities i
         where i.identity_data is null or i.provider_id is null) as identities_with_nulls,
       (select count(*) from auth.users)                         as total_users,
       (select count(*) from auth.identities)                     as total_identities;
