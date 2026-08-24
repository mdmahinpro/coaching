-- ============================================================
-- Restore student authentication + portal RPCs
-- ============================================================
--
-- Recovery migration for projects where the exam RPC migration is present
-- but the student auth/session/portal migrations were not applied to the
-- same Supabase project. Run this in the target project's SQL Editor.
--
-- This script is intentionally self-contained and idempotent:
--   * it creates the session/rate-limit tables if absent;
--   * it replaces stale function signatures safely;
--   * it grants public callers only token-scoped portal operations;
--   * it restricts student creation/password reset to admin JWTs;
--   * it fails if any required function is still missing;
--   * it asks PostgREST to reload its schema cache.
--
-- Verify the target project URL in the Supabase dashboard before running.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Login rate-limit storage ──────────────────────────────────
CREATE TABLE IF NOT EXISTS login_attempts (
  id           BIGSERIAL PRIMARY KEY,
  phone_number TEXT NOT NULL,
  attempt_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success      BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_phone_time_success
  ON login_attempts (phone_number, attempt_time DESC, success);

ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON login_attempts FROM anon;
REVOKE ALL ON login_attempts FROM authenticated;

-- ── Opaque student sessions ───────────────────────────────────
CREATE TABLE IF NOT EXISTS student_sessions (
  token       TEXT PRIMARY KEY,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_sessions_student
  ON student_sessions (student_id);
CREATE INDEX IF NOT EXISTS idx_student_sessions_expires
  ON student_sessions (expires_at);

ALTER TABLE student_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON student_sessions FROM anon;
REVOKE ALL ON student_sessions FROM authenticated;

-- ── Drop stale signatures before recreating OUT shapes ─────────
DROP FUNCTION IF EXISTS register_student(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,BOOLEAN,TEXT);
DROP FUNCTION IF EXISTS verify_student_login(TEXT,TEXT);
DROP FUNCTION IF EXISTS change_student_password(UUID,TEXT,TEXT);
DROP FUNCTION IF EXISTS _student_id_from_token(TEXT);
DROP FUNCTION IF EXISTS _issue_student_session(UUID);
DROP FUNCTION IF EXISTS logout_student_session(TEXT);
DROP FUNCTION IF EXISTS portal_get_profile(TEXT);
DROP FUNCTION IF EXISTS portal_get_fees(TEXT);
DROP FUNCTION IF EXISTS portal_get_exams(TEXT);
DROP FUNCTION IF EXISTS portal_get_submissions(TEXT);
DROP FUNCTION IF EXISTS portal_get_notices(TEXT,TEXT);
DROP FUNCTION IF EXISTS portal_update_photo(TEXT,TEXT);
DROP FUNCTION IF EXISTS portal_change_password(TEXT,TEXT,TEXT);

-- ── Internal session helpers ──────────────────────────────────
CREATE FUNCTION _student_id_from_token(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id UUID;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RETURN NULL;
  END IF;

  SELECT ss.student_id INTO v_student_id
  FROM student_sessions ss
  JOIN students s ON s.id = ss.student_id
  WHERE ss.token = p_token
    AND ss.expires_at > NOW()
    AND s.is_approved = true
    AND s.status <> 'suspended';

  IF v_student_id IS NOT NULL THEN
    UPDATE student_sessions SET last_seen = NOW() WHERE token = p_token;
  END IF;

  RETURN v_student_id;
END;
$$;

CREATE FUNCTION _issue_student_session(p_student_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
BEGIN
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO student_sessions (token, student_id, expires_at)
  VALUES (v_token, p_student_id, NOW() + INTERVAL '7 days');

  DELETE FROM student_sessions
  WHERE student_id = p_student_id AND expires_at < NOW();

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION _student_id_from_token(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _issue_student_session(UUID) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION logout_student_session(p_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM student_sessions WHERE token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION logout_student_session(TEXT) TO anon, authenticated;

-- ── Admin-only student creation ───────────────────────────────
CREATE FUNCTION register_student(
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
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '') <> 'admin' THEN
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

-- ── Login: bcrypt verification + rate limiting + session token ─
CREATE FUNCTION verify_student_login(
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
SET search_path = public
AS $$
DECLARE
  failed_count INT;
  v_id UUID;
  v_token TEXT;
BEGIN
  SELECT COUNT(*) INTO failed_count
  FROM login_attempts
  WHERE phone_number = p_phone
    AND success = false
    AND attempt_time > NOW() - INTERVAL '15 minutes';

  IF failed_count >= 5 THEN
    RAISE EXCEPTION 'Too many failed attempts. Please try again later.';
  END IF;

  SELECT s.id INTO v_id
  FROM students s
  WHERE s.phone = p_phone
    AND s.password = crypt(p_password, s.password);

  IF v_id IS NULL THEN
    INSERT INTO login_attempts (phone_number, attempt_time, success)
    VALUES (p_phone, NOW(), false);
    RAISE EXCEPTION 'Invalid phone number or password';
  END IF;

  IF EXISTS (
    SELECT 1 FROM students
    WHERE id = v_id AND is_approved = false
  ) THEN
    INSERT INTO login_attempts (phone_number, attempt_time, success)
    VALUES (p_phone, NOW(), false);
    RAISE EXCEPTION 'Account is not approved yet';
  END IF;

  IF EXISTS (
    SELECT 1 FROM students
    WHERE id = v_id AND status = 'suspended'
  ) THEN
    INSERT INTO login_attempts (phone_number, attempt_time, success)
    VALUES (p_phone, NOW(), false);
    RAISE EXCEPTION 'Account is suspended';
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

GRANT EXECUTE ON FUNCTION verify_student_login(TEXT,TEXT) TO anon, authenticated;

-- ── Admin-only password reset ─────────────────────────────────
CREATE FUNCTION change_student_password(
  p_student_id   UUID,
  p_new_password TEXT,
  p_old_password TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', '') <> 'admin' THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  UPDATE students
  SET password = crypt(p_new_password, gen_salt('bf'))
  WHERE id = p_student_id;
END;
$$;

REVOKE ALL ON FUNCTION change_student_password(UUID,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION change_student_password(UUID,TEXT,TEXT) TO authenticated;

-- ── Portal profile ────────────────────────────────────────────
CREATE FUNCTION portal_get_profile(p_token TEXT)
RETURNS TABLE (
  id UUID, name TEXT, student_id TEXT, phone TEXT, email TEXT,
  class_level TEXT, batch_id UUID, batch_name TEXT, photo_url TEXT,
  status TEXT, is_approved BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  RETURN QUERY
  SELECT s.id, s.name, s.student_id, s.phone, s.email, s.class_level,
         s.batch_id, b.name, s.photo_url, s.status, s.is_approved
  FROM students s LEFT JOIN batches b ON b.id = s.batch_id WHERE s.id = v_sid;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_get_profile(TEXT) TO anon, authenticated;

-- ── Portal fees ───────────────────────────────────────────────
CREATE FUNCTION portal_get_fees(p_token TEXT)
RETURNS SETOF fees
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  RETURN QUERY SELECT * FROM fees f WHERE f.student_id = v_sid ORDER BY f.due_date DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_get_fees(TEXT) TO anon, authenticated;

-- ── Portal exams ──────────────────────────────────────────────
CREATE FUNCTION portal_get_exams(p_token TEXT)
RETURNS TABLE (
  id UUID, title TEXT, subject TEXT, exam_date TIMESTAMPTZ,
  duration_minutes INTEGER, total_marks INTEGER, pass_marks INTEGER,
  status TEXT, batch_id UUID, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sid UUID := _student_id_from_token(p_token); v_batch UUID;
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  SELECT s.batch_id INTO v_batch FROM students s WHERE s.id = v_sid;
  RETURN QUERY
  SELECT e.id, e.title, e.subject, e.exam_date, e.duration_minutes,
         e.total_marks, e.pass_marks, e.status, e.batch_id, e.start_time, e.end_time
  FROM exams e
  WHERE e.batch_id IS NULL OR e.batch_id = v_batch
  ORDER BY e.exam_date DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_get_exams(TEXT) TO anon, authenticated;

-- ── Portal submissions ────────────────────────────────────────
CREATE FUNCTION portal_get_submissions(p_token TEXT)
RETURNS TABLE (
  id UUID, exam_id UUID, score INTEGER, correct_count INTEGER,
  wrong_count INTEGER, time_taken INTEGER, rank INTEGER, answers JSONB,
  submitted_at TIMESTAMPTZ, exam_title TEXT, exam_subject TEXT,
  total_marks INTEGER, pass_marks INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  RETURN QUERY
  SELECT m.id, m.exam_id, m.score, m.correct_count, m.wrong_count,
         m.time_taken, m.rank, m.answers, m.submitted_at,
         e.title, e.subject, e.total_marks, e.pass_marks
  FROM mcq_submissions m JOIN exams e ON e.id = m.exam_id
  WHERE m.student_id = v_sid ORDER BY m.submitted_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_get_submissions(TEXT) TO anon, authenticated;

-- ── Portal notices ────────────────────────────────────────────
CREATE FUNCTION portal_get_notices(p_token TEXT, p_type TEXT DEFAULT NULL)
RETURNS SETOF notices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sid UUID := _student_id_from_token(p_token); v_batch UUID;
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  SELECT s.batch_id INTO v_batch FROM students s WHERE s.id = v_sid;
  RETURN QUERY
  SELECT * FROM notices n
  WHERE n.is_published = true
    AND (n.target = 'all' OR (n.target = 'batch' AND n.batch_id = v_batch))
    AND (p_type IS NULL OR n.type = p_type)
  ORDER BY n.is_pinned DESC, n.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_get_notices(TEXT,TEXT) TO anon, authenticated;

-- ── Portal profile photo ──────────────────────────────────────
CREATE FUNCTION portal_update_photo(p_token TEXT, p_photo_url TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  UPDATE students SET photo_url = p_photo_url WHERE id = v_sid;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_update_photo(TEXT,TEXT) TO anon, authenticated;

-- ── Portal password change ────────────────────────────────────
CREATE FUNCTION portal_change_password(
  p_token TEXT, p_old_password TEXT, p_new_password TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = v_sid AND password = crypt(p_old_password, password)
  ) THEN
    RAISE EXCEPTION 'Current password is incorrect';
  END IF;
  UPDATE students SET password = crypt(p_new_password, gen_salt('bf')) WHERE id = v_sid;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_change_password(TEXT,TEXT,TEXT) TO anon, authenticated;

-- ── Fail loudly if this recovery was run in the wrong project ──
DO $$
DECLARE missing_functions TEXT[];
BEGIN
  SELECT ARRAY_AGG(required.signature)
  INTO missing_functions
  FROM UNNEST(ARRAY[
    'register_student(text,text,text,text,text,text,text,text,text,text,uuid,text,boolean,text)',
    'verify_student_login(text,text)',
    'logout_student_session(text)',
    'portal_get_profile(text)',
    'portal_get_fees(text)',
    'portal_get_exams(text)',
    'portal_get_submissions(text)',
    'portal_get_notices(text,text)',
    'portal_update_photo(text,text)',
    'portal_change_password(text,text,text)'
  ]) AS required(signature)
  WHERE TO_REGPROCEDURE('public.' || required.signature) IS NULL;

  IF missing_functions IS NOT NULL THEN
    RAISE EXCEPTION 'Student portal recovery incomplete. Missing functions: %', missing_functions;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
