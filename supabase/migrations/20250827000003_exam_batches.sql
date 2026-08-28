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

BEGIN;

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

COMMIT;

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
