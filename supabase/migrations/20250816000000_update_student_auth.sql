-- ============================================================
-- Student Password Security Migration (pgcrypto)
-- Run this ONCE in Supabase → SQL Editor
-- ============================================================

-- 1. Enable pgcrypto extension (provides crypt() and gen_salt())
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Register student (used for new student creation)
--    Takes plaintext password, hashes it with bcrypt, inserts record.
CREATE OR REPLACE FUNCTION register_student(
  p_name          TEXT,
  p_phone         TEXT,
  p_student_id    TEXT,
  p_password      TEXT,
  p_email         TEXT DEFAULT NULL,
  p_guardian_name TEXT DEFAULT NULL,
  p_guardian_phone TEXT DEFAULT NULL,
  p_address       TEXT DEFAULT NULL,
  p_class_level   TEXT DEFAULT NULL,
  p_gender        TEXT DEFAULT NULL,
  p_batch_id      UUID DEFAULT NULL,
  p_status        TEXT DEFAULT 'active',
  p_is_approved   BOOLEAN DEFAULT false,
  p_photo_url     TEXT DEFAULT NULL
)
RETURNS TABLE (
  id              UUID,
  name            TEXT,
  student_id      TEXT,
  phone           TEXT,
  email           TEXT,
  guardian_name   TEXT,
  guardian_phone  TEXT,
  address         TEXT,
  class_level     TEXT,
  gender          TEXT,
  batch_id        UUID,
  status          TEXT,
  is_approved     BOOLEAN,
  photo_url       TEXT,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
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
    students.email, students.guardian_name, students.guardian_phone, students.address,
    students.class_level, students.gender, students.batch_id,
    students.status, students.is_approved, students.photo_url, students.created_at;
END;
$$;

-- 3. Verify student login (used for portal authentication)
--    Compares plaintext password against stored bcrypt hash.
CREATE OR REPLACE FUNCTION verify_student_login(
  p_phone    TEXT,
  p_password TEXT
)
RETURNS TABLE (
  id              UUID,
  name            TEXT,
  student_id      TEXT,
  phone           TEXT,
  email           TEXT,
  guardian_name   TEXT,
  guardian_phone  TEXT,
  address         TEXT,
  class_level     TEXT,
  gender          TEXT,
  batch_id        UUID,
  status          TEXT,
  is_approved     BOOLEAN,
  photo_url       TEXT,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.name, s.student_id, s.phone,
    s.email, s.guardian_name, s.guardian_phone, s.address,
    s.class_level, s.gender, s.batch_id,
    s.status, s.is_approved, s.photo_url, s.created_at
  FROM students s
  WHERE s.phone = p_phone
    AND s.password = crypt(p_password, s.password);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid phone number or password';
  END IF;
END;
$$;

-- 4. Change student password (used for admin reset and student self-service)
--    If p_old_password is provided, verifies it before allowing change.
--    If p_old_password is NULL/empty, skips verification (admin bypass).
CREATE OR REPLACE FUNCTION change_student_password(
  p_student_id   UUID,
  p_new_password TEXT,
  p_old_password TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_old_password IS NOT NULL AND p_old_password != '' THEN
    -- Verify old password matches
    IF NOT EXISTS (
      SELECT 1 FROM students
      WHERE id = p_student_id
        AND password = crypt(p_old_password, password)
    ) THEN
      RAISE EXCEPTION 'Current password is incorrect';
    END IF;
  END IF;

  UPDATE students
  SET password = crypt(p_new_password, gen_salt('bf'))
  WHERE id = p_student_id;
END;
$$;

-- 5. Update existing plaintext passwords to bcrypt hashes
--    This hashes every password that doesn't look like a bcrypt hash yet.
UPDATE students
SET password = crypt(password, gen_salt('bf'))
WHERE password IS NOT NULL
  AND password != ''
  AND password NOT LIKE '$2a$%'
  AND password NOT LIKE '$2b$%'
  AND password NOT LIKE '$2y$%';

-- 5. Grant execute permissions to anon and authenticated roles
GRANT EXECUTE ON FUNCTION register_student(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,BOOLEAN,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_student_login(TEXT,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION change_student_password(UUID,TEXT,TEXT) TO anon, authenticated;

-- ============================================================
-- Done. The frontend should now call:
--   supabase.rpc('register_student', { ... })   — for signup/creation
--   supabase.rpc('verify_student_login', { phone, password }) — for login
-- ============================================================
