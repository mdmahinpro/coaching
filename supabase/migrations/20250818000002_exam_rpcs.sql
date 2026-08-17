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
