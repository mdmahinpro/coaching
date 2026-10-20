-- QA fixture: disposable admin for an end-to-end walkthrough.
-- Run in Supabase -> SQL Editor. Safe to re-run. Delete afterwards with
-- supabase/qa_cleanup.sql (removes this account and its QA records).
--
-- This is a throwaway test account, NOT a real operator account.

DO $$
DECLARE
  v_email text := 'qa-admin@example.test';
  v_pw    text := 'Qa-Admin-2026!x7';
  v_uid   uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(v_email);

  IF v_uid IS NULL THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_email, crypt(v_pw, gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', '{}',
      now(), now(), '', '', '', ''
    );
  ELSE
    UPDATE auth.users
       SET encrypted_password = crypt(v_pw, gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           updated_at = now()
     WHERE id = v_uid;
  END IF;

  INSERT INTO auth.identities
         (id, user_id, provider_id, provider, identity_data,
          last_sign_in_at, created_at, updated_at)
  SELECT gen_random_uuid(), v_uid, v_uid::text, 'email',
         jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
         now(), now(), now()
  WHERE NOT EXISTS (
    SELECT 1 FROM auth.identities i WHERE i.user_id = v_uid AND i.provider = 'email'
  );

  INSERT INTO admin_users (user_id, email) VALUES (v_uid, v_email)
  ON CONFLICT (user_id) DO NOTHING;

  RAISE NOTICE 'QA admin ready: % (uid %)', v_email, v_uid;
END $$;

SELECT u.email, a.email IS NOT NULL AS on_roster
FROM auth.users u LEFT JOIN admin_users a ON a.user_id = u.id
WHERE u.email = 'qa-admin@example.test';
