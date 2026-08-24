-- ============================================================
-- Security hardening + pgcrypto search_path repair
-- Run ONCE in Supabase → SQL Editor, after
-- 20250820000000_restore_student_portal.sql and
-- 20250818000002_exam_rpcs.sql have both succeeded.
-- ============================================================
--
-- This migration fixes five defects found by live probing:
--
--   H1  pgcrypto unreachable. Every SECURITY DEFINER function declares
--       `SET search_path = public`, but Supabase installs pgcrypto into
--       the `extensions` schema. crypt(), gen_salt() and gen_random_bytes()
--       therefore fail with 42883 at runtime, killing student login,
--       registration, password change and exam-token minting.
--
--   H2  Admin authorization was `TO authenticated USING (true)` on all 12
--       core tables — ANY confirmed auth user had full CRUD. Worse, the
--       role marker lived in user_metadata, which the browser can rewrite
--       via auth.updateUser(), so a self-signup could self-promote.
--       Replaced with membership in a server-only `admin_users` table.
--
--   H3  The site_settings SMS deny-list and purge targeted snake_case keys
--       ('sms_api_key'), but the live rows are camelCase ('smsApiKey').
--       Credentials were neither hidden from anon nor purged.
--
--   H4  exam_tokens was readable by anon (RLS returned 0 rows, but the
--       table-level SELECT grant was still present). Session-token tables
--       are touched only by SECURITY DEFINER functions, which run as owner
--       and bypass grants entirely.
--
--   H5  site_settings carried duplicate camelCase rows shadowing the
--       snake_case keys the client actually reads, and every one of them
--       was served to anonymous visitors on page load.
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- H1. Make pgcrypto resolvable from every project function
-- ────────────────────────────────────────────────────────────
-- ALTER (rather than recreating bodies) keeps this migration independent
-- of the function definitions and safe to re-run.
--
-- pgcrypto is already installed on Supabase projects, in the `extensions`
-- schema — which is exactly why `SET search_path = public` broke crypt().
-- Only create it if genuinely absent, and never try to relocate an existing
-- install (that would break anything already resolving it).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
      CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    ELSE
      CREATE EXTENSION pgcrypto;
    END IF;
  END IF;
END $$;

-- Report where it actually lives, so the search_path below is verifiable.
DO $$
DECLARE v_schema TEXT;
BEGIN
  SELECT n.nspname INTO v_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';
  RAISE NOTICE 'pgcrypto lives in schema: %', v_schema;
END $$;

DO $$
DECLARE
  fn RECORD;
  patched INT := 0;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        '_student_id_from_token', '_issue_student_session', '_exam_token_resolve',
        'logout_student_session', 'register_student', 'verify_student_login',
        'change_student_password',
        'portal_get_profile', 'portal_get_fees', 'portal_get_exams',
        'portal_get_submissions', 'portal_get_notices', 'portal_update_photo',
        'portal_change_password',
        'exam_get_meta', 'exam_join', 'exam_get_questions', 'exam_submit',
        'exam_get_leaderboard', 'exam_get_review', 'exam_get_my_submission',
        'increment_enrolled', 'decrement_enrolled', 'cleanup_old_login_attempts'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions;', fn.sig);
    patched := patched + 1;
  END LOOP;

  RAISE NOTICE 'search_path patched on % function(s)', patched;

  IF patched = 0 THEN
    RAISE EXCEPTION
      'No project functions found in public. Run 20250820000000_restore_student_portal.sql and 20250818000002_exam_rpcs.sql first.';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- H2a. admin_users — the authoritative admin roster
-- ────────────────────────────────────────────────────────────
-- Membership is the ONLY thing that grants admin data access. Unlike
-- user_metadata, this table is not writable from the browser: RLS is on
-- and no role holds a direct grant, so it is reachable only through the
-- SECURITY DEFINER functions below.
CREATE TABLE IF NOT EXISTS admin_users (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_users FROM PUBLIC, anon, authenticated;

-- Bootstrap: promote every existing account that carried the legacy
-- user_metadata.role = 'admin' marker, so this migration does not lock
-- the current operator out of their own dashboard.
INSERT INTO admin_users (user_id, email)
SELECT u.id, u.email
FROM auth.users u
WHERE COALESCE(u.raw_user_meta_data ->> 'role', '') = 'admin'
ON CONFLICT (user_id) DO NOTHING;

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM admin_users;
  RAISE NOTICE 'admin_users seeded with % account(s)', n;
  IF n = 0 THEN
    RAISE WARNING
      'admin_users is EMPTY — no account can reach admin data. Insert your admin user_id manually before signing out.';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- H2b. is_admin() — single predicate every admin policy uses
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin() TO anon, authenticated;

-- Self-service check for the dashboard: "am I an admin?"
CREATE OR REPLACE FUNCTION admin_self_check()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT is_admin();
$$;

REVOKE ALL ON FUNCTION admin_self_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_self_check() TO authenticated;

-- Admin-gated roster management. An existing admin may add or remove
-- others; the last admin cannot remove themselves (no lockout).
CREATE OR REPLACE FUNCTION admin_grant(p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_uid UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  SELECT id INTO v_uid FROM auth.users WHERE LOWER(email) = LOWER(p_email);
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No auth user exists for %. They must sign up first.', p_email;
  END IF;

  INSERT INTO admin_users (user_id, email, created_by)
  VALUES (v_uid, p_email, auth.uid())
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION admin_grant(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_grant(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION admin_revoke(p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID;
  v_remaining INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  SELECT user_id INTO v_uid FROM admin_users WHERE LOWER(email) = LOWER(p_email);
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '% is not an admin', p_email;
  END IF;

  SELECT COUNT(*) INTO v_remaining FROM admin_users WHERE user_id <> v_uid;
  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'Cannot revoke the last admin';
  END IF;

  DELETE FROM admin_users WHERE user_id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION admin_revoke(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_revoke(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION admin_list()
RETURNS TABLE (email TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;
  RETURN QUERY SELECT a.email, a.created_at FROM admin_users a ORDER BY a.created_at;
END;
$$;

REVOKE ALL ON FUNCTION admin_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_list() TO authenticated;

-- ────────────────────────────────────────────────────────────
-- H2c. Re-gate every admin policy behind is_admin()
-- ────────────────────────────────────────────────────────────
-- Previously: FOR ALL TO authenticated USING (true) — any confirmed
-- Supabase Auth user had full CRUD on all 12 core tables. Since public
-- signup is open, that was unauthenticated-to-full-write in two steps.
--
-- The portal/exam RPCs are SECURITY DEFINER and run as the function owner,
-- so they bypass RLS entirely and are unaffected by this tightening.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'students','teachers','batches','fees','exams','notices',
    'admission_requests','contact_messages','sms_logs',
    'mcq_questions','mcq_submissions','site_settings'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "admin_all_%1$s" ON %1$I;', t);
    EXECUTE format(
      'CREATE POLICY "admin_all_%1$s" ON %1$I FOR ALL TO authenticated '
      'USING (is_admin()) WITH CHECK (is_admin());',
      t
    );
  END LOOP;
END $$;

-- Session/token tables: same treatment. Only SECURITY DEFINER functions
-- should ever touch these, so authenticated admins get read-only visibility
-- for debugging and nothing else.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_sessions','login_attempts','exam_tokens']
  LOOP
    IF TO_REGCLASS('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS "Allow auth all %1$s" ON %1$I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "admin_all_%1$s" ON %1$I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "admin_read_%1$s" ON %1$I;', t);
    EXECUTE format(
      'CREATE POLICY "admin_read_%1$s" ON %1$I FOR SELECT TO authenticated USING (is_admin());',
      t
    );
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- H4. Strip table-level grants from token tables
-- ────────────────────────────────────────────────────────────
-- exam_tokens still answered anon SELECT with 200 (empty only because RLS
-- filtered it). Removing the grant makes the denial unconditional.
REVOKE ALL ON student_sessions FROM PUBLIC, anon;
REVOKE ALL ON login_attempts   FROM PUBLIC, anon;
REVOKE ALL ON exam_tokens      FROM PUBLIC, anon;

GRANT SELECT ON student_sessions TO authenticated;
GRANT SELECT ON login_attempts   TO authenticated;
GRANT SELECT ON exam_tokens      TO authenticated;

-- ────────────────────────────────────────────────────────────
-- H3 + H5. site_settings: purge credentials, drop shadow rows
-- ────────────────────────────────────────────────────────────
-- The live table holds camelCase keys ('smsApiKey'), but the earlier
-- deny-list and purge both targeted snake_case ('sms_api_key'), so they
-- were no-ops. Cover BOTH spellings from here on.
DELETE FROM site_settings
WHERE key IN ('sms_api_key', 'sms_sender_id', 'smsApiKey', 'smsSenderId');

-- Fold the camelCase duplicates into the snake_case keys the client
-- actually reads via SETTINGS_KEY_MAP. Four of them (centerAddress,
-- centerWhatsapp, admissionFee, primaryColor) have NO snake_case row in
-- the live table, so their values must be carried across before deleting
-- — a blind DELETE here would silently lose configured settings.
--
-- Precedence: an existing snake_case row wins (it is what the app has been
-- reading and writing); the camelCase row is only promoted when the
-- canonical key is absent or blank.
DO $$
DECLARE
  m RECORD;
  v_old TEXT;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('centerName',     'institute_name'),
      ('centerTagline',  'tagline'),
      ('centerAddress',  'address'),
      ('centerPhone',    'phone'),
      ('centerEmail',    'email'),
      ('centerWhatsapp', 'whatsapp'),
      ('bkashNumber',    'bkash_number'),
      ('nagadNumber',    'nagad_number'),
      ('admissionOpen',  'admission_open'),
      ('admissionFee',   'admission_fee'),
      ('primaryColor',   'primary_color')
    ) AS t(camel, snake)
  LOOP
    SELECT value INTO v_old FROM site_settings WHERE key = m.camel;
    CONTINUE WHEN v_old IS NULL;

    IF EXISTS (
      SELECT 1 FROM site_settings
      WHERE key = m.snake AND COALESCE(value, '') <> ''
    ) THEN
      -- Canonical row already carries a real value; drop the shadow.
      DELETE FROM site_settings WHERE key = m.camel;
    ELSIF EXISTS (SELECT 1 FROM site_settings WHERE key = m.snake) THEN
      UPDATE site_settings SET value = v_old, updated_at = NOW() WHERE key = m.snake;
      DELETE FROM site_settings WHERE key = m.camel;
      RAISE NOTICE 'promoted % → % (canonical row was blank)', m.camel, m.snake;
    ELSE
      -- No canonical row at all: rename in place, preserving the value.
      UPDATE site_settings SET key = m.snake, updated_at = NOW() WHERE key = m.camel;
      RAISE NOTICE 'renamed % → % (value preserved)', m.camel, m.snake;
    END IF;
  END LOOP;
END $$;

-- NOTE: 'rocketNumber' is intentionally left in place. It maps to no field
-- in SETTINGS_KEY_MAP, so the app never reads it, but the value may still be
-- wanted — dropping it here would be an unrequested data deletion.

-- Reassert the anon read policy with both spellings denied, so a future
-- write to either name can never be served to the browser.
DROP POLICY IF EXISTS "anon_read_site_settings" ON site_settings;
CREATE POLICY "anon_read_site_settings"
  ON site_settings FOR SELECT TO anon
  USING (key NOT IN ('sms_api_key', 'sms_sender_id', 'smsApiKey', 'smsSenderId'));

COMMIT;

-- ────────────────────────────────────────────────────────────
-- Post-migration verification
-- ────────────────────────────────────────────────────────────
-- Runs outside the transaction so a failure here reports loudly without
-- rolling back work that already succeeded.
DO $$
DECLARE
  v_bad_paths TEXT[];
  v_loose_policies TEXT[];
  v_plain_pw INT;
  v_sms INT;
BEGIN
  -- 1. Every project function must be able to reach pgcrypto.
  SELECT ARRAY_AGG(p.proname ORDER BY p.proname) INTO v_bad_paths
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND p.proname NOT LIKE 'pg\_%'
    AND NOT EXISTS (
      SELECT 1 FROM UNNEST(COALESCE(p.proconfig, ARRAY[]::TEXT[])) AS c
      WHERE c LIKE 'search\_path=%extensions%'
    );
  IF v_bad_paths IS NOT NULL THEN
    RAISE WARNING 'SECURITY DEFINER functions without extensions on search_path: %', v_bad_paths;
  END IF;

  -- 2. No admin policy may still be an unconditional USING (true).
  SELECT ARRAY_AGG(tablename || '.' || policyname) INTO v_loose_policies
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname LIKE 'admin\_%'
    AND (qual IS NULL OR qual = 'true');
  IF v_loose_policies IS NOT NULL THEN
    RAISE EXCEPTION 'Admin policies still grant unconditional access: %', v_loose_policies;
  END IF;

  -- 3. Original audit item Q9: no plaintext student passwords may survive.
  SELECT COUNT(*) INTO v_plain_pw
  FROM students
  WHERE password IS NOT NULL AND password NOT LIKE '$2%';
  IF v_plain_pw > 0 THEN
    RAISE EXCEPTION 'Q9 FAILED: % student password(s) are not bcrypt hashes', v_plain_pw;
  END IF;

  -- 4. SMS credentials must be gone from site_settings.
  SELECT COUNT(*) INTO v_sms
  FROM site_settings
  WHERE key IN ('sms_api_key', 'sms_sender_id', 'smsApiKey', 'smsSenderId');
  IF v_sms > 0 THEN
    RAISE EXCEPTION 'SMS credential row(s) still present in site_settings: %', v_sms;
  END IF;

  -- 5. is_admin() and the roster functions must exist.
  IF TO_REGPROCEDURE('public.is_admin()') IS NULL
     OR TO_REGPROCEDURE('public.admin_grant(text)') IS NULL
     OR TO_REGPROCEDURE('public.admin_revoke(text)') IS NULL
     OR TO_REGPROCEDURE('public.admin_list()') IS NULL
     OR TO_REGPROCEDURE('public.admin_self_check()') IS NULL THEN
    RAISE EXCEPTION 'Admin authorization functions are missing';
  END IF;

  RAISE NOTICE 'Security hardening verified: admin policies gated, passwords hashed, SMS credentials purged.';
END $$;

-- Smoke-test pgcrypto reachability through an actual project function.
-- A wrong password must raise 'Invalid phone number or password' (P0001),
-- NOT 'function crypt(text, text) does not exist' (42883).
DO $$
BEGIN
  PERFORM verify_student_login('00000000000', 'definitely-not-a-real-password');
  RAISE WARNING 'verify_student_login unexpectedly succeeded for a dummy phone';
EXCEPTION
  WHEN undefined_function THEN
    RAISE EXCEPTION 'pgcrypto STILL unreachable from verify_student_login: %', SQLERRM;
  WHEN OTHERS THEN
    RAISE NOTICE 'pgcrypto reachable (verify_student_login rejected dummy login: %)', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
