-- Repair one SQL-seeded admin account so it can actually log in.
-- Run in Supabase -> SQL Editor. Edit the two v_ values, then Run.
--
-- Why this is needed: users inserted into auth.users by hand have no matching
-- row in auth.identities, so GoTrue cannot authenticate them even when a bcrypt
-- hash exists. This script re-hashes the password, marks the email confirmed,
-- creates the missing email identity, and puts the account on the admin roster.

DO $$
DECLARE
  v_email text := 'your-admin@example.com';   -- <<< your admin email
  v_pw    text := 'PickA-Strong-Passw0rd!';   -- <<< the password you will type
  v_uid   uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(v_email);
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No auth.users row for email %', v_email;
  END IF;

  UPDATE auth.users
     SET encrypted_password = crypt(v_pw, gen_salt('bf')),
         email_confirmed_at = COALESCE(email_confirmed_at, now()),
         updated_at = now()
   WHERE id = v_uid;

  INSERT INTO auth.identities
         (id, user_id, provider_id, provider, identity_data,
          last_sign_in_at, created_at, updated_at)
  SELECT gen_random_uuid(), v_uid, v_uid::text, 'email',
         jsonb_build_object('sub', v_uid::text,
                            'email', v_email,
                            'email_verified', true),
         now(), now(), now()
  WHERE NOT EXISTS (
    SELECT 1 FROM auth.identities i
     WHERE i.user_id = v_uid AND i.provider = 'email'
  );

  INSERT INTO admin_users (user_id, email)
  VALUES (v_uid, v_email)
  ON CONFLICT (user_id) DO NOTHING;

  RAISE NOTICE 'OK - % is confirmed, has an email identity, and is on the admin roster', v_email;
END $$;

-- Verify: expect is_admin = true and has_identity = true for that email.
SELECT u.email,
       u.email_confirmed_at IS NOT NULL AS confirmed,
       EXISTS (SELECT 1 FROM auth.identities i
                WHERE i.user_id = u.id AND i.provider = 'email') AS has_identity,
       EXISTS (SELECT 1 FROM admin_users a WHERE a.user_id = u.id) AS is_admin
FROM auth.users u
ORDER BY u.created_at;
