-- Batch S1: remove identifier-only exam entry and anonymous avatar writes.
-- Source-only until an explicitly assigned disposable/staging database is
-- approved and the migration is applied and verified there.

BEGIN;

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

COMMIT;

-- Operator verification (run only in an approved disposable/staging DB):
-- 1. pg_proc has exactly exam_join(uuid,text), and no exam_join(uuid,text,text).
-- 2. anon EXECUTE exists only on exam_join(uuid,text), questions, submit,
--    review and the token-gated leaderboard.
-- 3. storage.objects has no anon INSERT/UPDATE/DELETE policy for avatars.
-- 4. Revoke existing exam_tokens in a separately approved maintenance window
--    if old tokens may have been minted through the removed identifier path.
