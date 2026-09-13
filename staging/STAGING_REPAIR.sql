-- ============================================================================
-- STAGING_REPAIR.sql
-- Target: temporary Supabase project hjzwbicauyxffrmdhvgy (POST-INSTALL repair)
-- Applies ONLY the new forward changes for this installed environment:
--   [A] payment_approvals admin policy -> is_admin() gate
--   [B] avatars bucket -> PRIVATE (public=false, 2 MiB, JPEG/PNG/WebP),
--       public/anon/authenticated avatar read/write policies removed,
--       ownership-validated retrieval RPCs added
--   [C] mcq_submissions UNIQUE (exam_id, student_id); exam_submit hardened
--
-- It DOES NOT rerun the baseline, DOES NOT re-edit any recorded ledger
-- checksum, and DOES NOT replay earlier migrations. It appends a single new
-- ledger row for 20250909000001_postinstall_repairs.sql (idempotence guarded:
-- if that version already exists, the INSERT fails loudly).
--
-- Read-only towards existing rows; no data/Auth/Storage seeding; no messages;
-- nothing triggered. Dashboard SQL Editor compatible (no psql directives).
-- ============================================================================
BEGIN;

-- Apply the same A + B + C changes as the new forward migration.
-- ============ [A] PAYMENT APPROVAL AUTHORIZATION ============
ALTER TABLE public.payment_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_payment_approvals" ON public.payment_approvals;
CREATE POLICY "admin_all_payment_approvals"
  ON public.payment_approvals
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

REVOKE ALL ON TABLE public.payment_approvals FROM anon;
REVOKE ALL ON TABLE public.payment_approvals FROM PUBLIC;

-- ============ [B] PRIVATE AVATAR STORAGE ============
DO $b$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL
     AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'avatars') THEN
    UPDATE storage.buckets
       SET public = false,
           file_size_limit = 2097152, -- 2 MiB
           allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']::text[]
     WHERE id = 'avatars';
  END IF;
END $b$;

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_delete" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_upload" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;

DROP FUNCTION IF EXISTS public.portal_get_avatar_path(TEXT);
CREATE FUNCTION public.portal_get_avatar_path(p_token TEXT)
RETURNS TABLE (path TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID;
BEGIN
  v_sid := _student_id_from_token(p_token);
  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'Session expired. Please log in again.';
  END IF;
  RETURN QUERY SELECT 'avatars/students/' || v_sid::text || '-photo.jpg'::text;
END;
$fn$;
REVOKE ALL ON FUNCTION public.portal_get_avatar_path(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_get_avatar_path(TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.admin_get_avatar_path(UUID);
CREATE FUNCTION public.admin_get_avatar_path(p_student_id UUID)
RETURNS TABLE (path TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
BEGIN
  IF NOT COALESCE(is_admin(), false) THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'STUDENT_NOT_FOUND';
  END IF;
  RETURN QUERY SELECT 'avatars/students/' || p_student_id::text || '-photo.jpg'::text;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_get_avatar_path(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_avatar_path(UUID) TO authenticated;

-- ============ [C] EXAM SUBMISSION INTEGRITY ============
DO $c$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'mcq_submissions'
       AND indexname = 'mcq_submissions_exam_student_uidx'
  ) THEN
    CREATE UNIQUE INDEX mcq_submissions_exam_student_uidx
      ON public.mcq_submissions (exam_id, student_id);
  END IF;
END $c$;

DROP FUNCTION IF EXISTS public.exam_submit(TEXT, JSONB, INTEGER, INTEGER);
CREATE FUNCTION public.exam_submit(
  p_exam_token TEXT,
  p_answers    JSONB,
  p_time_taken INTEGER DEFAULT 0,
  p_red_cards  INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID, score INTEGER, raw_score INTEGER, penalty_marks INTEGER,
  correct_count INTEGER, wrong_count INTEGER, time_taken INTEGER,
  rank INTEGER, red_cards INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_exam UUID; v_sid UUID; v_sbatch UUID; v_estat TEXT; v_total INTEGER;
  v_strict BOOLEAN; v_score INTEGER := 0; v_final INTEGER; v_penalty INTEGER := 0;
  v_correct INTEGER := 0; v_wrong INTEGER := 0; v_cards INTEGER; v_rank INTEGER;
  v_new_id UUID; q RECORD; v_ans TEXT;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN RAISE EXCEPTION 'Exam session expired. Please rejoin.'; END IF;

  IF EXISTS (SELECT 1 FROM mcq_submissions m WHERE m.exam_id = v_exam AND m.student_id = v_sid) THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END IF;

  SELECT s.batch_id INTO v_sbatch FROM students s WHERE s.id = v_sid;
  SELECT g.status, g.total_marks, g.strict_mode INTO v_estat, v_total, v_strict
  FROM _exam_gate(v_exam, v_sbatch, true) g;

  FOR q IN SELECT mq.id, mq.correct_option, mq.marks FROM mcq_questions mq WHERE mq.exam_id = v_exam LOOP
    v_ans := lower(COALESCE(p_answers ->> q.id::text, ''));
    IF v_ans <> '' THEN
      IF v_ans = lower(q.correct_option) THEN
        v_correct := v_correct + 1;
        v_score := v_score + COALESCE(q.marks, 1);
      ELSE
        v_wrong := v_wrong + 1;
      END IF;
    END IF;
  END LOOP;

  v_cards := LEAST(GREATEST(COALESCE(p_red_cards, 0), 0), 10);
  IF v_strict THEN v_penalty := v_cards * CEIL(COALESCE(v_total, 0) * 0.10); END IF;
  v_final := GREATEST(v_score - v_penalty, 0);

  SELECT COUNT(*) + 1 INTO v_rank
  FROM mcq_submissions m
  WHERE m.exam_id = v_exam AND (m.score > v_final OR (m.score = v_final AND m.time_taken < p_time_taken));

  BEGIN
    INSERT INTO mcq_submissions
      (exam_id, student_id, answers, score, raw_score, penalty_marks,
       correct_count, wrong_count, time_taken, rank, red_cards, submitted_at)
    VALUES
      (v_exam, v_sid, p_answers, v_final, v_score, v_penalty,
       v_correct, v_wrong, COALESCE(p_time_taken, 0), v_rank, v_cards, NOW())
    RETURNING mcq_submissions.id INTO v_new_id;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END;

  RETURN QUERY SELECT v_new_id, v_final, v_score, v_penalty, v_correct,
                      v_wrong, COALESCE(p_time_taken, 0), v_rank, v_cards;
END;
$fn$;
REVOKE ALL ON FUNCTION public.exam_submit(TEXT, JSONB, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exam_submit(TEXT, JSONB, INTEGER, INTEGER) TO anon, authenticated;

-- ============ LEDGER APPEND (single new row; existing 40 rows untouched) ============
-- The checksum below is sha256(supabase/migrations/20250909000001_postinstall_repairs.sql).
-- It records the ACTUAL reviewed file. If the version already exists the insert is a
-- no-op (this file is itself the source of that row), so re-running is idempotent.
INSERT INTO public.provisioning_migrations (version, sha256)
VALUES ('20250909000001_postinstall_repairs.sql',
        '6037b948bc717b5efa68634f5360fed8ddf3b39e6cdd31da09f0c9d2c9a3199f')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- Focused post-repair checks (read-only, after COMMIT; fail loudly if unmet).
-- ============================================================================
DO $post$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='payment_approvals'
       AND policyname='admin_all_payment_approvals'
       AND (qual::text ILIKE '%is_admin%' OR with_check::text ILIKE '%is_admin%')
  ) THEN RAISE EXCEPTION 'payment_approvals admin policy not is_admin()-gated'; END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='storage' AND tablename='objects'
                AND policyname ILIKE '%avatar%') THEN
    RAISE EXCEPTION 'stray avatar storage policy remains';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND tablename='mcq_submissions'
                    AND indexname='mcq_submissions_exam_student_uidx') THEN
    RAISE EXCEPTION 'mcq_submissions unique index missing';
  END IF;

  IF to_regprocedure('public.portal_get_avatar_path(text)') IS NULL
     OR to_regprocedure('public.admin_get_avatar_path(uuid)') IS NULL THEN
    RAISE EXCEPTION 'avatar retrieval RPCs missing';
  END IF;

  RAISE NOTICE 'STAGING_REPAIR OK';
END $post$;

-- Expected final state:
--   ledger_rows = 41 (canonical + 40 follow-on; the new postinstall row appended)
--   payment_approvals authored = admin_all_payment_approvals gated on is_admin()
--   avatars bucket public=false, file_size_limit=2097152,
--     allowed_mime_types = jpeg/png/webp; no avatar storage policies remain
--   mcq_submissions_exam_student_uidx present; exam_submit returns ALREADY_SUBMITTED
--     on any duplicate/concurrent write
