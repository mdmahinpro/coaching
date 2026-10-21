-- ============================================================
-- admin_create_rpc.sql — add admins from the panel (v2)
-- ============================================================
-- Run ONCE in Supabase → SQL Editor. Idempotent — safe to re-run.
--
-- WHAT THIS GIVES YOU
--   1. admin_create_admin(email, password, name) — the panel's Add New Admin
--      button calls this. Creates the auth user, the email identity and the
--      admin roster row in one transaction.
--   2. admin_list_admins() — the Admins tab's roster list.
--   3. A REPAIR block at the bottom: if an account created earlier still can't
--      log in, set its email + password there, run, and it will be fixed.
--   4. A DIAGNOSTIC select at the very end: shows every account with
--      confirmed / identity / roster / hash state. Paste its output if
--      anything still fails.
-- ============================================================


-- ── 1. Create an admin ────────────────────────────────────────────────────
drop function if exists public.admin_create_admin(text, text, text);

create function public.admin_create_admin(
  p_email    text,
  p_password text,
  p_name     text default 'Admin'
)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid   uuid;
  v_email text := lower(trim(p_email));
  v_name  text := nullif(trim(p_name), '');
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'not-authorized' using errcode = '42501';
  end if;

  if v_email is null or v_email = '' or position('@' in v_email) = 0 then
    raise exception 'invalid-email';
  end if;

  if p_password is null or length(p_password) < 8 then
    raise exception 'weak-password';
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'email-exists';
  end if;

  v_uid := gen_random_uuid();

  insert into auth.users (
    id, instance_id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    v_uid,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('name', coalesce(v_name, 'Admin'), 'role', 'admin'),
    now(), now()
  );

  -- GoTrue cannot authenticate a user without an email identity row, even
  -- when a correct bcrypt hash exists.
  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid()::text, v_uid, v_uid::text, 'email',
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
    now(), now(), now()
  )
  on conflict do nothing;

  insert into public.admin_users (user_id, email)
  values (v_uid, v_email)
  on conflict do nothing;

  return v_email;
end;
$$;

revoke execute on function public.admin_create_admin(text, text, text) from anon;
grant execute on function public.admin_create_admin(text, text, text) to authenticated;


-- ── 2. List admins ────────────────────────────────────────────────────────
drop function if exists public.admin_list_admins();

create function public.admin_list_admins()
returns table (email text, user_id uuid, created_at timestamptz, is_self boolean)
language sql
security definer
set search_path = public, auth
stable
as $$
  select lower(u.email),
         u.id,
         u.created_at,
         u.id = auth.uid()
    from public.admin_users a
    join auth.users u on u.id = a.user_id
   where coalesce(public.is_admin(), false)
   order by u.created_at asc nulls last;
$$;

revoke execute on function public.admin_list_admins() from anon;
grant execute on function public.admin_list_admins() to authenticated;


-- ── 3. REPAIR one account (runs as postgres, bypasses RLS) ───────────────
-- If an admin created earlier still cannot log in: put its email and the exact
-- password you want to type below, then Run. Re-hashes the password the way
-- GoTrue expects, confirms the email, ensures the email identity and roster
-- row exist.
do $$
declare
  v_email text := 'new-admin@example.com';   -- <<< EDIT: the admin's email
  v_pw    text := 'ChangeMe-12345678';       -- <<< EDIT: the password you will type
  v_uid   uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    raise exception 'No auth.users row for %', v_email;
  end if;

  update auth.users
     set encrypted_password = crypt(v_pw, gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = v_uid;

  insert into auth.identities
         (id, user_id, provider_id, provider, identity_data,
          last_sign_in_at, created_at, updated_at)
  select gen_random_uuid()::text, v_uid, v_uid::text, 'email',
         jsonb_build_object('sub', v_uid::text, 'email', lower(v_email),
                            'email_verified', true),
         now(), now(), now()
  where not exists (
    select 1 from auth.identities i
     where i.user_id = v_uid and i.provider = 'email'
  );

  insert into public.admin_users (user_id, email)
  values (v_uid, lower(v_email))
  on conflict do nothing;

  raise notice 'Repaired % — password reset, email confirmed, identity + roster present', v_email;
end $$;


-- ── 4. DIAGNOSTIC — paste this output if anything still fails ────────────
select u.email,
       u.email_confirmed_at is not null                            as email_confirmed,
       exists (select 1 from auth.identities i
                where i.user_id = u.id and i.provider = 'email')   as has_email_identity,
       exists (select 1 from public.admin_users a
                where a.user_id = u.id)                            as on_admin_roster,
       left(u.encrypted_password, 7)                               as hash_prefix,
       u.instance_id,
       u.created_at
  from auth.users u
 order by u.created_at desc
 limit 15;
