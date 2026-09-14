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
