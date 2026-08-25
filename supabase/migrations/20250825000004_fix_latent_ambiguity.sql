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

COMMIT;

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
