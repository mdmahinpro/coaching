-- ============================================================
-- Rate Limiting for Student Logins
-- Run this ONCE in Supabase → SQL Editor
-- ============================================================

-- 1. Create login_attempts table
CREATE TABLE IF NOT EXISTS login_attempts (
  id           BIGSERIAL PRIMARY KEY,
  phone_number TEXT NOT NULL,
  attempt_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success      BOOLEAN NOT NULL
);

-- 2. Index for fast rate-limit queries (phone + recent time + success)
CREATE INDEX IF NOT EXISTS idx_login_attempts_phone_time_success
  ON login_attempts (phone_number, attempt_time DESC, success);

-- 3. Update verify_student_login with rate limiting
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
DECLARE
  failed_count INT;
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

  RETURN QUERY
  SELECT
    s.id, s.name, s.student_id, s.phone,
    s.email, s.guardian_name, s.guardian_phone, s.address,
    s.class_level, s.gender, s.batch_id,
    s.status, s.is_approved, s.photo_url, s.created_at
  FROM students s
  WHERE s.phone = p_phone
    AND s.password = crypt(p_password, s.password);

  IF FOUND THEN
    -- Log successful attempt
    INSERT INTO login_attempts (phone_number, attempt_time, success)
    VALUES (p_phone, NOW(), true);
  ELSE
    -- Log failed attempt
    INSERT INTO login_attempts (phone_number, attempt_time, success)
    VALUES (p_phone, NOW(), false);
    RAISE EXCEPTION 'Invalid phone number or password';
  END IF;
END;
$$;

-- 4. Grant execute permission
GRANT EXECUTE ON FUNCTION verify_student_login(TEXT, TEXT) TO anon, authenticated;

-- 5. Allow anon role to insert into login_attempts (RPC runs as definer, but just in case)
GRANT INSERT ON login_attempts TO anon, authenticated;

-- ============================================================
-- Optional: Periodic cleanup of old attempts (run via pg_cron or manually)
-- Removes entries older than 24 hours to keep the table small.
-- ============================================================
-- CREATE OR REPLACE FUNCTION cleanup_old_login_attempts()
-- RETURNS void LANGUAGE plpgsql AS $$
-- BEGIN
--   DELETE FROM login_attempts WHERE attempt_time < NOW() - INTERVAL '24 hours';
-- END;
-- $$;
