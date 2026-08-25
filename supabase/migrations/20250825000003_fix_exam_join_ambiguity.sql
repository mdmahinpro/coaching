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

BEGIN;

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

COMMIT;

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
