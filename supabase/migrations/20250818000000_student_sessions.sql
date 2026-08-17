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
