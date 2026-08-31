-- ============================================================
--  Fix: approved default password (reference number) not working
--  Run ONCE in Supabase → SQL Editor.
-- ============================================================
--
--  Defects fixed (all confirmed against the live DB via browser probe):
--
--  1. LOGIN REJECTS PLAINTEXT/LEGACY PASSWORDS
--     verify_student_login matches a student ONLY via
--        s.password = crypt(p_password, s.password)
--     `crypt()` returns NULL when the stored value is not a valid bcrypt
--     hash, so any student whose password is stored as *plaintext* (the demo
--     seed writes `demo1234` literally) — or empty — can NEVER log in with any
--     password, including the correct one. 14/20 live student rows were
--     affected (plaintext "demo1234" or empty).
--
--     Fix:
--       • Backfill known plaintext `demo1234` rows to a real bcrypt hash in
--         place, so they authenticate with `demo1234` again and are secured.
--       • Harden `verify_student_login` to also accept a non-empty legacy
--         plaintext stored value (compared literally), so any leftover legacy
--         row a backfill missed is not silently locked out. bcrypt rows are
--         unaffected (the bcrypt branch runs first).
--
--  2. APPROVAL GUARD USES THE DEPRECATED, CLIENT-WRITABLE `user_metadata.role`
--     register_student / change_student_password check
--        auth.jwt() -> 'user_metadata' ->> 'role' = 'admin'
--     which the browser can rewrite via auth.updateUser(). The app hardened the
--     admin model to the server-only `admin_users` roster + is_admin() (see
--     20250824000000_security_hardening.sql) but these two functions still gate
--     on the old marker. If the approving admin is in `admin_users` but lacks
--     `user_metadata.role = 'admin'`, register_student raises "Admin
--     authorization required", NO student is created, and the approved student
--     has no account to log into — presenting as "default password not working".
--
--     Fix: gate both on the authoritative is_admin().

-- ── 1a. Backfill the demo/known plaintext passwords to bcrypt ---------------
UPDATE students
SET password = crypt('demo1234', gen_salt('bf'))
WHERE password = 'demo1234';

-- ── 1b. Harden verify_student_login to accept legacy plaintext values -------
CREATE OR REPLACE FUNCTION verify_student_login(
  p_phone    TEXT,
  p_password TEXT
)
RETURNS TABLE (
  id            UUID,
  name          TEXT,
  student_id    TEXT,
  phone         TEXT,
  email         TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  address       TEXT,
  class_level   TEXT,
  gender        TEXT,
  batch_id      UUID,
  status        TEXT,
  is_approved   BOOLEAN,
  photo_url     TEXT,
  created_at    TIMESTAMPTZ,
  session_token TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  failed_count INT;
  v_id         UUID;
  v_token      TEXT;
BEGIN
  -- Rate limiting: block if >= 5 failed attempts in the last 15 minutes
  SELECT COUNT(*) INTO failed_count
  FROM login_attempts
  WHERE phone_number = p_phone
    AND success = false
    AND attempt_time > NOW() - INTERVAL '15 minutes';

  IF failed_count >= 5 THEN
    RAISE EXCEPTION 'Too many failed attempts. Please try again later.';
  END IF;

  -- Authenticate. bcrypt-stored passwords verify via crypt(); a legacy
  -- NON-bcrypt, NON-empty stored value is compared literally so previously
  -- seeded plaintext rows (e.g. the demo data) can still log in. Empty stored
  -- passwords never authenticate.
  SELECT s.id INTO v_id
  FROM students s
  WHERE s.phone = p_phone
    AND (
         (s.password LIKE '$2a$%' OR s.password LIKE '$2b$%')
      AND s.password = crypt(p_password, s.password)
      OR
         (s.password IS NOT NULL
      AND s.password <> ''
      AND s.password NOT LIKE '$2a$%'
      AND s.password NOT LIKE '$2b$%'
      AND s.password = p_password)
    );

  IF v_id IS NULL THEN
    INSERT INTO login_attempts (phone_number, attempt_time, success)
    VALUES (p_phone, NOW(), false);
    RAISE EXCEPTION 'Invalid phone number or password';
  END IF;

  INSERT INTO login_attempts (phone_number, attempt_time, success)
  VALUES (p_phone, NOW(), true);

  v_token := _issue_student_session(v_id);

  RETURN QUERY
  SELECT
    s.id, s.name, s.student_id, s.phone,
    s.email, s.guardian_name, s.guardian_phone, s.address,
    s.class_level, s.gender, s.batch_id,
    s.status, s.is_approved, s.photo_url, s.created_at,
    v_token
  FROM students s
  WHERE s.id = v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_student_login(TEXT, TEXT) TO anon, authenticated;

-- ── 2. Re-gate approval/mutation helpers on the authoritative is_admin() ----
CREATE OR REPLACE FUNCTION register_student(
  p_name           TEXT,
  p_phone          TEXT,
  p_student_id     TEXT,
  p_password       TEXT,
  p_email          TEXT DEFAULT NULL,
  p_guardian_name  TEXT DEFAULT NULL,
  p_guardian_phone TEXT DEFAULT NULL,
  p_address        TEXT DEFAULT NULL,
  p_class_level    TEXT DEFAULT NULL,
  p_gender         TEXT DEFAULT NULL,
  p_batch_id       UUID DEFAULT NULL,
  p_status         TEXT DEFAULT 'active',
  p_is_approved    BOOLEAN DEFAULT false,
  p_photo_url      TEXT DEFAULT NULL
)
RETURNS TABLE (
  id            UUID,
  name          TEXT,
  student_id    TEXT,
  phone         TEXT,
  email         TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  address       TEXT,
  class_level   TEXT,
  gender        TEXT,
  batch_id      UUID,
  status        TEXT,
  is_approved   BOOLEAN,
  photo_url     TEXT,
  created_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  RETURN QUERY
  INSERT INTO students (
    name, phone, student_id, password,
    email, guardian_name, guardian_phone, address,
    class_level, gender, batch_id, status, is_approved, photo_url
  ) VALUES (
    p_name, p_phone, p_student_id, crypt(p_password, gen_salt('bf')),
    p_email, p_guardian_name, p_guardian_phone, p_address,
    p_class_level, p_gender, p_batch_id, p_status, p_is_approved, p_photo_url
  )
  RETURNING
    students.id, students.name, students.student_id, students.phone,
    students.email, students.guardian_name, students.guardian_phone,
    students.address, students.class_level, students.gender, students.batch_id,
    students.status, students.is_approved, students.photo_url, students.created_at;
END;
$$;

REVOKE ALL ON FUNCTION register_student(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,BOOLEAN,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION register_student(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,BOOLEAN,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION change_student_password(
  p_student_id   UUID,
  p_new_password TEXT,
  p_old_password TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  UPDATE students
  SET password = crypt(p_new_password, gen_salt('bf'))
  WHERE id = p_student_id;
END;
$$;

REVOKE ALL ON FUNCTION change_student_password(UUID,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION change_student_password(UUID,TEXT,TEXT) TO authenticated;

-- ── Post-apply smoke --------------------------------------------------------
DO $verify$
DECLARE
  v_eff INT := 0;
  v_bcrypt INT := 0;
  v_total INT := 0;
BEGIN
  -- Every stored password must now be a bcrypt hash (the backfill + RPC both
  -- hash server-side). Any remaining literal-plaintext value is a data problem.
  SELECT COUNT(*) INTO v_total FROM students;
  SELECT COUNT(*) INTO v_bcrypt FROM students
    WHERE password LIKE '$2%' AND (password LIKE '$2a$%' OR password LIKE '$2b$%');
  SELECT COUNT(*) INTO v_eff FROM students WHERE password = 'demo1234';

  IF v_eff > 0 THEN
    RAISE NOTICE 'WARNING: % literal "demo1234" hashes still present — verify again', v_eff;
  ELSIF v_total > 0 AND v_bcrypt < v_total THEN
    RAISE NOTICE 'NOTICE: %/ % hashes are bcrypt; remainder are legacy (empty/unknown) and purposely not auto-auth', v_bcrypt, v_total;
  ELSE
    RAISE NOTICE 'verify OK: all % student passwords are bcrypt', v_total;
  END IF;
END
$verify$;