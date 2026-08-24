-- ============================================================
-- Portal Data-Access RPCs  (Path-B secure student access)
-- Run this ONCE in Supabase → SQL Editor AFTER 20250818000000.
-- ============================================================
--
-- Every function resolves the acting student from a session token
-- (see 20250818000000_student_sessions.sql) and only ever returns/writes
-- that student's own rows. The anon client stops selecting students /
-- fees / exams / mcq_* directly; RLS (see 20250818000002) denies those.
-- ============================================================

-- ── Drop prior versions first ────────────────────────────────
-- CREATE OR REPLACE cannot change a function's return type, and some of
-- these (notably verify_student_login) already exist from earlier
-- migrations with a different OUT shape. Dropping by exact signature makes
-- this migration safely re-runnable.
DROP FUNCTION IF EXISTS verify_student_login(TEXT, TEXT);
DROP FUNCTION IF EXISTS portal_get_profile(TEXT);
DROP FUNCTION IF EXISTS portal_get_fees(TEXT);
DROP FUNCTION IF EXISTS portal_get_exams(TEXT);
DROP FUNCTION IF EXISTS portal_get_submissions(TEXT);
DROP FUNCTION IF EXISTS portal_get_notices(TEXT, TEXT);
DROP FUNCTION IF EXISTS portal_update_photo(TEXT, TEXT);
DROP FUNCTION IF EXISTS portal_change_password(TEXT, TEXT, TEXT);

-- ── LOGIN: verify + mint session token ───────────────────────
-- Adds session_token to the returned row (additive; existing fields kept).
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
  created_at      TIMESTAMPTZ,
  session_token   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  SELECT s.id INTO v_id
  FROM students s
  WHERE s.phone = p_phone
    AND s.password = crypt(p_password, s.password);

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

-- ── PROFILE: fetch own row (replaces students select) ────────
CREATE OR REPLACE FUNCTION portal_get_profile(p_token TEXT)
RETURNS TABLE (
  id            UUID,
  name          TEXT,
  student_id    TEXT,
  phone         TEXT,
  email         TEXT,
  class_level   TEXT,
  batch_id      UUID,
  batch_name    TEXT,
  photo_url     TEXT,
  status        TEXT,
  is_approved   BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;

  RETURN QUERY
  SELECT s.id, s.name, s.student_id, s.phone, s.email, s.class_level,
         s.batch_id, b.name, s.photo_url, s.status, s.is_approved
  FROM students s
  LEFT JOIN batches b ON b.id = s.batch_id
  WHERE s.id = v_sid;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_get_profile(TEXT) TO anon, authenticated;

-- ── FEES: own fee rows only ──────────────────────────────────
CREATE OR REPLACE FUNCTION portal_get_fees(p_token TEXT)
RETURNS SETOF fees
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;

  RETURN QUERY
  SELECT * FROM fees f
  WHERE f.student_id = v_sid
  ORDER BY f.due_date DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_get_fees(TEXT) TO anon, authenticated;

-- ── EXAMS: exams visible to this student's batch (no answer key) ─
CREATE OR REPLACE FUNCTION portal_get_exams(p_token TEXT)
RETURNS TABLE (
  id               UUID,
  title            TEXT,
  subject          TEXT,
  exam_date        TIMESTAMPTZ,
  duration_minutes INTEGER,
  total_marks      INTEGER,
  pass_marks       INTEGER,
  status           TEXT,
  batch_id         UUID,
  start_time       TIMESTAMPTZ,
  end_time         TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid   UUID := _student_id_from_token(p_token);
  v_batch UUID;
BEGIN
  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;

  SELECT s.batch_id INTO v_batch FROM students s WHERE s.id = v_sid;

  RETURN QUERY
  SELECT e.id, e.title, e.subject, e.exam_date, e.duration_minutes,
         e.total_marks, e.pass_marks, e.status, e.batch_id,
         e.start_time, e.end_time
  FROM exams e
  WHERE e.batch_id IS NULL OR e.batch_id = v_batch
  ORDER BY e.exam_date DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_get_exams(TEXT) TO anon, authenticated;

-- ── SUBMISSIONS: own results with exam metadata (no answer key) ─
CREATE OR REPLACE FUNCTION portal_get_submissions(p_token TEXT)
RETURNS TABLE (
  id            UUID,
  exam_id       UUID,
  score         INTEGER,
  correct_count INTEGER,
  wrong_count   INTEGER,
  time_taken    INTEGER,
  rank          INTEGER,
  answers       JSONB,
  submitted_at  TIMESTAMPTZ,
  exam_title    TEXT,
  exam_subject  TEXT,
  total_marks   INTEGER,
  pass_marks    INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;

  RETURN QUERY
  SELECT m.id, m.exam_id, m.score, m.correct_count, m.wrong_count,
         m.time_taken, m.rank, m.answers, m.submitted_at,
         e.title, e.subject, e.total_marks, e.pass_marks
  FROM mcq_submissions m
  JOIN exams e ON e.id = m.exam_id
  WHERE m.student_id = v_sid
  ORDER BY m.submitted_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_get_submissions(TEXT) TO anon, authenticated;

-- ── NOTICES: published notices for this student's batch / all ─
CREATE OR REPLACE FUNCTION portal_get_notices(p_token TEXT, p_type TEXT DEFAULT NULL)
RETURNS SETOF notices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid   UUID := _student_id_from_token(p_token);
  v_batch UUID;
BEGIN
  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;

  SELECT s.batch_id INTO v_batch FROM students s WHERE s.id = v_sid;

  RETURN QUERY
  SELECT * FROM notices n
  WHERE n.is_published = true
    AND (n.target = 'all' OR (n.target = 'batch' AND n.batch_id = v_batch))
    AND (p_type IS NULL OR n.type = p_type)
  ORDER BY n.is_pinned DESC, n.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_get_notices(TEXT, TEXT) TO anon, authenticated;

-- ── PROFILE PHOTO: update own photo_url only ─────────────────
CREATE OR REPLACE FUNCTION portal_update_photo(p_token TEXT, p_photo_url TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;

  UPDATE students SET photo_url = p_photo_url WHERE id = v_sid;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_update_photo(TEXT, TEXT) TO anon, authenticated;

-- ── CHANGE PASSWORD: token-scoped (student self-service) ─────
--    Admin reset path stays on change_student_password(UUID,...).
CREATE OR REPLACE FUNCTION portal_change_password(
  p_token        TEXT,
  p_old_password TEXT,
  p_new_password TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = v_sid AND password = crypt(p_old_password, password)
  ) THEN
    RAISE EXCEPTION 'Current password is incorrect';
  END IF;

  UPDATE students
  SET password = crypt(p_new_password, gen_salt('bf'))
  WHERE id = v_sid;
END;
$$;

GRANT EXECUTE ON FUNCTION portal_change_password(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── Verify the complete portal RPC surface before reporting success ────────
DO $$
DECLARE
  missing_functions TEXT[];
BEGIN
  SELECT ARRAY_AGG(signature)
  INTO missing_functions
  FROM UNNEST(ARRAY[
    'verify_student_login(text,text)',
    'portal_get_profile(text)',
    'portal_get_fees(text)',
    'portal_get_exams(text)',
    'portal_get_submissions(text)',
    'portal_get_notices(text,text)',
    'portal_update_photo(text,text)',
    'portal_change_password(text,text,text)'
  ]) AS required(signature)
  WHERE TO_REGPROCEDURE('public.' || signature) IS NULL;

  IF missing_functions IS NOT NULL THEN
    RAISE EXCEPTION 'Portal RPC migration incomplete. Missing functions: %', missing_functions;
  END IF;
END;
$$;

-- Ask Supabase PostgREST to expose the newly created functions immediately.
NOTIFY pgrst, 'reload schema';
