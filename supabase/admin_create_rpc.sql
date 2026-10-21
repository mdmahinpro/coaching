-- ============================================================
-- admin_create_rpc.sql — create additional admins from the panel
-- ============================================================
-- Why this exists:
--   The old "Add New Admin" form used supabase.auth.signUp() from the
--   browser. That had two fatal flaws:
--     1. signUp() on the already-signed-in client REPLACES the current
--        session — the acting admin got logged out (and the new account
--        became the active user).
--     2. It never inserted a row into `admin_users`, so the new account
--        could sign in but is_admin() returned false -> no admin access.
--
--   These SECURITY DEFINER RPCs create the auth user + email identity +
--   admin roster row atomically, server-side, gated on the caller already
--   being an admin.
--
-- Run ONCE in Supabase -> SQL Editor. Idempotent.
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

  -- GoTrue cannot authenticate a user without an email identity row.
  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_uid, v_uid::text, 'email',
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
    now(), now(), now()
  );

  insert into public.admin_users (user_id, email)
  values (v_uid, v_email)
  on conflict (user_id) do nothing;

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
