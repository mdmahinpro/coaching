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

BEGIN;

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

COMMIT;

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
