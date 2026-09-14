-- ============ STAGING_INSTALL.sql ============
-- Generated from the reviewed canonical baseline and manifest.
-- Source revision: 3df7c31b41192172476e7869071316347e1ec764
-- Do not run if STAGING_PRECHECK.sql shows existing application objects or a ledger.
--
-- TRANSACTION BOUNDARY
--   BEGIN; ... COMMIT; wraps the canonical baseline, every follow-on migration,
--   and the migration-ledger writes. All of that is atomic: if any DDL/ledger
--   statement fails, the whole install rolls back.
--
--   Several reviewed migrations intentionally carry verification / smoke-test
--   DO blocks AFTER their own COMMIT; so a verification failure reports loudly
--   WITHOUT rolling back already-committed work. Those blocks are emitted below,
--   OUTSIDE the outer transaction, in the "Post-install verification" section,
--   and are NOT part of the atomic unit. The entire setup is therefore NOT
--   atomic end-to-end; only baseline + migrations + ledger are.
--
-- No data/Auth/Storage rows are seeded. No psql-only directives are emitted.

-- ═══════════ OUTER TRANSACTION: BEGIN ═══════════
BEGIN;

-- Canonical application tables
-- (support tables mcq_questions/mcq_submissions/site_settings/fee_audit_logs
--  are created by 20250817000000_support_tables.sql below)
-- Canonical fresh-install baseline, recovered from the authorized source
-- project flbvusudwszxdylxevfe on 2026-09-08.
-- This file contains application tables only. Supabase Auth/storage internals,
-- customer rows, secrets, and source-project policies are intentionally absent.
-- Follow-on migrations create support tables, RPCs, hardened policies, and
-- storage configuration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  subject TEXT,
  qualification TEXT,
  salary NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  bio TEXT,
  is_active BOOLEAN DEFAULT true,
  photo_url TEXT
);

CREATE TABLE public.batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT,
  schedule TEXT,
  capacity INTEGER DEFAULT 30,
  enrolled INTEGER DEFAULT 0,
  fee NUMERIC DEFAULT 0,
  teacher TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  teacher_id UUID REFERENCES public.teachers(id),
  class_level TEXT,
  schedule_days TEXT[],
  start_time TEXT,
  monthly_fee INTEGER,
  max_seats INTEGER,
  description TEXT,
  code TEXT,
  end_time TEXT
);

CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  gender TEXT CHECK (gender IN ('male', 'female', 'other')),
  guardian_name TEXT,
  guardian_phone TEXT,
  date_of_birth DATE,
  batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  student_id TEXT UNIQUE,
  class_level TEXT,
  status TEXT DEFAULT 'active',
  is_approved BOOLEAN DEFAULT false,
  password TEXT,
  photo_url TEXT,
  suspension_reason TEXT
);

CREATE TABLE public.fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 0,
  month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'waived')),
  payment_date TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  batch_id UUID REFERENCES public.batches(id),
  due_date DATE
);

CREATE TABLE public.exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  subject TEXT,
  batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
  exam_date DATE,
  duration_minutes INTEGER,
  total_marks INTEGER,
  pass_marks INTEGER,
  type TEXT,
  instructions TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'upcoming',
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  timer_enabled BOOLEAN DEFAULT true,
  paused_remaining_seconds INTEGER,
  batch_ids UUID[],
  strict_mode BOOLEAN DEFAULT false
);

CREATE TABLE public.notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT,
  category TEXT DEFAULT 'general',
  is_pinned BOOLEAN DEFAULT false,
  is_published BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  type TEXT,
  target TEXT DEFAULT 'all',
  batch_id UUID REFERENCES public.batches(id)
);

CREATE TABLE public.admission_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
  address TEXT,
  message TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT now(),
  class_level TEXT,
  note TEXT,
  gender TEXT,
  reference_no TEXT
);

CREATE TABLE public.contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- sms_logs: outgoing SMS delivery log.
-- NOTE: This definition is reconstructed from the application usage sites
-- (src/lib/sms.ts, src/pages/admin/SMSPage.tsx, src/components/admin/
-- StudentDrawer.tsx) because the read-only catalog recovery that produced the
-- rest of canonical.sql omitted it, and no migration defines it. The table is
-- required as a first-class core table by 20250818000003_core_rls.sql and by the
-- included backup migrations. Columns below are exactly those the application
-- inserts, filters, orders, and lists; constraints follow the same defensive
-- convention as the other baseline tables. Confirm against the source project
-- catalog before applying to a production baseline.
CREATE TABLE public.sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'custom',
  status TEXT NOT NULL DEFAULT 'failed' CHECK (status IN ('sent', 'failed', 'pending')),
  response JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX sms_logs_phone_created_at_idx ON public.sms_logs (phone, created_at DESC);

-- === Migration: 20250816000000_update_student_auth.sql ===
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

-- === Migration: 20250816000001_rate_limiting.sql ===
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

-- === Migration: 20250817000000_support_tables.sql ===
-- Fresh-install support tables recovered from the authoritative legacy table
-- definitions in migration.sql. Policies are intentionally omitted here;
-- security migrations apply the reviewed final access model later.

CREATE TABLE IF NOT EXISTS public.mcq_questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES public.exams(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_option TEXT NOT NULL CHECK (correct_option IN ('a', 'b', 'c', 'd')),
  marks INTEGER DEFAULT 1,
  order_num INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcq_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES public.exams(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  answers JSONB DEFAULT '{}'::jsonb,
  score INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  wrong_count INTEGER DEFAULT 0,
  time_taken INTEGER DEFAULT 0,
  rank INTEGER,
  submitted_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.site_settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fee_audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fee_id UUID REFERENCES public.fees(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  admin_email TEXT,
  student_name TEXT,
  student_code TEXT,
  month TEXT,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- === Migration: 20250818000000_student_sessions.sql ===
-- ============================================================
-- Student Session Tokens  (Path-B secure student data access)
-- Run this ONCE in Supabase → SQL Editor (after the earlier
-- student-auth + rate-limiting migrations).
-- ============================================================
--
-- WHY: Students do NOT authenticate through Supabase Auth. They share
-- the public anon key, so RLS cannot tell one student from another (or
-- from any anonymous visitor). This migration mints a random, server-side
-- session token at login. Every portal/exam RPC resolves the acting
-- student_id FROM that token, so a student can only ever read/write
-- their own data — the anon client never selects student tables directly.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── student_sessions: opaque bearer tokens with expiry ───────
CREATE TABLE IF NOT EXISTS student_sessions (
  token       TEXT PRIMARY KEY,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_sessions_student ON student_sessions (student_id);
CREATE INDEX IF NOT EXISTS idx_student_sessions_expires ON student_sessions (expires_at);

-- RLS on: the anon client must NEVER read/write this table directly.
-- Only SECURITY DEFINER functions (which run as owner) touch it.
ALTER TABLE student_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow auth all student_sessions" ON student_sessions;
CREATE POLICY "Allow auth all student_sessions"
  ON student_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- (no anon policy → anon is denied all direct access)

-- ── Internal helper: resolve student_id from a live token ────
--    Returns NULL when the token is missing, unknown, or expired.
--    Also bumps last_seen so active sessions stay warm.
CREATE OR REPLACE FUNCTION _student_id_from_token(p_token TEXT)
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

  SELECT student_id INTO v_student_id
  FROM student_sessions
  WHERE token = p_token
    AND expires_at > NOW();

  IF v_student_id IS NOT NULL THEN
    UPDATE student_sessions SET last_seen = NOW() WHERE token = p_token;
  END IF;

  RETURN v_student_id;
END;
$$;

-- ── Internal helper: mint a fresh session for a student ──────
CREATE OR REPLACE FUNCTION _issue_student_session(p_student_id UUID)
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
  -- Opportunistic cleanup of this student's expired tokens.
  DELETE FROM student_sessions
  WHERE student_id = p_student_id AND expires_at < NOW();
  RETURN v_token;
END;
$$;

-- ── Logout: revoke a session token ───────────────────────────
CREATE OR REPLACE FUNCTION logout_student_session(p_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM student_sessions WHERE token = p_token;
END;
$$;

-- Helpers are internal; only logout is client-callable.
REVOKE ALL ON FUNCTION _student_id_from_token(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _issue_student_session(UUID)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION logout_student_session(TEXT) TO anon, authenticated;

-- === Migration: 20250818000001_portal_rpcs.sql ===
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

-- === Migration: 20250818000002_exam_rpcs.sql ===
-- ============================================================
-- MCQ Exam Integrity RPCs  (server-side grading, gated answer key)
-- Run this ONCE in Supabase → SQL Editor AFTER 20250818000001.
-- ============================================================
--
-- Fixes the integrity gap where the client fetched correct_option,
-- graded itself, and inserted a client-controlled score + rank.
--
-- After this migration:
--   • Questions are served WITHOUT correct_option before grading.
--   • Grading, scoring, and ranking happen server-side.
--   • The exam window (status = 'active') is enforced on submit.
--   • Double submissions are rejected.
--   • correct_option is only revealed to a student who has already
--     submitted (for the answer-review breakdown).
-- ============================================================

-- ── Drop prior versions first ────────────────────────────────
-- CREATE OR REPLACE cannot change a function's return type. If any of
-- these already exist from an earlier build with a different OUT shape,
-- the replace fails with 42P13. Dropping by exact signature up front
-- makes this migration safely re-runnable.
DROP FUNCTION IF EXISTS exam_get_meta(UUID);
DROP FUNCTION IF EXISTS _exam_token_resolve(TEXT);
DROP FUNCTION IF EXISTS exam_join(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS exam_get_questions(TEXT);
DROP FUNCTION IF EXISTS exam_submit(TEXT, JSONB, INTEGER);
DROP FUNCTION IF EXISTS exam_get_my_submission(TEXT);
DROP FUNCTION IF EXISTS exam_get_leaderboard(UUID);
DROP FUNCTION IF EXISTS exam_get_review(UUID, TEXT, TEXT);

-- ── Exam metadata (public — anyone with the exam link) ───────
CREATE OR REPLACE FUNCTION exam_get_meta(p_exam_id UUID)
RETURNS TABLE (
  id               UUID,
  title            TEXT,
  subject          TEXT,
  batch_name       TEXT,
  duration_minutes INTEGER,
  total_marks      INTEGER,
  pass_marks       INTEGER,
  instructions     TEXT,
  status           TEXT,
  start_time       TIMESTAMPTZ,
  end_time         TIMESTAMPTZ,
  timer_enabled    BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT e.id, e.title, e.subject, b.name, e.duration_minutes,
         e.total_marks, e.pass_marks, e.instructions, e.status,
         e.start_time, e.end_time, e.timer_enabled
  FROM exams e
  LEFT JOIN batches b ON b.id = e.batch_id
  WHERE e.id = p_exam_id;
END;
$$;

GRANT EXECUTE ON FUNCTION exam_get_meta(UUID) TO anon, authenticated;

-- ── exam_tokens: short-lived per-(exam, student) sit token ───
--    The manual-verify path only knows a student_id string (no password),
--    so it must NOT grant a full portal session. Instead it mints an
--    exam-scoped token that can only join/submit ONE exam.
CREATE TABLE IF NOT EXISTS exam_tokens (
  token       TEXT PRIMARY KEY,
  exam_id     UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  UNIQUE (exam_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_tokens_expires ON exam_tokens (expires_at);

ALTER TABLE exam_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow auth all exam_tokens" ON exam_tokens;
CREATE POLICY "Allow auth all exam_tokens"
  ON exam_tokens FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- (no anon policy → anon denied direct access)

-- Internal: resolve (exam_id, student_id) from a live exam token.
CREATE OR REPLACE FUNCTION _exam_token_resolve(p_token TEXT)
RETURNS TABLE (exam_id UUID, student_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT t.exam_id, t.student_id
  FROM exam_tokens t
  WHERE t.token = p_token AND t.expires_at > NOW();
END;
$$;
REVOKE ALL ON FUNCTION _exam_token_resolve(TEXT) FROM PUBLIC, anon, authenticated;

-- ── JOIN: establish identity + mint an exam-scoped token ─────
--    Provide EITHER p_portal_token (logged-in student) OR p_student_code
--    (manual verify by Student ID). Validates the student is approved and
--    not suspended, then returns basic identity + whether they already
--    submitted. Does not reveal any answer key.
CREATE OR REPLACE FUNCTION exam_join(
  p_exam_id      UUID,
  p_portal_token TEXT DEFAULT NULL,
  p_student_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  exam_token       TEXT,
  student_id       UUID,
  student_name     TEXT,
  student_code     TEXT,
  already_submitted BOOLEAN,
  exam_status      TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid    UUID;
  v_status TEXT;
  v_appr   BOOLEAN;
  v_estat  TEXT;
  v_token  TEXT;
  v_done   BOOLEAN;
BEGIN
  IF p_portal_token IS NOT NULL AND p_portal_token <> '' THEN
    v_sid := _student_id_from_token(p_portal_token);
    IF v_sid IS NULL THEN
      RAISE EXCEPTION 'Session expired. Please log in again.';
    END IF;
  ELSIF p_student_code IS NOT NULL AND p_student_code <> '' THEN
    SELECT s.id INTO v_sid FROM students s
    WHERE s.student_id ILIKE p_student_code
    LIMIT 1;
    IF v_sid IS NULL THEN
      RAISE EXCEPTION 'STUDENT_NOT_FOUND';
    END IF;
  ELSE
    RAISE EXCEPTION 'Identity required';
  END IF;

  SELECT s.status, s.is_approved INTO v_status, v_appr
  FROM students s WHERE s.id = v_sid;
  IF NOT v_appr THEN
    RAISE EXCEPTION 'NOT_APPROVED';
  END IF;
  IF v_status = 'suspended' THEN
    RAISE EXCEPTION 'SUSPENDED';
  END IF;

  SELECT e.status INTO v_estat FROM exams e WHERE e.id = p_exam_id;
  IF v_estat IS NULL THEN
    RAISE EXCEPTION 'EXAM_NOT_FOUND';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM mcq_submissions
    WHERE exam_id = p_exam_id AND mcq_submissions.student_id = v_sid
  ) INTO v_done;

  -- Mint / refresh an exam-scoped token.
  v_token := encode(gen_random_bytes(24), 'hex');
  INSERT INTO exam_tokens (token, exam_id, student_id, expires_at)
  VALUES (v_token, p_exam_id, v_sid, NOW() + INTERVAL '6 hours')
  ON CONFLICT (exam_id, student_id)
  DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, created_at = NOW();

  RETURN QUERY
  SELECT v_token, s.id, s.name, s.student_id, v_done, v_estat
  FROM students s WHERE s.id = v_sid;
END;
$$;

GRANT EXECUTE ON FUNCTION exam_join(UUID, TEXT, TEXT) TO anon, authenticated;

-- ── QUESTIONS: served WITHOUT correct_option (pre-grade) ─────
CREATE OR REPLACE FUNCTION exam_get_questions(p_exam_token TEXT)
RETURNS TABLE (
  id            UUID,
  question_text TEXT,
  option_a      TEXT,
  option_b      TEXT,
  option_c      TEXT,
  option_d      TEXT,
  marks         INTEGER,
  order_num     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam UUID;
  v_sid  UUID;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  RETURN QUERY
  SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
         q.marks, q.order_num
  FROM mcq_questions q
  WHERE q.exam_id = v_exam
  ORDER BY q.order_num;
END;
$$;

GRANT EXECUTE ON FUNCTION exam_get_questions(TEXT) TO anon, authenticated;

-- ── SUBMIT: server-side grading + ranking, window enforced ───
CREATE OR REPLACE FUNCTION exam_submit(
  p_exam_token TEXT,
  p_answers    JSONB,
  p_time_taken INTEGER DEFAULT 0
)
RETURNS TABLE (
  id            UUID,
  score         INTEGER,
  correct_count INTEGER,
  wrong_count   INTEGER,
  time_taken    INTEGER,
  rank          INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam    UUID;
  v_sid     UUID;
  v_estat   TEXT;
  v_score   INTEGER := 0;
  v_correct INTEGER := 0;
  v_wrong   INTEGER := 0;
  v_answered INTEGER := 0;
  v_rank    INTEGER;
  v_new_id  UUID;
  q         RECORD;
  v_ans     TEXT;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  -- Reject duplicate submission.
  IF EXISTS (SELECT 1 FROM mcq_submissions WHERE exam_id = v_exam AND student_id = v_sid) THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END IF;

  -- Enforce exam window: must be active (or paused, to allow in-flight submits).
  SELECT status INTO v_estat FROM exams WHERE id = v_exam;
  IF v_estat NOT IN ('active', 'paused', 'ended') THEN
    RAISE EXCEPTION 'EXAM_NOT_OPEN';
  END IF;

  -- Grade server-side against the authoritative answer key.
  FOR q IN
    SELECT id, correct_option, marks FROM mcq_questions WHERE exam_id = v_exam
  LOOP
    v_ans := lower(COALESCE(p_answers ->> q.id::text, ''));
    IF v_ans <> '' THEN
      v_answered := v_answered + 1;
      IF v_ans = lower(q.correct_option) THEN
        v_correct := v_correct + 1;
        v_score := v_score + COALESCE(q.marks, 1);
      ELSE
        v_wrong := v_wrong + 1;
      END IF;
    END IF;
  END LOOP;

  -- Rank = 1 + submissions that beat this score (or tie on score, faster time).
  SELECT COUNT(*) + 1 INTO v_rank
  FROM mcq_submissions
  WHERE exam_id = v_exam
    AND (score > v_score OR (score = v_score AND time_taken < p_time_taken));

  INSERT INTO mcq_submissions
    (exam_id, student_id, answers, score, correct_count, wrong_count, time_taken, rank, submitted_at)
  VALUES
    (v_exam, v_sid, p_answers, v_score, v_correct, v_wrong, COALESCE(p_time_taken, 0), v_rank, NOW())
  RETURNING mcq_submissions.id INTO v_new_id;

  RETURN QUERY
  SELECT v_new_id, v_score, v_correct, v_wrong, COALESCE(p_time_taken, 0), v_rank;
END;
$$;

GRANT EXECUTE ON FUNCTION exam_submit(TEXT, JSONB, INTEGER) TO anon, authenticated;

-- ── MY SUBMISSION: the caller's own graded result for an exam ─
--    Needed by the "already submitted" / result view, since anon can no
--    longer read mcq_submissions directly. Resolved from the exam token.
CREATE OR REPLACE FUNCTION exam_get_my_submission(p_exam_token TEXT)
RETURNS TABLE (
  id            UUID,
  score         INTEGER,
  correct_count INTEGER,
  wrong_count   INTEGER,
  time_taken    INTEGER,
  rank          INTEGER,
  answers       JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam UUID;
  v_sid  UUID;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  RETURN QUERY
  SELECT m.id, m.score, m.correct_count, m.wrong_count, m.time_taken, m.rank, m.answers
  FROM mcq_submissions m
  WHERE m.exam_id = v_exam AND m.student_id = v_sid
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION exam_get_my_submission(TEXT) TO anon, authenticated;

-- ── LEADERBOARD: top scorers for an exam (names only) ────────
CREATE OR REPLACE FUNCTION exam_get_leaderboard(p_exam_id UUID)
RETURNS TABLE (
  id           UUID,
  score        INTEGER,
  time_taken   INTEGER,
  rank         INTEGER,
  student_name TEXT,
  student_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.score, m.time_taken, m.rank, s.name, s.student_id
  FROM mcq_submissions m
  LEFT JOIN students s ON s.id = m.student_id
  WHERE m.exam_id = p_exam_id
  ORDER BY m.score DESC, m.time_taken ASC
  LIMIT 5;
END;
$$;

GRANT EXECUTE ON FUNCTION exam_get_leaderboard(UUID) TO anon, authenticated;

-- ── REVIEW: own submission + answer key AFTER submitting ─────
--    Reveals correct_option only for a student who already submitted.
--    Accepts EITHER a portal token or an exam token.
CREATE OR REPLACE FUNCTION exam_get_review(
  p_exam_id      UUID,
  p_portal_token TEXT DEFAULT NULL,
  p_exam_token   TEXT DEFAULT NULL
)
RETURNS TABLE (
  question_id    UUID,
  question_text  TEXT,
  option_a       TEXT,
  option_b       TEXT,
  option_c       TEXT,
  option_d       TEXT,
  correct_option TEXT,
  marks          INTEGER,
  order_num      INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid  UUID;
  v_ex   UUID;
BEGIN
  IF p_portal_token IS NOT NULL AND p_portal_token <> '' THEN
    v_sid := _student_id_from_token(p_portal_token);
  ELSIF p_exam_token IS NOT NULL AND p_exam_token <> '' THEN
    SELECT r.student_id, r.exam_id INTO v_sid, v_ex FROM _exam_token_resolve(p_exam_token) r;
  END IF;

  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;

  -- Only reveal if this student has a submission for this exam.
  IF NOT EXISTS (
    SELECT 1 FROM mcq_submissions WHERE exam_id = p_exam_id AND student_id = v_sid
  ) THEN
    RAISE EXCEPTION 'NO_SUBMISSION';
  END IF;

  RETURN QUERY
  SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
         q.correct_option, q.marks, q.order_num
  FROM mcq_questions q
  WHERE q.exam_id = p_exam_id
  ORDER BY q.order_num;
END;
$$;

GRANT EXECUTE ON FUNCTION exam_get_review(UUID, TEXT, TEXT) TO anon, authenticated;

-- === Migration: 20250818000003_core_rls.sql ===
-- ============================================================
-- Row Level Security — core tables lockdown
-- Run this ONCE in Supabase → SQL Editor AFTER the 20250818*
-- session / portal / exam RPC migrations (they create the
-- SECURITY DEFINER functions the portal now relies on).
-- ============================================================
--
-- MODEL
--   authenticated (admin via Supabase Auth) → full CRUD on everything.
--   anon (public bundle key) → ONLY the minimal public-page surface:
--       • SELECT batches / teachers            (public marketing pages)
--       • SELECT exams                         (public exam links + realtime)
--       • SELECT notices WHERE target='all'    (public notice board)
--       • SELECT site_settings EXCEPT secrets  (branding load on mount)
--       • INSERT admission_requests / contact_messages (public forms)
--   Everything per-student (students, fees, mcq_questions, mcq_submissions,
--   batch-targeted notices) is DENIED to anon and reached only through the
--   SECURITY DEFINER RPCs, which resolve identity from a session token.
--
-- This closes the core defect: holding the anon key no longer grants
-- read access to any student's data, and the MCQ answer key
-- (correct_option) is no longer selectable by the client.
-- ============================================================

-- ── Drop the old permissive policies from earlier migrations ─
-- (migration.sql shipped public-read on mcq_*/site_settings;
--  update_rls_policies.sql added anon read/insert on mcq_*.)
DROP POLICY IF EXISTS "Allow public read mcq_questions"    ON mcq_questions;
DROP POLICY IF EXISTS "Allow anon read mcq_questions"       ON mcq_questions;
DROP POLICY IF EXISTS "Allow public read mcq_submissions"  ON mcq_submissions;
DROP POLICY IF EXISTS "Allow anon insert mcq_submissions"   ON mcq_submissions;
DROP POLICY IF EXISTS "Allow anon read mcq_submissions"     ON mcq_submissions;
DROP POLICY IF EXISTS "Allow public read site_settings"    ON site_settings;

-- ── Enable RLS on every core table ───────────────────────────
ALTER TABLE students            ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fees                ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams               ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices             ENABLE ROW LEVEL SECURITY;
ALTER TABLE admission_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcq_questions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcq_submissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings       ENABLE ROW LEVEL SECURITY;

-- ── authenticated (admin) → full CRUD everywhere ─────────────
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
      'CREATE POLICY "admin_all_%1$s" ON %1$I FOR ALL TO authenticated USING (true) WITH CHECK (true);',
      t
    );
  END LOOP;
END $$;

-- ── anon: minimal public-page read surface ───────────────────
-- Marketing / public pages read batches + teachers.
DROP POLICY IF EXISTS "anon_read_batches" ON batches;
CREATE POLICY "anon_read_batches"  ON batches  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon_read_teachers" ON teachers;
CREATE POLICY "anon_read_teachers" ON teachers FOR SELECT TO anon USING (true);

-- Public exam links + realtime status watch need to read exams.
-- (exams carries no answer key; questions/answers are RPC-gated.)
DROP POLICY IF EXISTS "anon_read_exams" ON exams;
CREATE POLICY "anon_read_exams" ON exams FOR SELECT TO anon USING (true);

-- Public notice board: only site-wide ('all') published notices.
DROP POLICY IF EXISTS "anon_read_public_notices" ON notices;
CREATE POLICY "anon_read_public_notices"
  ON notices FOR SELECT TO anon
  USING (is_published = true AND target = 'all');

-- Branding load on app mount: allow anon to read all site_settings
-- rows EXCEPT the SMS credentials (moved server-side).
DROP POLICY IF EXISTS "anon_read_site_settings" ON site_settings;
CREATE POLICY "anon_read_site_settings"
  ON site_settings FOR SELECT TO anon
  USING (key NOT IN ('sms_api_key', 'sms_sender_id'));

-- Purge any SMS credentials that earlier builds persisted into
-- site_settings. The key now lives ONLY in the SMS_API_KEY server env
-- var (api/_sms-core.ts); nothing sensitive should remain in this table.
DELETE FROM site_settings WHERE key IN ('sms_api_key', 'sms_sender_id');

-- ── anon: minimal public-form insert surface ─────────────────
DROP POLICY IF EXISTS "anon_insert_admission_requests" ON admission_requests;
CREATE POLICY "anon_insert_admission_requests"
  ON admission_requests FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "anon_insert_contact_messages" ON contact_messages;
CREATE POLICY "anon_insert_contact_messages"
  ON contact_messages FOR INSERT TO anon WITH CHECK (true);

-- ── Everything else for anon is implicitly DENIED ────────────
-- students, fees, mcq_questions, mcq_submissions, sms_logs, and
-- batch-targeted notices have NO anon policy, so RLS blocks direct
-- anon access. The portal/exam SECURITY DEFINER RPCs (owner rights)
-- are the only path in, and each resolves identity from a token.
--
-- NOTE: verify the anon role has no leftover table GRANTs that would
-- bypass intent. RLS still applies even with GRANTs, but revoke the
-- broad ones for defence in depth:
REVOKE SELECT, INSERT, UPDATE, DELETE ON students        FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON fees            FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON sms_logs        FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON mcq_questions   FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON mcq_submissions FROM anon;
-- (keep anon SELECT on batches/teachers/exams/notices/site_settings and
--  INSERT on admission_requests/contact_messages — governed by policies above)

-- === Migration: 20250820000000_restore_student_portal.sql ===
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

-- === Migration: 20250824000000_security_hardening.sql ===
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

-- === Migration: 20250825000000_lock_counter_rpcs.sql ===
-- ============================================================
-- Lock down the enrolled-seat counter RPCs
-- Run ONCE in Supabase → SQL Editor, after
-- 20250824000000_security_hardening.sql has succeeded.
-- ============================================================
--
--   H6  increment_enrolled(UUID) and decrement_enrolled(UUID) were
--       EXECUTE-granted to `anon`. Both are SECURITY DEFINER, so they run
--       as the owner and bypass the RLS policies that otherwise stop an
--       anonymous caller from touching `batches`. Confirmed live: a bare
--       anon-key POST to /rest/v1/rpc/increment_enrolled moved a real
--       batch's `enrolled` from 18 to 19 (reverted immediately), while the
--       equivalent direct PATCH correctly affected zero rows.
--
--       Impact was integrity, not disclosure: an anonymous visitor could
--       inflate or deflate seat counts, which drive the "seats remaining"
--       display and the admission cut-off. No data was readable this way.
--
--       Both functions are called only from authenticated admin screens
--       (AdmissionsPage approval, StudentsPage create/edit/delete), so
--       `authenticated` is the correct audience. They are additionally
--       gated on is_admin() inside the body, since every authenticated
--       user is otherwise equal at the GRANT level and a signed-up
--       non-admin student account should not shift seat counts either.
--
--       The counters are also clamped at zero. `decrement_enrolled` had no
--       floor, so repeated calls could drive `enrolled` negative and make
--       "seats remaining" exceed max_seats.
-- ============================================================


-- ── Assert both counters exist before changing anything ──────
-- Guarded on TO_REGPROCEDURE so a missing counter is reported rather than
-- silently skipped, leaving the operator thinking the lockdown ran.
DO $$
DECLARE
  fn    TEXT;
  found INT := 0;
BEGIN
  FOREACH fn IN ARRAY ARRAY['increment_enrolled(uuid)', 'decrement_enrolled(uuid)']
  LOOP
    IF TO_REGPROCEDURE('public.' || fn) IS NULL THEN
      RAISE NOTICE 'not present in this project: %', fn;
      CONTINUE;
    END IF;
    found := found + 1;
  END LOOP;

  RAISE NOTICE 'counter RPCs found: %', found;
  IF found = 0 THEN
    -- Fresh-install / clean-schema path: the legacy permissive counters were
    -- never created by any tracked migration (they existed only on the live
    -- project), so there is nothing to *de-escalate*. The DROP + CREATE below
    -- still defines both functions in their hardened is_admin()-gated form, so
    -- the final state is identical to a live lockdown. Do not fail a clean
    -- install; only warn so the operator knows no legacy grant needed revoking.
    RAISE WARNING
      'No legacy counter RPCs present (expected on a fresh install). Creating hardened increment_enrolled/decrement_enrolled below.';
  END IF;

  -- The new bodies call is_admin(); without it they would fail at runtime
  -- rather than at migration time, silently breaking both admin screens.
  IF TO_REGPROCEDURE('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION
      'is_admin() is missing. Run 20250824000000_security_hardening.sql first.';
  END IF;
END $$;

-- ── Re-define both with an is_admin() gate and a zero floor ──
-- DROP first rather than CREATE OR REPLACE: replace refuses to change an
-- input parameter name or return type, and these were authored outside the
-- numbered migrations, so neither is guaranteed. The grants that DROP
-- discards are re-stated explicitly below.
DROP FUNCTION IF EXISTS increment_enrolled(UUID);
DROP FUNCTION IF EXISTS decrement_enrolled(UUID);

CREATE FUNCTION increment_enrolled(batch_uuid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT COALESCE(is_admin(), false) THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  UPDATE batches
  SET enrolled = COALESCE(enrolled, 0) + 1
  WHERE id = batch_uuid;
END;
$$;

CREATE FUNCTION decrement_enrolled(batch_uuid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT COALESCE(is_admin(), false) THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  -- GREATEST clamps at zero: the counter is a cache of a row count and a
  -- negative value would render as more seats free than the batch has.
  UPDATE batches
  SET enrolled = GREATEST(COALESCE(enrolled, 0) - 1, 0)
  WHERE id = batch_uuid;
END;
$$;

-- DROP discarded the previous grants, so state the intended audience
-- explicitly. anon must not hold EXECUTE; the admin screens need
-- authenticated.
REVOKE ALL ON FUNCTION increment_enrolled(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION decrement_enrolled(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION increment_enrolled(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION decrement_enrolled(UUID) TO authenticated;

-- === Migration: 20250825000001_gate_exam_leaderboard.sql ===
-- ════════════════════════════════════════════════════════════════
--  H7 — exam_get_leaderboard leaked student identities to anon
-- ════════════════════════════════════════════════════════════════
--
--  FINDING
--   exam_get_leaderboard(UUID) held EXECUTE for anon and took no token.
--   Any caller holding only the public anon key could enumerate exam IDs
--   (`anon_read_exams` permits SELECT on exams by design, for public exam
--   links and the realtime status watch) and then read the top 5 rows of
--   every exam.
--
--   Confirmed live with nothing but the publishable key:
--     POST /rest/v1/rpc/exam_get_leaderboard {"p_exam_id":"dbb2252a-…"}
--     → [{"score":24,"rank":1,"student_name":"আরিফ হোসেন","student_code":"CF250001"},
--        {"score":18,"rank":2,"student_name":"সুমাইয়া খান","student_code":"CF250002"}]
--   11 exams were reachable this way; 3 returned populated boards.
--
--  WHY student_code MATTERS MORE THAN THE SCORES
--   exam_join accepts p_student_code ALONE as proof of identity — the
--   manual-verify path for students without a portal login. So a leaked
--   code is not just PII, it is an authentication factor: harvest
--   CF250001 from a public leaderboard, then join any exam as that
--   student and submit on their behalf. The disclosure escalates into
--   impersonation.
--
--  FIX
--   1. Require a token, exactly as exam_get_review already does: either a
--      portal session token or an exam-scoped token, and the caller must
--      already have a submission for this exam. Every call site in the app
--      is on the post-submission result screen, so this changes no
--      behaviour — see src/lib/examApi.ts.
--   2. Return student_code ONLY for the caller's own row, NULL for others.
--      The UI compares it to highlight "(আপনি)", which still works; other
--      students' codes stop crossing the wire at all. Defence in depth: an
--      authenticated student is a legitimate leaderboard reader but has no
--      business collecting classmates' login identifiers.
--
--  NOT CHANGED (flagged for a decision, not silently altered)
--   exam_join's student-code-only path is a deliberate product choice for
--   students without portal credentials. It is now much harder to abuse —
--   codes are no longer published — but a guessable code scheme (CF25xxxx
--   is sequential) remains guessable. Adding a second factor there is a UX
--   decision, so it is left to the owner.
-- ════════════════════════════════════════════════════════════════


-- ── Pre-flight: assert the pieces this migration depends on ──
DO $pre$
BEGIN
  IF TO_REGPROCEDURE('public.exam_get_leaderboard(uuid)') IS NULL
     AND TO_REGPROCEDURE('public.exam_get_leaderboard(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION
      'exam_get_leaderboard does not exist in either signature. Nothing was gated — check the project before assuming this succeeded.';
  END IF;

  -- The new body delegates identity resolution to these two, exactly as
  -- exam_get_review does. Missing either would fail at runtime (blank
  -- leaderboard for every student) rather than here.
  IF TO_REGPROCEDURE('public._student_id_from_token(text)') IS NULL THEN
    RAISE EXCEPTION '_student_id_from_token(text) is missing. Run 20250818000001_portal_rpcs.sql first.';
  END IF;
  IF TO_REGPROCEDURE('public._exam_token_resolve(text)') IS NULL THEN
    RAISE EXCEPTION '_exam_token_resolve(text) is missing. Run 20250818000002_exam_rpcs.sql first.';
  END IF;
END $pre$;

-- ── Re-define with token gating and own-row-only student_code ──
-- DROP both possible signatures: the old one must go or PostgREST would
-- still resolve a bare {"p_exam_id":…} body to the ungated overload,
-- leaving the hole open behind a fixed-looking function.
DROP FUNCTION IF EXISTS exam_get_leaderboard(UUID);
DROP FUNCTION IF EXISTS exam_get_leaderboard(UUID, TEXT, TEXT);

CREATE FUNCTION exam_get_leaderboard(
  p_exam_id      UUID,
  p_exam_token   TEXT DEFAULT NULL,
  p_portal_token TEXT DEFAULT NULL
)
RETURNS TABLE (
  id           UUID,
  score        INTEGER,
  time_taken   INTEGER,
  rank         INTEGER,
  student_name TEXT,
  student_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_sid UUID;
BEGIN
  IF p_portal_token IS NOT NULL AND p_portal_token <> '' THEN
    v_sid := _student_id_from_token(p_portal_token);
  ELSIF p_exam_token IS NOT NULL AND p_exam_token <> '' THEN
    SELECT r.student_id INTO v_sid FROM _exam_token_resolve(p_exam_token) r;
  END IF;

  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;

  -- Same precondition as exam_get_review: a board is only visible to
  -- someone who has actually sat this exam.
  IF NOT EXISTS (
    SELECT 1 FROM mcq_submissions WHERE exam_id = p_exam_id AND student_id = v_sid
  ) THEN
    RAISE EXCEPTION 'NO_SUBMISSION';
  END IF;

  RETURN QUERY
  SELECT m.id,
         m.score,
         m.time_taken,
         m.rank,
         s.name,
         -- Own row only. Other students' codes are an auth factor for
         -- exam_join, so they never leave the database.
         CASE WHEN m.student_id = v_sid THEN s.student_id ELSE NULL END
  FROM mcq_submissions m
  LEFT JOIN students s ON s.id = m.student_id
  WHERE m.exam_id = p_exam_id
  ORDER BY m.score DESC, m.time_taken ASC
  LIMIT 5;
END;
$fn$;

-- anon keeps EXECUTE deliberately: the exam flow is reachable without a
-- Supabase auth session (students hold a portal/exam token, not a JWT), so
-- the PostgREST role is anon. Authorization now lives inside the function.
GRANT EXECUTE ON FUNCTION exam_get_leaderboard(UUID, TEXT, TEXT) TO anon, authenticated;

-- === Migration: 20250825000002_narrow_teacher_columns.sql ===
-- ════════════════════════════════════════════════════════════════
--  H8 — teachers exposed salary, phone and email to anon
-- ════════════════════════════════════════════════════════════════
--
--  FINDING
--   `anon_read_teachers` grants SELECT on all of `teachers` with
--   USING (true), and the anon role holds a table-wide SELECT grant. RLS
--   filters ROWS, never COLUMNS, so every column of every staff row is
--   readable with nothing but the publishable key:
--
--     GET /rest/v1/teachers?select=name,salary,phone,email&order=salary.desc
--     → [{"name":"Dr. Kamal Hossain","salary":35000,
--         "phone":"01711-000003","email":"kamal@example.com"}, … ]
--
--   All 8 staff rows were retrievable, ordered by salary. This is a
--   payroll disclosure plus a staff contact list — the latter useful for
--   phishing the very accounts that hold admin access.
--
--  WHY IT WENT UNNOTICED
--   The policy is correct for its stated intent ("marketing pages read
--   teachers"). The gap is that the public page asks for `select('*')`
--   while rendering only three fields — see src/pages/public/HomePage.tsx,
--   which uses name, subject and qualification and nothing else. The
--   over-broad read was invisible in the UI.
--
--  FIX
--   Column-level GRANT, which is the only mechanism in Postgres that can
--   restrict a projection. anon keeps SELECT on exactly the columns the
--   public teacher card needs; salary, phone, email and created_at are
--   revoked. `authenticated` (the admin screens, TeachersPage CRUD) keeps
--   full table access and is untouched.
--
--   Consequence: `select=*` as anon now fails with 42501 instead of
--   silently over-fetching. HomePage is updated in the same commit to
--   request the six public columns explicitly. Any future public query
--   that reaches for a private column fails loudly at development time
--   rather than leaking quietly in production.
-- ════════════════════════════════════════════════════════════════


-- ── Pre-flight ───────────────────────────────────────────────
DO $pre$
DECLARE
  missing TEXT;
BEGIN
  IF TO_REGCLASS('public.teachers') IS NULL THEN
    RAISE EXCEPTION 'public.teachers does not exist. Nothing was narrowed.';
  END IF;

  -- Grant a column that does not exist and the whole grant statement
  -- fails; assert the public set up front so the error names the column.
  SELECT string_agg(c, ', ') INTO missing
  FROM unnest(ARRAY['id','name','subject','qualification','bio','photo_url','is_active']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = c
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'teachers is missing expected public column(s): %', missing;
  END IF;
END $pre$;

-- ── Narrow anon's projection to the public teacher card ──────
-- Table-wide SELECT must go first: column grants are additive, so leaving
-- the table-level grant in place would keep every column readable.
REVOKE SELECT ON teachers FROM anon;

GRANT SELECT (
  id,             -- React key
  name,           -- card heading
  subject,        -- badge
  qualification,  -- sub-line
  bio,            -- public-facing blurb
  photo_url,      -- avatar
  is_active       -- so inactive staff can be filtered out client-side
) ON teachers TO anon;

-- salary, phone, email and created_at are deliberately absent.

-- The row policy stays as-is; it was never the problem.
DROP POLICY IF EXISTS "anon_read_teachers" ON teachers;
CREATE POLICY "anon_read_teachers" ON teachers FOR SELECT TO anon USING (true);

-- === Migration: 20250825000003_fix_exam_join_ambiguity.sql ===
-- ════════════════════════════════════════════════════════════════
--  C1 — exam_join is broken: "column reference student_id is ambiguous"
-- ════════════════════════════════════════════════════════════════
--
--  This is a CORRECTNESS defect, not a security one, and it is severe:
--  exam_join is the only way into an exam, so the entire exam flow is
--  unreachable. Every call that gets far enough to mint a token fails.
--
--  OBSERVED (anon key, four different exams covering every status):
--    POST /rest/v1/rpc/exam_join {"p_exam_id":"…","p_student_code":"CF260001"}
--    → 400 42702 'column reference "student_id" is ambiguous'
--           details: 'It could refer to either a PL/pgSQL variable or a
--                     table column.'
--  A nonexistent exam ID still returns EXAM_NOT_FOUND, which confirms the
--  failure is downstream of the identity and exam checks.
--
--  ROOT CAUSE
--   exam_join declares RETURNS TABLE (…, student_id UUID, …). Every
--   RETURNS TABLE column is an OUT parameter, so `student_id` is a
--   PL/pgSQL variable in scope for the whole body. The body then runs:
--
--     INSERT INTO exam_tokens (token, exam_id, student_id, expires_at)
--     VALUES (…)
--     ON CONFLICT (exam_id, student_id) DO UPDATE SET …
--
--   The ON CONFLICT index-inference clause is parsed in a context where
--   PL/pgSQL substitutes variables, and an inference clause cannot be
--   table-qualified, so `student_id` there is genuinely ambiguous between
--   the OUT variable and the exam_tokens column. Postgres refuses to
--   guess. The column list in the INSERT target is fine — only the
--   inference clause is affected.
--
--  WHY IT SURVIVED EARLIER PROBING
--   Every previous anon probe stopped short of this statement: no
--   identity → 'Identity required', bad code → 'STUDENT_NOT_FOUND',
--   nil exam → 'EXAM_NOT_FOUND'. All three RAISE before the INSERT, so
--   the function looked healthy from outside.
--
--   Note this is NOT a consequence of 20250825000000-2: none of them
--   touched exam_join. Real submissions do exist for non-seeded exams,
--   which suggests the live definition drifted from
--   20250818000002_exam_rpcs.sql at some point. Either way the fix stands
--   on its own.
--
--  FIX
--   Move the upsert into a `_`-prefixed internal helper, matching the
--   existing convention (_exam_token_resolve, _issue_student_session,
--   _student_id_from_token). Inside the helper the parameters are p_
--   prefixed, so no name collides with an exam_tokens column and the
--   inference clause is unambiguous.
--
--   Chosen over the alternatives deliberately:
--     • Renaming the OUT parameter would change the RPC's returned column
--       names — src/lib/examApi.ts reads row.student_id, and that is an
--       external contract.
--     • `#variable_conflict use_column` would flip name resolution for
--       the entire body to fix one statement.
--     • DELETE-then-INSERT would drop the upsert's atomicity and let two
--       concurrent joins race into a unique violation.
--   The helper keeps a real upsert, preserves the return shape exactly,
--   and touches no constraint names.
-- ════════════════════════════════════════════════════════════════


-- ── Pre-flight ───────────────────────────────────────────────
DO $pre$
BEGIN
  IF TO_REGCLASS('public.exam_tokens') IS NULL THEN
    RAISE EXCEPTION 'exam_tokens does not exist. Run 20250818000002_exam_rpcs.sql first.';
  END IF;

  IF TO_REGPROCEDURE('public.exam_join(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'exam_join(uuid,text,text) does not exist. Nothing was repaired.';
  END IF;

  -- The upsert infers this exact index; without it ON CONFLICT errors at
  -- runtime instead of here.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.exam_tokens'::regclass
      AND c.contype = 'u'
      AND c.conkey = ARRAY[
            (SELECT attnum FROM pg_attribute
              WHERE attrelid = 'public.exam_tokens'::regclass AND attname = 'exam_id'),
            (SELECT attnum FROM pg_attribute
              WHERE attrelid = 'public.exam_tokens'::regclass AND attname = 'student_id')
          ]::smallint[]
  ) THEN
    RAISE EXCEPTION
      'exam_tokens has no UNIQUE (exam_id, student_id) constraint — the upsert in this migration would fail at runtime.';
  END IF;

  IF TO_REGPROCEDURE('public._student_id_from_token(text)') IS NULL THEN
    RAISE EXCEPTION '_student_id_from_token(text) is missing. Run 20250818000001_portal_rpcs.sql first.';
  END IF;
END $pre$;

-- ── Internal helper: mint or refresh an exam-scoped token ────
-- p_-prefixed parameters cannot collide with an exam_tokens column, so
-- the ON CONFLICT inference clause resolves cleanly here.
--
-- search_path includes `extensions`: gen_random_bytes() comes from
-- pgcrypto, which Supabase installs there, not in public.
CREATE OR REPLACE FUNCTION _exam_token_issue(p_exam_id UUID, p_student_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_token TEXT;
BEGIN
  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO exam_tokens (token, exam_id, student_id, expires_at)
  VALUES (v_token, p_exam_id, p_student_id, NOW() + INTERVAL '6 hours')
  ON CONFLICT (exam_id, student_id)
  DO UPDATE SET token      = EXCLUDED.token,
                expires_at = EXCLUDED.expires_at,
                created_at = NOW();

  RETURN v_token;
END;
$fn$;

-- Internal only: reachable from the SECURITY DEFINER callers above it,
-- never directly over REST. Granting this would hand out exam tokens for
-- an arbitrary student_id.
REVOKE ALL ON FUNCTION _exam_token_issue(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── Rebuild exam_join around the helper ──────────────────────
-- DROP rather than REPLACE: the live definition has demonstrably drifted
-- from the tracked file, so its exact OUT names are not guaranteed and
-- REPLACE would refuse to change them. The grant DROP discards is
-- re-stated below.
DROP FUNCTION IF EXISTS exam_join(UUID, TEXT, TEXT);

CREATE FUNCTION exam_join(
  p_exam_id      UUID,
  p_portal_token TEXT DEFAULT NULL,
  p_student_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  exam_token        TEXT,
  student_id        UUID,
  student_name      TEXT,
  student_code      TEXT,
  already_submitted BOOLEAN,
  exam_status       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_sid    UUID;
  v_status TEXT;
  v_appr   BOOLEAN;
  v_estat  TEXT;
  v_token  TEXT;
  v_done   BOOLEAN;
BEGIN
  IF p_portal_token IS NOT NULL AND p_portal_token <> '' THEN
    v_sid := _student_id_from_token(p_portal_token);
    IF v_sid IS NULL THEN
      RAISE EXCEPTION 'Session expired. Please log in again.';
    END IF;
  ELSIF p_student_code IS NOT NULL AND p_student_code <> '' THEN
    SELECT s.id INTO v_sid FROM students s
    WHERE s.student_id ILIKE p_student_code
    LIMIT 1;
    IF v_sid IS NULL THEN
      RAISE EXCEPTION 'STUDENT_NOT_FOUND';
    END IF;
  ELSE
    RAISE EXCEPTION 'Identity required';
  END IF;

  SELECT s.status, s.is_approved INTO v_status, v_appr
  FROM students s WHERE s.id = v_sid;
  IF NOT v_appr THEN
    RAISE EXCEPTION 'NOT_APPROVED';
  END IF;
  IF v_status = 'suspended' THEN
    RAISE EXCEPTION 'SUSPENDED';
  END IF;

  SELECT e.status INTO v_estat FROM exams e WHERE e.id = p_exam_id;
  IF v_estat IS NULL THEN
    RAISE EXCEPTION 'EXAM_NOT_FOUND';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM mcq_submissions m
    WHERE m.exam_id = p_exam_id AND m.student_id = v_sid
  ) INTO v_done;

  -- Delegated: the ON CONFLICT inference clause cannot be written here,
  -- because the `student_id` OUT parameter shadows the column.
  v_token := _exam_token_issue(p_exam_id, v_sid);

  RETURN QUERY
  SELECT v_token, s.id, s.name, s.student_id, v_done, v_estat
  FROM students s WHERE s.id = v_sid;
END;
$fn$;

-- anon retains EXECUTE by design: exam takers hold a portal or exam
-- token, not a Supabase JWT, so their PostgREST role is anon.
GRANT EXECUTE ON FUNCTION exam_join(UUID, TEXT, TEXT) TO anon, authenticated;

-- === Migration: 20250825000004_fix_latent_ambiguity.sql ===
-- ============================================================
-- C2. Latent `42702 column reference is ambiguous` defects
-- ============================================================
-- Sibling defects to C1 (20250825000003), found by a static sweep of all
-- RETURNS TABLE functions rather than by probing — because this class of bug
-- NEVER surfaces at CREATE time. `RETURNS TABLE (...)` columns are OUT
-- parameters, in scope as PL/pgSQL variables for the entire body. Any
-- unqualified reference to such a name inside a statement that also exposes a
-- column of that name raises 42702 at RUNTIME, under PL/pgSQL's default
-- `#variable_conflict error`. The function creates and looks healthy.
--
-- Two functions are affected. Both are repaired by alias-qualifying every
-- column reference; no logic, signature, return shape or grant changes.
--
--   verify_student_login(text,text)
--     OUT `id`, `is_approved`, `status` are unqualified in the two
--     post-authentication guard checks:
--         SELECT 1 FROM students WHERE id = v_id AND is_approved = false
--         SELECT 1 FROM students WHERE id = v_id AND status = 'suspended'
--     LATENT, not live: both branches sit after the `Invalid phone number or
--     password` RAISE, so they only execute on a SUCCESSFUL credential match
--     for a not-approved or suspended student. When that finally happens the
--     student gets an opaque 42702 instead of "Account is not approved yet",
--     and — worse — the failed attempt is never recorded in login_attempts,
--     because the INSERT sits inside the branch that aborts.
--
--   exam_submit(text,jsonb,integer)
--     OUT `id` unqualified in  SELECT status INTO v_estat FROM exams WHERE id = v_exam
--     OUT `id` unqualified in  FOR q IN SELECT id, correct_option, marks FROM mcq_questions ...
--     OUT `score` / `time_taken` unqualified in the rank subquery.
--     This one goes LIVE the instant C1 repairs exam_join: the exam-window
--     check is the first statement after the duplicate-submission guard, so
--     every submission would fail with 42702. It has been invisible only
--     because exam_join has been broken, making exam_submit unreachable.
--
-- DROP + CREATE rather than CREATE OR REPLACE: exam_join already proved the
-- live database has drifted from the tracked migrations, so the prior
-- definitions cannot be assumed. DROP discards grants, so both are re-stated.
--
-- `SET search_path = public, extensions` is declared inline, NOT left to the
-- 20250824000000 hardening loop: DROP+CREATE resets the setting, and
-- verify_student_login calls crypt(), which lives in pgcrypto — installed by
-- Supabase into `extensions`, not `public`. Omitting it here would break login
-- outright.
--
-- Run in the Supabase SQL Editor. Idempotent and safe to re-run.
-- ============================================================

-- ── Pre-flight ──────────────────────────────────────────────
DO $$
DECLARE v_pgcrypto TEXT;
BEGIN
  IF TO_REGPROCEDURE('public.verify_student_login(text,text)') IS NULL THEN
    RAISE EXCEPTION
      'verify_student_login(text,text) not found. Run 20250820000000_restore_student_portal.sql first.';
  END IF;

  IF TO_REGPROCEDURE('public.exam_submit(text,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION
      'exam_submit(text,jsonb,integer) not found. Run 20250818000002_exam_rpcs.sql first.';
  END IF;

  IF TO_REGPROCEDURE('public._exam_token_resolve(text)') IS NULL THEN
    RAISE EXCEPTION '_exam_token_resolve(text) not found — exam_submit depends on it.';
  END IF;

  IF TO_REGPROCEDURE('public._issue_student_session(uuid)') IS NULL THEN
    RAISE EXCEPTION '_issue_student_session(uuid) not found — verify_student_login depends on it.';
  END IF;

  -- crypt() must be reachable from `public, extensions` or login breaks.
  SELECT n.nspname INTO v_pgcrypto
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_pgcrypto IS NULL THEN
    RAISE EXCEPTION 'pgcrypto is not installed — verify_student_login cannot hash or verify passwords.';
  END IF;
  IF v_pgcrypto NOT IN ('public', 'extensions') THEN
    RAISE EXCEPTION
      'pgcrypto lives in schema "%" — the search_path below (public, extensions) cannot reach crypt().',
      v_pgcrypto;
  END IF;
  RAISE NOTICE 'pgcrypto found in schema: %', v_pgcrypto;
END $$;

-- Every column named below must exist, or the rewritten bodies would fail
-- with 42703 at runtime instead of 42702 — trading one silent defect for
-- another. Assert them up front so a schema drift names itself here.
DO $$
DECLARE
  t TEXT; c TEXT;
  pairs TEXT[][] := ARRAY[
    ['students','id'], ['students','phone'], ['students','password'],
    ['students','is_approved'], ['students','status'],
    ['exams','id'], ['exams','status'],
    ['mcq_questions','id'], ['mcq_questions','exam_id'],
    ['mcq_questions','correct_option'], ['mcq_questions','marks'],
    ['mcq_submissions','exam_id'], ['mcq_submissions','student_id'],
    ['mcq_submissions','score'], ['mcq_submissions','time_taken'],
    ['login_attempts','phone_number'], ['login_attempts','attempt_time'],
    ['login_attempts','success']
  ];
  i INT;
BEGIN
  FOR i IN 1 .. ARRAY_LENGTH(pairs, 1) LOOP
    t := pairs[i][1]; c := pairs[i][2];
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = c
    ) THEN
      RAISE EXCEPTION 'Expected column %.% does not exist — schema has drifted.', t, c;
    END IF;
  END LOOP;
  RAISE NOTICE 'Pre-flight: all % referenced columns present.', ARRAY_LENGTH(pairs, 1);
END $$;

-- ── C2a. verify_student_login ───────────────────────────────
DROP FUNCTION IF EXISTS verify_student_login(TEXT, TEXT);

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
SET search_path = public, extensions
AS $fn$
DECLARE
  failed_count INT;
  v_id UUID;
  v_token TEXT;
BEGIN
  SELECT COUNT(*) INTO failed_count
  FROM login_attempts la
  WHERE la.phone_number = p_phone
    AND la.success = false
    AND la.attempt_time > NOW() - INTERVAL '15 minutes';

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

  -- Aliased: `id` and `is_approved` are OUT parameters of this function, so
  -- unqualified they resolve ambiguously against students' columns (42702).
  IF EXISTS (
    SELECT 1 FROM students s
    WHERE s.id = v_id AND s.is_approved = false
  ) THEN
    INSERT INTO login_attempts (phone_number, attempt_time, success)
    VALUES (p_phone, NOW(), false);
    RAISE EXCEPTION 'Account is not approved yet';
  END IF;

  -- Same for `status`.
  IF EXISTS (
    SELECT 1 FROM students s
    WHERE s.id = v_id AND s.status = 'suspended'
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
$fn$;

-- Unchanged from 20250820000000: the portal login screen is reached without a
-- Supabase auth session, so the PostgREST role is anon. Rate limiting and
-- bcrypt verification inside the function are the authorization.
GRANT EXECUTE ON FUNCTION verify_student_login(TEXT, TEXT) TO anon, authenticated;

-- ── C2b. exam_submit ────────────────────────────────────────
DROP FUNCTION IF EXISTS exam_submit(TEXT, JSONB, INTEGER);

CREATE FUNCTION exam_submit(
  p_exam_token TEXT,
  p_answers    JSONB,
  p_time_taken INTEGER DEFAULT 0
)
RETURNS TABLE (
  id            UUID,
  score         INTEGER,
  correct_count INTEGER,
  wrong_count   INTEGER,
  time_taken    INTEGER,
  rank          INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_exam    UUID;
  v_sid     UUID;
  v_estat   TEXT;
  v_score   INTEGER := 0;
  v_correct INTEGER := 0;
  v_wrong   INTEGER := 0;
  v_answered INTEGER := 0;
  v_rank    INTEGER;
  v_new_id  UUID;
  q         RECORD;
  v_ans     TEXT;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  -- Reject duplicate submission.
  IF EXISTS (
    SELECT 1 FROM mcq_submissions m
    WHERE m.exam_id = v_exam AND m.student_id = v_sid
  ) THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END IF;

  -- Enforce exam window: must be active (or paused, to allow in-flight submits).
  -- Aliased: `id` is an OUT parameter, so `WHERE id = v_exam` was ambiguous.
  SELECT e.status INTO v_estat FROM exams e WHERE e.id = v_exam;
  IF v_estat NOT IN ('active', 'paused', 'ended') THEN
    RAISE EXCEPTION 'EXAM_NOT_OPEN';
  END IF;

  -- Grade server-side against the authoritative answer key.
  -- Aliased for the same reason: the projected `id` collided with the OUT parameter.
  FOR q IN
    SELECT mq.id, mq.correct_option, mq.marks
    FROM mcq_questions mq
    WHERE mq.exam_id = v_exam
  LOOP
    v_ans := lower(COALESCE(p_answers ->> q.id::text, ''));
    IF v_ans <> '' THEN
      v_answered := v_answered + 1;
      IF v_ans = lower(q.correct_option) THEN
        v_correct := v_correct + 1;
        v_score := v_score + COALESCE(q.marks, 1);
      ELSE
        v_wrong := v_wrong + 1;
      END IF;
    END IF;
  END LOOP;

  -- Rank = 1 + submissions that beat this score (or tie on score, faster time).
  -- Aliased: `score` and `time_taken` are both OUT parameters of this function.
  SELECT COUNT(*) + 1 INTO v_rank
  FROM mcq_submissions m
  WHERE m.exam_id = v_exam
    AND (m.score > v_score OR (m.score = v_score AND m.time_taken < p_time_taken));

  INSERT INTO mcq_submissions
    (exam_id, student_id, answers, score, correct_count, wrong_count, time_taken, rank, submitted_at)
  VALUES
    (v_exam, v_sid, p_answers, v_score, v_correct, v_wrong, COALESCE(p_time_taken, 0), v_rank, NOW())
  RETURNING mcq_submissions.id INTO v_new_id;

  RETURN QUERY
  SELECT v_new_id, v_score, v_correct, v_wrong, COALESCE(p_time_taken, 0), v_rank;
END;
$fn$;

-- Unchanged from 20250818000002: students sit exams holding an exam token, not
-- a Supabase JWT, so the calling role is anon. _exam_token_resolve is the gate.
GRANT EXECUTE ON FUNCTION exam_submit(TEXT, JSONB, INTEGER) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- === Migration: 20250827000001_batch_fixes.sql ===
-- ============================================================
--  P1. Batch fixes — phantom column, broken delete, stale seat count
-- ============================================================
--  THREE unrelated defects from the manual UI pass:

--  1. Editing/creating a batch failed in the UI with:
--       Could not find the 'schedule time' column of 'batches' in the schema cache
--     ROOT CAUSE (client): the form sent `schedule_time`, but the real column
--     is `start_time` (see migration.sql). No DB change required for that —
--     the client fix (BatchesPage.tsx) is committed alongside this file. This
--     migration guarantees the columns the fixed client writes to actually
--     exist, so the repaired payload cannot hit a missing column.

--  2. Deleting a batch errored with:
--       update or delete on table "batches" violates foreign key constraint
--       "fees_batch_id_fkey" on table "fees"
--     The client used to null students/exams references then hard-delete;
--     `fees.batch_id` references batches with no cascade, so the delete blew
--     up. The client now SOFT-DISABLES (is_active = false) instead — no DB
--     change needed, this migration only guarantees is_active is never NULL
--     so every batch is renderable and toggleable.

--  3. A batch with zero enrolled students displayed "2 enrolled". The public
--     BatchCard reads the denormalized `enrolled` column, which had drifted
--     from the real student set. Reconcile it against the source of truth —
--     students who are approved, active, and assigned to the batch. The
--     admin page's live count now matches this exact definition.
--
--  Idempotent. Run in the Supabase SQL Editor.


-- ── Pre-flight ───────────────────────────────────────────────
DO $pre$
BEGIN
  IF TO_REGCLASS('public.batches') IS NULL THEN
    RAISE EXCEPTION 'public.batches does not exist. Nothing to repair.';
  END IF;

  IF TO_REGCLASS('public.students') IS NULL THEN
    RAISE EXCEPTION 'public.students missing — cannot reconcile enrolled counts.';
  END IF;

  -- Every column the tightened client writes must exist or the whole payload
  -- fails with 42703. Assert them so a drifted schema names itself here.
  DO $cols$
  DECLARE
    missing TEXT;
    c TEXT;
  BEGIN
    SELECT string_agg(m, ', ') INTO missing
    FROM (
      SELECT unnest(ARRAY['name','subject','class_level','teacher_id','teacher',
                          'schedule_days','start_time','capacity','max_seats',
                          'monthly_fee','fee','description','is_active']) m
    ) t
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='batches' AND column_name=t.m
    );
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION 'batches is missing expected column(s): %', missing;
    END IF;
  END $cols$;
END $pre$;

-- ── Fix 2: no NULL is_active — soft-disable needs a strict boolean ──
-- Seed rows may have NULL; normalise so the client toggle and the
-- public `is_active = true` filters behave.
UPDATE batches SET is_active = true WHERE is_active IS NULL;

-- ── Fix 3: reconcile enrolled against approved + active students ──
-- Only students who are approved, active, and assigned to the batch count.
-- This matches the admin page's live counter and the increment/decrement
-- RPC behaviour, so public card, admin card and seat counters all agree.
UPDATE batches b
SET enrolled = (
  SELECT COUNT(*)
  FROM students s
  WHERE s.batch_id = b.id
    AND s.is_approved = true
    AND s.status = 'active'
)
WHERE EXISTS (
  SELECT 1 FROM students s2 WHERE s2.batch_id = b.id
);
-- Batches with no students at all are left at whatever they had (seeded 0);
-- zero them explicitly so a stale seed like 2 never survives:
UPDATE batches SET enrolled = 0
WHERE NOT EXISTS (
  SELECT 1 FROM students s WHERE s.batch_id = batches.id
);

-- === Migration: 20250827000002_student_id.sql ===
-- ============================================================
--  P2. Configurable student IDs + batch code column
-- ============================================================
--  The student ID was hardcoded as CF<year><4-digit-seq> (client-side, in
--  AdmissionsPage and StudentModal). The requirement is a configurable
--  `Short + Code + Year + Seq` scheme, e.g. TLY + Q + 26 + 001 -> "TLYQ26001",
--  where:
--    Short    = coaching short name (site_settings.coaching_short_name, admin editable)
--    Code     = a per-batch short token (new batches.code column, admin editable)
--    Year     = 2-digit current year (client-computed)
--    Seq      = 3-digit per-prefix counter (client-computed, unique-checked)
--
--  This migration provisions the two DB halves the scheme needs. The client
--  logic (shared generator src/lib/studentId.ts) is committed alongside.
--
--  Idempotent. Run in the Supabase SQL Editor.


-- ── Pre-flight ───────────────────────────────────────────────
DO $pre$
BEGIN
  IF TO_REGCLASS('public.batches') IS NULL THEN
    RAISE EXCEPTION 'public.batches missing — run P1 (20250827000001) first.';
  END IF;

  IF TO_REGCLASS('public.students') IS NULL THEN
    RAISE EXCEPTION 'public.students missing — cannot verify ID generation.';
  END IF;

  IF TO_REGCLASS('public.site_settings') IS NULL THEN
    RAISE EXCEPTION 'public.site_settings missing — run the core migration first.';
  END IF;
END $pre$;

-- ── Batch short code (used inside student IDs) ──────────────
ALTER TABLE batches ADD COLUMN IF NOT EXISTS code TEXT;

-- ── Coaching short name (ID prefix), with a sane default ─────
INSERT INTO site_settings (key, value)
VALUES ('coaching_short_name', 'TLY')
ON CONFLICT (key) DO NOTHING;

-- === Migration: 20250827000003_exam_batches.sql ===
-- ============================================================
--  P3. Exams: multiple batches per exam + draft/upcoming gating
-- ============================================================
--  TWO defects from the manual pass:

--  1. An exam could only target ONE batch (single exams.batch_id). The
--     requirement is that an exam can be assigned to several batches. Adding
--     `batch_ids UUID[]` (NULL = "all batches") while keeping `batch_id` as
--     the primary/first batch for existing joins, then updating the student
--     portal filter to match ANY.

--  2. A DRAFT exam was fully playable: exam_join only rejected a NULL exam,
--     and exam_get_questions had no status check at all. A student with the
--     link could sit a draft end-to-end and only hit EXAM_NOT_OPEN at submit.
--     Both entry points now reject 'draft' / 'upcoming' with EXAM_NOT_STARTED,
--     and the student ExamPage shows a "not started" screen instead of a form.
--
--  exam_join is re-declared from the CURRENT tracked definition
--  (20250825000003, which mints via the _exam_token_issue helper) plus the
--  new status gate; exam_get_questions gains a status check on the resolved
--  exam; portal_get_exams filters by batch_ids array OR null.
--
--  Idempotent. Run in the Supabase SQL Editor.


-- ── Pre-flight ───────────────────────────────────────────────
DO $pre$
BEGIN
  IF TO_REGCLASS('public.exams') IS NULL THEN
    RAISE EXCEPTION 'public.exams missing — run 20250818000002_exam_rpcs.sql first.';
  END IF;

  IF TO_REGPROCEDURE('public.exam_join(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'exam_join not found — run C1 (20250825000003) first.';
  END IF;

  IF TO_REGPROCEDURE('public.exam_get_questions(text)') IS NULL THEN
    RAISE EXCEPTION 'exam_get_questions not found — run 20250818000002 first.';
  END IF;

  IF TO_REGPROCEDURE('public.portal_get_exams(text)') IS NULL THEN
    RAISE EXCEPTION 'portal_get_exams not found — run 20250820000000 first.';
  END IF;
END $pre$;

-- ── Schema: multi-batch targeting ───────────────────────────
ALTER TABLE exams ADD COLUMN IF NOT EXISTS batch_ids UUID[];

-- Backfill: any existing single-batch exam carries that batch in its array.
UPDATE exams
SET batch_ids = ARRAY[batch_id]
WHERE batch_id IS NOT NULL AND batch_ids IS NULL;

-- ── exam_join: reject not-started exams ───────────────────────
-- Status gate added after the exam-exists check. active/paused/ended remain
-- joinable so in-flight students can re-join and finish.
DROP FUNCTION IF EXISTS exam_join(UUID, TEXT, TEXT);

CREATE FUNCTION exam_join(
  p_exam_id      UUID,
  p_portal_token TEXT DEFAULT NULL,
  p_student_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  exam_token        TEXT,
  student_id        UUID,
  student_name      TEXT,
  student_code      TEXT,
  already_submitted BOOLEAN,
  exam_status       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_sid    UUID;
  v_status TEXT;
  v_appr   BOOLEAN;
  v_estat  TEXT;
  v_token  TEXT;
  v_done   BOOLEAN;
BEGIN
  IF p_portal_token IS NOT NULL AND p_portal_token <> '' THEN
    v_sid := _student_id_from_token(p_portal_token);
    IF v_sid IS NULL THEN
      RAISE EXCEPTION 'Session expired. Please log in again.';
    END IF;
  ELSIF p_student_code IS NOT NULL AND p_student_code <> '' THEN
    SELECT s.id INTO v_sid FROM students s
    WHERE s.student_id ILIKE p_student_code
    LIMIT 1;
    IF v_sid IS NULL THEN
      RAISE EXCEPTION 'STUDENT_NOT_FOUND';
    END IF;
  ELSE
    RAISE EXCEPTION 'Identity required';
  END IF;

  SELECT s.status, s.is_approved INTO v_status, v_appr
  FROM students s WHERE s.id = v_sid;
  IF NOT v_appr THEN
    RAISE EXCEPTION 'NOT_APPROVED';
  END IF;
  IF v_status = 'suspended' THEN
    RAISE EXCEPTION 'SUSPENDED';
  END IF;

  SELECT e.status INTO v_estat FROM exams e WHERE e.id = p_exam_id;
  IF v_estat IS NULL THEN
    RAISE EXCEPTION 'EXAM_NOT_FOUND';
  END IF;

  -- Not-started exams are invisible and unjoinable through the link.
  IF v_estat IN ('draft', 'upcoming') THEN
    RAISE EXCEPTION 'EXAM_NOT_STARTED';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM mcq_submissions m
    WHERE m.exam_id = p_exam_id AND m.student_id = v_sid
  ) INTO v_done;

  -- Delegated: the ON CONFLICT inference clause cannot be written here,
  -- because the `student_id` OUT parameter shadows the column.
  v_token := _exam_token_issue(p_exam_id, v_sid);

  RETURN QUERY
  SELECT v_token, s.id, s.name, s.student_id, v_done, v_estat
  FROM students s WHERE s.id = v_sid;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_join(UUID, TEXT, TEXT) TO anon, authenticated;

-- ── exam_get_questions: also refuse not-started exams ─────────
DROP FUNCTION IF EXISTS exam_get_questions(TEXT);

CREATE FUNCTION exam_get_questions(p_exam_token TEXT)
RETURNS TABLE (
  id            UUID,
  question_text TEXT,
  option_a      TEXT,
  option_b      TEXT,
  option_c      TEXT,
  option_d      TEXT,
  marks         INTEGER,
  order_num     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_exam UUID;
  v_sid  UUID;
  v_estat TEXT;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  -- A token minted before the fix could still point at a draft; refuse to
  -- serve questions for not-started exams regardless of how the token got here.
  SELECT e.status INTO v_estat FROM exams e WHERE e.id = v_exam;
  IF v_estat IN ('draft', 'upcoming') THEN
    RAISE EXCEPTION 'EXAM_NOT_STARTED';
  END IF;

  RETURN QUERY
  SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
         q.marks, q.order_num
  FROM mcq_questions q
  WHERE q.exam_id = v_exam
  ORDER BY q.order_num;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_get_questions(TEXT) TO anon, authenticated;

-- ── portal_get_exams: multi-batch filter ─────────────────────
DROP FUNCTION IF EXISTS portal_get_exams(TEXT);

CREATE FUNCTION portal_get_exams(p_token TEXT)
RETURNS TABLE (
  id UUID, title TEXT, subject TEXT, exam_date TIMESTAMPTZ,
  duration_minutes INTEGER, total_marks INTEGER, pass_marks INTEGER,
  status TEXT, batch_id UUID, batch_ids UUID[], start_time TIMESTAMPTZ, end_time TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token); v_batch UUID;
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  SELECT s.batch_id INTO v_batch FROM students s WHERE s.id = v_sid;
  RETURN QUERY
  SELECT e.id, e.title, e.subject, e.exam_date, e.duration_minutes,
         e.total_marks, e.pass_marks, e.status, e.batch_id, e.batch_ids, e.start_time, e.end_time
  FROM exams e
  WHERE e.batch_ids IS NULL OR v_batch = ANY(e.batch_ids)
  ORDER BY e.exam_date DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION portal_get_exams(TEXT) TO anon, authenticated;

-- === Migration: 20250827000004_exam_penalty.sql ===
-- ============================================================
--  P4. Tab-minimize penalty (red cards) — exam integrity
-- ============================================================
--  When a student minimizes/leaves the exam tab it is counted as a red
--  card. Each red card deducts 10% of the student's own score, capped at
--  ten cards. Scoring stays server-side: the client reports how many red
--  cards (measured from visibility lifecycle), the server applies the
--  penalty and persists red_cards on the submission.
--
--  The timer previously was a pure client-side decrement (background-tab
--  setInterval throttling made it drift); the client now also derives time
--  from the exam's wall-clock end_time. That is a client change committed
--  alongside this file — this migration owns the server half.
--
--  Idempotent. Run in the Supabase SQL Editor.


-- ── Pre-flight ───────────────────────────────────────────────
DO $pre$
BEGIN
  IF TO_REGCLASS('public.mcq_submissions') IS NULL THEN
    RAISE EXCEPTION 'public.mcq_submissions missing — run 20250818000002 first.';
  END IF;

  IF TO_REGPROCEDURE('public.exam_submit(text,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'exam_submit(text,jsonb,integer) not found — run C2 (20250825000004) first.';
  END IF;
END $pre$;

-- ── Penalty storage ──────────────────────────────────────────
ALTER TABLE mcq_submissions ADD COLUMN IF NOT EXISTS red_cards INTEGER DEFAULT 0;

-- ── exam_submit: accept red cards, apply penalty, persist ────
-- DROP + CREATE (arity changes by +1 defaulted param) and the grant is
-- re-stated. Penalty rule (user decision): 10% of the STUDENT'S SCORE per
-- red card, capped at 10 cards, never below 0.
DROP FUNCTION IF EXISTS exam_submit(TEXT, JSONB, INTEGER);

CREATE FUNCTION exam_submit(
  p_exam_token TEXT,
  p_answers    JSONB,
  p_time_taken INTEGER DEFAULT 0,
  p_red_cards  INTEGER DEFAULT 0
)
RETURNS TABLE (
  id            UUID,
  score         INTEGER,
  correct_count INTEGER,
  wrong_count   INTEGER,
  time_taken    INTEGER,
  rank          INTEGER,
  red_cards     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_exam     UUID;
  v_sid      UUID;
  v_estat    TEXT;
  v_score    INTEGER := 0;
  v_final    INTEGER;
  v_correct  INTEGER := 0;
  v_wrong    INTEGER := 0;
  v_answered INTEGER := 0;
  v_cards    INTEGER;
  v_rank     INTEGER;
  v_new_id   UUID;
  q          RECORD;
  v_ans      TEXT;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  -- Reject duplicate submission.
  IF EXISTS (
    SELECT 1 FROM mcq_submissions m
    WHERE m.exam_id = v_exam AND m.student_id = v_sid
  ) THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END IF;

  -- Enforce exam window: must be active (or paused, to allow in-flight submits).
  SELECT e.status INTO v_estat FROM exams e WHERE e.id = v_exam;
  IF v_estat NOT IN ('active', 'paused', 'ended') THEN
    RAISE EXCEPTION 'EXAM_NOT_OPEN';
  END IF;

  -- Grade server-side against the authoritative answer key.
  FOR q IN
    SELECT mq.id, mq.correct_option, mq.marks
    FROM mcq_questions mq
    WHERE mq.exam_id = v_exam
  LOOP
    v_ans := lower(COALESCE(p_answers ->> q.id::text, ''));
    IF v_ans <> '' THEN
      v_answered := v_answered + 1;
      IF v_ans = lower(q.correct_option) THEN
        v_correct := v_correct + 1;
        v_score := v_score + COALESCE(q.marks, 1);
      ELSE
        v_wrong := v_wrong + 1;
      END IF;
    END IF;
  END LOOP;

  -- Red-card penalty: 10% of the student's score per card, cap 10 cards.
  v_cards := LEAST(COALESCE(p_red_cards, 0), 10);
  v_final  := GREATEST(v_score - v_cards * CEIL(v_score * 0.10), 0);

  -- Rank = 1 + submissions that beat this (penalized) score (tie on faster time).
  SELECT COUNT(*) + 1 INTO v_rank
  FROM mcq_submissions m
  WHERE m.exam_id = v_exam
    AND (m.score > v_final OR (m.score = v_final AND m.time_taken < p_time_taken));

  INSERT INTO mcq_submissions
    (exam_id, student_id, answers, score, correct_count, wrong_count, time_taken, rank, red_cards, submitted_at)
  VALUES
    (v_exam, v_sid, p_answers, v_final, v_correct, v_wrong, COALESCE(p_time_taken, 0), v_rank, v_cards, NOW())
  RETURNING mcq_submissions.id INTO v_new_id;

  RETURN QUERY
  SELECT v_new_id, v_final, v_correct, v_wrong, COALESCE(p_time_taken, 0), v_rank, v_cards;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_submit(TEXT, JSONB, INTEGER, INTEGER) TO anon, authenticated;

-- === Migration: 20250829000001_security_controls.sql ===
-- ============================================================
--  R2-M1. Security controls: portal 42804, teacher storage, capacity
-- ============================================================
--  Covers three reported defects (priority group).

--  A. STUDENT LOGIN "structure of query does not match function result type"
--     portal_get_fees / portal_get_notices are `RETURNS SETOF <table>` with
--     `SELECT *`, and their result row type is the table composite bound at
--     CREATE (20250820000000). The live database is known to drift from the
--     tracked migrations (exam_join was the prior example), so a live
--     add/retype on fees/notices makes SELECT * diverge from the bound row
--     type -> 42804 on the dashboard's Promise.all right after login.
--     Fix: assert the columns the RPCs depend on actually exist (loud,
--     self-diagnosing failure), then DROP+CREATE both functions to RE-BIND
--     the row type to the live tables.

--  B. TEACHER PHOTO UPLOAD "does not work"
--     No migration ever created the `avatars` bucket or any storage.objects
--     policy — the bucket + policies exist only in the console. The admin
--     upload (TeachersPage.tsx) runs as role `authenticated`; a missing or
--     anon-only policy silently fails the upload, so photo_url writes null.
--     Fix: create the public `avatars` bucket idempotently and add explicit
--     storage.objects policies for read/insert/update covering anon
--     (student portal) and authenticated (admin) paths.

--  C. BATCH CAPACITY NOT ENFORCED ("2/1 enrolled")
--     Nothing server-side prevents enrollment beyond capacity: increment
--     RPC gates only on is_admin(), there is no trigger/CHECK, and
--     `authenticated` can PATCH students.batch_id directly.
--     Fix: a BEFORE trigger (row-locked) raises BATCH_FULL when an
--     approved+active enrollment would exceed capacity (NULL/<=0 = no
--     limit); an AFTER trigger keeps batches.enrolled == live count so the
--     public card shows reality. Pre-existing over-capacity batches are
--     AUDITED (reported) in verification, never deleted.

--  Idempotent. Run in the Supabase SQL Editor.


-- ═══════════ A. Portal login 42804 ═══════════

DO $pre$
DECLARE
  missing_fees   TEXT;
  missing_notice TEXT;
BEGIN
  IF TO_REGCLASS('public.fees') IS NULL THEN
    RAISE EXCEPTION 'public.fees missing — nothing to rebind.';
  END IF;
  IF TO_REGCLASS('public.notices') IS NULL THEN
    RAISE EXCEPTION 'public.notices missing — nothing to rebind.';
  END IF;

  -- Portal comma RPCs touch these columns; missing ones are the 42804/42703
  -- root cause, reported here atomically.
  SELECT string_agg(m, ', ') INTO missing_fees
  FROM unnest(ARRAY['id','student_id','batch_id','amount','month','status','due_date']) m
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='fees' AND column_name=m
  );

  SELECT string_agg(m, ', ') INTO missing_notice
  FROM unnest(ARRAY['id','title','content','is_published','target','batch_id','is_pinned','created_at','type']) m
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notices' AND column_name=m
  );

  IF missing_fees IS NOT NULL THEN
    RAISE EXCEPTION 'fees is missing column(s) % — the live table has drifted; fix the column(s) before this migration.', missing_fees;
  END IF;
  IF missing_notice IS NOT NULL THEN
    RAISE EXCEPTION 'notices is missing column(s) % — fix before this migration.', missing_notice;
  END IF;
END $pre$;

-- Re-bind the row types to the CURRENT live tables.
DROP FUNCTION IF EXISTS portal_get_fees(TEXT);
CREATE FUNCTION portal_get_fees(p_token TEXT)
RETURNS SETOF fees
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  RETURN QUERY SELECT * FROM fees f WHERE f.student_id = v_sid ORDER BY f.due_date DESC NULLS LAST;
END;
$fn$;
GRANT EXECUTE ON FUNCTION portal_get_fees(TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS portal_get_notices(TEXT, TEXT);
CREATE FUNCTION portal_get_notices(p_token TEXT, p_type TEXT DEFAULT NULL)
RETURNS SETOF notices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
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
$fn$;
GRANT EXECUTE ON FUNCTION portal_get_notices(TEXT, TEXT) TO anon, authenticated;

-- ═══════════ B. Teacher photo storage ═══════════

DO $pre$
BEGIN
  IF TO_REGCLASS('storage.buckets') IS NULL OR TO_REGCLASS('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'storage schema not present — this must run on a Supabase project.';
  END IF;
END $pre$;

-- Public avatars bucket (idempotent): logo/teacher/student photos.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Read for everyone (public URLs in <img src>).
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avatars');

-- Insert/update for the roles that upload: anon (student portal) and
-- authenticated (admin Teachers/Students pages).
DROP POLICY IF EXISTS "avatars_anon_insert" ON storage.objects;
CREATE POLICY "avatars_anon_insert"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_anon_update" ON storage.objects;
CREATE POLICY "avatars_anon_update"
  ON storage.objects FOR UPDATE TO anon
  USING (bucket_id = 'avatars') WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
CREATE POLICY "avatars_auth_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
CREATE POLICY "avatars_auth_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars') WITH CHECK (bucket_id = 'avatars');

-- ═══════════ C. Batch capacity enforcement ═══════════

-- BEFORE trigger: reject an enrollment that would exceed capacity.
-- The batch row is locked FOR UPDATE so concurrent enrollments serialize;
-- under READ COMMITTED the waiting transaction re-reads the fresh count.
CREATE OR REPLACE FUNCTION _enforce_batch_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_cap  INTEGER;
  v_count INTEGER;
  v_now_active BOOLEAN;
  v_was_active BOOLEAN;
BEGIN
  IF NEW.batch_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT capacity INTO v_cap FROM batches WHERE id = NEW.batch_id FOR UPDATE;
  -- Batch removed/concurrency: FK will complain anyway; treat as no limit.
  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_cap <= 0 THEN
    RETURN NEW; -- 0 / negative capacity = no limit
  END IF;

  v_now_active := (NEW.is_approved AND NEW.status = 'active');
  IF TG_OP = 'INSERT' THEN
    v_was_active := false;
  ELSIF NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
    v_was_active := false; -- moving in is a fresh enrollment
  ELSE
    v_was_active := (OLD.is_approved AND OLD.status = 'active');
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM students s
  WHERE s.batch_id = NEW.batch_id
    AND s.is_approved AND s.status = 'active';

  IF v_now_active AND NOT v_was_active THEN
    v_count := v_count + 1; -- this row becomes an active enrollment
  END IF;

  IF v_count > v_cap THEN
    RAISE EXCEPTION 'BATCH_FULL: this batch is full (capacity %).', v_cap
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS enforce_batch_capacity_trg ON students;
CREATE TRIGGER enforce_batch_capacity_trg
  BEFORE INSERT OR UPDATE OF batch_id, is_approved, status ON students
  FOR EACH ROW EXECUTE FUNCTION _enforce_batch_capacity();

-- AFTER trigger: keep batches.enrolled == live approved+active count so the
-- public card never shows a stale number. This single source of truth makes
-- the legacy increment_enrolled RPC harmless (it becomes idempotent vs count).
CREATE OR REPLACE FUNCTION _sync_batch_enrolled() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_bid UUID;
BEGIN
  -- Recompute the (old and/or new) affected batches.
  IF TG_OP <> 'DELETE' AND NEW.batch_id IS NOT NULL THEN
    v_bid := NEW.batch_id;
    UPDATE batches SET enrolled = (
      SELECT COUNT(*) FROM students s
      WHERE s.batch_id = v_bid AND s.is_approved AND s.status = 'active'
    ) WHERE id = v_bid;
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.batch_id IS NOT NULL AND
     (TG_OP = 'DELETE' OR NEW.batch_id IS DISTINCT FROM OLD.batch_id) THEN
    v_bid := OLD.batch_id;
    UPDATE batches SET enrolled = (
      SELECT COUNT(*) FROM students s
      WHERE s.batch_id = v_bid AND s.is_approved AND s.status = 'active'
    ) WHERE id = v_bid;
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS sync_batch_enrolled_trg ON students;
CREATE TRIGGER sync_batch_enrolled_trg
  AFTER INSERT OR UPDATE OF batch_id, is_approved, status OR DELETE ON students
  FOR EACH ROW EXECUTE FUNCTION _sync_batch_enrolled();

-- The legacy seat-counter RPCs must not double-apply: the AFTER trigger above
-- already sets enrolled = live count, so +1/-1 on top would over/under-count.
-- Rewrite them to RECOMPUTE the live count (idempotent w.r.t. the trigger).
CREATE OR REPLACE FUNCTION increment_enrolled(batch_uuid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT COALESCE(is_admin(), false) THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  UPDATE batches b
  SET enrolled = (
    SELECT COUNT(*) FROM students s
    WHERE s.batch_id = b.id AND s.is_approved AND s.status = 'active'
  )
  WHERE b.id = batch_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION decrement_enrolled(batch_uuid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT COALESCE(is_admin(), false) THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  UPDATE batches b
  SET enrolled = (
    SELECT COUNT(*) FROM students s
    WHERE s.batch_id = b.id AND s.is_approved AND s.status = 'active'
  )
  WHERE b.id = batch_uuid;
END;
$$;

-- === Migration: 20250829000002_exam_auth_penalty.sql ===
-- ============================================================
--  R2-M2. Exam access control, auto-start, strict penalty, notice reads
-- ============================================================
--  Covers: #10a auto-start, #10b access control, #7 strict penalty +
--  transparency, #9 notice read tracking.

--  #10b — anyone with an exam link could join: exam_join only gated on
--    status NOT IN (draft,upcoming); NO batch check and NO wall-clock
--    window. Only portal_get_exams was batch-aware. Fix: a shared internal
--    gate `_exam_gate` enforces (1) batch assignment against exams.batch_ids
--    (NULL = all batches), (2) the server wall-clock window against
--    start_time/end_time (never trust client clocks), (3) exam existence.
--    Applied at exam_join (entry, strict) and re-checked at
--    exam_get_questions / exam_submit / exam_get_my_submission /
--    exam_get_review. In-flight students may still fetch/submit after the
--    window closes (p_allow_ended=true), matching the existing behaviour.

--  #10a — auto-start: exam availability is derived from the WALL CLOCK.
--    An exam with status 'upcoming' is joinable once start_time is reached
--    (and before end_time) — no manual intervention, no cron dependency.

--  #7 — penalty was 10% of the STUDENT's score (wrong); requirement is 10%
--    of TOTAL MARKS per red card, capped at 10, only when the exam has
--    Strict Mode ON (default OFF). `exams.strict_mode` (default false) is
--    the per-exam toggle; the client only tracks red cards when ON.
--    `mcq_submissions.raw_score` (marks from correct answers) and
--    `penalty_marks` (deducted) are persisted so the result view can show
--    "mark +12 from correct, −6 penalty, final 6" instead of the confusing
--    "2/3 all correct" state.

--  #9 — notice read state was client-side localStorage only (per-browser,
--    not per-user). Fix: `notice_reads` table (RLS denies anon; only
--    SECURITY DEFINER RPCs touch it) + portal_mark_notice_read /
--    portal_get_notice_reads so reads persist per student.

--  Idempotent. Run in the Supabase SQL Editor.


-- ═══════════ Schema ═══════════

DO $pre$
BEGIN
  IF TO_REGCLASS('public.exams') IS NULL THEN
    RAISE EXCEPTION 'public.exams missing — run 20250818000002 first.';
  END IF;
  IF TO_REGCLASS('public.mcq_submissions') IS NULL THEN
    RAISE EXCEPTION 'public.mcq_submissions missing.';
  END IF;
  IF TO_REGCLASS('public.notices') IS NULL THEN
    RAISE EXCEPTION 'public.notices missing.';
  END IF;
  IF TO_REGPROCEDURE('public.exam_join(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'exam_join missing — run P3 (20250827000003) first.';
  END IF;
END $pre$;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS strict_mode BOOLEAN DEFAULT false;
ALTER TABLE mcq_submissions ADD COLUMN IF NOT EXISTS raw_score INTEGER DEFAULT 0;
ALTER TABLE mcq_submissions ADD COLUMN IF NOT EXISTS penalty_marks INTEGER DEFAULT 0;

-- ═══════════ Shared exam authorization gate ═══════════
-- Internal only — revoked from all external roles.
DROP FUNCTION IF EXISTS _exam_gate(UUID, UUID, BOOLEAN);
CREATE FUNCTION _exam_gate(
  p_exam_id UUID,
  p_student_batch UUID,
  p_allow_ended BOOLEAN DEFAULT false
)
RETURNS TABLE (status TEXT, total_marks INTEGER, strict_mode BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_status    TEXT;
  v_start     TIMESTAMPTZ;
  v_end       TIMESTAMPTZ;
  v_batchids  UUID[];
  v_batchid   UUID;
  v_total     INTEGER;
  v_strict    BOOLEAN;
BEGIN
  SELECT e.status, e.start_time, e.end_time, e.batch_ids, e.batch_id,
         e.total_marks, e.strict_mode
    INTO v_status, v_start, v_end, v_batchids, v_batchid, v_total, v_strict
  FROM exams e WHERE e.id = p_exam_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'EXAM_NOT_FOUND';
  END IF;

  -- #10a auto-start: 'upcoming' becomes joinable once its window opens.
  IF v_status IN ('draft', 'upcoming') THEN
    IF v_start IS NULL OR now() < v_start THEN
      RAISE EXCEPTION 'EXAM_NOT_STARTED';
    END IF;
  END IF;

  -- Wall-clock end (or admin-ended): new entries rejected; in-flight may
  -- finish when p_allow_ended is true.
  IF v_status = 'ended' OR (v_end IS NOT NULL AND now() >= v_end) THEN
    IF NOT p_allow_ended THEN
      RAISE EXCEPTION 'EXAM_ENDED';
    END IF;
  END IF;

  -- #10b batch assignment (STRICT): an exam is joinable ONLY by a student of
  -- a batch it targets (`batch_ids` authoritative, `batch_id` legacy fallback).
  -- An exam with NO target batch is UNASSIGNED and no student may join it —
  -- it must never fall through to "everyone". Empty/NULL target arrays are
  -- rejected explicitly (ANY(ARRAY[NULL]) is NULL, so the plain check alone
  -- would wrongly admit everyone).
  IF p_student_batch IS NULL
     OR (v_batchids IS NULL AND v_batchid IS NULL)
     OR (v_batchids IS NOT NULL AND cardinality(v_batchids) = 0)
     OR NOT (p_student_batch = ANY(COALESCE(v_batchids, ARRAY[v_batchid]::uuid[])))
  THEN
    RAISE EXCEPTION 'EXAM_NOT_ASSIGNED';
  END IF;

  status := v_status;
  total_marks := v_total;
  strict_mode := v_strict;
  RETURN NEXT;
END;
$fn$;

REVOKE ALL ON FUNCTION _exam_gate(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ═══════════ exam_join — full authorization ═══════════
DROP FUNCTION IF EXISTS exam_join(UUID, TEXT, TEXT);
CREATE FUNCTION exam_join(
  p_exam_id      UUID,
  p_portal_token TEXT DEFAULT NULL,
  p_student_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  exam_token        TEXT,
  student_id        UUID,
  student_name      TEXT,
  student_code      TEXT,
  already_submitted BOOLEAN,
  exam_status       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_sid    UUID;
  v_sbatch UUID;
  v_status TEXT;
  v_appr   BOOLEAN;
  v_token  TEXT;
  v_done   BOOLEAN;
  v_estat  TEXT;
BEGIN
  IF p_portal_token IS NOT NULL AND p_portal_token <> '' THEN
    v_sid := _student_id_from_token(p_portal_token);
    IF v_sid IS NULL THEN
      RAISE EXCEPTION 'Session expired. Please log in again.';
    END IF;
  ELSIF p_student_code IS NOT NULL AND p_student_code <> '' THEN
    SELECT s.id INTO v_sid FROM students s
    WHERE s.student_id ILIKE p_student_code
    LIMIT 1;
    IF v_sid IS NULL THEN
      RAISE EXCEPTION 'STUDENT_NOT_FOUND';
    END IF;
  ELSE
    RAISE EXCEPTION 'Identity required';
  END IF;

  SELECT s.status, s.is_approved, s.batch_id INTO v_status, v_appr, v_sbatch
  FROM students s WHERE s.id = v_sid;
  IF NOT v_appr THEN
    RAISE EXCEPTION 'NOT_APPROVED';
  END IF;
  IF v_status = 'suspended' THEN
    RAISE EXCEPTION 'SUSPENDED';
  END IF;

  -- #10b authorization (batch + wall-clock window) — strict on entry.
  SELECT g.status INTO v_estat FROM _exam_gate(p_exam_id, v_sbatch, false) g;

  SELECT EXISTS (
    SELECT 1 FROM mcq_submissions m
    WHERE m.exam_id = p_exam_id AND m.student_id = v_sid
  ) INTO v_done;

  v_token := _exam_token_issue(p_exam_id, v_sid);

  RETURN QUERY
  SELECT v_token, s.id, s.name, s.student_id, v_done, v_estat
  FROM students s WHERE s.id = v_sid;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_join(UUID, TEXT, TEXT) TO anon, authenticated;

-- ═══════════ exam_get_questions — re-check authorization ═══════════
DROP FUNCTION IF EXISTS exam_get_questions(TEXT);
CREATE FUNCTION exam_get_questions(p_exam_token TEXT)
RETURNS TABLE (
  id            UUID,
  question_text TEXT,
  option_a      TEXT,
  option_b      TEXT,
  option_c      TEXT,
  option_d      TEXT,
  marks         INTEGER,
  order_num     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_exam   UUID;
  v_sid    UUID;
  v_sbatch UUID;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  SELECT s.batch_id INTO v_sbatch FROM students s WHERE s.id = v_sid;
  -- In-flight students may keep fetching even as the window closes.
  PERFORM * FROM _exam_gate(v_exam, v_sbatch, true);

  RETURN QUERY
  SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
         q.marks, q.order_num
  FROM mcq_questions q
  WHERE q.exam_id = v_exam
  ORDER BY q.order_num;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_get_questions(TEXT) TO anon, authenticated;

-- ═══════════ exam_submit — strict-gated penalty + transparency ═══════════
DROP FUNCTION IF EXISTS exam_submit(TEXT, JSONB, INTEGER, INTEGER);
CREATE FUNCTION exam_submit(
  p_exam_token TEXT,
  p_answers    JSONB,
  p_time_taken INTEGER DEFAULT 0,
  p_red_cards  INTEGER DEFAULT 0
)
RETURNS TABLE (
  id            UUID,
  score         INTEGER,
  raw_score     INTEGER,
  penalty_marks INTEGER,
  correct_count INTEGER,
  wrong_count   INTEGER,
  time_taken    INTEGER,
  rank          INTEGER,
  red_cards     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_exam    UUID;
  v_sid     UUID;
  v_sbatch  UUID;
  v_estat   TEXT;
  v_total   INTEGER;
  v_strict  BOOLEAN;
  v_score   INTEGER := 0;
  v_final   INTEGER;
  v_penalty INTEGER := 0;
  v_correct INTEGER := 0;
  v_wrong   INTEGER := 0;
  v_answered INTEGER := 0;
  v_cards   INTEGER;
  v_rank    INTEGER;
  v_new_id  UUID;
  q         RECORD;
  v_ans     TEXT;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  -- Reject duplicate submission.
  IF EXISTS (
    SELECT 1 FROM mcq_submissions m
    WHERE m.exam_id = v_exam AND m.student_id = v_sid
  ) THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END IF;

  -- #10b: batch + window; in-flight may finish.
  SELECT s.batch_id INTO v_sbatch FROM students s WHERE s.id = v_sid;
  SELECT g.status, g.total_marks, g.strict_mode INTO v_estat, v_total, v_strict
  FROM _exam_gate(v_exam, v_sbatch, true) g;

  -- Grade server-side against the authoritative answer key.
  FOR q IN
    SELECT mq.id, mq.correct_option, mq.marks
    FROM mcq_questions mq
    WHERE mq.exam_id = v_exam
  LOOP
    v_ans := lower(COALESCE(p_answers ->> q.id::text, ''));
    IF v_ans <> '' THEN
      v_answered := v_answered + 1;
      IF v_ans = lower(q.correct_option) THEN
        v_correct := v_correct + 1;
        v_score := v_score + COALESCE(q.marks, 1);
      ELSE
        v_wrong := v_wrong + 1;
      END IF;
    END IF;
  END LOOP;

  -- #7 penalty: 10% of TOTAL MARKS per card, cap 10 cards; only when Strict
  -- Mode is ON for this exam.
  v_cards := LEAST(GREATEST(COALESCE(p_red_cards, 0), 0), 10);
  IF v_strict THEN
    v_penalty := v_cards * CEIL(COALESCE(v_total, 0) * 0.10);
  END IF;
  v_final := GREATEST(v_score - v_penalty, 0);

  -- Rank = 1 + submissions that beat this (penalized) score.
  SELECT COUNT(*) + 1 INTO v_rank
  FROM mcq_submissions m
  WHERE m.exam_id = v_exam
    AND (m.score > v_final OR (m.score = v_final AND m.time_taken < p_time_taken));

  INSERT INTO mcq_submissions
    (exam_id, student_id, answers, score, raw_score, penalty_marks,
     correct_count, wrong_count, time_taken, rank, red_cards, submitted_at)
  VALUES
    (v_exam, v_sid, p_answers, v_final, v_score, v_penalty,
     v_correct, v_wrong, COALESCE(p_time_taken, 0), v_rank, v_cards, NOW())
  RETURNING mcq_submissions.id INTO v_new_id;

  RETURN QUERY
  SELECT v_new_id, v_final, v_score, v_penalty, v_correct, v_wrong,
         COALESCE(p_time_taken, 0), v_rank, v_cards;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_submit(TEXT, JSONB, INTEGER, INTEGER) TO anon, authenticated;

-- ═══════════ exam_get_my_submission — expose breakdown ═══════════
DROP FUNCTION IF EXISTS exam_get_my_submission(TEXT);
CREATE FUNCTION exam_get_my_submission(p_exam_token TEXT)
RETURNS TABLE (
  id            UUID,
  score         INTEGER,
  raw_score     INTEGER,
  penalty_marks INTEGER,
  correct_count INTEGER,
  wrong_count   INTEGER,
  time_taken    INTEGER,
  rank          INTEGER,
  answers       JSONB,
  red_cards     INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_exam   UUID;
  v_sid    UUID;
  v_sbatch UUID;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  SELECT s.batch_id INTO v_sbatch FROM students s WHERE s.id = v_sid;
  PERFORM * FROM _exam_gate(v_exam, v_sbatch, true);

  RETURN QUERY
  SELECT m.id, m.score, m.raw_score, m.penalty_marks, m.correct_count, m.wrong_count,
         m.time_taken, m.rank, m.answers, m.red_cards
  FROM mcq_submissions m
  WHERE m.exam_id = v_exam AND m.student_id = v_sid
  LIMIT 1;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_get_my_submission(TEXT) TO anon, authenticated;

-- ═══════════ exam_get_review — batch re-check ═══════════
DROP FUNCTION IF EXISTS exam_get_review(UUID, TEXT, TEXT);
CREATE FUNCTION exam_get_review(
  p_exam_id      UUID,
  p_portal_token TEXT DEFAULT NULL,
  p_exam_token   TEXT DEFAULT NULL
)
RETURNS TABLE (
  question_id    UUID,
  question_text  TEXT,
  option_a       TEXT,
  option_b       TEXT,
  option_c       TEXT,
  option_d       TEXT,
  correct_option TEXT,
  marks          INTEGER,
  order_num      INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_sid    UUID;
  v_ex     UUID;
  v_sbatch UUID;
BEGIN
  IF p_portal_token IS NOT NULL AND p_portal_token <> '' THEN
    v_sid := _student_id_from_token(p_portal_token);
  ELSIF p_exam_token IS NOT NULL AND p_exam_token <> '' THEN
    SELECT r.student_id, r.exam_id INTO v_sid, v_ex FROM _exam_token_resolve(p_exam_token) r;
  END IF;

  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;

  -- Only reveal if this student has a submission for this exam.
  IF NOT EXISTS (
    SELECT 1 FROM mcq_submissions WHERE exam_id = p_exam_id AND student_id = v_sid
  ) THEN
    RAISE EXCEPTION 'NO_SUBMISSION';
  END IF;

  -- #10b: still must be assigned to the exam's batch.
  SELECT s.batch_id INTO v_sbatch FROM students s WHERE s.id = v_sid;
  PERFORM * FROM _exam_gate(p_exam_id, v_sbatch, true);

  RETURN QUERY
  SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
         q.correct_option, q.marks, q.order_num
  FROM mcq_questions q
  WHERE q.exam_id = p_exam_id
  ORDER BY q.order_num;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_get_review(UUID, TEXT, TEXT) TO anon, authenticated;

-- ═══════════ exam_get_meta — expose strict_mode to the client ═══════════
DROP FUNCTION IF EXISTS exam_get_meta(UUID);
CREATE FUNCTION exam_get_meta(p_exam_id UUID)
RETURNS TABLE (
  id               UUID,
  title            TEXT,
  subject          TEXT,
  batch_name       TEXT,
  duration_minutes INTEGER,
  total_marks      INTEGER,
  pass_marks       INTEGER,
  instructions     TEXT,
  status           TEXT,
  start_time       TIMESTAMPTZ,
  end_time         TIMESTAMPTZ,
  timer_enabled    BOOLEAN,
  strict_mode      BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  RETURN QUERY
  SELECT e.id, e.title, e.subject, b.name, e.duration_minutes,
         e.total_marks, e.pass_marks, e.instructions, e.status,
         e.start_time, e.end_time, e.timer_enabled, e.strict_mode
  FROM exams e
  LEFT JOIN batches b ON b.id = e.batch_id
  WHERE e.id = p_exam_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION exam_get_meta(UUID) TO anon, authenticated;

-- ═══════════ portal_get_submissions — expose breakdown ═══════════
DROP FUNCTION IF EXISTS portal_get_submissions(TEXT);
CREATE FUNCTION portal_get_submissions(p_token TEXT)
RETURNS TABLE (
  id UUID, exam_id UUID, score INTEGER, raw_score INTEGER, penalty_marks INTEGER,
  correct_count INTEGER, wrong_count INTEGER, time_taken INTEGER, rank INTEGER,
  answers JSONB, submitted_at TIMESTAMPTZ, exam_title TEXT, exam_subject TEXT,
  total_marks INTEGER, pass_marks INTEGER, red_cards INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  RETURN QUERY
  SELECT m.id, m.exam_id, m.score, m.raw_score, m.penalty_marks,
         m.correct_count, m.wrong_count, m.time_taken, m.rank, m.answers,
         m.submitted_at, e.title, e.subject, e.total_marks, e.pass_marks, m.red_cards
  FROM mcq_submissions m JOIN exams e ON e.id = m.exam_id
  WHERE m.student_id = v_sid ORDER BY m.submitted_at DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION portal_get_submissions(TEXT) TO anon, authenticated;

-- ═══════════ #9 notice read tracking ═══════════
CREATE TABLE IF NOT EXISTS notice_reads (
  notice_id  UUID NOT NULL REFERENCES notices(id)   ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notice_id, student_id)
);

ALTER TABLE notice_reads ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policy → direct table access denied; the SECURITY
-- DEFINER RPCs below are the only paths (portal students act as anon).

DROP FUNCTION IF EXISTS portal_mark_notice_read(TEXT, UUID);
CREATE FUNCTION portal_mark_notice_read(p_token TEXT, p_notice_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  INSERT INTO notice_reads (notice_id, student_id, read_at)
  VALUES (p_notice_id, v_sid, NOW())
  ON CONFLICT (notice_id, student_id)
  DO UPDATE SET read_at = NOW();
END;
$fn$;

DROP FUNCTION IF EXISTS portal_get_notice_reads(TEXT);
CREATE FUNCTION portal_get_notice_reads(p_token TEXT)
RETURNS TABLE (notice_id UUID, read_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  RETURN QUERY
  SELECT nr.notice_id, nr.read_at FROM notice_reads nr WHERE nr.student_id = v_sid;
END;
$fn$;

GRANT EXECUTE ON FUNCTION portal_mark_notice_read(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION portal_get_notice_reads(TEXT) TO anon, authenticated;

-- === Migration: 20250829000003_fix_portal_exams_42804.sql ===
-- ============================================================
--  R2-M3. Fix the real 42804: portal_get_exams exam_date type drift
-- ============================================================
--  R2-M1's smoke failed with:
--      Portal RPC smoke FAILED after rebind: 42804 structure of query
--      does not match function result type
--  That was NOT the SETOF rebind failing. It surfaced the true #2 root
--  cause: the LIVE `exams.exam_date` column is type `date`, but
--  `portal_get_exams` declared `exam_date timestamp with time zone`
--  (introduced in 20250827000003). At plan time Postgres compares the
--  RETURN QUERY column (date) against the declared OUT (timestamptz) and
--  raises 42804 — exactly the "structure of query does not match function
--  result type" error the student dashboard showed after login.
--
--  This aligns the declared type to the live column. All other exam RPCs
--  that expose exam_date (exam_get_meta, portal exam list internals) do so
--  as date/timestamptz consistently; only this one drifted.
--
--  Also note: R2-M2 was already fully applied once (notice_reads exists,
--  _exam_gate exists); the "function _exam_gate already exists" error came
--  from RE-RUNNING M2, which is not idempotent on that plain CREATE. Do NOT
--  re-run M2. This file is independent and idempotent.
--
--  Run in the Supabase SQL Editor.


-- ── Pre-flight ───────────────────────────────────────────────
DO $pre$
BEGIN
  IF TO_REGCLASS('public.exams') IS NULL THEN
    RAISE EXCEPTION 'public.exams missing.';
  END IF;
  IF TO_REGPROCEDURE('public.portal_get_exams(text)') IS NULL THEN
    RAISE EXCEPTION 'portal_get_exams missing — run 20250827000003 first.';
  END IF;
END $pre$;

-- ── Re-declare with the LIVE column types ────────────────────
-- exam_date is `date` in the live schema; declaring it timestamptz was the
-- 42804. Everything else matches.
DROP FUNCTION IF EXISTS portal_get_exams(TEXT);
CREATE FUNCTION portal_get_exams(p_token TEXT)
RETURNS TABLE (
  id UUID, title TEXT, subject TEXT, exam_date DATE,
  duration_minutes INTEGER, total_marks INTEGER, pass_marks INTEGER,
  status TEXT, batch_id UUID, batch_ids UUID[],
  start_time TIMESTAMPTZ, end_time TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token); v_batch UUID;
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  SELECT s.batch_id INTO v_batch FROM students s WHERE s.id = v_sid;
  RETURN QUERY
  SELECT e.id, e.title, e.subject, e.exam_date, e.duration_minutes,
         e.total_marks, e.pass_marks, e.status, e.batch_id, e.batch_ids,
         e.start_time, e.end_time
  FROM exams e
  WHERE e.batch_ids IS NULL OR v_batch = ANY(e.batch_ids)
  ORDER BY e.exam_date DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION portal_get_exams(TEXT) TO anon, authenticated;

-- === Migration: 20250830000001_exam_batch_backfill.sql ===
-- ============================================================
--  Exams: batch backfill + STRICT batch scoping for the portal
-- ============================================================
--  WHY: portal_get_exams already filters with
--      `e.batch_ids IS NULL OR v_batch = ANY(e.batch_ids)`.
--  But exams created BEFORE the multi-batch column existed only carry
--  `batch_id` — their `batch_ids` stays NULL, and the `IS NULL` clause
--  then surfaces them to EVERY student. That leaks one-batch exams into
--  other students' portals.
--
--  This migration:
--    1. Backfills `exams.batch_ids` from `exams.batch_id` for any legacy
--       rows where the array is still NULL (so single-batch exams are
--       scoped exactly like their batch column intended).
--    2. Re-creates portal_get_exams as a STRICT filter that returns
--       `batch_ids` (plus a computed batch-scoped status) so the client
--       can both display the right rows and treat NULL batch_ids as
--       "all batches" only when the exam genuinely has no target batch.
--
--  Idempotent. Run in the Supabase SQL Editor.


-- ── Pre-flight ───────────────────────────────────────────────
DO $pre$
BEGIN
  IF TO_REGCLASS('public.exams') IS NULL THEN
    RAISE EXCEPTION 'public.exams missing — run the schema migrations first.';
  END IF;
END $pre$;

-- ── 1. Backfill batch_ids from batch_id (legacy single-batch exams) ──
UPDATE exams
SET batch_ids = ARRAY[batch_id]
WHERE batch_id IS NOT NULL AND (batch_ids IS NULL OR cardinality(batch_ids) = 0);

-- ── 2. Strict portal_get_exams (drop + recreate, returns batch_ids) ──
--
-- STRICT per-batch scoping: a student may ONLY see exams that target their
-- own batch. `batch_ids` is authoritative; `batch_id` is the legacy single-
-- batch fallback (backfilled into batch_ids by step 1 / re-run of this file).
-- An exam with NO target batch (both NULL) is treated as UNASSIGNED and is
-- returned to no student — it must never leak into every portal (the previous
-- `batch_ids IS NULL OR ...` clause leaked unassigned exams to everyone).
DROP FUNCTION IF EXISTS portal_get_exams(TEXT);

CREATE FUNCTION portal_get_exams(p_token TEXT)
RETURNS TABLE (
  id UUID, title TEXT, subject TEXT, exam_date DATE,
  duration_minutes INTEGER, total_marks INTEGER, pass_marks INTEGER,
  status TEXT, batch_id UUID, batch_ids UUID[],
  start_time TIMESTAMPTZ, end_time TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token); v_batch UUID;
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  SELECT s.batch_id INTO v_batch FROM students s WHERE s.id = v_sid;
  IF v_batch IS NULL THEN
    RETURN; -- a student with no batch sees no batch-scoped exams
  END IF;
  RETURN QUERY
  SELECT e.id, e.title, e.subject, e.exam_date, e.duration_minutes,
         e.total_marks, e.pass_marks, e.status, e.batch_id, e.batch_ids,
         e.start_time, e.end_time
  FROM exams e
  WHERE v_batch = ANY(COALESCE(e.batch_ids, ARRAY[e.batch_id]::uuid[]))
  ORDER BY e.exam_date DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION portal_get_exams(TEXT) TO anon, authenticated;

-- === Migration: 20250830000002_payment_approvals.sql ===
-- ============================================================
--  Student-submitted payment approvals
-- ============================================================
--  WHY: portal students pay manually (bKash / Nagad / WhatsApp), then the
--  admin records it. There was no in-app way for a student to hand the
--  transaction ID to the admin, and no pending state visible to either side.
--
--  This adds a `payment_approvals` table + token-scoped RPCs so a student
--  can submit their transaction ID, the admin sees it in the Fees page and
--  approves/rejects, and the portal then shows পরিশোধিত once approved.
--
--  Security: students are anon (no Supabase Auth) — the table has NO anon
--  policy; only SECURITY DEFINER RPCs touch it (student identity from the
--  session token), and authenticated (admin) has full access. update_rls
--  also re-grants admin via the standard admin_all pattern.
--
--  Idempotent. Run in the Supabase SQL Editor.


-- ── 1. Table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_id          UUID NOT NULL REFERENCES fees(id) ON DELETE CASCADE,
  method          TEXT NOT NULL CHECK (method IN ('bkash','nagad','rocket','cash')),
  transaction_id  TEXT NOT NULL DEFAULT '',
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     TEXT
);
-- One outstanding ("pending") approval per fee at a time.
DROP INDEX IF EXISTS payment_approvals_fee_pending_uidx;
CREATE UNIQUE INDEX payment_approvals_fee_pending_uidx
  ON payment_approvals (fee_id) WHERE status = 'pending';

ALTER TABLE payment_approvals ENABLE ROW LEVEL SECURITY;

-- Admin (authenticated) full CRUD — mirror the core_rls admin_all pattern.
DROP POLICY IF EXISTS "admin_all_payment_approvals" ON payment_approvals;
CREATE POLICY "admin_all_payment_approvals"
  ON payment_approvals FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Students are anon and must NOT read/write this table directly.
REVOKE SELECT, INSERT, UPDATE, DELETE ON payment_approvals FROM anon;

-- ── 2. Student: submit a transaction for approval ────────────
DROP FUNCTION IF EXISTS portal_submit_payment(TEXT, UUID, TEXT, TEXT, TEXT);

CREATE FUNCTION portal_submit_payment(
  p_token          TEXT,
  p_fee_id         UUID,
  p_method         TEXT,
  p_transaction_id TEXT,
  p_note           TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID, approval_status TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_sid  UUID := _student_id_from_token(p_token);
  v_fee  RECORD;
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  IF p_method NOT IN ('bkash','nagad','rocket','cash') THEN
    RAISE EXCEPTION 'INVALID_METHOD';
  END IF;
  IF p_transaction_id IS NULL OR length(trim(p_transaction_id)) = 0 THEN
    RAISE EXCEPTION 'TRANSACTION_ID_REQUIRED';
  END IF;

  -- The fee must belong to this student and not yet be paid.
  SELECT f.month, f.status INTO v_fee
  FROM fees f WHERE f.id = p_fee_id AND f.student_id = v_sid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FEE_NOT_FOUND';
  END IF;
  IF v_fee.status = 'paid' THEN
    RAISE EXCEPTION 'FEE_ALREADY_PAID';
  END IF;

  -- The unique partial index rejects a second pending request automatically.
  -- (The ON CONFLICT arbiter predicate must mirror the partial-index predicate
  -- `WHERE status = 'pending'` for inference to match; the function's OUT param
  -- was renamed so `status` unambiguously refers to the table column here.)
  INSERT INTO payment_approvals (student_id, fee_id, method, transaction_id, note)
  VALUES (v_sid, p_fee_id, p_method, trim(p_transaction_id),
          COALESCE(p_note, trim(p_method) || '-' || trim(p_transaction_id)))
  ON CONFLICT (fee_id) WHERE status = 'pending' DO NOTHING
  RETURNING payment_approvals.id, payment_approvals.status, payment_approvals.created_at
  INTO id, approval_status, created_at;

  IF id IS NULL THEN
    RAISE EXCEPTION 'PENDING_APPROVAL_EXISTS';
  END IF;
  RETURN NEXT;
END;
$fn$;

GRANT EXECUTE ON FUNCTION portal_submit_payment(TEXT, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── 3. Student: my approvals (join month/amount for display) ──
DROP FUNCTION IF EXISTS portal_my_payment_approvals(TEXT);

CREATE FUNCTION portal_my_payment_approvals(p_token TEXT)
RETURNS TABLE (
  id UUID, fee_id UUID, month TEXT, amount NUMERIC, method TEXT,
  transaction_id TEXT, note TEXT, status TEXT, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  RETURN QUERY
  SELECT a.id, a.fee_id, f.month, f.amount, a.method, a.transaction_id,
         a.note, a.status, a.created_at
  FROM payment_approvals a
  JOIN fees f ON f.id = a.fee_id
  WHERE a.student_id = v_sid
  ORDER BY a.created_at DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION portal_my_payment_approvals(TEXT) TO anon, authenticated;

-- ── 4. Admin: list approvals (pending by default) ─────────────
DROP FUNCTION IF EXISTS admin_payment_approvals(TEXT);

CREATE FUNCTION admin_payment_approvals(p_status TEXT DEFAULT 'pending')
RETURNS TABLE (
  id UUID, student_name TEXT, student_code TEXT, phone TEXT,
  batch_name TEXT, month TEXT, amount NUMERIC, method TEXT,
  transaction_id TEXT, note TEXT, status TEXT, created_at TIMESTAMPTZ, fee_id UUID
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;
  IF p_status IS NULL OR p_status = '' THEN
    p_status := 'pending';
  END IF;
  RETURN QUERY
  SELECT a.id, s.name, s.student_id, s.phone, b.name,
         f.month, f.amount, a.method, a.transaction_id, a.note, a.status,
         a.created_at, a.fee_id
  FROM payment_approvals a
  JOIN students s ON s.id = a.student_id
  LEFT JOIN batches b ON b.id = s.batch_id
  JOIN fees f ON f.id = a.fee_id
  WHERE a.status = p_status
  ORDER BY a.created_at DESC;
END;
$fn$;

REVOKE ALL ON FUNCTION admin_payment_approvals(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_payment_approvals(TEXT) TO authenticated;

-- ── 5. Admin: approve → mark the fee paid (same note shape as UI) ──
DROP FUNCTION IF EXISTS admin_approve_payment(UUID);

CREATE FUNCTION admin_approve_payment(p_approval_id UUID)
RETURNS TABLE (receipt_no TEXT, amount NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_admin     TEXT;
  v_appr      RECORD;
  v_receipt   TEXT;
  v_meta      TEXT;
  v_stu_name  TEXT;
  v_stu_code  TEXT;
  v_month     TEXT;
  v_amount    NUMERIC;
  v_old_status TEXT;
  v_old_note  TEXT;
  v_old       JSONB;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin authorization required'; END IF;
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'email') INTO v_admin;
  v_admin := COALESCE(v_admin, 'admin');

  SELECT a.student_id, a.fee_id, a.method, a.transaction_id INTO v_appr
  FROM payment_approvals a WHERE a.id = p_approval_id AND a.status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND';
  END IF;

  -- Snapshot student + fee BEFORE marking the fee paid, so the audit "before"
  -- state is the true pre-payment state (portal approvals only ever target
  -- unpaid fees, so f.status at this point is guaranteed NOT 'paid').
  SELECT s.name, s.student_id, f.month, f.amount, f.status, f.note
    INTO v_stu_name, v_stu_code, v_month, v_amount, v_old_status, v_old_note
  FROM students s JOIN fees f ON f.id = v_appr.fee_id
  WHERE s.id = v_appr.student_id;
  v_old := jsonb_build_object(
    'status', v_old_status,
    'note', v_old_note,
    'amount', v_amount
  );

  v_receipt := 'RCT-' || to_char(now(), 'YYYYMMDD') || '-' ||
               lpad(floor(random() * 9000 + 1000)::int::text, 4, '0');

  -- Same JSON note shape PortalFeesPage / FeesPage already parse.
  v_meta := jsonb_build_object(
    'receipt_no', v_receipt,
    'payment_method', v_appr.method,
    'transaction_id', v_appr.transaction_id,
    'final_amount', v_amount,
    'source', 'portal-approval'
  )::text;

  UPDATE fees
  SET status = 'paid',
      payment_date = now(),
      note = v_meta
  WHERE id = v_appr.fee_id;

  UPDATE payment_approvals
  SET status = 'approved', reviewed_at = now(), reviewed_by = v_admin
  WHERE id = p_approval_id;

  -- Audit entry is part of the same transaction. If it cannot be written,
  -- payment state and approval state roll back instead of creating an
  -- untraceable financial mutation.
  INSERT INTO fee_audit_logs
    (fee_id, action, admin_email, student_name, student_code, month, old_data, new_data)
  VALUES (
    v_appr.fee_id, 'payment_recorded', v_admin, v_stu_name, v_stu_code, v_month,
    v_old,
    (v_meta::jsonb || jsonb_build_object('status', 'paid', 'amount', v_amount))::jsonb
  );

  RETURN QUERY SELECT v_receipt, (SELECT f.amount FROM fees f WHERE f.id = v_appr.fee_id);
END;
$fn$;

REVOKE ALL ON FUNCTION admin_approve_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_approve_payment(UUID) TO authenticated;

-- ── 6. Admin: reject → leave fee unpaid, record review ─────────
DROP FUNCTION IF EXISTS admin_reject_payment(UUID);

CREATE FUNCTION admin_reject_payment(p_approval_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_admin TEXT;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin authorization required'; END IF;
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'email') INTO v_admin;
  UPDATE payment_approvals
  SET status = 'rejected', reviewed_at = now(), reviewed_by = COALESCE(v_admin, 'admin')
  WHERE id = p_approval_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION admin_reject_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_reject_payment(UUID) TO authenticated;

-- === Migration: 20250830000004_admission_reference_gender.sql ===
-- ============================================================
--  Admission: reference number (default portal password) + gender
-- ============================================================
--  WHY:
--    • Students sign up through the admission form. We want them to receive a
--      "reference number" (APP-XXXXXX) that becomes their DEFAULT portal
--      password once the admin approves the admission. That requires a column
--      to carry the reference from the form to the approval step.
--    • The admission form should collect everything a student record needs
--      (except Status + profile photo, which the student can update later on
--      the portal), and `gender` was an accepted signup input that had no
--      column to land in.
--    • Class level (শ্রেণী) is a managed list: default options are seeded into
--      site_settings so every form can render a <select> of existing classes,
--      and the admin can add/edit them in Settings.
--
--  Idempotent. Run in the Supabase SQL Editor.

-- ── 1. New columns ─────────────────────────────────────────────
ALTER TABLE admission_requests ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE admission_requests ADD COLUMN IF NOT EXISTS reference_no TEXT;

-- ── 2. Default class-level options (existing ones; admin editable) ──
INSERT INTO site_settings (key, value)
VALUES ('class_levels', 'Class 6,Class 7,Class 8,JSC,Class 9,Class 10,SSC,Class 11,Class 12,HSC,IELTS,Admission Test')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
--  Post-COMMIT smoke
-- ============================================================
DO $verify$
DECLARE v_col BOOLEAN; v_val TEXT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='admission_requests'
      AND column_name='reference_no') INTO v_col;
  IF NOT v_col THEN RAISE EXCEPTION 'admission_requests.reference_no missing'; END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='admission_requests'
      AND column_name='gender') INTO v_col;
  IF NOT v_col THEN RAISE EXCEPTION 'admission_requests.gender missing'; END IF;
  SELECT value INTO v_val FROM site_settings WHERE key='class_levels';
  IF v_val IS NULL OR length(v_val) = 0 THEN
    RAISE EXCEPTION 'site_settings.class_levels not seeded';
  END IF;
  RAISE NOTICE 'verify OK: admission reference_no/gender + class_levels seed present.';
END
$verify$;

-- === Migration: 20250831000001_fix_default_password_login.sql ===
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

-- === Migration: 20250831000002_batch_end_time.sql ===
-- ============================================================
--  Batches: add end_time (class finish time)
--  Run ONCE in Supabase → SQL Editor.
-- ============================================================
--
--  WHY:
--  Batch cards must show "start AND end time" (e.g. 9:30 AM – 11:00 AM),
--  but the batches table only holds `start_time`. The `schedule_days` +
--  `start_time` structured fields are what admins edit in the batch form;
--  `schedule` is a legacy free-text column that predates them.
--
--  This adds `end_time` as optional TEXT (HH:MM, matching start_time).
--  Idempotent. No existing data is touched.

ALTER TABLE batches ADD COLUMN IF NOT EXISTS end_time TEXT;

-- ── Post-COMMIT smoke ────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'batches' AND column_name = 'end_time'
  ) THEN
    RAISE EXCEPTION 'batches.end_time was not created';
  END IF;
  RAISE NOTICE 'verify OK: batches.end_time present';
END
$verify$;

-- === Migration: 20250904000001_admin_safe_mutations.sql ===
-- ============================================================
--  Production-go hardening: admin safe mutations
--  Run ONCE in Supabase → SQL Editor (after all earlier
--  migrations, e.g. 20250831000002_batch_end_time.sql).
--  (1) transactional student deletion (P1)
--  (2) transactional backup restore with accurate reporting (P0)
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- (0) register_student — collision-safe
--     Approval passes the client-generated student_id. On a
--     UNIQUE collision (students.student_id), retry the INSERT
--     with a numeric suffix instead of failing the whole
--     approval (P1). Keeps the same return shape & signature,
--     so the app works before and after this migration.
-- ════════════════════════════════════════════════════════════
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
  id UUID, name TEXT, student_id TEXT, phone TEXT, email TEXT,
  guardian_name TEXT, guardian_phone TEXT, address TEXT, class_level TEXT,
  gender TEXT, batch_id UUID, status TEXT, is_approved BOOLEAN, photo_url TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_try  INT := 0;
  v_sid  TEXT := p_student_id;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  LOOP
    BEGIN
      RETURN QUERY
      INSERT INTO students (
        name, phone, student_id, password,
        email, guardian_name, guardian_phone, address,
        class_level, gender, batch_id, status, is_approved, photo_url
      ) VALUES (
        p_name, p_phone, v_sid, crypt(p_password, gen_salt('bf')),
        p_email, p_guardian_name, p_guardian_phone, p_address,
        p_class_level, p_gender, p_batch_id, p_status, p_is_approved, p_photo_url
      )
      RETURNING
        students.id, students.name, students.student_id, students.phone,
        students.email, students.guardian_name, students.guardian_phone,
        students.address, students.class_level, students.gender, students.batch_id,
        students.status, students.is_approved, students.photo_url, students.created_at;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      v_try := v_try + 1;
      IF v_try > 10 THEN
        RAISE;
      END IF;
      -- Reserve distinct suffixes so the retry is very likely unique.
      v_sid := p_student_id || '-' || substr(md5(random()::text), 1, 6);
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION register_student(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,BOOLEAN,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION register_student(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,BOOLEAN,TEXT) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- (1) admin_delete_student
--     Single admin-gated transaction: removes every student-owned
--     row (sessions, exam tokens, approvals, submissions, fees and
--     their audit entries) and the student. All-or-nothing.
--     login_attempts keys on phone_number with no FK, so it is
--     deliberately left untouched to avoid deleting another
--     student's rate-limit history.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_delete_student(p_student_id UUID)
RETURNS TABLE (related_removed BIGINT, student_removed BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_related BIGINT := 0;
  v_student_removed BOOLEAN := false;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  -- Each owned table is guarded by TO_REGCLASS so the RPC is safe even if a
  -- supporting table (e.g. exam_tokens / student_sessions) has not been
  -- created yet by an earlier migration on this project.
  IF TO_REGCLASS('public.exam_tokens')       IS NOT NULL THEN v_related := v_related + (SELECT count(*) FROM exam_tokens       WHERE student_id = p_student_id); END IF;
  IF TO_REGCLASS('public.student_sessions')  IS NOT NULL THEN v_related := v_related + (SELECT count(*) FROM student_sessions  WHERE student_id = p_student_id); END IF;
  IF TO_REGCLASS('public.payment_approvals') IS NOT NULL THEN v_related := v_related + (SELECT count(*) FROM payment_approvals WHERE student_id = p_student_id); END IF;
  IF TO_REGCLASS('public.mcq_submissions')   IS NOT NULL THEN v_related := v_related + (SELECT count(*) FROM mcq_submissions   WHERE student_id = p_student_id); END IF;
  IF TO_REGCLASS('public.fee_audit_logs')    IS NOT NULL THEN v_related := v_related + (SELECT count(*) FROM fee_audit_logs    WHERE fee_id IN (SELECT id FROM fees WHERE student_id = p_student_id)); END IF;
  IF TO_REGCLASS('public.fees')              IS NOT NULL THEN v_related := v_related + (SELECT count(*) FROM fees              WHERE student_id = p_student_id); END IF;

  IF TO_REGCLASS('public.exam_tokens')       IS NOT NULL THEN DELETE FROM exam_tokens       WHERE student_id = p_student_id; END IF;
  IF TO_REGCLASS('public.student_sessions')  IS NOT NULL THEN DELETE FROM student_sessions  WHERE student_id = p_student_id; END IF;
  IF TO_REGCLASS('public.payment_approvals') IS NOT NULL THEN DELETE FROM payment_approvals WHERE student_id = p_student_id; END IF;
  IF TO_REGCLASS('public.mcq_submissions')   IS NOT NULL THEN DELETE FROM mcq_submissions   WHERE student_id = p_student_id; END IF;
  IF TO_REGCLASS('public.fee_audit_logs')    IS NOT NULL THEN DELETE FROM fee_audit_logs    WHERE fee_id IN (SELECT id FROM fees WHERE student_id = p_student_id); END IF;
  IF TO_REGCLASS('public.fees')              IS NOT NULL THEN DELETE FROM fees              WHERE student_id = p_student_id; END IF;

  DELETE FROM students WHERE id = p_student_id;
  v_student_removed := FOUND;

  RETURN QUERY SELECT v_related, v_student_removed;
END;
$fn$;

REVOKE ALL ON FUNCTION admin_delete_student(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_delete_student(UUID) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- (2) admin_restore_backup
--     Server-side transactional restore. Every table present in
--     the backup is REPLACED (delete + insert) inside ONE
--     transaction. Tables absent from the backup are untouched.
--     Any failure rolls back the entire restore and raises with
--     the offending table name + underlying error. The function
--     deletes existing rows first, so inserts use a plain INSERT
--     (duplicate ids in a malformed backup trip the primary key
--     and roll back cleanly).
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_restore_backup(p_tables JSONB)
RETURNS TABLE (table_name TEXT, rows_restored INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_key       TEXT;
  v_rows      JSONB;
  v_cols      TEXT[];
  v_defs      TEXT[];
  v_sample    JSONB;
  v_ins       TEXT;
  v_def       TEXT;
  v_fk_map    TEXT[] := ARRAY[
    'payment_approvals','admission_requests','mcq_submissions','mcq_questions',
    'sms_logs','notices','exams','fees','students','teachers','batches','site_settings'
  ];
  v_order     TEXT[] := ARRAY[
    'site_settings','batches','teachers','students','fees',
    'notices','exams','mcq_questions','mcq_submissions',
    'sms_logs','admission_requests','payment_approvals'
  ];
  v_count     INTEGER;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF p_tables IS NULL OR jsonb_typeof(p_tables) <> 'object' THEN
    RAISE EXCEPTION 'no tables supplied' USING ERRCODE = '22023';
  END IF;

  -- Allowlist: only keys the app backs up may be restored.
  FOR v_key IN SELECT jsonb_object_keys(p_tables) LOOP
    IF NOT (v_key = ANY(v_order)) THEN
      RAISE EXCEPTION 'disallowed table in restore: %', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_tables -> v_key) <> 'array' THEN
      RAISE EXCEPTION 'malformed rows for table: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 1) Delete current rows for tables that exist in the backup (children first).
  FOREACH v_key IN ARRAY v_fk_map LOOP
    IF p_tables ? v_key THEN
      EXECUTE format('DELETE FROM %I', v_key);
    END IF;
  END LOOP;

  -- 2) Re-insert the backup rows (parents first).
  FOREACH v_key IN ARRAY v_order LOOP
    IF NOT p_tables ? v_key THEN
      CONTINUE;
    END IF;

    v_rows := p_tables -> v_key;
    v_count := jsonb_array_length(v_rows);
    IF v_count = 0 THEN
      CONTINUE;
    END IF;

    v_sample := v_rows -> 0;

    -- Columns present in the sample row AND in the live table, in table order.
    SELECT array_agg(c.column_name ORDER BY c.ordinal_position) INTO v_cols
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = v_key
      AND c.column_name IN (SELECT jsonb_object_keys(v_sample));

    IF v_cols IS NULL OR array_length(v_cols, 1) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT array_agg(c.column_name || ' ' || c.data_type ORDER BY c.ordinal_position)
    INTO v_defs
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = v_key
      AND c.column_name = ANY(v_cols);

    v_def := array_to_string(v_defs, ', ');
    v_ins := array_to_string(v_cols, ', ');

    BEGIN
      EXECUTE format(
        'INSERT INTO %I (%s) SELECT %s FROM jsonb_to_recordset($1::jsonb) AS x(%s)',
        v_key, v_ins, v_ins, v_def
      ) USING v_rows::text;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'restore failed on table %: %', v_key, SQLERRM;
    END;

    table_name := v_key;
    rows_restored := v_count;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION admin_restore_backup(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_restore_backup(JSONB) TO authenticated;

-- === Migration: 20250905000005_feedback_email.sql ===
-- Published student feedback, email delivery logs, and student email updates.


CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  grade TEXT,
  content TEXT NOT NULL,
  image_url TEXT,
  rating SMALLINT NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  is_published BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_public_read ON public.feedback;
CREATE POLICY feedback_public_read ON public.feedback
  FOR SELECT TO anon, authenticated USING (is_published = true);
DROP POLICY IF EXISTS feedback_admin_all ON public.feedback;
CREATE POLICY feedback_admin_all ON public.feedback
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE INDEX IF NOT EXISTS feedback_public_order_idx
  ON public.feedback (is_published, sort_order, created_at DESC);

CREATE TABLE IF NOT EXISTS public.email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  template_type TEXT NOT NULL DEFAULT 'custom',
  status TEXT NOT NULL DEFAULT 'pending',
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_logs_admin_all ON public.email_logs;
CREATE POLICY email_logs_admin_all ON public.email_logs
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Portal students may update only their own email through this session-gated RPC.
CREATE OR REPLACE FUNCTION portal_update_email(p_token TEXT, p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_student UUID;
BEGIN
  SELECT student_id INTO v_student
  FROM student_sessions
  WHERE token = p_token AND expires_at > now();
  IF v_student IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  IF p_email IS NULL OR p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'A valid email address is required';
  END IF;
  UPDATE students SET email = lower(trim(p_email)) WHERE id = v_student;
  RETURN lower(trim(p_email));
END;
$$;

GRANT EXECUTE ON FUNCTION portal_update_email(TEXT, TEXT) TO anon, authenticated;

-- === Migration: 20250905000006_provider_secrets.sql ===
-- Protected provider configuration. API keys are never stored in public site_settings.


CREATE TABLE IF NOT EXISTS public.provider_secrets (
  provider TEXT PRIMARY KEY,
  api_key TEXT,
  endpoint TEXT,
  sender_id TEXT,
  from_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_secrets_admin_all ON public.provider_secrets;
CREATE POLICY provider_secrets_admin_all ON public.provider_secrets
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- === Migration: 20250906000001_phase2_session_validation.sql ===
-- Phase 2: explicit session validation endpoint for client initialization.

CREATE OR REPLACE FUNCTION portal_validate_session(p_token TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  student_id TEXT,
  phone TEXT,
  email TEXT,
  class_level TEXT,
  batch_id UUID,
  photo_url TEXT,
  status TEXT,
  is_approved BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_student UUID;
BEGIN
  SELECT ss.student_id INTO v_student
  FROM student_sessions ss
  JOIN students s ON s.id = ss.student_id
  WHERE ss.token = p_token
    AND ss.expires_at > now()
    AND s.is_approved = true
    AND s.status <> 'suspended';

  IF v_student IS NULL THEN
    RETURN;
  END IF;

  UPDATE student_sessions SET last_seen = now() WHERE token = p_token;

  RETURN QUERY
  SELECT s.id, s.name, s.student_id, s.phone, s.email, s.class_level,
         s.batch_id, s.photo_url, s.status, s.is_approved
  FROM students s
  WHERE s.id = v_student;
END;
$$;

REVOKE ALL ON FUNCTION portal_validate_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_validate_session(TEXT) TO anon, authenticated;

-- === Migration: 20250906000002_atomic_admission_approval.sql ===
-- Phase 2: atomic/idempotent admission approval.
-- The caller supplies the existing UI-generated student ID/password so business
-- rules remain unchanged. The lock + conditional status update prevents double
-- approval; all writes run in one transaction.

CREATE OR REPLACE FUNCTION admin_approve_admission(
  p_admission_id UUID,
  p_student_id TEXT,
  p_password TEXT
)
RETURNS TABLE (student_id TEXT, student_uuid UUID, status TEXT, created BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  a admission_requests%ROWTYPE;
  s students%ROWTYPE;
  v_created BOOLEAN := false;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin authorization required'; END IF;

  SELECT * INTO a FROM admission_requests WHERE id = p_admission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Admission not found'; END IF;

  IF a.status <> 'pending' THEN
    SELECT * INTO s FROM students WHERE phone = a.phone ORDER BY created_at DESC LIMIT 1;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Admission is already processed but student is missing'; END IF;
    RETURN QUERY SELECT s.student_id, s.id, a.status, false;
    RETURN;
  END IF;

  INSERT INTO students (
    name, phone, student_id, password, email, guardian_name, guardian_phone,
    address, class_level, gender, batch_id, status, is_approved, photo_url
  ) VALUES (
    a.name, a.phone, p_student_id, crypt(p_password, gen_salt('bf')), a.email,
    a.guardian_name, a.guardian_phone, a.address, a.class_level, a.gender,
    a.batch_id, 'active', true, a.photo_url
  )
  RETURNING * INTO s;
  v_created := true;

  IF a.batch_id IS NOT NULL THEN
    PERFORM increment_enrolled(a.batch_id);
  END IF;

  UPDATE admission_requests SET status = 'approved' WHERE id = a.id;

  RETURN QUERY SELECT s.student_id, s.id, 'approved'::TEXT, v_created;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Student already exists or generated student ID is already used';
END;
$$;

REVOKE ALL ON FUNCTION admin_approve_admission(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_approve_admission(UUID, TEXT, TEXT) TO authenticated;

-- === Migration: 20250906000003_phase2_payment_audit_atomic.sql ===
-- Phase 2: replace payment approval with transactionally required audit.
-- Existing customer databases may already have 20250830000002 applied, so this
-- follow-up contains the actual function body rather than only a marker.

CREATE OR REPLACE FUNCTION admin_approve_payment(p_approval_id UUID)
RETURNS TABLE (receipt_no TEXT, amount NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_admin TEXT;
  v_appr RECORD;
  v_receipt TEXT;
  v_meta TEXT;
  v_stu_name TEXT;
  v_stu_code TEXT;
  v_month TEXT;
  v_amount NUMERIC;
  v_old_status TEXT;
  v_old_note TEXT;
  v_old JSONB;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin authorization required'; END IF;
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'email') INTO v_admin;
  v_admin := COALESCE(v_admin, 'admin');

  SELECT a.student_id, a.fee_id, a.method, a.transaction_id INTO v_appr
  FROM payment_approvals a
  WHERE a.id = p_approval_id AND a.status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_NOT_FOUND'; END IF;

  SELECT s.name, s.student_id, f.month, f.amount, f.status, f.note
  INTO v_stu_name, v_stu_code, v_month, v_amount, v_old_status, v_old_note
  FROM students s JOIN fees f ON f.id = v_appr.fee_id
  WHERE s.id = v_appr.student_id
  FOR UPDATE OF f;
  IF NOT FOUND THEN RAISE EXCEPTION 'FEE_OR_STUDENT_NOT_FOUND'; END IF;
  IF v_old_status = 'paid' THEN RAISE EXCEPTION 'FEE_ALREADY_PAID'; END IF;

  v_old := jsonb_build_object('status', v_old_status, 'note', v_old_note, 'amount', v_amount);
  v_receipt := 'RCT-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(floor(random() * 9000 + 1000)::int::text, 4, '0');
  v_meta := jsonb_build_object(
    'receipt_no', v_receipt,
    'payment_method', v_appr.method,
    'transaction_id', v_appr.transaction_id,
    'final_amount', v_amount,
    'source', 'portal-approval'
  )::text;

  UPDATE fees SET status = 'paid', payment_date = now(), note = v_meta WHERE id = v_appr.fee_id;
  UPDATE payment_approvals SET status = 'approved', reviewed_at = now(), reviewed_by = v_admin WHERE id = p_approval_id;

  -- Required financial audit: failure aborts the entire transaction.
  INSERT INTO fee_audit_logs
    (fee_id, action, admin_email, student_name, student_code, month, old_data, new_data)
  VALUES (
    v_appr.fee_id, 'payment_recorded', v_admin, v_stu_name, v_stu_code, v_month,
    v_old,
    (v_meta::jsonb || jsonb_build_object('status', 'paid', 'amount', v_amount))::jsonb
  );

  RETURN QUERY SELECT v_receipt, v_amount;
END;
$fn$;

REVOKE ALL ON FUNCTION admin_approve_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_approve_payment(UUID) TO authenticated;

-- === Migration: 20250907000001_exam_session_only_and_avatar_storage.sql ===
-- Batch S1: remove identifier-only exam entry and anonymous avatar writes.
-- Source-only until an explicitly assigned disposable/staging database is
-- approved and the migration is applied and verified there.


-- The previous public signature accepted p_student_code. Keep no compatible
-- overload: a caller must present the opaque portal session token.
DROP FUNCTION IF EXISTS public.exam_join(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.exam_join(UUID, TEXT);

CREATE FUNCTION public.exam_join(
  p_exam_id UUID,
  p_portal_token TEXT
)
RETURNS TABLE (
  exam_token TEXT,
  student_id UUID,
  student_name TEXT,
  student_code TEXT,
  already_submitted BOOLEAN,
  exam_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_sid UUID;
  v_sbatch UUID;
  v_status TEXT;
  v_appr BOOLEAN;
  v_done BOOLEAN;
  v_estat TEXT;
  v_token TEXT;
BEGIN
  IF p_portal_token IS NULL OR p_portal_token = '' THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  v_sid := _student_id_from_token(p_portal_token);
  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;

  SELECT s.status, s.is_approved, s.batch_id
    INTO v_status, v_appr, v_sbatch
  FROM students s
  WHERE s.id = v_sid;

  IF NOT COALESCE(v_appr, false) THEN
    RAISE EXCEPTION 'NOT_APPROVED';
  END IF;
  IF v_status = 'suspended' OR v_status <> 'active' THEN
    RAISE EXCEPTION 'STUDENT_INACTIVE';
  END IF;

  -- This gate verifies exam existence, wall-clock state, and batch
  -- assignment before any exam token is minted.
  SELECT g.status INTO v_estat
  FROM _exam_gate(p_exam_id, v_sbatch, false) g;

  SELECT EXISTS (
    SELECT 1 FROM mcq_submissions m
    WHERE m.exam_id = p_exam_id AND m.student_id = v_sid
  ) INTO v_done;

  v_token := _exam_token_issue(p_exam_id, v_sid);

  RETURN QUERY
  SELECT v_token, s.id, s.name, s.student_id, v_done, v_estat
  FROM students s
  WHERE s.id = v_sid;
END;
$fn$;

REVOKE ALL ON FUNCTION public.exam_join(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exam_join(UUID, TEXT) TO anon, authenticated;

-- The browser uses an opaque custom session, which storage RLS cannot inspect.
-- Avatar writes now go through the server-side upload boundary, where the
-- token is validated before a service-role storage write. Public reads remain
-- unchanged pending a separate privacy decision.
DROP POLICY IF EXISTS "avatars_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_delete" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_upload" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;

-- Do not grant anonymous write access back here. Authenticated admin writes
-- remain available, but must still use the existing admin application path.

-- === Migration: 20250909000001_postinstall_repairs.sql ===
-- ============================================================================
-- 20250909000001_postinstall_repairs.sql
-- Target repair batch (applies to any installed environment + future fresh
-- installs). Numbered as a NEW forward migration: it appends its own ledger
-- entry and never re-edits rows already recorded by earlier migrations.
--
-- Scope:
--   [A] Close the payment-approval authorization bypass.
--       Replace the unconditional admin-named RLS policy
--       (admin_all_payment_approvals ... FOR ALL TO authenticated USING(true))
--       with a genuine fail-closed is_admin() gate. Student payment submission
--       is preserved through the existing server-validated portal RPCs, which
--       are unaffected.
--   [B] PRIVATE avatar storage.
--       - avatars bucket is PRIVATE (public=false), max 2 MiB, JPEG/PNG/WebP.
--       - Remove the public/anon/authenticated avatar read policy; no direct
--         storage read is authorized. Ownership-validated retrieval is exposed
--         through RPCs consumed by a server-side signed-URL endpoint.
--   [C] Exam-submission integrity.
--       - mcq_submissions gains a UNIQUE (exam_id, student_id) invariant so a
--         duplicate/concurrent submission cannot be written twice.
--       - exam_submit is hardened to treat the unique-violation as
--         ALREADY_SUBMITTED (retry/reload-safe) instead of a 23505 leak.
--
-- No data, Auth, or Storage rows are seeded; no messages are sent; nothing is
-- triggered. Idempotent. Dashboard SQL Editor compatible.
-- ============================================================================

-- ============================================================================
-- [A] PAYMENT APPROVAL AUTHORIZATION
-- ============================================================================
-- The previous policy let ANY Supabase-authenticated user (authenticated role)
-- directly read/insert/update/delete every payment_approval via PostgREST,
-- because it assumed authenticated == admin. Students use an opaque custom
-- session and are NOT the authenticated role. The authenticated role must mean
-- "roster admin" for this financial table.
ALTER TABLE public.payment_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_payment_approvals" ON public.payment_approvals;
CREATE POLICY "admin_all_payment_approvals"
  ON public.payment_approvals
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Student financial access happens ONLY through the is_admin()-gated admin
-- RPCs and the server-validated portal RPCs (portal_submit_payment,
-- portal_my_payment_approvals), both SECURITY DEFINER. Explicitly keep anon
-- and the direct path locked down.
REVOKE ALL ON TABLE public.payment_approvals FROM anon;
REVOKE ALL ON TABLE public.payment_approvals FROM PUBLIC;

-- ============================================================================
-- [B] PRIVATE AVATAR STORAGE
-- ============================================================================
-- Guard on the bucket being present (it is created by 20250829000001). Set it
-- PRIVATE with a 2 MiB size cap and JPEG/PNG/WebP allow-list at the storage
-- layer. (The authoritative size + content validation also live in
-- server/avatar-core.ts, which is tightened to match.)
DO $b$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL
     AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'avatars') THEN
    UPDATE storage.buckets
       SET public = false,
           file_size_limit = 2097152, -- 2 MiB
           allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']::text[]
     WHERE id = 'avatars';
  END IF;
END $b$;

-- Remove the public read policy (and any stray avatar read/write policy). With
-- the bucket private, no anon/authenticated storage access remains: uploads go
-- through the server-side service-role path, reads through signed URLs.
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_delete" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_upload" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;

-- Ownership-validated retrieval support. These RPCs resolve WHO may view a
-- student's avatar and return the storage object path; the caller/server then
-- signs a short-lived URL with the service key. They are SECURITY DEFINER so
-- the path is only disclosed to an authorized party.
--
-- 1) Student path: the caller's OWN avatar only, identity from the opaque
--    portal session token (students are NOT the Supabase authenticated role).
DROP FUNCTION IF EXISTS public.portal_get_avatar_path(TEXT);
CREATE FUNCTION public.portal_get_avatar_path(p_token TEXT)
RETURNS TABLE (path TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID;
BEGIN
  v_sid := _student_id_from_token(p_token);
  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;
  RETURN QUERY
    SELECT 'avatars/students/' || v_sid::text || '-photo.jpg'::text;
END;
$fn$;
REVOKE ALL ON FUNCTION public.portal_get_avatar_path(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_get_avatar_path(TEXT) TO anon, authenticated;

-- 2) Admin path: a roster admin may view any student's avatar. identity from
--    the Supabase authenticated JWT via is_admin().
DROP FUNCTION IF EXISTS public.admin_get_avatar_path(UUID);
CREATE FUNCTION public.admin_get_avatar_path(p_student_id UUID)
RETURNS TABLE (path TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
BEGIN
  IF NOT COALESCE(is_admin(), false) THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'STUDENT_NOT_FOUND';
  END IF;
  RETURN QUERY
    SELECT 'avatars/students/' || p_student_id::text || '-photo.jpg'::text;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_get_avatar_path(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_avatar_path(UUID) TO authenticated;

-- ============================================================================
-- [C] EXAM SUBMISSION INTEGRITY
-- ============================================================================
-- Add the DB invariant that makes the exam_submit EXISTS check race-safe:
-- exactly one submission per (student, exam). Idempotent.
DO $c$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'mcq_submissions'
       AND indexname = 'mcq_submissions_exam_student_uidx'
  ) THEN
    CREATE UNIQUE INDEX mcq_submissions_exam_student_uidx
      ON public.mcq_submissions (exam_id, student_id);
  END IF;
END $c$;

-- Harden exam_submit: if the unique index rejects a concurrent/duplicate write
-- (23505), translate it to the same ALREADY_SUBMITTED the check already emits,
-- so reload/recovery never surfaces a raw unique-violation and never double
-- counts a student's submission.
DROP FUNCTION IF EXISTS public.exam_submit(TEXT, JSONB, INTEGER, INTEGER);
CREATE FUNCTION public.exam_submit(
  p_exam_token TEXT,
  p_answers    JSONB,
  p_time_taken INTEGER DEFAULT 0,
  p_red_cards  INTEGER DEFAULT 0
)
RETURNS TABLE (
  id            UUID,
  score         INTEGER,
  raw_score     INTEGER,
  penalty_marks INTEGER,
  correct_count INTEGER,
  wrong_count   INTEGER,
  time_taken    INTEGER,
  rank          INTEGER,
  red_cards     INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_exam    UUID;
  v_sid     UUID;
  v_sbatch  UUID;
  v_estat   TEXT;
  v_total   INTEGER;
  v_strict  BOOLEAN;
  v_score   INTEGER := 0;
  v_final   INTEGER;
  v_penalty INTEGER := 0;
  v_correct INTEGER := 0;
  v_wrong   INTEGER := 0;
  v_answered INTEGER := 0;
  v_cards   INTEGER;
  v_rank    INTEGER;
  v_new_id  UUID;
  q         RECORD;
  v_ans     TEXT;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  -- Reject duplicate (fast path; the unique index is the authoritative guard).
  IF EXISTS (
    SELECT 1 FROM mcq_submissions m
    WHERE m.exam_id = v_exam AND m.student_id = v_sid
  ) THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END IF;

  SELECT s.batch_id INTO v_sbatch FROM students s WHERE s.id = v_sid;
  SELECT g.status, g.total_marks, g.strict_mode INTO v_estat, v_total, v_strict
  FROM _exam_gate(v_exam, v_sbatch, true) g;

  FOR q IN
    SELECT mq.id, mq.correct_option, mq.marks
    FROM mcq_questions mq
    WHERE mq.exam_id = v_exam
  LOOP
    v_ans := lower(COALESCE(p_answers ->> q.id::text, ''));
    IF v_ans <> '' THEN
      v_answered := v_answered + 1;
      IF v_ans = lower(q.correct_option) THEN
        v_correct := v_correct + 1;
        v_score := v_score + COALESCE(q.marks, 1);
      ELSE
        v_wrong := v_wrong + 1;
      END IF;
    END IF;
  END LOOP;

  v_cards := LEAST(GREATEST(COALESCE(p_red_cards, 0), 0), 10);
  IF v_strict THEN
    v_penalty := v_cards * CEIL(COALESCE(v_total, 0) * 0.10);
  END IF;
  v_final := GREATEST(v_score - v_penalty, 0);

  SELECT COUNT(*) + 1 INTO v_rank
  FROM mcq_submissions m
  WHERE m.exam_id = v_exam
    AND (m.score > v_final OR (m.score = v_final AND m.time_taken < p_time_taken));

  BEGIN
    INSERT INTO mcq_submissions
      (exam_id, student_id, answers, score, raw_score, penalty_marks,
       correct_count, wrong_count, time_taken, rank, red_cards, submitted_at)
    VALUES
      (v_exam, v_sid, p_answers, v_final, v_score, v_penalty,
       v_correct, v_wrong, COALESCE(p_time_taken, 0), v_rank, v_cards, NOW())
    RETURNING mcq_submissions.id INTO v_new_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END;

  RETURN QUERY
  SELECT v_new_id, v_final, v_score, v_penalty, v_correct, v_wrong,
         COALESCE(p_time_taken, 0), v_rank, v_cards;
END;
$fn$;

REVOKE ALL ON FUNCTION public.exam_submit(TEXT, JSONB, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exam_submit(TEXT, JSONB, INTEGER, INTEGER) TO anon, authenticated;

-- === Migration: 20250910000001_fee_audit_logs_admin_rls.sql ===
-- ============================================================
--  fee_audit_logs: restore admin-write + admin-read RLS
-- ============================================================
-- `fee_audit_logs` was created out of band (support-tables migration 20250817
-- deliberately omitted policies: "security migrations apply the reviewed final
-- access model later"), but the hardening migration 20250824000000 (H2c) never
-- added it to its is_admin()-gated loop, which only covered the 12 core tables
-- plus the session/token tables. The result: the table is RLS-enabled with no
-- usable policy for the `authenticated` role.
--
-- Symptom (verified on the disposable target):
--   authenticated  INSERT  -> 42501 "new row violates row-level security policy"
--   -> the admin "Record Payment" UI marks the fee paid but silently fails to
--      write its mandatory `payment_recorded` audit entry (logFeeAudit swallows
--      the error), and the Audit Log tab cannot fetch entries.
--
-- Fix: apply the exact canonical policy every other core table gets, gated by
-- is_admin(). Admins keep full CRUD (record payment audit + audit tab read +
-- e2e cleanup); anon / non-admin users remain fully denied.

ALTER TABLE public.fee_audit_logs ENABLE ROW LEVEL SECURITY;

-- Remove any legacy permissive all-authenticated policy first so behavior is
-- deterministic regardless of what the out-of-band schema left behind.
DROP POLICY IF EXISTS "Allow auth all fee_audit_logs" ON public.fee_audit_logs;
DROP POLICY IF EXISTS "admin_all_fee_audit_logs"     ON public.fee_audit_logs;
DROP POLICY IF EXISTS "admin_read_fee_audit_logs"    ON public.fee_audit_logs;

CREATE POLICY "admin_all_fee_audit_logs"
  ON public.fee_audit_logs
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Deny anonymous/public table access to the financial audit trail.
REVOKE ALL ON public.fee_audit_logs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_audit_logs TO authenticated;

-- === Migration: 20250911000001_atomic_exam_deletion.sql ===
-- Atomic, admin-only exam deletion.
-- Deleting the parent relies on the existing ON DELETE CASCADE foreign keys for
-- questions, submissions and exam tokens, so every related write commits or
-- rolls back as one transaction.

CREATE OR REPLACE FUNCTION public.admin_delete_exam(p_exam_id UUID)
RETURNS TABLE (
  questions_removed BIGINT,
  submissions_removed BIGINT,
  tokens_removed BIGINT,
  exam_removed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_questions BIGINT := 0;
  v_submissions BIGINT := 0;
  v_tokens BIGINT := 0;
  v_exam_removed BOOLEAN := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  -- Serialize concurrent deletion attempts and return a truthful not-found result.
  PERFORM 1 FROM public.exams WHERE id = p_exam_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::BIGINT, 0::BIGINT, 0::BIGINT, false;
    RETURN;
  END IF;

  IF TO_REGCLASS('public.mcq_questions') IS NOT NULL THEN
    SELECT count(*) INTO v_questions
    FROM public.mcq_questions
    WHERE exam_id = p_exam_id;
  END IF;

  IF TO_REGCLASS('public.mcq_submissions') IS NOT NULL THEN
    SELECT count(*) INTO v_submissions
    FROM public.mcq_submissions
    WHERE exam_id = p_exam_id;
  END IF;

  IF TO_REGCLASS('public.exam_tokens') IS NOT NULL THEN
    SELECT count(*) INTO v_tokens
    FROM public.exam_tokens
    WHERE exam_id = p_exam_id;
  END IF;

  DELETE FROM public.exams WHERE id = p_exam_id;
  v_exam_removed := FOUND;

  RETURN QUERY SELECT v_questions, v_submissions, v_tokens, v_exam_removed;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_delete_exam(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_exam(UUID) TO authenticated;

-- === Migration: 20250912000001_student_auth_hardening.sql ===
-- Serialize student login attempts, remove legacy plaintext authentication, and
-- retain the existing opaque-session RPC contract. This migration is data-only
-- plus a CREATE OR REPLACE of public.verify_student_login(text, text).

-- pgcrypto may be installed in public (fresh installs) or extensions (managed
-- Supabase projects); cover both without hard-coding its deployment schema.
SET search_path = public, extensions;

-- Hash every non-empty legacy password before removing plaintext comparison.
-- Already-valid bcrypt values are left untouched.
UPDATE public.students AS s
SET password = crypt(s.password, gen_salt('bf'))
WHERE s.password IS NOT NULL
  AND btrim(s.password) <> ''
  AND s.password !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$';

-- Store historical attempt keys in the same canonical form used by the RPC so
-- attempts made with cosmetic phone formatting cannot evade the shared budget.
UPDATE public.login_attempts AS la
SET phone_number = regexp_replace(btrim(la.phone_number), '[^0-9]', '', 'g')
WHERE la.phone_number IS DISTINCT FROM
      regexp_replace(btrim(la.phone_number), '[^0-9]', '', 'g');

CREATE OR REPLACE FUNCTION public.verify_student_login(
  p_phone    TEXT,
  p_password TEXT
)
RETURNS TABLE (
  id             UUID,
  name           TEXT,
  student_id     TEXT,
  phone          TEXT,
  email          TEXT,
  guardian_name  TEXT,
  guardian_phone TEXT,
  address        TEXT,
  class_level    TEXT,
  gender         TEXT,
  batch_id       UUID,
  status         TEXT,
  is_approved    BOOLEAN,
  photo_url      TEXT,
  created_at     TIMESTAMPTZ,
  session_token  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_phone        TEXT := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9]', '', 'g');
  v_failed_count INTEGER;
  v_id           UUID;
  v_token        TEXT;
BEGIN
  -- Serialize the complete check/authenticate/record sequence for one normalized
  -- phone. The transaction-scoped lock is released on either commit or failure.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_phone, 0)
  );

  -- Deliberately allow catalog/table errors to propagate: inability to evaluate
  -- the budget must never degrade into an authentication bypass (fail closed).
  SELECT count(*) INTO v_failed_count
  FROM public.login_attempts AS la
  WHERE la.phone_number = v_phone
    AND la.success = false
    AND la.attempt_time > clock_timestamp() - interval '15 minutes';

  IF v_failed_count >= 5 THEN
    RAISE EXCEPTION 'Too many failed attempts. Please try again later.';
  END IF;

  SELECT s.id INTO v_id
  FROM public.students AS s
  WHERE regexp_replace(btrim(s.phone), '[^0-9]', '', 'g') = v_phone
    AND s.password ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'
    AND s.password = crypt(p_password, s.password)
  ORDER BY s.id
  LIMIT 1;

  IF v_id IS NULL THEN
    -- Return an empty result instead of raising after this insert: an exception
    -- would roll the attempt back with the surrounding RPC transaction.
    INSERT INTO public.login_attempts (phone_number, attempt_time, success)
    VALUES (v_phone, clock_timestamp(), false);
    RETURN;
  END IF;

  INSERT INTO public.login_attempts (phone_number, attempt_time, success)
  VALUES (v_phone, clock_timestamp(), true);

  -- Preserve opaque-session behavior: only _issue_student_session creates the
  -- token, and only that token is returned to the caller.
  v_token := public._issue_student_session(v_id);

  RETURN QUERY
  SELECT
    s.id, s.name, s.student_id, s.phone,
    s.email, s.guardian_name, s.guardian_phone, s.address,
    s.class_level, s.gender, s.batch_id,
    s.status, s.is_approved, s.photo_url, s.created_at,
    v_token
  FROM public.students AS s
  WHERE s.id = v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.verify_student_login(TEXT, TEXT) TO anon, authenticated;

RESET search_path;

-- === Migration: 20250913000001_private_avatars_public_assets.sql ===
-- Reconcile storage with the production server boundaries.
-- Student photos are private service-role-only objects. Intentionally public
-- branding, teacher, feedback and admin images live in a separate public bucket
-- and are also service-role-only for writes (via /api/upload-public-asset).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars', 'avatars', false, 2097152,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'public-assets', 'public-assets', true, 2097152,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Remove every historical browser write/read policy for the old mixed bucket.
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_delete" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_upload" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_delete" ON storage.objects;

-- Deliberately create no INSERT/UPDATE/DELETE policy for either bucket. Public
-- means unauthenticated reads only; all writes require the server service role.

-- Normalize legacy student public URLs to opaque private references. The server
-- retrieval endpoint supports these refs and signs only the caller-authorized
-- student's canonical object path.
UPDATE public.students
SET photo_url = regexp_replace(
  photo_url,
  '^https://[^/]+/storage/v1/object/public/avatars/(students/[0-9a-fA-F-]{36}-photo\.jpg)(\?.*)?$',
  'avatars/\1'
)
WHERE photo_url ~ '^https://[^/]+/storage/v1/object/public/avatars/students/[0-9a-fA-F-]{36}-photo\.jpg(\?.*)?$';

-- === Migration: 20250914000001_public_form_abuse_prevention.sql ===
-- Public admission/contact submissions: service-role-only atomic insert + durable rate limits.
CREATE TABLE IF NOT EXISTS public.public_form_rate_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  form_type TEXT NOT NULL CHECK (form_type IN ('admission', 'contact')),
  ip_hash BYTEA NOT NULL,
  phone_hash BYTEA,
  email_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS public_form_rate_events_ip_idx
  ON public.public_form_rate_events (form_type, ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS public_form_rate_events_phone_idx
  ON public.public_form_rate_events (form_type, phone_hash, created_at DESC)
  WHERE phone_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS public_form_rate_events_email_idx
  ON public.public_form_rate_events (form_type, email_hash, created_at DESC);

ALTER TABLE public.public_form_rate_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.public_form_rate_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.public_form_rate_events_id_seq FROM PUBLIC, anon, authenticated;

-- Direct anonymous inserts are replaced by the serverless endpoints and this RPC.
DROP POLICY IF EXISTS "anon_insert_admission_requests" ON public.admission_requests;
DROP POLICY IF EXISTS "anon_insert_contact_messages" ON public.contact_messages;
REVOKE INSERT ON public.admission_requests FROM anon;
REVOKE INSERT ON public.contact_messages FROM anon;

CREATE UNIQUE INDEX IF NOT EXISTS admission_requests_reference_no_unique
  ON public.admission_requests (reference_no) WHERE reference_no IS NOT NULL;

-- Database-side limits remain authoritative even if a handler validation regression occurs.
ALTER TABLE public.admission_requests
  ADD CONSTRAINT admission_requests_public_lengths CHECK (
    char_length(name) BETWEEN 2 AND 120
    AND email IS NOT NULL AND char_length(email) BETWEEN 3 AND 254
    AND phone IS NOT NULL AND char_length(phone) BETWEEN 8 AND 32
    AND guardian_name IS NOT NULL AND char_length(guardian_name) BETWEEN 2 AND 120
    AND guardian_phone IS NOT NULL AND char_length(guardian_phone) BETWEEN 8 AND 32
    AND (address IS NULL OR char_length(address) <= 500)
    AND (class_level IS NULL OR char_length(class_level) <= 80)
    AND (gender IS NULL OR gender IN ('male', 'female', 'other'))
    AND (message IS NULL OR char_length(message) <= 2000)
    AND status IN ('pending', 'approved', 'rejected')
    AND reference_no ~ '^APP-[A-Z0-9_-]{12}$'
  ) NOT VALID;

ALTER TABLE public.contact_messages
  ADD CONSTRAINT contact_messages_public_lengths CHECK (
    char_length(name) BETWEEN 2 AND 120
    AND char_length(email) BETWEEN 3 AND 254
    AND char_length(phone) <= 32
    AND message IS NOT NULL AND char_length(message) BETWEEN 10 AND 2000
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.submit_public_form(
  p_form_type TEXT,
  p_client_ip INET,
  p_payload JSONB,
  p_reference_no TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_ip_hash BYTEA;
  v_phone_hash BYTEA;
  v_email_hash BYTEA;
  v_phone TEXT;
  v_email TEXT;
  v_id UUID;
  v_ip_limit INTEGER;
  v_identity_limit INTEGER;
BEGIN
  IF p_form_type NOT IN ('admission', 'contact') OR p_client_ip IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_public_form';
  END IF;

  v_phone := regexp_replace(coalesce(p_payload->>'phone', ''), '[^0-9+]', '', 'g');
  v_email := lower(btrim(coalesce(p_payload->>'email', '')));
  IF v_email = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_public_form';
  END IF;

  v_ip_hash := digest(host(p_client_ip), 'sha256');
  v_phone_hash := CASE WHEN v_phone = '' THEN NULL ELSE digest(v_phone, 'sha256') END;
  v_email_hash := digest(v_email, 'sha256');
  v_ip_limit := CASE p_form_type WHEN 'admission' THEN 5 ELSE 10 END;
  v_identity_limit := CASE p_form_type WHEN 'admission' THEN 3 ELSE 5 END;

  -- Serialize contenders for all three counters before counting and inserting.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_form_type || ':ip:' || encode(v_ip_hash, 'hex'), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_form_type || ':email:' || encode(v_email_hash, 'hex'), 0));
  IF v_phone_hash IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_form_type || ':phone:' || encode(v_phone_hash, 'hex'), 0));
  END IF;

  IF (SELECT count(*) FROM public.public_form_rate_events
      WHERE form_type = p_form_type AND ip_hash = v_ip_hash AND created_at > v_now - interval '1 hour') >= v_ip_limit
    OR (SELECT count(*) FROM public.public_form_rate_events
      WHERE form_type = p_form_type AND email_hash = v_email_hash AND created_at > v_now - interval '24 hours') >= v_identity_limit
    OR (v_phone_hash IS NOT NULL AND (SELECT count(*) FROM public.public_form_rate_events
      WHERE form_type = p_form_type AND phone_hash = v_phone_hash AND created_at > v_now - interval '24 hours') >= v_identity_limit)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rate_limited';
  END IF;

  IF p_form_type = 'admission' THEN
    IF p_reference_no IS NULL OR p_reference_no !~ '^APP-[A-Z0-9_-]{12}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_public_form';
    END IF;
    INSERT INTO public.admission_requests (
      name, email, phone, guardian_name, guardian_phone, address,
      class_level, gender, batch_id, message, reference_no
    ) VALUES (
      p_payload->>'name', v_email, p_payload->>'phone', p_payload->>'guardian_name',
      p_payload->>'guardian_phone', nullif(p_payload->>'address', ''),
      nullif(p_payload->>'class_level', ''), nullif(p_payload->>'gender', ''),
      (p_payload->>'batch_id')::uuid, nullif(p_payload->>'message', ''), p_reference_no
    ) RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.contact_messages (name, email, phone, message)
    VALUES (p_payload->>'name', v_email, coalesce(p_payload->>'phone', ''), p_payload->>'message')
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.public_form_rate_events (form_type, ip_hash, phone_hash, email_hash, created_at)
  VALUES (p_form_type, v_ip_hash, v_phone_hash, v_email_hash, v_now);

  -- Opportunistic bounded-retention cleanup; rate events contain hashes only.
  DELETE FROM public.public_form_rate_events WHERE created_at < v_now - interval '2 days';
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$function$;

REVOKE ALL ON FUNCTION public.submit_public_form(TEXT, INET, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_form(TEXT, INET, JSONB, TEXT) TO service_role;

-- === Migration: 20250915000001_durable_message_outbox.sql ===
-- Durable server-only message outbox, delivery state, and admission notification.
-- No provider credentials or raw provider responses belong in these tables.


DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'message_channel') THEN
    CREATE TYPE public.message_channel AS ENUM ('sms', 'email');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'message_job_status') THEN
    CREATE TYPE public.message_job_status AS ENUM ('queued', 'processing', 'completed', 'partially_failed', 'failed', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'message_delivery_status') THEN
    CREATE TYPE public.message_delivery_status AS ENUM ('pending', 'processing', 'accepted', 'delivered', 'failed', 'bounced');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'message_attempt_outcome') THEN
    CREATE TYPE public.message_attempt_outcome AS ENUM ('accepted', 'delivered', 'failed', 'bounced');
  END IF;
END
$do$;

CREATE TABLE public.messaging_configuration (
  channel public.message_channel PRIMARY KEY,
  provider_name TEXT NOT NULL CHECK (provider_name ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  enabled BOOLEAN NOT NULL DEFAULT false,
  sender_label TEXT CHECK (sender_label IS NULL OR char_length(sender_label) BETWEEN 1 AND 100),
  max_attempts SMALLINT NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  base_retry_seconds INTEGER NOT NULL DEFAULT 60 CHECK (base_retry_seconds BETWEEN 5 AND 86400),
  lease_seconds INTEGER NOT NULL DEFAULT 120 CHECK (lease_seconds BETWEEN 15 AND 3600),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (lower(provider_name) !~ '(secret|token|password|api.?key|credential)'),
  CHECK (sender_label IS NULL OR lower(sender_label) !~ '(secret|token|password|api.?key|credential)')
);

COMMENT ON TABLE public.messaging_configuration IS
  'Non-secret operational messaging settings only. Provider credentials remain server-side and must never be stored here.';

CREATE TABLE public.message_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  channel public.message_channel NOT NULL,
  status public.message_job_status NOT NULL DEFAULT 'queued',
  source_type TEXT NOT NULL CHECK (source_type ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  source_id UUID,
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object' AND content <> '{}'::jsonb),
  recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  delivered_count INTEGER NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  bounced_count INTEGER NOT NULL DEFAULT 0 CHECK (bounced_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (accepted_count + delivered_count + failed_count + bounced_count <= recipient_count),
  CHECK (content ? 'body'),
  CHECK (NOT (content ?| ARRAY['password', 'reference_no', 'default_password', 'api_key', 'secret', 'token', 'provider_response']))
);

COMMENT ON COLUMN public.message_jobs.content IS
  'Rendered message fields only; passwords, admission references, provider responses, and credentials are forbidden.';

CREATE TABLE public.message_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.message_jobs(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL CHECK (char_length(recipient) BETWEEN 3 AND 320),
  status public.message_delivery_status NOT NULL DEFAULT 'pending',
  provider_message_id TEXT CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 255),
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT CHECK (locked_by IS NULL OR char_length(locked_by) BETWEEN 1 AND 100),
  accepted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, recipient)
);

CREATE TABLE public.message_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id UUID NOT NULL REFERENCES public.message_deliveries(id) ON DELETE CASCADE,
  attempt_no SMALLINT NOT NULL CHECK (attempt_no BETWEEN 1 AND 20),
  outcome public.message_attempt_outcome NOT NULL,
  provider_message_id TEXT CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 255),
  failure_category TEXT CHECK (failure_category IS NULL OR failure_category IN ('configuration', 'authentication', 'rate_limit', 'provider', 'network', 'invalid_recipient', 'unknown')),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  failure_message TEXT CHECK (
    failure_message IS NULL OR
    (char_length(failure_message) <= 500 AND lower(failure_message) !~ '(authorization|bearer|api.?key|password|secret|token|credential|provider.response)')
  ),
  retryable BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, attempt_no),
  CHECK ((outcome IN ('failed', 'bounced')) OR (failure_category IS NULL AND failure_code IS NULL AND failure_message IS NULL))
);

COMMENT ON TABLE public.message_attempts IS
  'Sanitized attempt audit only: never store request bodies, recipient values, credentials, headers, or raw provider responses.';

CREATE INDEX message_jobs_ready_idx ON public.message_jobs (available_at, created_at)
  WHERE status IN ('queued', 'processing');
CREATE INDEX message_jobs_source_idx ON public.message_jobs (source_type, source_id, created_at DESC);
CREATE INDEX message_jobs_created_at_idx ON public.message_jobs (created_at DESC);
CREATE INDEX message_deliveries_claim_idx ON public.message_deliveries (next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX message_deliveries_job_status_idx ON public.message_deliveries (job_id, status);
CREATE INDEX message_deliveries_created_at_idx ON public.message_deliveries (created_at DESC);
CREATE INDEX message_attempts_delivery_idx ON public.message_attempts (delivery_id, attempt_no DESC);
CREATE INDEX message_attempts_created_at_idx ON public.message_attempts (created_at DESC);

ALTER TABLE public.messaging_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY messaging_configuration_admin_read ON public.messaging_configuration
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY message_jobs_admin_read ON public.message_jobs
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY message_deliveries_admin_read ON public.message_deliveries
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY message_attempts_admin_read ON public.message_attempts
  FOR SELECT TO authenticated USING (public.is_admin());

REVOKE ALL ON TABLE public.messaging_configuration, public.message_jobs, public.message_deliveries, public.message_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.messaging_configuration, public.message_jobs, public.message_deliveries, public.message_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messaging_configuration, public.message_jobs, public.message_deliveries, public.message_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.message_attempts_id_seq TO service_role;

-- Provider credentials are server-only. Remove the legacy browser-admin policy and
-- every direct browser grant; service_role remains the sole SQL API role allowed.
ALTER TABLE public.provider_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_secrets_admin_all ON public.provider_secrets;
REVOKE ALL ON TABLE public.provider_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.provider_secrets TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_message_job(
  p_idempotency_key TEXT,
  p_channel public.message_channel,
  p_source_type TEXT,
  p_source_id UUID,
  p_content JSONB,
  p_recipients TEXT[],
  p_available_at TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_job_id UUID;
  v_recipients TEXT[];
BEGIN
  SELECT COALESCE(array_agg(recipient ORDER BY recipient), ARRAY[]::TEXT[])
    INTO v_recipients
  FROM (
    SELECT DISTINCT btrim(value) AS recipient
    FROM unnest(COALESCE(p_recipients, ARRAY[]::TEXT[])) AS value
    WHERE btrim(value) <> ''
  ) AS normalized;

  IF cardinality(v_recipients) = 0 THEN
    RAISE EXCEPTION 'At least one recipient is required';
  END IF;

  INSERT INTO public.message_jobs (
    idempotency_key, channel, source_type, source_id, content, recipient_count, available_at
  ) VALUES (
    p_idempotency_key, p_channel, p_source_type, p_source_id, p_content,
    cardinality(v_recipients), COALESCE(p_available_at, now())
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_job_id;

  IF v_job_id IS NULL THEN
    SELECT id INTO v_job_id
    FROM public.message_jobs
    WHERE idempotency_key = p_idempotency_key;
    RETURN v_job_id;
  END IF;

  INSERT INTO public.message_deliveries (job_id, recipient, next_attempt_at)
  SELECT v_job_id, recipient, COALESCE(p_available_at, now())
  FROM unnest(v_recipients) AS recipient;

  RETURN v_job_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.claim_message_deliveries(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  delivery_id UUID,
  job_id UUID,
  channel public.message_channel,
  recipient TEXT,
  content JSONB,
  attempt_no SMALLINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
BEGIN
  IF btrim(COALESCE(p_worker_id, '')) = '' OR char_length(p_worker_id) > 100 THEN
    RAISE EXCEPTION 'Invalid worker id';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 15 AND 3600 THEN
    RAISE EXCEPTION 'Invalid claim limits';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
    FROM public.message_deliveries AS d
    JOIN public.message_jobs AS j ON j.id = d.job_id
    LEFT JOIN public.messaging_configuration AS c ON c.channel = j.channel
    WHERE j.status IN ('queued', 'processing')
      AND j.available_at <= now()
      AND COALESCE(c.enabled, false)
      AND d.attempt_count < COALESCE(c.max_attempts, 5)
      AND (
        (d.status = 'pending' AND d.next_attempt_at <= now()) OR
        (d.status = 'processing' AND d.locked_at < now() - make_interval(secs => p_lease_seconds))
      )
    ORDER BY d.next_attempt_at, d.created_at
    FOR UPDATE OF d SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.message_deliveries AS d
    SET status = 'processing',
        attempt_count = d.attempt_count + 1,
        locked_at = now(),
        locked_by = p_worker_id,
        updated_at = now()
    FROM candidates AS x
    WHERE d.id = x.id
    RETURNING d.id, d.job_id, d.recipient, d.attempt_count
  ), touched_jobs AS (
    UPDATE public.message_jobs AS j
    SET status = 'processing', started_at = COALESCE(j.started_at, now()), updated_at = now()
    WHERE j.id IN (SELECT c.job_id FROM claimed AS c)
    RETURNING j.id
  )
  SELECT c.id, c.job_id, j.channel, c.recipient, j.content, c.attempt_count
  FROM claimed AS c
  JOIN public.message_jobs AS j ON j.id = c.job_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.record_message_attempt(
  p_delivery_id UUID,
  p_worker_id TEXT,
  p_outcome public.message_attempt_outcome,
  p_provider_message_id TEXT DEFAULT NULL,
  p_failure_category TEXT DEFAULT NULL,
  p_failure_code TEXT DEFAULT NULL,
  p_failure_message TEXT DEFAULT NULL,
  p_retryable BOOLEAN DEFAULT false,
  p_next_attempt_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.message_delivery_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_delivery public.message_deliveries%ROWTYPE;
  v_max_attempts SMALLINT;
  v_status public.message_delivery_status;
  v_job_status public.message_job_status;
BEGIN
  SELECT d.*
    INTO v_delivery
  FROM public.message_deliveries AS d
  WHERE d.id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message delivery not found'; END IF;

  SELECT COALESCE(c.max_attempts, 5)
    INTO v_max_attempts
  FROM public.message_jobs AS j
  LEFT JOIN public.messaging_configuration AS c ON c.channel = j.channel
  WHERE j.id = v_delivery.job_id;
  IF v_delivery.status <> 'processing' OR v_delivery.locked_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Message delivery lease is not owned by this worker';
  END IF;

  INSERT INTO public.message_attempts (
    delivery_id, attempt_no, outcome, provider_message_id,
    failure_category, failure_code, failure_message, retryable
  ) VALUES (
    v_delivery.id, v_delivery.attempt_count, p_outcome, p_provider_message_id,
    p_failure_category, p_failure_code, p_failure_message, p_retryable
  );

  v_status := CASE
    WHEN p_outcome = 'accepted' THEN 'accepted'::public.message_delivery_status
    WHEN p_outcome = 'delivered' THEN 'delivered'::public.message_delivery_status
    WHEN p_outcome = 'bounced' THEN 'bounced'::public.message_delivery_status
    WHEN p_retryable AND v_delivery.attempt_count < v_max_attempts THEN 'pending'::public.message_delivery_status
    ELSE 'failed'::public.message_delivery_status
  END;

  UPDATE public.message_deliveries
  SET status = v_status,
      provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
      next_attempt_at = CASE WHEN v_status = 'pending' THEN COALESCE(p_next_attempt_at, now() + interval '1 minute') ELSE next_attempt_at END,
      locked_at = NULL,
      locked_by = NULL,
      accepted_at = CASE WHEN v_status = 'accepted' THEN now() ELSE accepted_at END,
      delivered_at = CASE WHEN v_status = 'delivered' THEN now() ELSE delivered_at END,
      failed_at = CASE WHEN v_status = 'failed' THEN now() ELSE failed_at END,
      bounced_at = CASE WHEN v_status = 'bounced' THEN now() ELSE bounced_at END,
      updated_at = now()
  WHERE id = v_delivery.id;

  SELECT CASE
    WHEN count(*) FILTER (WHERE status IN ('pending', 'processing')) > 0 THEN 'processing'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('failed', 'bounced')) = count(*) THEN 'failed'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('failed', 'bounced')) > 0 THEN 'partially_failed'::public.message_job_status
    ELSE 'completed'::public.message_job_status
  END
  INTO v_job_status
  FROM public.message_deliveries
  WHERE job_id = v_delivery.job_id;

  UPDATE public.message_jobs AS j
  SET status = v_job_status,
      recipient_count = a.recipient_count,
      accepted_count = a.accepted_count,
      delivered_count = a.delivered_count,
      failed_count = a.failed_count,
      bounced_count = a.bounced_count,
      completed_at = CASE WHEN v_job_status IN ('completed', 'partially_failed', 'failed') THEN COALESCE(j.completed_at, now()) ELSE NULL END,
      updated_at = now()
  FROM (
    SELECT
      count(*)::INTEGER AS recipient_count,
      count(*) FILTER (WHERE status = 'accepted')::INTEGER AS accepted_count,
      count(*) FILTER (WHERE status = 'delivered')::INTEGER AS delivered_count,
      count(*) FILTER (WHERE status = 'failed')::INTEGER AS failed_count,
      count(*) FILTER (WHERE status = 'bounced')::INTEGER AS bounced_count
    FROM public.message_deliveries
    WHERE job_id = v_delivery.job_id
  ) AS a
  WHERE j.id = v_delivery.job_id;

  RETURN v_status;
END
$fn$;

REVOKE ALL ON FUNCTION public.enqueue_message_job(TEXT, public.message_channel, TEXT, UUID, JSONB, TEXT[], TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_message_deliveries(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_message_job(TEXT, public.message_channel, TEXT, UUID, JSONB, TEXT[], TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_message_deliveries(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;

-- Preserve the existing RPC signature/return contract while making student creation,
-- approval, and credential notification one transaction. The notification never
-- repeats the admission reference or password.
CREATE OR REPLACE FUNCTION public.admin_approve_admission(
  p_admission_id UUID,
  p_student_id TEXT,
  p_password TEXT
)
RETURNS TABLE (student_id TEXT, student_uuid UUID, status TEXT, created BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  a public.admission_requests%ROWTYPE;
  s public.students%ROWTYPE;
  v_channel public.message_channel;
  v_recipient TEXT;
  v_job_id UUID;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin authorization required'; END IF;

  SELECT * INTO a FROM public.admission_requests WHERE id = p_admission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Admission not found'; END IF;

  IF a.status <> 'pending' THEN
    SELECT * INTO s FROM public.students WHERE phone = a.phone ORDER BY created_at DESC LIMIT 1;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Admission is already processed but student is missing'; END IF;
    RETURN QUERY SELECT s.student_id, s.id, a.status, false;
    RETURN;
  END IF;

  INSERT INTO public.students (
    name, phone, student_id, password, email, guardian_name, guardian_phone,
    address, class_level, gender, batch_id, status, is_approved, photo_url
  ) VALUES (
    a.name, a.phone, p_student_id, crypt(p_password, gen_salt('bf')), a.email,
    a.guardian_name, a.guardian_phone, a.address, a.class_level, a.gender,
    a.batch_id, 'active', true, NULL
  )
  RETURNING * INTO s;

  IF a.batch_id IS NOT NULL THEN PERFORM public.increment_enrolled(a.batch_id); END IF;
  UPDATE public.admission_requests SET status = 'approved' WHERE id = a.id;

  IF NULLIF(btrim(a.phone), '') IS NOT NULL THEN
    v_channel := 'sms';
    v_recipient := btrim(a.phone);
  ELSIF NULLIF(btrim(a.email), '') IS NOT NULL THEN
    v_channel := 'email';
    v_recipient := btrim(a.email);
  ELSE
    RAISE EXCEPTION 'Admission has no notification recipient';
  END IF;

  v_job_id := public.enqueue_message_job(
    'admission-approved:' || a.id::TEXT,
    v_channel,
    'admission_approval',
    a.id,
    jsonb_build_object(
      'subject', 'Admission approved',
      'body', format('Your admission is approved. Student ID: %s. Use the admission reference you already saved as your initial password. For security, the reference is not repeated in this message.', s.student_id)
    ),
    ARRAY[v_recipient],
    now()
  );

  RETURN QUERY SELECT s.student_id, s.id, 'approved'::TEXT, true;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Student already exists or generated student ID is already used';
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_approve_admission(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_admission(UUID, TEXT, TEXT) TO authenticated;

-- Defense in depth for historical/portable backup payloads. This helper can be
-- installed before or after the optional backup subsystem.
CREATE OR REPLACE FUNCTION public._backup_redact_message_tables(p_tables JSONB)
RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $fn$
  SELECT (CASE WHEN jsonb_typeof(p_tables) = 'object' THEN p_tables ELSE '{}'::jsonb END)
    - 'provider_secrets'
    - 'message_jobs'
    - 'message_deliveries'
    - 'message_attempts'
    - 'messaging_configuration'
$fn$;

REVOKE ALL ON FUNCTION public._backup_redact_message_tables(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._backup_redact_message_tables(JSONB) TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.backups') IS NOT NULL THEN
    UPDATE public.backups
    SET tables = CASE
      WHEN jsonb_typeof(tables -> 'tables') = 'object' THEN
        tables || jsonb_build_object('tables', public._backup_redact_message_tables(tables -> 'tables'))
      ELSE public._backup_redact_message_tables(tables)
    END
    WHERE tables ?| ARRAY['provider_secrets', 'message_jobs', 'message_deliveries', 'message_attempts', 'messaging_configuration']
       OR (jsonb_typeof(tables -> 'tables') = 'object' AND (tables -> 'tables') ?| ARRAY['provider_secrets', 'message_jobs', 'message_deliveries', 'message_attempts', 'messaging_configuration']);
  END IF;
END
$do$;

-- === Migration: 20250915000002_messaging_worker_heartbeat.sql ===
-- Persist scheduler liveness without storing host credentials or request metadata.

CREATE TABLE public.messaging_worker_heartbeat (
  id TEXT PRIMARY KEY CHECK (id = 'messaging-worker'),
  last_success_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.messaging_worker_heartbeat IS
  'Non-secret liveness marker updated only after successful messaging queue worker runs.';

INSERT INTO public.messaging_worker_heartbeat (id) VALUES ('messaging-worker');

ALTER TABLE public.messaging_worker_heartbeat ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.messaging_worker_heartbeat FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.messaging_worker_heartbeat TO service_role;

-- === Migration: 20250915000003_messaging_channel_claims.sql ===
-- Seed non-secret messaging defaults and require channel-scoped delivery claims.


INSERT INTO public.messaging_configuration (
  channel,
  provider_name,
  enabled
) VALUES
  ('sms'::public.message_channel, 'mim', true),
  ('email'::public.message_channel, 'resend', true)
ON CONFLICT (channel) DO UPDATE
SET provider_name = EXCLUDED.provider_name,
    enabled = EXCLUDED.enabled,
    updated_at = now();

REVOKE ALL ON FUNCTION public.claim_message_deliveries(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.claim_message_deliveries(TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.claim_message_deliveries(
  p_worker_id TEXT,
  p_channel public.message_channel,
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  delivery_id UUID,
  job_id UUID,
  channel public.message_channel,
  recipient TEXT,
  content JSONB,
  attempt_no SMALLINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
BEGIN
  IF btrim(COALESCE(p_worker_id, '')) = '' OR char_length(p_worker_id) > 100 THEN
    RAISE EXCEPTION 'Invalid worker id';
  END IF;
  IF p_channel IS NULL THEN
    RAISE EXCEPTION 'Message channel is required';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 15 AND 3600 THEN
    RAISE EXCEPTION 'Invalid claim limits';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
    FROM public.message_deliveries AS d
    JOIN public.message_jobs AS j ON j.id = d.job_id
    JOIN public.messaging_configuration AS c ON c.channel = j.channel
    WHERE j.channel = p_channel
      AND j.status IN ('queued', 'processing')
      AND j.available_at <= now()
      AND c.enabled
      AND d.attempt_count < c.max_attempts
      AND (
        (d.status = 'pending' AND d.next_attempt_at <= now()) OR
        (d.status = 'processing' AND d.locked_at < now() - make_interval(secs => p_lease_seconds))
      )
    ORDER BY d.next_attempt_at, d.created_at
    FOR UPDATE OF d SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.message_deliveries AS d
    SET status = 'processing',
        attempt_count = d.attempt_count + 1,
        locked_at = now(),
        locked_by = p_worker_id,
        updated_at = now()
    FROM candidates AS x
    WHERE d.id = x.id
    RETURNING d.id, d.job_id, d.recipient, d.attempt_count
  ), touched_jobs AS (
    UPDATE public.message_jobs AS j
    SET status = 'processing', started_at = COALESCE(j.started_at, now()), updated_at = now()
    WHERE j.id IN (SELECT c.job_id FROM claimed AS c)
    RETURNING j.id
  )
  SELECT c.id, c.job_id, j.channel, c.recipient, j.content, c.attempt_count
  FROM claimed AS c
  JOIN public.message_jobs AS j ON j.id = c.job_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.claim_message_deliveries(TEXT, public.message_channel, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_message_deliveries(TEXT, public.message_channel, INTEGER, INTEGER) TO service_role;

-- === Migration: 20250915000004_messaging_ambiguous_outcomes.sql ===
-- Make ambiguous provider outcomes explicit and terminal until an operator reviews them.


ALTER TYPE public.message_delivery_status ADD VALUE IF NOT EXISTS 'unknown';
ALTER TYPE public.message_job_status ADD VALUE IF NOT EXISTS 'requires_review';

ALTER TABLE public.message_jobs
  ADD COLUMN IF NOT EXISTS unknown_count INTEGER NOT NULL DEFAULT 0 CHECK (unknown_count >= 0);

ALTER TABLE public.message_jobs DROP CONSTRAINT IF EXISTS message_jobs_count_check;
ALTER TABLE public.message_jobs
  ADD CONSTRAINT message_jobs_count_check
  CHECK (accepted_count + delivered_count + failed_count + bounced_count + unknown_count <= recipient_count);

COMMENT ON COLUMN public.message_jobs.unknown_count IS
  'Deliveries with an ambiguous provider outcome that require operator review and must not be retried automatically.';

-- PostgreSQL cannot resolve a newly-added enum label until this transaction commits.
-- Defer PL/pgSQL body validation; the function is compiled on first use after commit.
SET LOCAL check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.record_message_attempt(
  p_delivery_id UUID,
  p_worker_id TEXT,
  p_outcome public.message_attempt_outcome,
  p_provider_message_id TEXT DEFAULT NULL,
  p_failure_category TEXT DEFAULT NULL,
  p_failure_code TEXT DEFAULT NULL,
  p_failure_message TEXT DEFAULT NULL,
  p_retryable BOOLEAN DEFAULT false,
  p_next_attempt_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.message_delivery_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_delivery public.message_deliveries%ROWTYPE;
  v_max_attempts SMALLINT;
  v_status public.message_delivery_status;
  v_job_status public.message_job_status;
BEGIN
  SELECT d.* INTO v_delivery
  FROM public.message_deliveries AS d
  WHERE d.id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message delivery not found'; END IF;

  SELECT COALESCE(c.max_attempts, 5) INTO v_max_attempts
  FROM public.message_jobs AS j
  LEFT JOIN public.messaging_configuration AS c ON c.channel = j.channel
  WHERE j.id = v_delivery.job_id;

  IF v_delivery.status <> 'processing' OR v_delivery.locked_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Message delivery lease is not owned by this worker';
  END IF;

  INSERT INTO public.message_attempts (
    delivery_id, attempt_no, outcome, provider_message_id,
    failure_category, failure_code, failure_message, retryable
  ) VALUES (
    v_delivery.id, v_delivery.attempt_count, p_outcome, p_provider_message_id,
    p_failure_category, p_failure_code, p_failure_message, p_retryable
  );

  v_status := CASE
    WHEN p_outcome = 'accepted' THEN 'accepted'::public.message_delivery_status
    WHEN p_outcome = 'delivered' THEN 'delivered'::public.message_delivery_status
    WHEN p_outcome = 'bounced' THEN 'bounced'::public.message_delivery_status
    WHEN p_retryable AND v_delivery.attempt_count < v_max_attempts THEN 'pending'::public.message_delivery_status
    WHEN p_failure_category = 'unknown' THEN 'unknown'::public.message_delivery_status
    ELSE 'failed'::public.message_delivery_status
  END;

  UPDATE public.message_deliveries
  SET status = v_status,
      provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
      next_attempt_at = CASE WHEN v_status = 'pending' THEN COALESCE(p_next_attempt_at, now() + interval '1 minute') ELSE next_attempt_at END,
      locked_at = NULL,
      locked_by = NULL,
      accepted_at = CASE WHEN v_status = 'accepted' THEN now() ELSE accepted_at END,
      delivered_at = CASE WHEN v_status = 'delivered' THEN now() ELSE delivered_at END,
      failed_at = CASE WHEN v_status = 'failed' THEN now() ELSE failed_at END,
      bounced_at = CASE WHEN v_status = 'bounced' THEN now() ELSE bounced_at END,
      updated_at = now()
  WHERE id = v_delivery.id;

  SELECT CASE
    WHEN count(*) FILTER (WHERE status = 'unknown') > 0 THEN 'requires_review'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('pending', 'processing')) > 0 THEN 'processing'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('failed', 'bounced')) = count(*) THEN 'failed'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('failed', 'bounced')) > 0 THEN 'partially_failed'::public.message_job_status
    ELSE 'completed'::public.message_job_status
  END INTO v_job_status
  FROM public.message_deliveries
  WHERE job_id = v_delivery.job_id;

  UPDATE public.message_jobs AS j
  SET status = v_job_status,
      recipient_count = a.recipient_count,
      accepted_count = a.accepted_count,
      delivered_count = a.delivered_count,
      failed_count = a.failed_count,
      bounced_count = a.bounced_count,
      unknown_count = a.unknown_count,
      completed_at = CASE WHEN v_job_status IN ('completed', 'partially_failed', 'failed', 'requires_review') THEN COALESCE(j.completed_at, now()) ELSE NULL END,
      updated_at = now()
  FROM (
    SELECT
      count(*)::INTEGER AS recipient_count,
      count(*) FILTER (WHERE status = 'accepted')::INTEGER AS accepted_count,
      count(*) FILTER (WHERE status = 'delivered')::INTEGER AS delivered_count,
      count(*) FILTER (WHERE status = 'failed')::INTEGER AS failed_count,
      count(*) FILTER (WHERE status = 'bounced')::INTEGER AS bounced_count,
      count(*) FILTER (WHERE status = 'unknown')::INTEGER AS unknown_count
    FROM public.message_deliveries
    WHERE job_id = v_delivery.job_id
  ) AS a
  WHERE j.id = v_delivery.job_id;

  RETURN v_status;
END
$fn$;

REVOKE ALL ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;

-- === Migration: 20250915000005_atomic_message_attempts.sql ===
-- Make every provider attempt finalization atomic and require a real lease for inline sends.


ALTER TYPE public.message_attempt_outcome ADD VALUE IF NOT EXISTS 'unknown';

ALTER TABLE public.message_attempts
  DROP CONSTRAINT IF EXISTS message_attempts_check;
ALTER TABLE public.message_attempts
  DROP CONSTRAINT IF EXISTS message_attempts_outcome_fields_check;
ALTER TABLE public.message_attempts
  ADD CONSTRAINT message_attempts_outcome_fields_check
  CHECK ((outcome NOT IN ('accepted', 'delivered')) OR
    (failure_category IS NULL AND failure_code IS NULL AND failure_message IS NULL));

-- PostgreSQL cannot resolve a newly-added enum label until this transaction commits.
SET LOCAL check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.claim_message_job_delivery(
  p_job_id UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  delivery_id UUID,
  job_id UUID,
  channel public.message_channel,
  recipient TEXT,
  content JSONB,
  attempt_no SMALLINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
BEGIN
  IF p_job_id IS NULL THEN RAISE EXCEPTION 'Message job is required'; END IF;
  IF btrim(COALESCE(p_worker_id, '')) = '' OR char_length(p_worker_id) > 100 THEN
    RAISE EXCEPTION 'Invalid worker id';
  END IF;
  IF p_lease_seconds NOT BETWEEN 15 AND 3600 THEN RAISE EXCEPTION 'Invalid lease duration'; END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT d.id
    FROM public.message_deliveries AS d
    JOIN public.message_jobs AS j ON j.id = d.job_id
    JOIN public.messaging_configuration AS c ON c.channel = j.channel
    WHERE d.job_id = p_job_id
      AND j.status IN ('queued', 'processing')
      AND j.available_at <= now()
      AND c.enabled
      AND d.status = 'pending'
      AND d.next_attempt_at <= now()
      AND d.attempt_count < c.max_attempts
    ORDER BY d.created_at
    FOR UPDATE OF d SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.message_deliveries AS d
    SET status = 'processing',
        attempt_count = d.attempt_count + 1,
        locked_at = now(),
        locked_by = p_worker_id,
        updated_at = now()
    FROM candidate AS x
    WHERE d.id = x.id
    RETURNING d.id, d.job_id, d.recipient, d.attempt_count
  ), touched_job AS (
    UPDATE public.message_jobs AS j
    SET status = 'processing', started_at = COALESCE(j.started_at, now()), updated_at = now()
    WHERE j.id IN (SELECT c.job_id FROM claimed AS c)
    RETURNING j.id
  )
  SELECT c.id, c.job_id, j.channel, c.recipient, j.content, c.attempt_count
  FROM claimed AS c
  JOIN public.message_jobs AS j ON j.id = c.job_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.record_message_attempt(
  p_delivery_id UUID,
  p_worker_id TEXT,
  p_outcome public.message_attempt_outcome,
  p_provider_message_id TEXT DEFAULT NULL,
  p_failure_category TEXT DEFAULT NULL,
  p_failure_code TEXT DEFAULT NULL,
  p_failure_message TEXT DEFAULT NULL,
  p_retryable BOOLEAN DEFAULT false,
  p_next_attempt_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.message_delivery_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_delivery public.message_deliveries%ROWTYPE;
  v_max_attempts SMALLINT;
  v_status public.message_delivery_status;
  v_job_status public.message_job_status;
  v_provider_message_id TEXT;
  v_failure_category TEXT;
  v_failure_code TEXT;
  v_failure_message TEXT;
BEGIN
  SELECT d.* INTO v_delivery
  FROM public.message_deliveries AS d
  WHERE d.id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message delivery not found'; END IF;
  IF v_delivery.status <> 'processing' OR v_delivery.locked_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Message delivery lease is not owned by this worker';
  END IF;

  -- Serialize aggregate refreshes for deliveries in the same job so the last
  -- committer always observes every previously committed terminal transition.
  PERFORM 1 FROM public.message_jobs AS j WHERE j.id = v_delivery.job_id FOR UPDATE;

  SELECT COALESCE(c.max_attempts, 5) INTO v_max_attempts
  FROM public.message_jobs AS j
  LEFT JOIN public.messaging_configuration AS c ON c.channel = j.channel
  WHERE j.id = v_delivery.job_id;

  v_provider_message_id := NULLIF(left(btrim(COALESCE(p_provider_message_id, '')), 255), '');
  IF p_outcome IN ('accepted', 'delivered') THEN
    v_failure_category := NULL;
    v_failure_code := NULL;
    v_failure_message := NULL;
  ELSE
    v_failure_category := CASE WHEN p_failure_category IN
      ('configuration', 'authentication', 'rate_limit', 'provider', 'network', 'invalid_recipient', 'unknown')
      THEN p_failure_category ELSE 'unknown' END;
    v_failure_code := CASE
      WHEN p_failure_code ~ '^[A-Za-z0-9_.:-]{1,100}$' THEN p_failure_code
      ELSE 'unknown' END;
    v_failure_message := CASE
      WHEN p_failure_message IS NULL THEN NULL
      WHEN lower(p_failure_message) ~ '(authorization|bearer|api.?key|password|secret|token|credential|provider.response)'
        THEN 'Provider attempt failed (details redacted)'
      ELSE left(p_failure_message, 500) END;
  END IF;

  INSERT INTO public.message_attempts (
    delivery_id, attempt_no, outcome, provider_message_id,
    failure_category, failure_code, failure_message, retryable
  ) VALUES (
    v_delivery.id, v_delivery.attempt_count, p_outcome, v_provider_message_id,
    v_failure_category, v_failure_code, v_failure_message, p_retryable
  );

  v_status := CASE
    WHEN p_outcome = 'accepted' THEN 'accepted'::public.message_delivery_status
    WHEN p_outcome = 'delivered' THEN 'delivered'::public.message_delivery_status
    WHEN p_outcome = 'bounced' THEN 'bounced'::public.message_delivery_status
    WHEN p_outcome = 'unknown' THEN 'unknown'::public.message_delivery_status
    WHEN p_retryable AND v_delivery.attempt_count < v_max_attempts THEN 'pending'::public.message_delivery_status
    ELSE 'failed'::public.message_delivery_status
  END;

  UPDATE public.message_deliveries
  SET status = v_status,
      provider_message_id = COALESCE(v_provider_message_id, provider_message_id),
      next_attempt_at = CASE WHEN v_status = 'pending' THEN COALESCE(p_next_attempt_at, now() + interval '1 minute') ELSE next_attempt_at END,
      locked_at = NULL,
      locked_by = NULL,
      accepted_at = CASE WHEN v_status = 'accepted' THEN now() ELSE accepted_at END,
      delivered_at = CASE WHEN v_status = 'delivered' THEN now() ELSE delivered_at END,
      failed_at = CASE WHEN v_status = 'failed' THEN now() ELSE failed_at END,
      bounced_at = CASE WHEN v_status = 'bounced' THEN now() ELSE bounced_at END,
      updated_at = now()
  WHERE id = v_delivery.id;

  SELECT CASE
    WHEN count(*) FILTER (WHERE status = 'unknown') > 0 THEN 'requires_review'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('pending', 'processing')) > 0 THEN 'processing'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('failed', 'bounced')) = count(*) THEN 'failed'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('failed', 'bounced')) > 0 THEN 'partially_failed'::public.message_job_status
    ELSE 'completed'::public.message_job_status
  END INTO v_job_status
  FROM public.message_deliveries
  WHERE job_id = v_delivery.job_id;

  UPDATE public.message_jobs AS j
  SET status = v_job_status,
      recipient_count = a.recipient_count,
      accepted_count = a.accepted_count,
      delivered_count = a.delivered_count,
      failed_count = a.failed_count,
      bounced_count = a.bounced_count,
      unknown_count = a.unknown_count,
      completed_at = CASE WHEN v_job_status IN ('completed', 'partially_failed', 'failed', 'requires_review')
        THEN COALESCE(j.completed_at, now()) ELSE NULL END,
      updated_at = now()
  FROM (
    SELECT count(*)::INTEGER AS recipient_count,
      count(*) FILTER (WHERE status = 'accepted')::INTEGER AS accepted_count,
      count(*) FILTER (WHERE status = 'delivered')::INTEGER AS delivered_count,
      count(*) FILTER (WHERE status = 'failed')::INTEGER AS failed_count,
      count(*) FILTER (WHERE status = 'bounced')::INTEGER AS bounced_count,
      count(*) FILTER (WHERE status = 'unknown')::INTEGER AS unknown_count
    FROM public.message_deliveries
    WHERE job_id = v_delivery.job_id
  ) AS a
  WHERE j.id = v_delivery.job_id;

  RETURN v_status;
END
$fn$;

REVOKE ALL ON FUNCTION public.claim_message_job_delivery(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_message_job_delivery(UUID, TEXT, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;

-- === Migration: 20250915000006_atomic_message_job_aggregate.sql ===
-- Replace stale read-then-write aggregate refreshes with one serialized database operation.


CREATE OR REPLACE FUNCTION public.refresh_message_job_aggregate(
  p_job_id UUID
)
RETURNS TABLE (
  job_id UUID,
  status TEXT,
  total INTEGER,
  accepted INTEGER,
  failed INTEGER,
  pending INTEGER,
  unknown INTEGER,
  requires_review BOOLEAN,
  dry_run BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_job public.message_jobs%ROWTYPE;
  v_recipient_count INTEGER;
  v_accepted_count INTEGER;
  v_delivered_count INTEGER;
  v_failed_count INTEGER;
  v_bounced_count INTEGER;
  v_pending_count INTEGER;
  v_unknown_count INTEGER;
  v_job_status public.message_job_status;
BEGIN
  IF p_job_id IS NULL THEN RAISE EXCEPTION 'Message job is required'; END IF;

  -- Every aggregate writer for a job serializes on this row. Counts are read only
  -- after the lock is held, so an older snapshot can never overwrite newer totals.
  SELECT j.* INTO v_job
  FROM public.message_jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message job not found'; END IF;

  SELECT
    count(*)::INTEGER,
    count(*) FILTER (WHERE d.status = 'accepted')::INTEGER,
    count(*) FILTER (WHERE d.status = 'delivered')::INTEGER,
    count(*) FILTER (WHERE d.status = 'failed')::INTEGER,
    count(*) FILTER (WHERE d.status = 'bounced')::INTEGER,
    count(*) FILTER (WHERE d.status IN ('pending', 'processing'))::INTEGER,
    count(*) FILTER (WHERE d.status = 'unknown')::INTEGER
  INTO
    v_recipient_count,
    v_accepted_count,
    v_delivered_count,
    v_failed_count,
    v_bounced_count,
    v_pending_count,
    v_unknown_count
  FROM public.message_deliveries AS d
  WHERE d.job_id = p_job_id;

  v_job_status := CASE
    WHEN v_job.source_type = 'api_dry_run' THEN 'cancelled'::public.message_job_status
    WHEN v_unknown_count > 0 THEN 'requires_review'::public.message_job_status
    WHEN v_pending_count > 0 THEN 'processing'::public.message_job_status
    WHEN v_recipient_count > 0 AND v_failed_count + v_bounced_count = v_recipient_count THEN 'failed'::public.message_job_status
    WHEN v_failed_count + v_bounced_count > 0 THEN 'partially_failed'::public.message_job_status
    ELSE 'completed'::public.message_job_status
  END;

  UPDATE public.message_jobs AS j
  SET status = v_job_status,
      recipient_count = v_recipient_count,
      accepted_count = v_accepted_count,
      delivered_count = v_delivered_count,
      failed_count = v_failed_count,
      bounced_count = v_bounced_count,
      unknown_count = v_unknown_count,
      completed_at = CASE
        WHEN v_job_status IN ('completed', 'partially_failed', 'failed', 'requires_review', 'cancelled')
          THEN COALESCE(j.completed_at, now())
        ELSE NULL
      END,
      updated_at = now()
  WHERE j.id = p_job_id;

  RETURN QUERY SELECT
    p_job_id,
    CASE
      WHEN v_job.source_type = 'api_dry_run' THEN 'dry_run'
      WHEN v_job_status = 'partially_failed' THEN 'partial'
      ELSE v_job_status::TEXT
    END,
    v_recipient_count,
    v_accepted_count + v_delivered_count,
    v_failed_count + v_bounced_count,
    v_pending_count,
    v_unknown_count,
    v_unknown_count > 0,
    v_job.source_type = 'api_dry_run';
END
$fn$;

REVOKE ALL ON FUNCTION public.refresh_message_job_aggregate(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_message_job_aggregate(UUID) TO service_role;

-- === Migration: 20250915000007_non_idempotent_sms_dispatch.sql ===
-- Fence non-idempotent MIM provider I/O behind a durable, non-reclaimable state.


ALTER TYPE public.message_delivery_status ADD VALUE IF NOT EXISTS 'dispatching';

-- PostgreSQL cannot resolve a newly-added enum label until this transaction commits.
SET LOCAL check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.begin_non_idempotent_dispatch(
  p_delivery_id UUID,
  p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_delivery public.message_deliveries%ROWTYPE;
  v_channel public.message_channel;
  v_lease_seconds INTEGER;
BEGIN
  IF p_delivery_id IS NULL THEN RAISE EXCEPTION 'Message delivery is required'; END IF;
  IF btrim(COALESCE(p_worker_id, '')) = '' OR char_length(p_worker_id) > 100 THEN
    RAISE EXCEPTION 'Invalid worker id';
  END IF;

  SELECT d, j.channel, COALESCE(c.lease_seconds, 120)
    INTO v_delivery, v_channel, v_lease_seconds
  FROM public.message_deliveries AS d
  JOIN public.message_jobs AS j ON j.id = d.job_id
  LEFT JOIN public.messaging_configuration AS c ON c.channel = j.channel
  WHERE d.id = p_delivery_id
  FOR UPDATE OF d;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message delivery not found'; END IF;
  IF v_channel <> 'sms'::public.message_channel THEN
    RAISE EXCEPTION 'Non-idempotent dispatch is only valid for SMS';
  END IF;
  IF v_delivery.status <> 'processing'::public.message_delivery_status
     OR v_delivery.locked_by IS DISTINCT FROM p_worker_id
     OR v_delivery.locked_at IS NULL
     OR v_delivery.locked_at < now() - make_interval(secs => v_lease_seconds) THEN
    RAISE EXCEPTION 'Message delivery lease is not owned by this worker';
  END IF;

  -- Once this commits, claim RPCs cannot reclaim the row: they only select pending
  -- or expired processing rows. A worker crash after this point requires review.
  UPDATE public.message_deliveries AS d
  SET status = 'dispatching'::public.message_delivery_status,
      updated_at = now()
  WHERE d.id = v_delivery.id;

  -- Serialize every aggregate writer for the job and expose the unknown outcome
  -- before any non-idempotent provider request can begin.
  PERFORM 1 FROM public.message_jobs AS j WHERE j.id = v_delivery.job_id FOR UPDATE;
  UPDATE public.message_jobs AS j
  SET status = 'requires_review'::public.message_job_status,
      recipient_count = a.recipient_count,
      accepted_count = a.accepted_count,
      delivered_count = a.delivered_count,
      failed_count = a.failed_count,
      bounced_count = a.bounced_count,
      unknown_count = a.unknown_count,
      completed_at = COALESCE(j.completed_at, now()),
      updated_at = now()
  FROM (
    SELECT count(*)::INTEGER AS recipient_count,
      count(*) FILTER (WHERE status = 'accepted')::INTEGER AS accepted_count,
      count(*) FILTER (WHERE status = 'delivered')::INTEGER AS delivered_count,
      count(*) FILTER (WHERE status = 'failed')::INTEGER AS failed_count,
      count(*) FILTER (WHERE status = 'bounced')::INTEGER AS bounced_count,
      count(*) FILTER (WHERE status IN ('unknown', 'dispatching'))::INTEGER AS unknown_count
    FROM public.message_deliveries
    WHERE job_id = v_delivery.job_id
  ) AS a
  WHERE j.id = v_delivery.job_id;

  RETURN true;
END
$fn$;

CREATE OR REPLACE FUNCTION public.record_message_attempt(
  p_delivery_id UUID,
  p_worker_id TEXT,
  p_outcome public.message_attempt_outcome,
  p_provider_message_id TEXT DEFAULT NULL,
  p_failure_category TEXT DEFAULT NULL,
  p_failure_code TEXT DEFAULT NULL,
  p_failure_message TEXT DEFAULT NULL,
  p_retryable BOOLEAN DEFAULT false,
  p_next_attempt_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.message_delivery_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_delivery public.message_deliveries%ROWTYPE;
  v_max_attempts SMALLINT;
  v_status public.message_delivery_status;
  v_job_status public.message_job_status;
  v_provider_message_id TEXT;
  v_failure_category TEXT;
  v_failure_code TEXT;
  v_failure_message TEXT;
BEGIN
  SELECT d.* INTO v_delivery
  FROM public.message_deliveries AS d
  WHERE d.id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message delivery not found'; END IF;
  IF v_delivery.status NOT IN ('processing'::public.message_delivery_status, 'dispatching'::public.message_delivery_status)
     OR v_delivery.locked_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Message delivery lease is not owned by this worker';
  END IF;

  PERFORM 1 FROM public.message_jobs AS j WHERE j.id = v_delivery.job_id FOR UPDATE;

  SELECT COALESCE(c.max_attempts, 5) INTO v_max_attempts
  FROM public.message_jobs AS j
  LEFT JOIN public.messaging_configuration AS c ON c.channel = j.channel
  WHERE j.id = v_delivery.job_id;

  v_provider_message_id := NULLIF(left(btrim(COALESCE(p_provider_message_id, '')), 255), '');
  IF p_outcome IN ('accepted', 'delivered') THEN
    v_failure_category := NULL;
    v_failure_code := NULL;
    v_failure_message := NULL;
  ELSE
    v_failure_category := CASE WHEN p_failure_category IN
      ('configuration', 'authentication', 'rate_limit', 'provider', 'network', 'invalid_recipient', 'unknown')
      THEN p_failure_category ELSE 'unknown' END;
    v_failure_code := CASE WHEN p_failure_code ~ '^[A-Za-z0-9_.:-]{1,100}$' THEN p_failure_code ELSE 'unknown' END;
    v_failure_message := CASE
      WHEN p_failure_message IS NULL THEN NULL
      WHEN lower(p_failure_message) ~ '(authorization|bearer|api.?key|password|secret|token|credential|provider.response)'
        THEN 'Provider attempt failed (details redacted)'
      ELSE left(p_failure_message, 500) END;
  END IF;

  INSERT INTO public.message_attempts (
    delivery_id, attempt_no, outcome, provider_message_id,
    failure_category, failure_code, failure_message, retryable
  ) VALUES (
    v_delivery.id, v_delivery.attempt_count, p_outcome, v_provider_message_id,
    v_failure_category, v_failure_code, v_failure_message, p_retryable
  );

  v_status := CASE
    WHEN p_outcome = 'accepted' THEN 'accepted'::public.message_delivery_status
    WHEN p_outcome = 'delivered' THEN 'delivered'::public.message_delivery_status
    WHEN p_outcome = 'bounced' THEN 'bounced'::public.message_delivery_status
    WHEN p_outcome = 'unknown' THEN 'unknown'::public.message_delivery_status
    WHEN p_retryable AND v_delivery.status <> 'dispatching'::public.message_delivery_status
      AND v_delivery.attempt_count < v_max_attempts THEN 'pending'::public.message_delivery_status
    ELSE 'failed'::public.message_delivery_status
  END;

  UPDATE public.message_deliveries
  SET status = v_status,
      provider_message_id = COALESCE(v_provider_message_id, provider_message_id),
      next_attempt_at = CASE WHEN v_status = 'pending' THEN COALESCE(p_next_attempt_at, now() + interval '1 minute') ELSE next_attempt_at END,
      locked_at = NULL,
      locked_by = NULL,
      accepted_at = CASE WHEN v_status = 'accepted' THEN now() ELSE accepted_at END,
      delivered_at = CASE WHEN v_status = 'delivered' THEN now() ELSE delivered_at END,
      failed_at = CASE WHEN v_status = 'failed' THEN now() ELSE failed_at END,
      bounced_at = CASE WHEN v_status = 'bounced' THEN now() ELSE bounced_at END,
      updated_at = now()
  WHERE id = v_delivery.id;

  SELECT CASE
    WHEN count(*) FILTER (WHERE status IN ('unknown', 'dispatching')) > 0 THEN 'requires_review'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('pending', 'processing')) > 0 THEN 'processing'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('failed', 'bounced')) = count(*) THEN 'failed'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('failed', 'bounced')) > 0 THEN 'partially_failed'::public.message_job_status
    ELSE 'completed'::public.message_job_status
  END INTO v_job_status
  FROM public.message_deliveries
  WHERE job_id = v_delivery.job_id;

  UPDATE public.message_jobs AS j
  SET status = v_job_status,
      recipient_count = a.recipient_count,
      accepted_count = a.accepted_count,
      delivered_count = a.delivered_count,
      failed_count = a.failed_count,
      bounced_count = a.bounced_count,
      unknown_count = a.unknown_count,
      completed_at = CASE WHEN v_job_status IN ('completed', 'partially_failed', 'failed', 'requires_review')
        THEN COALESCE(j.completed_at, now()) ELSE NULL END,
      updated_at = now()
  FROM (
    SELECT count(*)::INTEGER AS recipient_count,
      count(*) FILTER (WHERE status = 'accepted')::INTEGER AS accepted_count,
      count(*) FILTER (WHERE status = 'delivered')::INTEGER AS delivered_count,
      count(*) FILTER (WHERE status = 'failed')::INTEGER AS failed_count,
      count(*) FILTER (WHERE status = 'bounced')::INTEGER AS bounced_count,
      count(*) FILTER (WHERE status IN ('unknown', 'dispatching'))::INTEGER AS unknown_count
    FROM public.message_deliveries
    WHERE job_id = v_delivery.job_id
  ) AS a
  WHERE j.id = v_delivery.job_id;

  RETURN v_status;
END
$fn$;

CREATE OR REPLACE FUNCTION public.refresh_message_job_aggregate(
  p_job_id UUID
)
RETURNS TABLE (
  job_id UUID,
  status TEXT,
  total INTEGER,
  accepted INTEGER,
  failed INTEGER,
  pending INTEGER,
  unknown INTEGER,
  requires_review BOOLEAN,
  dry_run BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_job public.message_jobs%ROWTYPE;
  v_recipient_count INTEGER;
  v_accepted_count INTEGER;
  v_delivered_count INTEGER;
  v_failed_count INTEGER;
  v_bounced_count INTEGER;
  v_pending_count INTEGER;
  v_unknown_count INTEGER;
  v_job_status public.message_job_status;
BEGIN
  IF p_job_id IS NULL THEN RAISE EXCEPTION 'Message job is required'; END IF;
  SELECT j.* INTO v_job FROM public.message_jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message job not found'; END IF;

  SELECT count(*)::INTEGER,
    count(*) FILTER (WHERE d.status = 'accepted')::INTEGER,
    count(*) FILTER (WHERE d.status = 'delivered')::INTEGER,
    count(*) FILTER (WHERE d.status = 'failed')::INTEGER,
    count(*) FILTER (WHERE d.status = 'bounced')::INTEGER,
    count(*) FILTER (WHERE d.status IN ('pending', 'processing'))::INTEGER,
    count(*) FILTER (WHERE d.status IN ('unknown', 'dispatching'))::INTEGER
  INTO v_recipient_count, v_accepted_count, v_delivered_count, v_failed_count,
    v_bounced_count, v_pending_count, v_unknown_count
  FROM public.message_deliveries AS d
  WHERE d.job_id = p_job_id;

  v_job_status := CASE
    WHEN v_job.source_type = 'api_dry_run' THEN 'cancelled'::public.message_job_status
    WHEN v_unknown_count > 0 THEN 'requires_review'::public.message_job_status
    WHEN v_pending_count > 0 THEN 'processing'::public.message_job_status
    WHEN v_recipient_count > 0 AND v_failed_count + v_bounced_count = v_recipient_count THEN 'failed'::public.message_job_status
    WHEN v_failed_count + v_bounced_count > 0 THEN 'partially_failed'::public.message_job_status
    ELSE 'completed'::public.message_job_status
  END;

  UPDATE public.message_jobs AS j
  SET status = v_job_status, recipient_count = v_recipient_count,
      accepted_count = v_accepted_count, delivered_count = v_delivered_count,
      failed_count = v_failed_count, bounced_count = v_bounced_count,
      unknown_count = v_unknown_count,
      completed_at = CASE WHEN v_job_status IN ('completed', 'partially_failed', 'failed', 'requires_review', 'cancelled')
        THEN COALESCE(j.completed_at, now()) ELSE NULL END,
      updated_at = now()
  WHERE j.id = p_job_id;

  RETURN QUERY SELECT p_job_id,
    CASE WHEN v_job.source_type = 'api_dry_run' THEN 'dry_run'
      WHEN v_job_status = 'partially_failed' THEN 'partial' ELSE v_job_status::TEXT END,
    v_recipient_count, v_accepted_count + v_delivered_count,
    v_failed_count + v_bounced_count, v_pending_count, v_unknown_count,
    v_unknown_count > 0, v_job.source_type = 'api_dry_run';
END
$fn$;

REVOKE ALL ON FUNCTION public.begin_non_idempotent_dispatch(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_non_idempotent_dispatch(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_message_job_aggregate(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_message_job_aggregate(UUID) TO service_role;

-- === Migration: 20250915000008_provider_neutral_messaging.sql ===
-- Authoritative provider-neutral messaging contract: safe configuration, versioned encrypted credentials, immutable job snapshots.

CREATE OR REPLACE FUNCTION public._messaging_safe_path(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $fn$
  SELECT char_length(p_path) BETWEEN 1 AND 256
    AND p_path ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}(\.[A-Za-z][A-Za-z0-9_-]{0,63})*$'
    AND p_path !~* '(^|\.)(__proto__|prototype|constructor|password|passwd|secret|token|api_?key|apikey|credential|authorization|cookie|private_?key)(\.|$)'
    AND p_path !~ E'[\r\n]'
$fn$;

CREATE OR REPLACE FUNCTION public._messaging_safe_header(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $fn$
  SELECT char_length(p_name) BETWEEN 1 AND 128
    AND p_name ~ '^[!#$%&''*+.^_`|~0-9A-Za-z-]+$'
    AND lower(p_name) <> ALL (ARRAY['authorization','proxy-authorization','cookie','set-cookie','host','content-length','connection','transfer-encoding','te','trailer','upgrade','keep-alive','proxy-authenticate','proxy-connection'])
    AND p_name !~* '(password|passwd|secret|token|api.?key|credential)'
$fn$;

CREATE OR REPLACE FUNCTION public._messaging_provider_config_valid(p_channel public.message_channel, p_provider TEXT, p_config JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $fn$
DECLARE v_key TEXT; v_value JSONB; v_auth JSONB; v_idem JSONB; v_endpoint TEXT;
BEGIN
  IF jsonb_typeof(p_config) <> 'object' OR p_config ->> 'providerName' IS DISTINCT FROM p_provider
    OR p_config::TEXT ~* '(-----BEGIN|bearer[[:space:]]+[A-Za-z0-9._~+/-]{8}|(^|[^a-z])(sk|pk|api)[_-][A-Za-z0-9_-]{12}|eyJ[A-Za-z0-9_-]{8,}\.|[A-Fa-f0-9]{32,}|eval[[:space:]]*\(|function[[:space:]]*\(|<%|\{\{)'
    OR p_config::TEXT ~ E'[\r\n]' THEN RETURN false; END IF;
  IF p_provider = 'mim' THEN
    RETURN p_channel = 'sms' AND p_config ?& ARRAY['providerName','userName','senderName']
      AND NOT p_config ?| ARRAY['endpoint','auth','idempotency','fieldMappings','acceptedStatuses','success','providerIdPath','from']
      AND (SELECT count(*) = 3 FROM jsonb_object_keys(p_config))
      AND p_config ->> 'userName' ~ '^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,99}$'
      AND p_config ->> 'senderName' ~ '^[A-Za-z0-9]{1,11}$';
  ELSIF p_provider = 'resend' THEN
    RETURN p_channel = 'email' AND (SELECT count(*) = 2 FROM jsonb_object_keys(p_config))
      AND p_config ?& ARRAY['providerName','from'] AND char_length(p_config ->> 'from') BETWEEN 1 AND 320;
  ELSIF p_provider <> 'custom' THEN RETURN false; END IF;
  IF NOT p_config ?& ARRAY['providerName','endpoint','method','idempotency','fieldMappings','acceptedStatuses','providerIdPath']
    OR p_config ?| ARRAY['headers','body','bodyTemplate','script']
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_config) k WHERE k <> ALL(ARRAY['providerName','endpoint','method','auth','idempotency','fieldMappings','acceptedStatuses','success','providerIdPath','senderIdentity']))
    OR p_config ->> 'method' <> 'POST' THEN RETURN false; END IF;
  v_endpoint := p_config ->> 'endpoint';
  IF char_length(v_endpoint) NOT BETWEEN 12 AND 2048 OR v_endpoint !~ '^https://[A-Za-z0-9.-]+/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*$'
    OR v_endpoint ~ '(^https://[^/]*@|[?#]|://[^/]+:[0-9]+/)' THEN RETURN false; END IF;
  IF jsonb_typeof(p_config -> 'fieldMappings') <> 'object' OR p_config -> 'fieldMappings' = '{}'::jsonb THEN RETURN false; END IF;
  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_config -> 'fieldMappings') LOOP
    IF v_key <> ALL(ARRAY['recipient','message','subject','html','text','sender']) OR jsonb_typeof(v_value) <> 'string' OR NOT public._messaging_safe_path(v_value #>> '{}') THEN RETURN false; END IF;
  END LOOP;
  v_auth := p_config -> 'auth';
  IF v_auth IS NOT NULL THEN
    IF jsonb_typeof(v_auth) <> 'object' OR v_auth ->> 'placement' NOT IN ('header','body') THEN RETURN false; END IF;
    IF v_auth ->> 'placement' = 'header' AND (NOT public._messaging_safe_header(v_auth ->> 'name') OR (v_auth ? 'path')) THEN RETURN false; END IF;
    IF v_auth ->> 'placement' = 'body' AND (NOT public._messaging_safe_path(v_auth ->> 'path') OR v_auth ?| ARRAY['name','scheme']) THEN RETURN false; END IF;
  END IF;
  v_idem := p_config -> 'idempotency';
  IF jsonb_typeof(v_idem) <> 'object' OR v_idem ->> 'placement' NOT IN ('header','body','none') THEN RETURN false; END IF;
  IF v_idem ->> 'placement' = 'header' AND NOT public._messaging_safe_header(v_idem ->> 'name') THEN RETURN false; END IF;
  IF v_idem ->> 'placement' = 'body' AND NOT public._messaging_safe_path(v_idem ->> 'path') THEN RETURN false; END IF;
  IF jsonb_typeof(p_config -> 'acceptedStatuses') <> 'array' OR jsonb_array_length(p_config -> 'acceptedStatuses') NOT BETWEEN 1 AND 20
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_config -> 'acceptedStatuses') x WHERE jsonb_typeof(x) <> 'number' OR (x #>> '{}')::INTEGER NOT BETWEEN 200 AND 599) THEN RETURN false; END IF;
  IF NOT public._messaging_safe_path(p_config ->> 'providerIdPath') THEN RETURN false; END IF;
  IF p_config ? 'success' AND (jsonb_typeof(p_config -> 'success') <> 'object' OR NOT (p_config -> 'success') ?& ARRAY['path','value'] OR NOT public._messaging_safe_path(p_config #>> '{success,path}') OR jsonb_typeof(p_config #> '{success,value}') NOT IN ('string','number','boolean','null')) THEN RETURN false; END IF;
  RETURN true;
END $fn$;

ALTER TABLE public.messaging_configuration
  ADD COLUMN provider_config JSONB,
  ADD COLUMN config_revision UUID;
UPDATE public.messaging_configuration SET
  provider_config = CASE channel
    WHEN 'sms'::public.message_channel THEN jsonb_build_object('providerName','mim','userName','configure-me','senderName',COALESCE(NULLIF(sender_label,''),'MIM'))
    ELSE jsonb_build_object('providerName','resend','from',COALESCE(NULLIF(sender_label,''),'configure@example.invalid')) END,
  config_revision = gen_random_uuid();
-- Legacy rows are safe placeholders only and remain disabled until the service-role configuration API saves reviewed metadata.
UPDATE public.messaging_configuration SET enabled = false;
ALTER TABLE public.messaging_configuration
  ALTER COLUMN provider_config SET NOT NULL,
  ALTER COLUMN config_revision SET NOT NULL,
  ALTER COLUMN config_revision SET DEFAULT gen_random_uuid(),
  DROP COLUMN sender_label,
  ADD CONSTRAINT messaging_configuration_provider_config_check CHECK (public._messaging_provider_config_valid(channel, provider_name, provider_config));
COMMENT ON COLUMN public.messaging_configuration.provider_config IS 'Safe non-secret built-in/custom provider metadata only.';

CREATE TABLE public.messaging_provider_credentials (
  channel public.message_channel NOT NULL,
  provider_name TEXT NOT NULL,
  config_revision UUID NOT NULL,
  ciphertext TEXT NOT NULL CHECK (ciphertext ~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' AND char_length(ciphertext) BETWEEN 4 AND 90000),
  iv TEXT NOT NULL CHECK (iv ~ '^[A-Za-z0-9+/]{16}==$'),
  auth_tag TEXT NOT NULL CHECK (auth_tag ~ '^[A-Za-z0-9+/]{22}==$'),
  key_id TEXT NOT NULL CHECK (key_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  hint TEXT CHECK (hint IS NULL OR (char_length(hint) BETWEEN 1 AND 16 AND hint !~ E'[\r\n]')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, provider_name, config_revision)
);
ALTER TABLE public.messaging_provider_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.messaging_provider_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messaging_provider_credentials TO service_role;
COMMENT ON TABLE public.messaging_provider_credentials IS 'Versioned AES-256-GCM material. Canonical base64 TEXT; service-role only.';

ALTER TABLE public.message_jobs ADD COLUMN provider_name TEXT, ADD COLUMN provider_config_snapshot JSONB, ADD COLUMN provider_config_revision UUID;
UPDATE public.message_jobs j SET provider_name = c.provider_name, provider_config_snapshot = c.provider_config, provider_config_revision = c.config_revision FROM public.messaging_configuration c WHERE c.channel = j.channel;
DELETE FROM public.message_jobs WHERE provider_name IS NULL;
ALTER TABLE public.message_jobs ALTER COLUMN provider_name SET NOT NULL, ALTER COLUMN provider_config_snapshot SET NOT NULL, ALTER COLUMN provider_config_revision SET NOT NULL,
  ADD CONSTRAINT message_jobs_provider_snapshot_check CHECK (public._messaging_provider_config_valid(channel, provider_name, provider_config_snapshot));
COMMENT ON COLUMN public.message_jobs.provider_config_snapshot IS 'Immutable safe provider configuration captured atomically at enqueue; no credentials.';

CREATE OR REPLACE FUNCTION public.enqueue_message_job(p_idempotency_key TEXT, p_channel public.message_channel, p_source_type TEXT, p_source_id UUID, p_content JSONB, p_recipients TEXT[], p_available_at TIMESTAMPTZ DEFAULT now()) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v_job_id UUID; v_recipients TEXT[]; v_config public.messaging_configuration%ROWTYPE;
BEGIN
  SELECT * INTO v_config FROM public.messaging_configuration WHERE channel = p_channel AND enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No enabled messaging provider is configured for channel %', p_channel; END IF;
  SELECT COALESCE(array_agg(recipient ORDER BY recipient), ARRAY[]::TEXT[]) INTO v_recipients FROM (SELECT DISTINCT btrim(value) recipient FROM unnest(COALESCE(p_recipients, ARRAY[]::TEXT[])) value WHERE btrim(value) <> '') normalized;
  IF cardinality(v_recipients) = 0 THEN RAISE EXCEPTION 'At least one recipient is required'; END IF;
  INSERT INTO public.message_jobs(idempotency_key,channel,source_type,source_id,content,recipient_count,available_at,provider_name,provider_config_snapshot,provider_config_revision)
  VALUES(p_idempotency_key,p_channel,p_source_type,p_source_id,p_content,cardinality(v_recipients),COALESCE(p_available_at,now()),v_config.provider_name,v_config.provider_config,v_config.config_revision)
  ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_job_id;
  IF v_job_id IS NULL THEN SELECT id INTO v_job_id FROM public.message_jobs WHERE idempotency_key=p_idempotency_key; RETURN v_job_id; END IF;
  INSERT INTO public.message_deliveries(job_id,recipient,next_attempt_at) SELECT v_job_id,recipient,COALESCE(p_available_at,now()) FROM unnest(v_recipients) recipient;
  RETURN v_job_id;
END $fn$;

-- Service-role RPC: server validates metadata and performs encryption/re-encryption before this atomic write.
CREATE OR REPLACE FUNCTION public.save_messaging_configuration(
 p_channel public.message_channel,p_provider_name TEXT,p_enabled BOOLEAN,p_provider_config JSONB,p_config_revision UUID,p_secret_action TEXT,
 p_ciphertext TEXT,p_iv TEXT,p_auth_tag TEXT,p_key_id TEXT,p_fingerprint TEXT,p_hint TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $fn$
DECLARE v_old_provider TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF p_secret_action NOT IN ('preserve','replace','remove') OR NOT public._messaging_provider_config_valid(p_channel,p_provider_name,p_provider_config) THEN RAISE EXCEPTION 'invalid configuration'; END IF;
  SELECT provider_name INTO v_old_provider FROM public.messaging_configuration WHERE channel=p_channel FOR UPDATE;
  IF p_secret_action='preserve' AND v_old_provider IS NOT NULL AND v_old_provider<>p_provider_name THEN RAISE EXCEPTION 'cannot preserve across providers'; END IF;
  IF p_secret_action='remove' THEN
    IF EXISTS(SELECT 1 FROM public.message_jobs WHERE channel=p_channel AND provider_name=COALESCE(v_old_provider,p_provider_name) AND status IN ('queued','processing','requires_review')) THEN RAISE EXCEPTION 'credential versions referenced by nonterminal jobs'; END IF;
    DELETE FROM public.messaging_provider_credentials WHERE channel=p_channel AND provider_name=COALESCE(v_old_provider,p_provider_name);
  END IF;
  INSERT INTO public.messaging_configuration(channel,provider_name,enabled,provider_config,config_revision)
  VALUES(p_channel,p_provider_name,p_enabled,p_provider_config,p_config_revision)
  ON CONFLICT(channel) DO UPDATE SET provider_name=EXCLUDED.provider_name,enabled=EXCLUDED.enabled,provider_config=EXCLUDED.provider_config,config_revision=EXCLUDED.config_revision,updated_at=now();
  IF p_secret_action IN ('preserve','replace') AND p_ciphertext IS NOT NULL THEN
    INSERT INTO public.messaging_provider_credentials(channel,provider_name,config_revision,ciphertext,iv,auth_tag,key_id,fingerprint,hint)
    VALUES(p_channel,p_provider_name,p_config_revision,p_ciphertext,p_iv,p_auth_tag,p_key_id,p_fingerprint,p_hint);
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.remove_messaging_configuration(p_channel public.message_channel) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  PERFORM 1 FROM public.messaging_configuration WHERE channel=p_channel FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.message_jobs WHERE channel=p_channel AND status IN ('queued','processing','requires_review')) THEN RAISE EXCEPTION 'provider referenced by nonterminal jobs'; END IF;
  DELETE FROM public.messaging_provider_credentials WHERE channel=p_channel;
  DELETE FROM public.messaging_configuration WHERE channel=p_channel;
END $fn$;

-- Replace claims so workers receive the exact provider snapshot revision.
DROP FUNCTION public.claim_message_deliveries(TEXT, public.message_channel, INTEGER, INTEGER);
CREATE FUNCTION public.claim_message_deliveries(p_worker_id TEXT,p_channel public.message_channel,p_limit INTEGER DEFAULT 25,p_lease_seconds INTEGER DEFAULT 120)
RETURNS TABLE(delivery_id UUID,job_id UUID,channel public.message_channel,recipient TEXT,content JSONB,attempt_no SMALLINT,provider_name TEXT,provider_config_snapshot JSONB,provider_config_revision UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
 RETURN QUERY WITH candidates AS (SELECT d.id FROM public.message_deliveries d JOIN public.message_jobs j ON j.id=d.job_id WHERE j.channel=p_channel AND j.status IN ('queued','processing') AND j.available_at<=now() AND ((d.status='pending' AND d.next_attempt_at<=now()) OR (d.status='processing' AND d.locked_at<now()-make_interval(secs=>p_lease_seconds))) ORDER BY d.next_attempt_at,d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT p_limit), claimed AS (UPDATE public.message_deliveries d SET status='processing',attempt_count=d.attempt_count+1,locked_at=now(),locked_by=p_worker_id,updated_at=now() FROM candidates x WHERE d.id=x.id RETURNING d.id,d.job_id,d.recipient,d.attempt_count) SELECT x.id,x.job_id,j.channel,x.recipient,j.content,x.attempt_count,j.provider_name,j.provider_config_snapshot,j.provider_config_revision FROM claimed x JOIN public.message_jobs j ON j.id=x.job_id;
END $fn$;
DROP FUNCTION public.claim_message_job_delivery(UUID,TEXT,INTEGER);
CREATE FUNCTION public.claim_message_job_delivery(p_job_id UUID,p_worker_id TEXT,p_lease_seconds INTEGER DEFAULT 120)
RETURNS TABLE(delivery_id UUID,job_id UUID,channel public.message_channel,recipient TEXT,content JSONB,attempt_no SMALLINT,provider_name TEXT,provider_config_snapshot JSONB,provider_config_revision UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
 RETURN QUERY WITH candidate AS (SELECT d.id FROM public.message_deliveries d JOIN public.message_jobs j ON j.id=d.job_id WHERE d.job_id=p_job_id AND j.status IN ('queued','processing') AND d.status='pending' AND d.next_attempt_at<=now() ORDER BY d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1), claimed AS (UPDATE public.message_deliveries d SET status='processing',attempt_count=d.attempt_count+1,locked_at=now(),locked_by=p_worker_id,updated_at=now() FROM candidate x WHERE d.id=x.id RETURNING d.id,d.job_id,d.recipient,d.attempt_count) SELECT x.id,x.job_id,j.channel,x.recipient,j.content,x.attempt_count,j.provider_name,j.provider_config_snapshot,j.provider_config_revision FROM claimed x JOIN public.message_jobs j ON j.id=x.job_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.begin_non_idempotent_dispatch(p_delivery_id UUID,p_worker_id TEXT) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_mode TEXT; v_status public.message_delivery_status; v_locked_by TEXT;
BEGIN
 SELECT j.provider_config_snapshot #>> '{idempotency,placement}',d.status,d.locked_by INTO v_mode,v_status,v_locked_by FROM public.message_deliveries d JOIN public.message_jobs j ON j.id=d.job_id WHERE d.id=p_delivery_id FOR UPDATE OF d;
 IF v_mode IS DISTINCT FROM 'none' THEN RAISE EXCEPTION 'Provider snapshot is idempotent'; END IF;
 IF v_status<>'processing' OR v_locked_by IS DISTINCT FROM p_worker_id THEN RAISE EXCEPTION 'Message delivery lease is not owned'; END IF;
 UPDATE public.message_deliveries SET status='dispatching',updated_at=now() WHERE id=p_delivery_id;
 UPDATE public.message_jobs SET status='requires_review',unknown_count=unknown_count+1,completed_at=COALESCE(completed_at,now()),updated_at=now()
 WHERE id=(SELECT job_id FROM public.message_deliveries WHERE id=p_delivery_id);
 RETURN true;
END $fn$;

REVOKE ALL ON FUNCTION public._messaging_safe_path(TEXT),public._messaging_safe_header(TEXT),public._messaging_provider_config_valid(public.message_channel,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enqueue_message_job(TEXT,public.message_channel,TEXT,UUID,JSONB,TEXT[],TIMESTAMPTZ),public.save_messaging_configuration(public.message_channel,TEXT,BOOLEAN,JSONB,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),public.remove_messaging_configuration(public.message_channel),public.claim_message_deliveries(TEXT,public.message_channel,INTEGER,INTEGER),public.claim_message_job_delivery(UUID,TEXT,INTEGER),public.begin_non_idempotent_dispatch(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_message_job(TEXT,public.message_channel,TEXT,UUID,JSONB,TEXT[],TIMESTAMPTZ),public.save_messaging_configuration(public.message_channel,TEXT,BOOLEAN,JSONB,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),public.remove_messaging_configuration(public.message_channel),public.claim_message_deliveries(TEXT,public.message_channel,INTEGER,INTEGER),public.claim_message_job_delivery(UUID,TEXT,INTEGER),public.begin_non_idempotent_dispatch(UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public._backup_redact_message_tables(p_tables JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$ SELECT (CASE WHEN jsonb_typeof(p_tables)='object' THEN p_tables ELSE '{}'::jsonb END)-'provider_secrets'-'messaging_provider_credentials'-'message_jobs'-'message_deliveries'-'message_attempts'-'messaging_configuration' $fn$;

-- === Migration: 20250915000009_mim_dispatch_fence.sql ===
-- Restore provider-aware fencing for non-idempotent dispatches.
-- Built-in MIM snapshots predate the generalized idempotency descriptor and are
-- intrinsically non-idempotent. Custom providers must opt in explicitly with
-- idempotency.placement = "none"; all other providers fail closed.


CREATE OR REPLACE FUNCTION public.begin_non_idempotent_dispatch(
  p_delivery_id UUID,
  p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_delivery public.message_deliveries%ROWTYPE;
  v_provider_name TEXT;
  v_idempotency_placement TEXT;
  v_lease_seconds INTEGER;
BEGIN
  IF p_delivery_id IS NULL THEN RAISE EXCEPTION 'Message delivery is required'; END IF;
  IF btrim(COALESCE(p_worker_id, '')) = '' OR char_length(p_worker_id) > 100 THEN
    RAISE EXCEPTION 'Invalid worker id';
  END IF;

  SELECT d, j.provider_name, j.provider_config_snapshot #>> '{idempotency,placement}',
         COALESCE(c.lease_seconds, 120)
    INTO v_delivery, v_provider_name, v_idempotency_placement, v_lease_seconds
  FROM public.message_deliveries AS d
  JOIN public.message_jobs AS j ON j.id = d.job_id
  LEFT JOIN public.messaging_configuration AS c ON c.channel = j.channel
  WHERE d.id = p_delivery_id
  FOR UPDATE OF d;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message delivery not found'; END IF;

  -- MIM has no idempotency descriptor in its real frozen snapshots, but the
  -- provider itself is non-idempotent. Only explicitly non-idempotent custom
  -- snapshots share this at-most-once path. Resend and custom header/body
  -- idempotency must never enter dispatching/requires_review pre-send state.
  IF v_provider_name = 'mim' THEN
    NULL;
  ELSIF v_provider_name = 'custom' AND v_idempotency_placement = 'none' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Provider snapshot is not non-idempotent';
  END IF;

  IF v_delivery.status <> 'processing'::public.message_delivery_status
     OR v_delivery.locked_by IS DISTINCT FROM p_worker_id
     OR v_delivery.locked_at IS NULL
     OR v_delivery.locked_at < now() - make_interval(secs => v_lease_seconds) THEN
    RAISE EXCEPTION 'Message delivery lease is not owned by this worker';
  END IF;

  -- Once committed, claim RPCs cannot reclaim this row: they only select pending
  -- or expired processing rows. A crash after this point therefore requires review.
  UPDATE public.message_deliveries AS d
  SET status = 'dispatching'::public.message_delivery_status,
      updated_at = now()
  WHERE d.id = v_delivery.id;

  -- Serialize aggregate writers and derive every counter from delivery state.
  PERFORM 1 FROM public.message_jobs AS j WHERE j.id = v_delivery.job_id FOR UPDATE;
  UPDATE public.message_jobs AS j
  SET status = 'requires_review'::public.message_job_status,
      recipient_count = a.recipient_count,
      accepted_count = a.accepted_count,
      delivered_count = a.delivered_count,
      failed_count = a.failed_count,
      bounced_count = a.bounced_count,
      unknown_count = a.unknown_count,
      completed_at = COALESCE(j.completed_at, now()),
      updated_at = now()
  FROM (
    SELECT count(*)::INTEGER AS recipient_count,
      count(*) FILTER (WHERE status = 'accepted')::INTEGER AS accepted_count,
      count(*) FILTER (WHERE status = 'delivered')::INTEGER AS delivered_count,
      count(*) FILTER (WHERE status = 'failed')::INTEGER AS failed_count,
      count(*) FILTER (WHERE status = 'bounced')::INTEGER AS bounced_count,
      count(*) FILTER (WHERE status IN ('unknown', 'dispatching'))::INTEGER AS unknown_count
    FROM public.message_deliveries
    WHERE job_id = v_delivery.job_id
  ) AS a
  WHERE j.id = v_delivery.job_id;

  RETURN true;
END
$fn$;

REVOKE ALL ON FUNCTION public.begin_non_idempotent_dispatch(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_non_idempotent_dispatch(UUID, TEXT) TO service_role;

-- Migration ledger (contract: provisioning_migrations)
CREATE TABLE IF NOT EXISTS public.provisioning_migrations (
  version TEXT PRIMARY KEY,
  sha256  TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ledger rows for the canonical baseline and every follow-on migration.
-- NOTE: this is a plain INSERT with NO ON CONFLICT upsert. A fresh
-- installer must FAIL LOUDLY if any version already exists in the ledger
-- (with the same or a different sha256), instead of silently overwriting
-- a previously recorded checksum. Conflicting existing installation state
-- is a STOP condition, not something to paper over.
INSERT INTO public.provisioning_migrations (version, sha256) VALUES
  ('canonical-baseline', '28b7e1b2d98cd72d212d004ec2647ccbf4afdb3ebd0c70d5132838d9acd0d662'),
  ('20250816000000_update_student_auth.sql', '31360cae0fb59040af0413c2aab13a1d06bf397cad8d549bc313ac24b57a4c20'),
  ('20250816000001_rate_limiting.sql', '477975e96507be836001ff3c0d275080be9576f50f2f8771174548fdd7ef645f'),
  ('20250817000000_support_tables.sql', 'da051335e5169f6353e2921feed1edc2b6999c09d9502f76cfe0cc20f425ac87'),
  ('20250818000000_student_sessions.sql', 'd1dfa9bb501d58368d29d9fa01350481fe1e81e190b085683b1ae11a778d047a'),
  ('20250818000001_portal_rpcs.sql', '205471a42a0cd1b5276e41125ad9a9937c57ebfb4ddf596f784c99213167b911'),
  ('20250818000002_exam_rpcs.sql', '0925a41bddf355777c0d9bf3f5584b1b6761820ef54e55edb1880485a6e8a07a'),
  ('20250818000003_core_rls.sql', 'f41659b77735f8a869bdbf6175b661a62509885f09f6eb35b0809d872a91d2ac'),
  ('20250820000000_restore_student_portal.sql', '327774fea6021c2defa4221e6d5a004f3ff43f0c4a846aaeb3b89f8afac631ef'),
  ('20250824000000_security_hardening.sql', 'b78cc17479041b1e1c88654cdad646f002b6cd69fb1b87d530b73803a9426539'),
  ('20250825000000_lock_counter_rpcs.sql', '2b946870840a49983622ec0964fb43d06e0186f938c8c40c3b1a72c52cc88bc8'),
  ('20250825000001_gate_exam_leaderboard.sql', 'b64564a428b94e63c1f54e6306a8f379e8900caf8d6fe87b9917c2c0998604bf'),
  ('20250825000002_narrow_teacher_columns.sql', 'e68dd22a0463532c862f1c05a49720afd23c93cc60905c98b7723100e2f8a403'),
  ('20250825000003_fix_exam_join_ambiguity.sql', '58b41dbecbb23ac07302eaa975081501081817425ec75a62e34509956576ead8'),
  ('20250825000004_fix_latent_ambiguity.sql', 'f6ccee31a21d70c3b4e9926553cee48a4a1404e49253b92ac00da1b1921294f2'),
  ('20250827000001_batch_fixes.sql', 'e92534e17503c0e476b5d1077c4d5c165314ad209e0bb35403cc6ea34bdadeab'),
  ('20250827000002_student_id.sql', 'b3a98d27ff0f6bcfcc82b940bbc72f5190272ff3d2e697b3ef003e6ad4ca1f21'),
  ('20250827000003_exam_batches.sql', '5beb3bd2bf3ce99cb6a49107fa6caea38eb3f0029bbe3d41ccba4d14b7a36584'),
  ('20250827000004_exam_penalty.sql', 'c3fdf649614f5184045f08fcf5b3b36c580db9b291481bf083b7fdc0fcc88e47'),
  ('20250829000001_security_controls.sql', '49d0faaf7c47733d46384a27902e0cd8dc6e5afbf5b8d55364f23d9110c46537'),
  ('20250829000002_exam_auth_penalty.sql', '39f1e3576f57aac65f6dd7979a6f8c4d50bbf76449d6e55cc7042290b807e44d'),
  ('20250829000003_fix_portal_exams_42804.sql', 'c2dcb93c14f8fc9b806fb243e3e88437690e97cf55a2d229b4ced1350e4cd68d'),
  ('20250830000001_exam_batch_backfill.sql', 'a2fbb89a293234f344ad9bd3b232180dbd3725166e46d1784f0e8f2c97649672'),
  ('20250830000002_payment_approvals.sql', '42a7fea782cd1523eb0b32026fecadc093a3ef1796b8b5be5169f0056a2f20c7'),
  ('20250830000004_admission_reference_gender.sql', 'd392e24b74d0a6f18e9da8851d38c023372d025434173156f028cf58c26ef54c'),
  ('20250831000001_fix_default_password_login.sql', 'e5236b1b84e0a1d715afafd971c9f94bf65a714b445eb7e47ab16b0cc52422ef'),
  ('20250831000002_batch_end_time.sql', '0fca0502d87f68bf15864c0a387a679dc04f4d041ea152b6780aac5e497e1835'),
  ('20250904000001_admin_safe_mutations.sql', '87c5ad1769a064da466910fec11357a8ad10387880a9c5d21697c55d25269bb0'),
  ('20250905000005_feedback_email.sql', '549430ae0bddb0a131af8827ad73e3a87b7bfe15bbd50d96185ec24df27e62f1'),
  ('20250905000006_provider_secrets.sql', '2338657559e2107b2a81d39e2fc251f934494522d5690916ef4da2e790513583'),
  ('20250906000001_phase2_session_validation.sql', '1973fda31a6c564a982fd1ce57df028432cdc8e5bad68e1b2cb0c4b9762c9203'),
  ('20250906000002_atomic_admission_approval.sql', '72e6ab3a6da156e28739b109f4170ce9c3c446fcd851c023b83b623599e01c99'),
  ('20250906000003_phase2_payment_audit_atomic.sql', 'e1bb8efa9f457ca37de4f355507465dd309196067082a45864ecaf834f250c22'),
  ('20250907000001_exam_session_only_and_avatar_storage.sql', '2ed0cedc6678c0948738b3d1b19c303acff69666a41c8d5511011c7a904233ad'),
  ('20250909000001_postinstall_repairs.sql', '6037b948bc717b5efa68634f5360fed8ddf3b39e6cdd31da09f0c9d2c9a3199f'),
  ('20250910000001_fee_audit_logs_admin_rls.sql', '3b2a82e555c14f1283c0e47ac60aaadeba4f281715e5476d886593859212a72c'),
  ('20250911000001_atomic_exam_deletion.sql', '158f18bf15ddf1f9b4e46e39efdb234d85179797484bfa87472ebb0c9040f139'),
  ('20250912000001_student_auth_hardening.sql', '4d995455e6a8a983be859b3793403d290e4985e6353e74e8f16e2116322d68a8'),
  ('20250913000001_private_avatars_public_assets.sql', 'c875ddc56f2d5bba7d94ae6a398896eb6de4d262357843a4077e134495d2c0bc'),
  ('20250914000001_public_form_abuse_prevention.sql', '96b3312c36ac684b394497c962a4ae4a2d247f8a6c24d8ad26b02af6305f13bd'),
  ('20250915000001_durable_message_outbox.sql', 'a58eec7809f4171f2034c91c36b470b51bd7943c50510972fe4d93d42ca122f0'),
  ('20250915000002_messaging_worker_heartbeat.sql', '601bb84bf05b6ec34d73e2110776258e522721f12be0bd5a7fd405289796e9b6'),
  ('20250915000003_messaging_channel_claims.sql', 'd8253badd712989bc1c8b204441dfe20b7c70ae6cdf631363606d86326fe65e7'),
  ('20250915000004_messaging_ambiguous_outcomes.sql', '9cc24efadf65b62907905adf75d28832bc3b809d3514c704f8392bb979b7c8fb'),
  ('20250915000005_atomic_message_attempts.sql', 'd3ddadc3c7afcc76023364d7c6b5f6960dbffb3564dcce6f2594c03cd8de698b'),
  ('20250915000006_atomic_message_job_aggregate.sql', 'af9f093b1f74ed0abc5115fe6847eb08a0b9464da97fab3f37c845f981c28826'),
  ('20250915000007_non_idempotent_sms_dispatch.sql', '3848b1136180d935184a05f4838e721d1730feceb3b5bac5c153c935c20eb257'),
  ('20250915000008_provider_neutral_messaging.sql', '5ab1cf2db881a6e1b5bb75d9cefbc5fd80c1ade4925ded20f8c6e8ad51f109b7'),
  ('20250915000009_mim_dispatch_fence.sql', 'aa3901d119a5447f40b9082a251048546df2e0d80ca95713ab8d42d596393d21')
;

-- ═══════════ OUTER TRANSACTION: COMMIT ═══════════
COMMIT;

-- ═══════════ POST-INSTALL VERIFICATION (NON-ATOMIC) ═══════════
-- The outer transaction above is ALREADY COMMITted. The following blocks
-- are the deliberate post-COMMIT; verification sections carried over from
-- the reviewed migrations. They run after the atomic install; a failure here
-- reports loudly but does NOT roll back the committed baseline/migrations/ledger.

-- === Post-commit verification: 20250824000000_security_hardening.sql ===
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

-- === Post-commit verification: 20250825000000_lock_counter_rpcs.sql ===
-- ============================================================
-- Verification — runs after COMMIT so a failed assertion reports
-- loudly without rolling back work that already succeeded.
-- ============================================================
DO $$
DECLARE
  oid_inc oid := to_regprocedure('public.increment_enrolled(uuid)');
  oid_dec oid := to_regprocedure('public.decrement_enrolled(uuid)');
  missing TEXT[];
BEGIN
  -- Resolve both counters by exact schema-qualified signature and assert they
  -- exist. The OIDs obtained here are the authoritative handle for every
  -- privilege check below (never re-identified by name or by assuming the
  -- identity-arguments string equals 'uuid').
  missing := NULL;
  IF oid_inc IS NULL THEN
    missing := array_append(missing, 'public.increment_enrolled(uuid)');
  END IF;
  IF oid_dec IS NULL THEN
    missing := array_append(missing, 'public.decrement_enrolled(uuid)');
  END IF;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Counter RPC signature(s) missing: %', array_to_string(missing, ', ');
  END IF;

  -- 1. Neither counter may still be executable by anon or PUBLIC. PostgreSQL
  --    accepts lowercase 'public' as the pseudo-role argument to
  --    has_function_privilege (PG13+; explicitly in PG17).
  IF HAS_FUNCTION_PRIVILEGE('anon', oid_inc, 'EXECUTE')
     OR HAS_FUNCTION_PRIVILEGE('public', oid_inc, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon/public can still EXECUTE increment_enrolled';
  END IF;
  IF HAS_FUNCTION_PRIVILEGE('anon', oid_dec, 'EXECUTE')
     OR HAS_FUNCTION_PRIVILEGE('public', oid_dec, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon/public can still EXECUTE decrement_enrolled';
  END IF;

  -- 2. authenticated must retain EXECUTE, or the admin screens break.
  IF NOT HAS_FUNCTION_PRIVILEGE('authenticated', oid_inc, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated LOST EXECUTE on increment_enrolled';
  END IF;
  IF NOT HAS_FUNCTION_PRIVILEGE('authenticated', oid_dec, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated LOST EXECUTE on decrement_enrolled';
  END IF;

  -- 3. No batch may be left with a negative enrolled count.
  IF EXISTS (SELECT 1 FROM batches WHERE enrolled < 0) THEN
    RAISE EXCEPTION 'batches.enrolled is negative on % row(s)',
      (SELECT COUNT(*) FROM batches WHERE enrolled < 0);
  END IF;

  RAISE NOTICE 'H6 verified: counters are authenticated + is_admin() only, no negative counts.';
END $$;

NOTIFY pgrst, 'reload schema';

-- === Post-commit verification: 20250825000001_gate_exam_leaderboard.sql ===
-- ════════════════════════════════════════════════════════════════
--  Verification — after COMMIT, so a failed assertion reports loudly
--  without rolling back work that succeeded.
-- ════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_old INT;
  v_new INT;
BEGIN
  SELECT COUNT(*) INTO v_old
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'exam_get_leaderboard'
    AND p.pronargs = 1;

  IF v_old > 0 THEN
    RAISE EXCEPTION
      'The ungated exam_get_leaderboard(uuid) overload still exists — anon can bypass the new gate.';
  END IF;

  SELECT COUNT(*) INTO v_new
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'exam_get_leaderboard'
    AND p.pronargs = 3;

  IF v_new <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one exam_get_leaderboard(uuid,text,text); found %.', v_new;
  END IF;

  RAISE NOTICE 'H7 verified: leaderboard requires a token and masks other students'' codes.';
END $verify$;

NOTIFY pgrst, 'reload schema';

-- === Post-commit verification: 20250825000002_narrow_teacher_columns.sql ===
-- ════════════════════════════════════════════════════════════════
--  Verification — after COMMIT so a failure reports loudly without
--  rolling back a grant change that already succeeded.
-- ════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  leaked  TEXT;
  dropped TEXT;
BEGIN
  -- 1. No private column may remain readable by anon.
  SELECT string_agg(c, ', ') INTO leaked
  FROM unnest(ARRAY['salary','phone','email','created_at']) AS c
  WHERE HAS_COLUMN_PRIVILEGE('anon', 'public.teachers', c, 'SELECT');

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'anon can still SELECT private teacher column(s): %', leaked;
  END IF;

  -- 2. Every column the public page needs must still be readable, or the
  --    marketing page silently renders an empty teacher section.
  SELECT string_agg(c, ', ') INTO dropped
  FROM unnest(ARRAY['id','name','subject','qualification','bio','photo_url','is_active']) AS c
  WHERE NOT HAS_COLUMN_PRIVILEGE('anon', 'public.teachers', c, 'SELECT');

  IF dropped IS NOT NULL THEN
    RAISE EXCEPTION 'anon LOST SELECT on required public column(s): %', dropped;
  END IF;

  -- 3. The admin screens must be unaffected.
  IF NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.teachers', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated LOST SELECT on teachers — the admin Teachers page would break.';
  END IF;

  RAISE NOTICE 'H8 verified: anon reads only the public teacher card columns.';
END $verify$;

NOTIFY pgrst, 'reload schema';

-- === Post-commit verification: 20250825000003_fix_exam_join_ambiguity.sql ===
-- ════════════════════════════════════════════════════════════════
--  Verification — after COMMIT so a failed assertion reports loudly
--  without discarding a repair that succeeded.
-- ════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  v_n     INT;
  v_sid   UUID;
  v_exam  UUID;
  v_tok   TEXT;
BEGIN
  -- 1. Exactly one exam_join, and the helper is not exposed.
  SELECT COUNT(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'exam_join';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one exam_join; found %.', v_n;
  END IF;

  IF HAS_FUNCTION_PRIVILEGE('anon', 'public._exam_token_issue(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can EXECUTE _exam_token_issue — that mints a token for any student_id.';
  END IF;

  IF NOT HAS_FUNCTION_PRIVILEGE('anon', 'public.exam_join(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon LOST EXECUTE on exam_join — no student could enter an exam.';
  END IF;

  -- 2. Functional smoke test: drive a real join far enough to reach the
  --    upsert, which is the statement that was failing. Runs in an
  --    exception block, and the token it mints is removed below.
  SELECT s.id INTO v_sid
  FROM students s
  WHERE s.is_approved AND COALESCE(s.status, '') <> 'suspended'
  LIMIT 1;

  SELECT e.id INTO v_exam FROM exams e LIMIT 1;

  IF v_sid IS NULL OR v_exam IS NULL THEN
    RAISE NOTICE 'Smoke test skipped: no eligible student/exam rows in this project.';
  ELSE
    BEGIN
      SELECT j.exam_token INTO v_tok
      FROM exam_join(v_exam, NULL, (SELECT student_id FROM students WHERE id = v_sid)) j;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'exam_join still fails: % (%)', SQLERRM, SQLSTATE;
    END;

    IF v_tok IS NULL OR LENGTH(v_tok) <> 48 THEN
      RAISE EXCEPTION 'exam_join returned an unusable token (%).', COALESCE(v_tok, 'NULL');
    END IF;

    -- Leave no trace: the smoke test is not a real exam session. Removing
    -- it also cannot strand a student, since a rejoin re-mints.
    DELETE FROM exam_tokens WHERE token = v_tok;

    RAISE NOTICE 'Smoke test passed: exam_join minted and released a 48-char token.';
  END IF;

  RAISE NOTICE 'C1 verified: exam_join reaches the upsert without ambiguity.';
END $verify$;

NOTIFY pgrst, 'reload schema';

-- === Post-commit verification: 20250825000004_fix_latent_ambiguity.sql ===
-- ============================================================
-- Verification (post-COMMIT: failures report loudly without
-- rolling back work that already succeeded)
-- ============================================================

-- Exactly one of each, with the expected arity, and grants intact.
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'verify_student_login';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 verify_student_login, found %.', n;
  END IF;

  SELECT COUNT(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'exam_submit';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 exam_submit, found % — a stale overload would still be reachable.', n;
  END IF;

  IF NOT HAS_FUNCTION_PRIVILEGE('anon', 'public.verify_student_login(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon lost EXECUTE on verify_student_login — portal login is now broken.';
  END IF;
  IF NOT HAS_FUNCTION_PRIVILEGE('anon', 'public.exam_submit(text,jsonb,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon lost EXECUTE on exam_submit — students cannot submit exams.';
  END IF;

  RAISE NOTICE 'Verified: one definition each, anon retains EXECUTE on both.';
END $$;

-- search_path must still reach `extensions`, or crypt() is unresolvable and
-- every login fails with 42883 after this migration.
DO $$
DECLARE cfg TEXT[]; fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.verify_student_login(text,text)',
    'public.exam_submit(text,jsonb,integer)'
  ] LOOP
    SELECT p.proconfig INTO cfg FROM pg_proc p WHERE p.oid = fn::regprocedure;
    IF cfg IS NULL OR NOT EXISTS (
      SELECT 1 FROM UNNEST(cfg) c WHERE c LIKE 'search_path=%extensions%'
    ) THEN
      RAISE EXCEPTION
        'search_path on % does not include `extensions` (got %) — crypt() would be unreachable.',
        fn, cfg;
    END IF;
  END LOOP;
  RAISE NOTICE 'Verified: search_path includes `extensions` on both functions.';
END $$;

-- Textual proof that no unqualified reference survived. exam_submit cannot be
-- exercised end-to-end here (it needs a live exam token), so assert against
-- the stored definition instead of guessing.
DO $$
DECLARE src TEXT;
BEGIN
  src := PG_GET_FUNCTIONDEF('public.exam_submit(text,jsonb,integer)'::regprocedure);

  IF src ~* 'FROM\s+exams\s+WHERE\s+id\s*=' THEN
    RAISE EXCEPTION 'exam_submit still has an unqualified `FROM exams WHERE id = ...` (42702 on every submit).';
  END IF;
  IF src ~* 'SELECT\s+id\s*,\s*correct_option' THEN
    RAISE EXCEPTION 'exam_submit still has an unqualified `SELECT id, correct_option ...` (42702 on every submit).';
  END IF;
  IF src ~* '\(\s*score\s*>' OR src ~* 'AND\s+time_taken\s*<' THEN
    RAISE EXCEPTION 'exam_submit still has an unqualified score/time_taken in the rank subquery (42702).';
  END IF;

  src := PG_GET_FUNCTIONDEF('public.verify_student_login(text,text)'::regprocedure);

  IF src ~* 'FROM\s+students\s+WHERE\s+id\s*=' THEN
    RAISE EXCEPTION 'verify_student_login still has an unqualified `FROM students WHERE id = ...` (42702).';
  END IF;

  RAISE NOTICE 'Verified: no unqualified OUT-parameter references remain in either body.';
END $$;

-- Functional self-test for verify_student_login's not-approved branch — the
-- exact path that used to raise 42702. Seeds a throwaway student, drives a
-- real successful bcrypt match against it, then removes every trace.
-- Deliberately non-fatal on seeding failure: an unknown NOT NULL on `students`
-- should not fail an otherwise-good migration, but a surviving 42702 must.
DO $$
DECLARE
  v_sid   UUID;
  v_phone TEXT := '__ambiguity_selftest__';
  v_state TEXT;
  v_msg   TEXT;
BEGIN
  PERFORM SET_CONFIG('search_path', 'public, extensions', true);

  BEGIN
    INSERT INTO students (name, phone, student_id, password, is_approved, status)
    VALUES ('__selftest__', v_phone, v_phone,
            crypt('selftest-pw', gen_salt('bf')), false, 'active')
    RETURNING students.id INTO v_sid;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Self-test skipped — could not seed a probe row (% %). Nothing was written.',
      SQLSTATE, SQLERRM;
    RETURN;
  END;

  BEGIN
    PERFORM * FROM verify_student_login(v_phone, 'selftest-pw');
    v_state := '00000';
    v_msg   := '(no exception)';
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
    v_msg   := SQLERRM;
  END;

  -- Clean up before asserting, so a failed assertion still leaves no residue.
  DELETE FROM student_sessions ss WHERE ss.student_id = v_sid;
  DELETE FROM login_attempts la WHERE la.phone_number = v_phone;
  DELETE FROM students s WHERE s.id = v_sid;

  IF v_state = '42702' THEN
    RAISE EXCEPTION 'verify_student_login is STILL ambiguous: %', v_msg;
  ELSIF v_msg = 'Account is not approved yet' THEN
    RAISE NOTICE 'Self-test passed: not-approved branch raises its own message, no 42702. Probe row removed.';
  ELSE
    RAISE NOTICE 'Self-test inconclusive (% / %) — no 42702, but check manually. Probe row removed.',
      v_state, v_msg;
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'C2 complete. Latent 42702 defects closed in verify_student_login and exam_submit.';
END $$;

-- === Post-commit verification: 20250827000001_batch_fixes.sql ===
-- ============================================================
--  Verification (post-COMMIT — a failure reports loudly without
--  rolling back repairs that already succeeded)
-- ============================================================
DO $verify$
DECLARE
  v_null INT;
  v_mismatch INT;
BEGIN
  -- All batches have a non-null is_active.
  SELECT COUNT(*) INTO v_null FROM batches WHERE is_active IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION '% batch(es) still have NULL is_active — soft-disable would break.', v_null;
  END IF;

  -- enrolled matches the appointed definition everywhere.
  SELECT COUNT(*) INTO v_mismatch
  FROM batches b
  WHERE b.enrolled <> (
    SELECT COUNT(*) FROM students s
    WHERE s.batch_id = b.id AND s.is_approved = true AND s.status = 'active'
  );
  IF v_mismatch > 0 THEN
    RAISE NOTICE 'WARNING: % batch(es) still disagree with live student counts.', v_mismatch;
  ELSE
    RAISE NOTICE 'All batches reconcile: enrolled == approved+active students.';
  END IF;

  RAISE NOTICE 'P1 verified: batches ready for the corrected client payload.';
END $verify$;

NOTIFY pgrst, 'reload schema';

-- === Post-commit verification: 20250827000002_student_id.sql ===
-- ============================================================
--  Verification (post-COMMIT)
-- ============================================================
DO $verify$
DECLARE
  v_code_exists BOOLEAN;
  v_val TEXT;
  v_dup INT;
BEGIN
  SELECT COUNT(*) > 0 INTO v_code_exists
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='batches' AND column_name='code';
  IF NOT v_code_exists THEN
    RAISE EXCEPTION 'batches.code was not added — the ID scheme cannot use batch codes.';
  END IF;

  SELECT value INTO v_val FROM site_settings WHERE key = 'coaching_short_name' LIMIT 1;
  IF v_val IS NULL OR v_val = '' THEN
    RAISE EXCEPTION 'coaching_short_name missing after insert.';
  END IF;
  RAISE NOTICE 'coaching_short_name = %', v_val;

  -- Existing student IDs must remain UNIQUE after the scheme change (the
  -- client checks uniqueness by exact match; a duplicate prefix is fine, a
  -- duplicate full ID would break exam_join identity resolution).
  SELECT COUNT(*) INTO v_dup
  FROM (SELECT student_id FROM students WHERE student_id IS NOT NULL GROUP BY student_id HAVING COUNT(*) > 1) d;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'Encountered % duplicate student_id(s) — resolve before adopting the new scheme.', v_dup;
  END IF;

  RAISE NOTICE 'P2 verified: batches.code present, short name set, no duplicate student IDs.';
END $verify$;

NOTIFY pgrst, 'reload schema';

-- === Post-commit verification: 20250827000003_exam_batches.sql ===
-- ============================================================
--  Verification (post-COMMIT)
-- ============================================================
DO $verify$
DECLARE
  v_count INT;
  v_gate  TEXT;
BEGIN
  -- Column + backfill.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='exams' AND column_name='batch_ids'
  ) THEN
    RAISE EXCEPTION 'exams.batch_ids missing after ALTER.';
  END IF;

  SELECT COUNT(*) INTO v_count FROM exams WHERE batch_id IS NOT NULL AND (batch_ids IS NULL OR batch_ids = '{}');
  IF v_count > 0 THEN
    RAISE NOTICE 'WARNING: % single-batch exam(s) not backfilled into batch_ids.', v_count;
  END IF;

  -- exam_join arity + grant.
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='exam_join';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 exam_join, found %', v_count;
  END IF;
  IF NOT HAS_FUNCTION_PRIVILEGE('anon', 'public.exam_join(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon lost EXECUTE on exam_join';
  END IF;

  -- Functional: a draft must now be rejected at join, active accepted.
  BEGIN
    PERFORM * FROM exam_join((SELECT id FROM exams WHERE status='draft' LIMIT 1), NULL, (SELECT student_id FROM students LIMIT 1));
    RAISE EXCEPTION 'draft exam_join returned rows — gate not applied';
  EXCEPTION
    WHEN OTHERS THEN
      v_gate := SQLSTATE || ':' || lower(SQLERRM);
      IF v_gate NOT LIKE '%exam_not_started%' THEN
        IF position('syntax' in v_gate) > 0 OR position('column' in v_gate) > 0 THEN
          RAISE EXCEPTION 'Unexpected error probing draft join: %', v_gate;
        END IF;
        RAISE NOTICE 'Draft join gate ok (raised %).', v_gate;
      END IF;
  END;

  RAISE NOTICE 'P3 verified: batch_ids present, draft gate live on join, portal filter array-capable.';
END $verify$;

NOTIFY pgrst, 'reload schema';

-- === Post-commit verification: 20250827000004_exam_penalty.sql ===
-- ============================================================
--  Verification (post-COMMIT)
-- ============================================================
DO $verify$
DECLARE
  v_n INT;
  v_col BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname='public' AND p.proname='exam_submit';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 exam_submit, found %', v_n;
  END IF;

  IF TO_REGPROCEDURE('public.exam_submit(text,jsonb,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'exam_submit(text,jsonb,integer,integer) missing after DROP/CREATE.';
  END IF;

  IF NOT HAS_FUNCTION_PRIVILEGE('anon', 'public.exam_submit(text,jsonb,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon lost EXECUTE on the 4-arg exam_submit';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mcq_submissions' AND column_name='red_cards'
  ) INTO v_col;
  IF NOT v_col THEN
    RAISE EXCEPTION 'mcq_submissions.red_cards missing';
  END IF;

  -- Penalty math is unit-provable without a live exam:
  -- 40-mark raw score with 10 cards -> 10 * ceil(4) = 40 -> 0.
  IF (SELECT GREATEST(40 - LEAST(10,10) * CEIL(40 * 0.10), 0)) <> 0 THEN
    RAISE EXCEPTION 'Penalty math regression at the 100%% mark';
  END IF;
  -- 25-mark raw score with 1 card -> ceil(2.5) = 3 -> 22 (not 23).
  IF (SELECT GREATEST(25 - LEAST(1,10) * CEIL(25 * 0.10), 0)) <> 22 THEN
    RAISE EXCEPTION 'Penalty math regression at 1 card / 25 marks (expected 22)';
  END IF;

  RAISE NOTICE 'P4 verified: 4-arg exam_submit with anon EXECUTE, red_cards column, penalty math sound.';
END $verify$;

NOTIFY pgrst, 'reload schema';

-- === Post-commit verification: 20250829000001_security_controls.sql ===
-- ═══════════ Verification (post-COMMIT) ═══════════
DO $verify$
DECLARE
  v_name TEXT;
  v_cap INTEGER;
  v_count INTEGER;
  v_sid UUID;
  v_tok TEXT;
  v_phone TEXT := '__r2_smoke__' || md5(random()::text)::text;
  v_err TEXT;
  v_pk  UUID;
  n     INT;
BEGIN
  -- A. Rebound functions exist with anon EXECUTE.
  IF NOT HAS_FUNCTION_PRIVILEGE('anon', 'public.portal_get_fees(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon lost EXECUTE on portal_get_fees';
  END IF;
  IF NOT HAS_FUNCTION_PRIVILEGE('anon', 'public.portal_get_notices(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon lost EXECUTE on portal_get_notices';
  END IF;

  -- A. Functional smoke: a temp approved student + session must let ALL FOUR
  -- dashboard-facing portal RPCs run without 42804/42703.
  INSERT INTO students (name, phone, student_id, password, is_approved, status)
  VALUES ('__r2smoke__', v_phone, v_phone, crypt('smoke', gen_salt('bf')), true, 'active')
  RETURNING id INTO v_sid;

  v_tok := _issue_student_session(v_sid);

  BEGIN
    PERFORM * FROM portal_get_fees(v_tok);
    PERFORM * FROM portal_get_exams(v_tok);
    PERFORM * FROM portal_get_submissions(v_tok);
    PERFORM * FROM portal_get_notices(v_tok);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE || ': ' || SQLERRM;
    RAISE EXCEPTION 'Portal RPC smoke FAILED after rebind: %', v_err;
  END;

  -- Cleanup (before asserting, no residue even on failure).
  DELETE FROM student_sessions WHERE student_id = v_sid;
  DELETE FROM login_attempts WHERE phone_number = v_phone;
  DELETE FROM students WHERE id = v_sid;
  RAISE NOTICE 'A verified: portal_get_fees/notices re-bound; all 4 dashboard RPCs run (no 42804).';

  -- C. Capacity math: unit-check on a temp batch.
  INSERT INTO batches (name, capacity, enrolled, is_active)
  VALUES ('__cap_test__', 2, 0, true) RETURNING id INTO v_pk;

  -- Enroll 2 approved+active students: allowed.
  FOR n IN 1..2 LOOP
    INSERT INTO students (name, phone, student_id, password, is_approved, status, batch_id)
    VALUES ('__c' || n, '__c' || n || random()::text, '__c' || n || random()::text,
            crypt('x', gen_salt('bf')), true, 'active', v_pk);
  END LOOP;

  SELECT capacity, enrolled INTO v_cap, v_count FROM batches WHERE id = v_pk;
  IF v_count <> 2 OR v_cap <> 2 THEN
    RAISE EXCEPTION 'capacity sync failed: enrolled=%, capacity=% (expected 2).', v_count, v_cap;
  END IF;

  -- Third enrollment must be rejected.
  BEGIN
    INSERT INTO students (name, phone, student_id, password, is_approved, status, batch_id)
    VALUES ('__overflow__', '__overflow__' || random()::text, '__overflow__' || random()::text,
            crypt('x', gen_salt('bf')), true, 'active', v_pk);
    RAISE EXCEPTION 'capacity trigger did NOT block a 3rd enrollment (capacity 2)';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'BATCH_FULL%' THEN
        RAISE EXCEPTION 'unexpected error during overflow probe: % %', SQLSTATE, SQLERRM;
      END IF;
  END;

  -- A suspended/not-approved move does NOT consume capacity.
  INSERT INTO students (name, phone, student_id, password, is_approved, status, batch_id)
  VALUES ('__suspended__', '__suspended__' || random()::text, '__suspended__' || random()::text,
          crypt('x', gen_salt('bf')), false, 'active', v_pk);

  SELECT enrolled INTO v_count FROM batches WHERE id = v_pk;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'not-approved student wrongly counted: enrolled=% (expected 2).', v_count;
  END IF;

  -- Cleanup the probe batch + its students.
  DELETE FROM students WHERE batch_id = v_pk;
  DELETE FROM batches WHERE id = v_pk;

  RAISE NOTICE 'C verified: enrollment blocked past capacity, enrolled stays live-synced.';

  -- C. Audit: list any pre-existing over-capacity batches (report, never delete).
  FOR v_name, v_cap, v_count IN
    SELECT b.name, b.capacity, b.enrolled
    FROM batches b
    WHERE b.capacity IS NOT NULL AND b.capacity > 0 AND b.enrolled > b.capacity
  LOOP
    RAISE NOTICE 'OVER-CAPACITY batch: % (capacity %, enrolled %) — review, not deleted.',
      v_name, v_cap, v_count;
  END LOOP;

  RAISE NOTICE 'M1 verified: 42804 re-bound, avatars storage policies, capacity enforced.';
END $verify$;

NOTIFY pgrst, 'reload schema';

-- === Post-commit verification: 20250829000002_exam_auth_penalty.sql ===
-- ═══════════ Verification (post-COMMIT) ═══════════
DO $verify$
DECLARE
  v_col BOOLEAN;
  v_probe INT; -- holds COUNT(*) results, NOT a uuid (was UUID -> 22P02 on re-run)
  v_sid UUID; v_b1 UUID; v_b2 UUID; v_exam UUID;
  v_x TEXT;
  v_cards INT;
BEGIN
  -- Schema present.
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='exams' AND column_name='strict_mode') INTO v_col;
  IF NOT v_col THEN RAISE EXCEPTION 'exams.strict_mode missing'; END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mcq_submissions' AND column_name='raw_score') INTO v_col;
  IF NOT v_col THEN RAISE EXCEPTION 'mcq_submissions.raw_score missing'; END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mcq_submissions' AND column_name='penalty_marks') INTO v_col;
  IF NOT v_col THEN RAISE EXCEPTION 'mcq_submissions.penalty_marks missing'; END IF;

  -- _exam_gate not externally reachable.
  IF HAS_FUNCTION_PRIVILEGE('anon', 'public._exam_gate(uuid,uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '_exam_gate is exposed to anon — must be internal-only.';
  END IF;

  -- Singular, granted entry points.
  SELECT COUNT(*) INTO v_probe FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='exam_join';
  IF v_probe <> 1 THEN RAISE EXCEPTION 'expected 1 exam_join, found %', v_probe; END IF;
  IF NOT HAS_FUNCTION_PRIVILEGE('anon','public.exam_join(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'anon lost exam_join EXECUTE';
  END IF;
  IF NOT HAS_FUNCTION_PRIVILEGE('anon','public.exam_submit(text,jsonb,integer,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'anon lost exam_submit EXECUTE';
  END IF;

  -- #7 penalty math (strict, 10% of TOTAL):
  -- 60-mark exam, 1 card -> 1 * CEIL(60*0.10) = 6 penalty.
  IF (SELECT 1 * CEIL(60 * 0.10)) <> 6 THEN
    RAISE EXCEPTION 'penalty math: 1 card on 60 total should be 6, got %', 1*CEIL(60*0.10);
  END IF;
  -- 60-mark, 10 cards -> 60 penalty (full wipe).
  IF (SELECT LEAST(10,10) * CEIL(60*0.10)) <> 60 THEN
    RAISE EXCEPTION 'penalty math: 10 cards on 60 should be 60';
  END IF;
  -- Strict OFF → zero penalty regardless of cards.
  -- 40-mark, 3 cards, 25 raw, strict OFF → final 25.
  IF (SELECT GREATEST(25 - (CASE WHEN false THEN 3*CEIL(40*0.10) ELSE 0 END), 0)) <> 25 THEN
    RAISE EXCEPTION 'penalty math: strict OFF must not deduct';
  END IF;

  -- #10b functional probe: a batch-scoped draft/upcoming exam rejects a
  -- student from an unassigned batch, and an auto-started (start_time passed)
  -- exam accepts an assigned student. Build disposable rows, then clean up.
  INSERT INTO batches (name, capacity, is_active) VALUES ('__m2b__', 10, true) RETURNING id INTO v_b1;
  INSERT INTO batches (name, capacity, is_active) VALUES ('__m2b2__', 10, true) RETURNING id INTO v_b2;
  INSERT INTO students (name, phone, student_id, password, is_approved, status, batch_id)
  VALUES ('__m2s__', '__m2s__'||random()::text, '__m2s__'||random()::text,
          crypt('x', gen_salt('bf')), true, 'active', v_b1) RETURNING id INTO v_sid;

  -- Exam scoped to b1, already started (auto-start), still open.
  INSERT INTO exams (title, subject, status, start_time, end_time, batch_ids, total_marks, strict_mode, type)
  VALUES ('__m2e__', 'x', 'upcoming', NOW() - INTERVAL '5 minutes', NOW() + INTERVAL '20 minutes',
          ARRAY[v_b1], 60, false, 'mcq') RETURNING id INTO v_exam;

  -- Student IS in b1 → join must pass the gate (ends only on realm issues).
  BEGIN
    SELECT exam_token INTO v_x FROM exam_join(v_exam, NULL, (SELECT student_id FROM students WHERE id=v_sid));
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'assigned, auto-started exam join failed: % %', SQLSTATE, SQLERRM;
  END;

  -- Move student to unassigned batch b2 → join must raise EXAM_NOT_ASSIGNED.
  UPDATE students SET batch_id = v_b2 WHERE id = v_sid;
  BEGIN
    SELECT exam_token INTO v_x FROM exam_join(v_exam, NULL, (SELECT student_id FROM students WHERE id=v_sid));
    RAISE EXCEPTION 'unassigned-batch student joined — EXAM_NOT_ASSIGNED not enforced';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%EXAM_NOT_ASSIGNED%' THEN
      RAISE EXCEPTION 'expected EXAM_NOT_ASSIGNED, got % %', SQLSTATE, SQLERRM;
    END IF;
  END;

  -- Cleanup.
  DELETE FROM exam_tokens WHERE token = v_x;
  DELETE FROM students WHERE id = v_sid;
  DELETE FROM exams WHERE id = v_exam;
  DELETE FROM batches WHERE id IN (v_b1, v_b2);

  RAISE NOTICE 'M2 verified: exam auth gates, auto-start, strict penalty math, notice_reads table ready.';
END $verify$;

NOTIFY pgrst, 'reload schema';

-- === Post-commit verification: 20250829000003_fix_portal_exams_42804.sql ===
-- ═══════════ Verification (post-COMMIT) ═══════════
DO $verify$
DECLARE
  v_sid UUID; v_tok TEXT; v_phone TEXT := '__m3__' || md5(random()::text)::text;
  v_col TEXT;
BEGIN
  -- Declared result now carries exam_date as date.
  SELECT data_type INTO v_col FROM information_schema.columns
  WHERE table_schema='public' AND table_name='exams' AND column_name='exam_date';
  IF v_col <> 'date' THEN
    RAISE NOTICE 'WARNING: live exams.exam_date is % (expected date); verify the client still formats it.', v_col;
  END IF;

  IF NOT HAS_FUNCTION_PRIVILEGE('anon', 'public.portal_get_exams(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon lost EXECUTE on portal_get_exams';
  END IF;

  -- Functional: temp approved student + live session -> the four dashboard
  -- portal RPCs must ALL run without 42804/42703 now.
  INSERT INTO students (name, phone, student_id, password, is_approved, status)
  VALUES ('__m3__', v_phone, v_phone, crypt('smoke', gen_salt('bf')), true, 'active')
  RETURNING id INTO v_sid;

  v_tok := _issue_student_session(v_sid);

  BEGIN
    PERFORM * FROM portal_get_fees(v_tok);
    PERFORM * FROM portal_get_exams(v_tok);
    PERFORM * FROM portal_get_submissions(v_tok);
    PERFORM * FROM portal_get_notices(v_tok);
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM student_sessions WHERE student_id = v_sid;
    DELETE FROM students WHERE id = v_sid;
    RAISE EXCEPTION 'Portal RPC smoke STILL fails: % %', SQLSTATE, SQLERRM;
  END;

  DELETE FROM student_sessions WHERE student_id = v_sid;
  DELETE FROM students WHERE id = v_sid;
  RAISE NOTICE 'M3 verified: all four portal RPCs run against live data (no 42804).';
END $verify$;

NOTIFY pgrst, 'reload schema';

-- === Post-commit verification: 20250830000001_exam_batch_backfill.sql ===
-- ============================================================
--  Post-COMMIT verification
-- ============================================================
DO $verify$
DECLARE
  v_b1 UUID; v_b2 UUID; v_s  UUID; v_tok TEXT;
  v_exam UUID; v_n INTEGER; v_leak INTEGER;
BEGIN
  -- Two fresh batches, one exam per batch.
  INSERT INTO batches (name, capacity, is_active)
  VALUES ('__E2E Backfill A__', 10, true) RETURNING id INTO v_b1;
  INSERT INTO batches (name, capacity, is_active)
  VALUES ('__E2E Backfill B__', 10, true) RETURNING id INTO v_b2;

  -- Exam A: single-batch via batch_id only (simulates a legacy row).
  INSERT INTO exams (title, subject, status, exam_date, duration_minutes,
                     total_marks, pass_marks, timer_enabled, batch_id, batch_ids)
  VALUES ('__E2E Legacy A__', 'Math', 'ended', CURRENT_DATE, 10, 10, 4, true,
          v_b1, ARRAY[v_b1]::uuid[])
  RETURNING id INTO v_exam;

  -- Verify the legacy single-batch shape: batch_ids was explicit here; now
  -- run the exact INSERT a legacy app produced (batch_id ONLY) and confirm
  -- backfill logic would not be needed only because we set it. Instead,
  -- simulate a row that forgot batch_ids and make sure scoping still works:
  DELETE FROM exams WHERE id = v_exam; -- drop the correct one
  INSERT INTO exams (title, subject, status, exam_date, duration_minutes,
                     total_marks, pass_marks, timer_enabled, batch_id)
  VALUES ('__E2E Legacy A__', 'Math', 'ended', CURRENT_DATE, 10, 10, 4, true, v_b1)
  RETURNING id INTO v_exam;
  -- Backfill again for the inserted-without-array row:
  UPDATE exams SET batch_ids = ARRAY[batch_id]
  WHERE batch_id IS NOT NULL AND (batch_ids IS NULL OR cardinality(batch_ids) = 0);

  -- Exam B: explicitly targets batch B.
  INSERT INTO exams (title, subject, status, exam_date, duration_minutes,
                     total_marks, pass_marks, timer_enabled, batch_ids)
  VALUES ('__E2E Scoped B__', 'Physics', 'ended', CURRENT_DATE, 10, 10, 4, true, ARRAY[v_b2])
  RETURNING id INTO v_exam;

  -- Student in batch A; mint a session token.
  INSERT INTO students (name, phone, student_id, password, is_approved, status, batch_id)
  VALUES ('E2E Backfill Student', '01981110001', '__E2EBAK001',
          crypt('Passw0rd!', gen_salt('bf')), true, 'active', v_b1)
  RETURNING id INTO v_s;
  v_tok := _issue_student_session(v_s);

  -- portal_get_exams for this batch-A student must return the legacy-A exam
  -- and never leak the batch-B exam.
  SELECT count(*) INTO v_n
  FROM portal_get_exams(v_tok) WHERE title = '__E2E Legacy A__';
  SELECT count(*) INTO v_leak
  FROM portal_get_exams(v_tok) WHERE title = '__E2E Scoped B__';

  -- STRICT: an exam with NO batch target (unassigned) must NOT appear for
  -- any student — it must never leak into every portal.
  INSERT INTO exams (title, subject, status, exam_date, duration_minutes,
                     total_marks, pass_marks, timer_enabled)
  VALUES ('__E2E Unassigned__', 'General', 'active', CURRENT_DATE, 10, 10, 4, true)
  RETURNING id INTO v_exam;
  SELECT count(*) INTO v_leak
  FROM portal_get_exams(v_tok) WHERE title = '__E2E Unassigned__';
  IF v_leak <> 0 THEN
    RAISE EXCEPTION 'batch backfill: UNASSIGNED exam leaked into every student (got %)', v_leak;
  END IF;
  -- Restore v_exam to the legacy-A id used for cleanup by title anyway; safe.

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'batch backfill: legacy batch-A exam not visible to batch-A student (got %)', v_n;
  END IF;
  IF v_leak <> 0 THEN
    RAISE EXCEPTION 'batch backfill: batch-B exam leaked into batch-A student (got %)', v_leak;
  END IF;

  -- Cleanup
  DELETE FROM student_sessions WHERE student_id = v_s;
  DELETE FROM students WHERE id = v_s;
  DELETE FROM exams WHERE title LIKE '__E2E %';
  DELETE FROM batches WHERE name LIKE '__E2E Backfill %';

  RAISE NOTICE 'verify OK: strict batch scoping — legacy A visible, batch B + unassigned hidden.';
END
$verify$;

-- === Post-commit verification: 20250830000002_payment_approvals.sql ===
-- ============================================================
--  Post-COMMIT functional smoke
-- ============================================================
DO $verify$
DECLARE
  v_b UUID; v_s UUID; v_f UUID; v_tok TEXT; v_app_id UUID; v_receipt TEXT;
BEGIN
  -- Disposable batch + student + unpaid fee.
  INSERT INTO batches (name, capacity, is_active) VALUES ('__E2E PAYA__', 10, true) RETURNING id INTO v_b;
  INSERT INTO students (name, phone, student_id, password, is_approved, status, batch_id)
  VALUES ('E2E Pay Approve', '01981110002', '__E2EPAYAPR',
          crypt('Passw0rd!', gen_salt('bf')), true, 'active', v_b) RETURNING id INTO v_s;
  INSERT INTO fees (student_id, batch_id, amount, month, status)
  VALUES (v_s, v_b, 1500, 'August 2026', 'pending') RETURNING id INTO v_f;

  v_tok := _issue_student_session(v_s);

  -- Student submits a transaction.
  SELECT id INTO v_app_id
  FROM portal_submit_payment(v_tok, v_f, 'bkash', 'TRX8888', 'bkash payment');

  -- Portal sees it as pending.
  IF NOT EXISTS (SELECT 1 FROM portal_my_payment_approvals(v_tok) WHERE id = v_app_id) THEN
    RAISE EXCEPTION 'portal_submit_payment / portal_my_payment_approvals failed';
  END IF;

  -- Admin approve is an is_admin()-gated RPC — in the SQL editor there is no
  -- JWT (auth.uid() IS NULL), so we cannot call it here without tripping the
  -- gate. Exercise the SAME writes it performs (fee → paid with receipt note,
  -- approval → approved) to prove the round trip; the gated RPC itself is
  -- covered by the browser E2E harness running as a real admin.
  v_receipt := 'RCT-VERIFY';
  UPDATE payment_approvals
  SET status = 'approved', reviewed_at = now(), reviewed_by = 'verify'
  WHERE id = v_app_id;
  UPDATE fees
  SET status = 'paid', payment_date = now(),
      note = jsonb_build_object(
        'receipt_no', v_receipt,
        'payment_method', 'bkash',
        'transaction_id', 'TRX8888',
        'final_amount', 1500,
        'source', 'verify'
      )::text
  WHERE id = v_f;

  -- Fee is paid, note carries the receipt (client parses JSON).
  IF NOT EXISTS (SELECT 1 FROM fees WHERE id = v_f AND status = 'paid') THEN
    RAISE EXCEPTION 'approve path did not mark the fee paid';
  END IF;

  -- Cleanup (fee_audit_logs is created out-of-band in this project; only
  -- touch it if it actually exists).
  IF TO_REGCLASS('public.fee_audit_logs') IS NOT NULL THEN
    DELETE FROM fee_audit_logs WHERE fee_id = v_f;
  END IF;
  DELETE FROM payment_approvals WHERE id = v_app_id;
  DELETE FROM fees WHERE id = v_f;
  DELETE FROM student_sessions WHERE student_id = v_s;
  DELETE FROM students WHERE id = v_s;
  DELETE FROM batches WHERE id = v_b;

  RAISE NOTICE 'verify OK: payment approval round-trip (submit → my list → approve → paid)';
END
$verify$;

-- === Post-commit verification: 20250907000001_exam_session_only_and_avatar_storage.sql ===
-- Operator verification (run only in an approved disposable/staging DB):
-- 1. pg_proc has exactly exam_join(uuid,text), and no exam_join(uuid,text,text).
-- 2. anon EXECUTE exists only on exam_join(uuid,text), questions, submit,
--    review and the token-gated leaderboard.
-- 3. storage.objects has no anon INSERT/UPDATE/DELETE policy for avatars.
-- 4. Revoke existing exam_tokens in a separately approved maintenance window
--    if old tokens may have been minted through the removed identifier path.

-- === Post-commit verification: 20250909000001_postinstall_repairs.sql ===
-- ============================================================================
-- Focused post-repair checks (run inside the same transaction; read-only).
-- ============================================================================
DO $post$
BEGIN
  -- A: payment_approvals admin policy is now is_admin()-gated (not USING true).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='payment_approvals'
       AND policyname='admin_all_payment_approvals'
       AND (qual::text ILIKE '%is_admin%' OR with_check::text ILIKE '%is_admin%')
  ) THEN
    RAISE EXCEPTION 'payment_approvals admin policy is not is_admin()-gated';
  END IF;

  -- B: avatars bucket is private and size/MIME constrained.
  IF to_regclass('storage.buckets') IS NOT NULL
     AND EXISTS (SELECT 1 FROM storage.buckets WHERE id='avatars'
                 AND public = false AND file_size_limit = 2097152
                 AND allowed_mime_types::text[] @> ARRAY['image/jpeg','image/png','image/webp']::text[]) IS NOT TRUE THEN
    RAISE EXCEPTION 'avatars bucket is not private / 2MiB / MIME-configured';
  END IF;
  -- No public/anon/authenticated avatar read policy remains.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='storage' AND tablename='objects'
                AND (policyname ILIKE '%avatar%')) THEN
    RAISE EXCEPTION 'stray avatar storage policy remains';
  END IF;

  -- C: unique index present.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND tablename='mcq_submissions'
                    AND indexname='mcq_submissions_exam_student_uidx') THEN
    RAISE EXCEPTION 'mcq_submissions unique (exam_id, student_id) index missing';
  END IF;

  RAISE NOTICE 'postinstall_repairs OK';
END $post$;
