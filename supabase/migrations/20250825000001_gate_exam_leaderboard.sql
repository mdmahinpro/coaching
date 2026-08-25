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

BEGIN;

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

COMMIT;

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
