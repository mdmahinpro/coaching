-- ============================================================================
-- 20250909000001_postinstall_repairs.sql
-- Target repair batch (applies to any installed environment + future fresh
-- installs). Numbered as a NEW forward migration: it appends its own ledger
-- entry and never re-edits rows already recorded by earlier migrations.
--
-- Scope:
--   [A] Close the payment-approval authorization bypass.
--       Replace the unconditional admin-named RLS policy
--       (admin_all_payment_approvals ... FOR ALL TO authenticated USING(true))
--       with a genuine fail-closed is_admin() gate. Student payment submission
--       is preserved through the existing server-validated portal RPCs, which
--       are unaffected.
--   [B] PRIVATE avatar storage.
--       - avatars bucket is PRIVATE (public=false), max 2 MiB, JPEG/PNG/WebP.
--       - Remove the public/anon/authenticated avatar read policy; no direct
--         storage read is authorized. Ownership-validated retrieval is exposed
--         through RPCs consumed by a server-side signed-URL endpoint.
--   [C] Exam-submission integrity.
--       - mcq_submissions gains a UNIQUE (exam_id, student_id) invariant so a
--         duplicate/concurrent submission cannot be written twice.
--       - exam_submit is hardened to treat the unique-violation as
--         ALREADY_SUBMITTED (retry/reload-safe) instead of a 23505 leak.
--
-- No data, Auth, or Storage rows are seeded; no messages are sent; nothing is
-- triggered. Idempotent. Dashboard SQL Editor compatible.
-- ============================================================================
BEGIN;

-- ============================================================================
-- [A] PAYMENT APPROVAL AUTHORIZATION
-- ============================================================================
-- The previous policy let ANY Supabase-authenticated user (authenticated role)
-- directly read/insert/update/delete every payment_approval via PostgREST,
-- because it assumed authenticated == admin. Students use an opaque custom
-- session and are NOT the authenticated role. The authenticated role must mean
-- "roster admin" for this financial table.
ALTER TABLE public.payment_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_payment_approvals" ON public.payment_approvals;
CREATE POLICY "admin_all_payment_approvals"
  ON public.payment_approvals
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Student financial access happens ONLY through the is_admin()-gated admin
-- RPCs and the server-validated portal RPCs (portal_submit_payment,
-- portal_my_payment_approvals), both SECURITY DEFINER. Explicitly keep anon
-- and the direct path locked down.
REVOKE ALL ON TABLE public.payment_approvals FROM anon;
REVOKE ALL ON TABLE public.payment_approvals FROM PUBLIC;

-- ============================================================================
-- [B] PRIVATE AVATAR STORAGE
-- ============================================================================
-- Guard on the bucket being present (it is created by 20250829000001). Set it
-- PRIVATE with a 2 MiB size cap and JPEG/PNG/WebP allow-list at the storage
-- layer. (The authoritative size + content validation also live in
-- server/avatar-core.ts, which is tightened to match.)
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

-- Remove the public read policy (and any stray avatar read/write policy). With
-- the bucket private, no anon/authenticated storage access remains: uploads go
-- through the server-side service-role path, reads through signed URLs.
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_delete" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_upload" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;

-- Ownership-validated retrieval support. These RPCs resolve WHO may view a
-- student's avatar and return the storage object path; the caller/server then
-- signs a short-lived URL with the service key. They are SECURITY DEFINER so
-- the path is only disclosed to an authorized party.
--
-- 1) Student path: the caller's OWN avatar only, identity from the opaque
--    portal session token (students are NOT the Supabase authenticated role).
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
  RETURN QUERY
    SELECT 'avatars/students/' || v_sid::text || '-photo.jpg'::text;
END;
$fn$;
REVOKE ALL ON FUNCTION public.portal_get_avatar_path(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_get_avatar_path(TEXT) TO anon, authenticated;

-- 2) Admin path: a roster admin may view any student's avatar. identity from
--    the Supabase authenticated JWT via is_admin().
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
  RETURN QUERY
    SELECT 'avatars/students/' || p_student_id::text || '-photo.jpg'::text;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_get_avatar_path(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_avatar_path(UUID) TO authenticated;

-- ============================================================================
-- [C] EXAM SUBMISSION INTEGRITY
-- ============================================================================
-- Add the DB invariant that makes the exam_submit EXISTS check race-safe:
-- exactly one submission per (student, exam). Idempotent.
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

-- Harden exam_submit: if the unique index rejects a concurrent/duplicate write
-- (23505), translate it to the same ALREADY_SUBMITTED the check already emits,
-- so reload/recovery never surfaces a raw unique-violation and never double
-- counts a student's submission.
DROP FUNCTION IF EXISTS public.exam_submit(TEXT, JSONB, INTEGER, INTEGER);
CREATE FUNCTION public.exam_submit(
  p_exam_token TEXT,
  p_answers    JSONB,
  p_time_taken INTEGER DEFAULT 0,
  p_red_cards  INTEGER DEFAULT 0
)
RETURNS TABLE (
  id            UUID,
  score         INTEGER,
  raw_score     INTEGER,
  penalty_marks INTEGER,
  correct_count INTEGER,
  wrong_count   INTEGER,
  time_taken    INTEGER,
  rank          INTEGER,
  red_cards     INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_exam    UUID;
  v_sid     UUID;
  v_sbatch  UUID;
  v_estat   TEXT;
  v_total   INTEGER;
  v_strict  BOOLEAN;
  v_score   INTEGER := 0;
  v_final   INTEGER;
  v_penalty INTEGER := 0;
  v_correct INTEGER := 0;
  v_wrong   INTEGER := 0;
  v_answered INTEGER := 0;
  v_cards   INTEGER;
  v_rank    INTEGER;
  v_new_id  UUID;
  q         RECORD;
  v_ans     TEXT;
BEGIN
  SELECT r.exam_id, r.student_id INTO v_exam, v_sid FROM _exam_token_resolve(p_exam_token) r;
  IF v_exam IS NULL THEN
    RAISE EXCEPTION 'Exam session expired. Please rejoin.';
  END IF;

  -- Reject duplicate (fast path; the unique index is the authoritative guard).
  IF EXISTS (
    SELECT 1 FROM mcq_submissions m
    WHERE m.exam_id = v_exam AND m.student_id = v_sid
  ) THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END IF;

  SELECT s.batch_id INTO v_sbatch FROM students s WHERE s.id = v_sid;
  SELECT g.status, g.total_marks, g.strict_mode INTO v_estat, v_total, v_strict
  FROM _exam_gate(v_exam, v_sbatch, true) g;

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

  v_cards := LEAST(GREATEST(COALESCE(p_red_cards, 0), 0), 10);
  IF v_strict THEN
    v_penalty := v_cards * CEIL(COALESCE(v_total, 0) * 0.10);
  END IF;
  v_final := GREATEST(v_score - v_penalty, 0);

  SELECT COUNT(*) + 1 INTO v_rank
  FROM mcq_submissions m
  WHERE m.exam_id = v_exam
    AND (m.score > v_final OR (m.score = v_final AND m.time_taken < p_time_taken));

  BEGIN
    INSERT INTO mcq_submissions
      (exam_id, student_id, answers, score, raw_score, penalty_marks,
       correct_count, wrong_count, time_taken, rank, red_cards, submitted_at)
    VALUES
      (v_exam, v_sid, p_answers, v_final, v_score, v_penalty,
       v_correct, v_wrong, COALESCE(p_time_taken, 0), v_rank, v_cards, NOW())
    RETURNING mcq_submissions.id INTO v_new_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END;

  RETURN QUERY
  SELECT v_new_id, v_final, v_score, v_penalty, v_correct, v_wrong,
         COALESCE(p_time_taken, 0), v_rank, v_cards;
END;
$fn$;

REVOKE ALL ON FUNCTION public.exam_submit(TEXT, JSONB, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exam_submit(TEXT, JSONB, INTEGER, INTEGER) TO anon, authenticated;

COMMIT;

-- ============================================================================
-- Focused post-repair checks (run inside the same transaction; read-only).
-- ============================================================================
DO $post$
BEGIN
  -- A: payment_approvals admin policy is now is_admin()-gated (not USING true).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='payment_approvals'
       AND policyname='admin_all_payment_approvals'
       AND (qual::text ILIKE '%is_admin%' OR with_check::text ILIKE '%is_admin%')
  ) THEN
    RAISE EXCEPTION 'payment_approvals admin policy is not is_admin()-gated';
  END IF;

  -- B: avatars bucket is private and size/MIME constrained.
  IF to_regclass('storage.buckets') IS NOT NULL
     AND EXISTS (SELECT 1 FROM storage.buckets WHERE id='avatars'
                 AND public = false AND file_size_limit = 2097152
                 AND allowed_mime_types::text[] @> ARRAY['image/jpeg','image/png','image/webp']::text[]) IS NOT TRUE THEN
    RAISE EXCEPTION 'avatars bucket is not private / 2MiB / MIME-configured';
  END IF;
  -- No public/anon/authenticated avatar read policy remains.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname='storage' AND tablename='objects'
                AND (policyname ILIKE '%avatar%')) THEN
    RAISE EXCEPTION 'stray avatar storage policy remains';
  END IF;

  -- C: unique index present.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND tablename='mcq_submissions'
                    AND indexname='mcq_submissions_exam_student_uidx') THEN
    RAISE EXCEPTION 'mcq_submissions unique (exam_id, student_id) index missing';
  END IF;

  RAISE NOTICE 'postinstall_repairs OK';
END $post$;
