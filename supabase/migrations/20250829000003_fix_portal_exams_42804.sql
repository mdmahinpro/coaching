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

BEGIN;

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

COMMIT;

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
