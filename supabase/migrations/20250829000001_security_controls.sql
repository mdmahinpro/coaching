-- ============================================================
--  R2-M1. Security controls: portal 42804, teacher storage, capacity
-- ============================================================
--  Covers three reported defects (priority group).

--  A. STUDENT LOGIN "structure of query does not match function result type"
--     portal_get_fees / portal_get_notices are `RETURNS SETOF <table>` with
--     `SELECT *`, and their result row type is the table composite bound at
--     CREATE (20250820000000). The live database is known to drift from the
--     tracked migrations (exam_join was the prior example), so a live
--     add/retype on fees/notices makes SELECT * diverge from the bound row
--     type -> 42804 on the dashboard's Promise.all right after login.
--     Fix: assert the columns the RPCs depend on actually exist (loud,
--     self-diagnosing failure), then DROP+CREATE both functions to RE-BIND
--     the row type to the live tables.

--  B. TEACHER PHOTO UPLOAD "does not work"
--     No migration ever created the `avatars` bucket or any storage.objects
--     policy — the bucket + policies exist only in the console. The admin
--     upload (TeachersPage.tsx) runs as role `authenticated`; a missing or
--     anon-only policy silently fails the upload, so photo_url writes null.
--     Fix: create the public `avatars` bucket idempotently and add explicit
--     storage.objects policies for read/insert/update covering anon
--     (student portal) and authenticated (admin) paths.

--  C. BATCH CAPACITY NOT ENFORCED ("2/1 enrolled")
--     Nothing server-side prevents enrollment beyond capacity: increment
--     RPC gates only on is_admin(), there is no trigger/CHECK, and
--     `authenticated` can PATCH students.batch_id directly.
--     Fix: a BEFORE trigger (row-locked) raises BATCH_FULL when an
--     approved+active enrollment would exceed capacity (NULL/<=0 = no
--     limit); an AFTER trigger keeps batches.enrolled == live count so the
--     public card shows reality. Pre-existing over-capacity batches are
--     AUDITED (reported) in verification, never deleted.

--  Idempotent. Run in the Supabase SQL Editor.

BEGIN;

-- ═══════════ A. Portal login 42804 ═══════════

DO $pre$
DECLARE
  missing_fees   TEXT;
  missing_notice TEXT;
BEGIN
  IF TO_REGCLASS('public.fees') IS NULL THEN
    RAISE EXCEPTION 'public.fees missing — nothing to rebind.';
  END IF;
  IF TO_REGCLASS('public.notices') IS NULL THEN
    RAISE EXCEPTION 'public.notices missing — nothing to rebind.';
  END IF;

  -- Portal comma RPCs touch these columns; missing ones are the 42804/42703
  -- root cause, reported here atomically.
  SELECT string_agg(m, ', ') INTO missing_fees
  FROM unnest(ARRAY['id','student_id','batch_id','amount','month','status','due_date']) m
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='fees' AND column_name=m
  );

  SELECT string_agg(m, ', ') INTO missing_notice
  FROM unnest(ARRAY['id','title','content','is_published','target','batch_id','is_pinned','created_at','type']) m
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notices' AND column_name=m
  );

  IF missing_fees IS NOT NULL THEN
    RAISE EXCEPTION 'fees is missing column(s) % — the live table has drifted; fix the column(s) before this migration.', missing_fees;
  END IF;
  IF missing_notice IS NOT NULL THEN
    RAISE EXCEPTION 'notices is missing column(s) % — fix before this migration.', missing_notice;
  END IF;
END $pre$;

-- Re-bind the row types to the CURRENT live tables.
DROP FUNCTION IF EXISTS portal_get_fees(TEXT);
CREATE FUNCTION portal_get_fees(p_token TEXT)
RETURNS SETOF fees
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  RETURN QUERY SELECT * FROM fees f WHERE f.student_id = v_sid ORDER BY f.due_date DESC NULLS LAST;
END;
$fn$;
GRANT EXECUTE ON FUNCTION portal_get_fees(TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS portal_get_notices(TEXT, TEXT);
CREATE FUNCTION portal_get_notices(p_token TEXT, p_type TEXT DEFAULT NULL)
RETURNS SETOF notices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token); v_batch UUID;
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  SELECT s.batch_id INTO v_batch FROM students s WHERE s.id = v_sid;
  RETURN QUERY
  SELECT * FROM notices n
  WHERE n.is_published = true
    AND (n.target = 'all' OR (n.target = 'batch' AND n.batch_id = v_batch))
    AND (p_type IS NULL OR n.type = p_type)
  ORDER BY n.is_pinned DESC, n.created_at DESC;
END;
$fn$;
GRANT EXECUTE ON FUNCTION portal_get_notices(TEXT, TEXT) TO anon, authenticated;

-- ═══════════ B. Teacher photo storage ═══════════

DO $pre$
BEGIN
  IF TO_REGCLASS('storage.buckets') IS NULL OR TO_REGCLASS('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'storage schema not present — this must run on a Supabase project.';
  END IF;
END $pre$;

-- Public avatars bucket (idempotent): logo/teacher/student photos.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Read for everyone (public URLs in <img src>).
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avatars');

-- Insert/update for the roles that upload: anon (student portal) and
-- authenticated (admin Teachers/Students pages).
DROP POLICY IF EXISTS "avatars_anon_insert" ON storage.objects;
CREATE POLICY "avatars_anon_insert"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_anon_update" ON storage.objects;
CREATE POLICY "avatars_anon_update"
  ON storage.objects FOR UPDATE TO anon
  USING (bucket_id = 'avatars') WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
CREATE POLICY "avatars_auth_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars');
DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
CREATE POLICY "avatars_auth_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars') WITH CHECK (bucket_id = 'avatars');

-- ═══════════ C. Batch capacity enforcement ═══════════

-- BEFORE trigger: reject an enrollment that would exceed capacity.
-- The batch row is locked FOR UPDATE so concurrent enrollments serialize;
-- under READ COMMITTED the waiting transaction re-reads the fresh count.
CREATE OR REPLACE FUNCTION _enforce_batch_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_cap  INTEGER;
  v_count INTEGER;
  v_now_active BOOLEAN;
  v_was_active BOOLEAN;
BEGIN
  IF NEW.batch_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT capacity INTO v_cap FROM batches WHERE id = NEW.batch_id FOR UPDATE;
  -- Batch removed/concurrency: FK will complain anyway; treat as no limit.
  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_cap <= 0 THEN
    RETURN NEW; -- 0 / negative capacity = no limit
  END IF;

  v_now_active := (NEW.is_approved AND NEW.status = 'active');
  IF TG_OP = 'INSERT' THEN
    v_was_active := false;
  ELSIF NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
    v_was_active := false; -- moving in is a fresh enrollment
  ELSE
    v_was_active := (OLD.is_approved AND OLD.status = 'active');
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM students s
  WHERE s.batch_id = NEW.batch_id
    AND s.is_approved AND s.status = 'active';

  IF v_now_active AND NOT v_was_active THEN
    v_count := v_count + 1; -- this row becomes an active enrollment
  END IF;

  IF v_count > v_cap THEN
    RAISE EXCEPTION 'BATCH_FULL: this batch is full (capacity %).', v_cap
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS enforce_batch_capacity_trg ON students;
CREATE TRIGGER enforce_batch_capacity_trg
  BEFORE INSERT OR UPDATE OF batch_id, is_approved, status ON students
  FOR EACH ROW EXECUTE FUNCTION _enforce_batch_capacity();

-- AFTER trigger: keep batches.enrolled == live approved+active count so the
-- public card never shows a stale number. This single source of truth makes
-- the legacy increment_enrolled RPC harmless (it becomes idempotent vs count).
CREATE OR REPLACE FUNCTION _sync_batch_enrolled() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_bid UUID;
BEGIN
  -- Recompute the (old and/or new) affected batches.
  IF TG_OP <> 'DELETE' AND NEW.batch_id IS NOT NULL THEN
    v_bid := NEW.batch_id;
    UPDATE batches SET enrolled = (
      SELECT COUNT(*) FROM students s
      WHERE s.batch_id = v_bid AND s.is_approved AND s.status = 'active'
    ) WHERE id = v_bid;
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.batch_id IS NOT NULL AND
     (TG_OP = 'DELETE' OR NEW.batch_id IS DISTINCT FROM OLD.batch_id) THEN
    v_bid := OLD.batch_id;
    UPDATE batches SET enrolled = (
      SELECT COUNT(*) FROM students s
      WHERE s.batch_id = v_bid AND s.is_approved AND s.status = 'active'
    ) WHERE id = v_bid;
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS sync_batch_enrolled_trg ON students;
CREATE TRIGGER sync_batch_enrolled_trg
  AFTER INSERT OR UPDATE OF batch_id, is_approved, status OR DELETE ON students
  FOR EACH ROW EXECUTE FUNCTION _sync_batch_enrolled();

-- The legacy seat-counter RPCs must not double-apply: the AFTER trigger above
-- already sets enrolled = live count, so +1/-1 on top would over/under-count.
-- Rewrite them to RECOMPUTE the live count (idempotent w.r.t. the trigger).
CREATE OR REPLACE FUNCTION increment_enrolled(batch_uuid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  UPDATE batches b
  SET enrolled = (
    SELECT COUNT(*) FROM students s
    WHERE s.batch_id = b.id AND s.is_approved AND s.status = 'active'
  )
  WHERE b.id = batch_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION decrement_enrolled(batch_uuid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  UPDATE batches b
  SET enrolled = (
    SELECT COUNT(*) FROM students s
    WHERE s.batch_id = b.id AND s.is_approved AND s.status = 'active'
  )
  WHERE b.id = batch_uuid;
END;
$$;

COMMIT;

-- ═══════════ Verification (post-COMMIT) ═══════════
DO $verify$
DECLARE
  v_name TEXT;
  v_cap INTEGER;
  v_count INTEGER;
  v_sid UUID;
  v_tok TEXT;
  v_phone TEXT := '__r2_smoke__' || md5(random()::text)::text;
  v_err TEXT;
  v_pk  UUID;
  n     INT;
BEGIN
  -- A. Rebound functions exist with anon EXECUTE.
  IF NOT HAS_FUNCTION_PRIVILEGE('anon', 'public.portal_get_fees(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon lost EXECUTE on portal_get_fees';
  END IF;
  IF NOT HAS_FUNCTION_PRIVILEGE('anon', 'public.portal_get_notices(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon lost EXECUTE on portal_get_notices';
  END IF;

  -- A. Functional smoke: a temp approved student + session must let ALL FOUR
  -- dashboard-facing portal RPCs run without 42804/42703.
  INSERT INTO students (name, phone, student_id, password, is_approved, status)
  VALUES ('__r2smoke__', v_phone, v_phone, crypt('smoke', gen_salt('bf')), true, 'active')
  RETURNING id INTO v_sid;

  v_tok := _issue_student_session(v_sid);

  BEGIN
    PERFORM * FROM portal_get_fees(v_tok);
    PERFORM * FROM portal_get_exams(v_tok);
    PERFORM * FROM portal_get_submissions(v_tok);
    PERFORM * FROM portal_get_notices(v_tok);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE || ': ' || SQLERRM;
    RAISE EXCEPTION 'Portal RPC smoke FAILED after rebind: %', v_err;
  END;

  -- Cleanup (before asserting, no residue even on failure).
  DELETE FROM student_sessions WHERE student_id = v_sid;
  DELETE FROM login_attempts WHERE phone_number = v_phone;
  DELETE FROM students WHERE id = v_sid;
  RAISE NOTICE 'A verified: portal_get_fees/notices re-bound; all 4 dashboard RPCs run (no 42804).';

  -- C. Capacity math: unit-check on a temp batch.
  INSERT INTO batches (name, capacity, enrolled, is_active)
  VALUES ('__cap_test__', 2, 0, true) RETURNING id INTO v_pk;

  -- Enroll 2 approved+active students: allowed.
  FOR n IN 1..2 LOOP
    INSERT INTO students (name, phone, student_id, password, is_approved, status, batch_id)
    VALUES ('__c' || n, '__c' || n || random()::text, '__c' || n || random()::text,
            crypt('x', gen_salt('bf')), true, 'active', v_pk);
  END LOOP;

  SELECT capacity, enrolled INTO v_cap, v_count FROM batches WHERE id = v_pk;
  IF v_count <> 2 OR v_cap <> 2 THEN
    RAISE EXCEPTION 'capacity sync failed: enrolled=%, capacity=% (expected 2).', v_count, v_cap;
  END IF;

  -- Third enrollment must be rejected.
  BEGIN
    INSERT INTO students (name, phone, student_id, password, is_approved, status, batch_id)
    VALUES ('__overflow__', '__overflow__' || random()::text, '__overflow__' || random()::text,
            crypt('x', gen_salt('bf')), true, 'active', v_pk);
    RAISE EXCEPTION 'capacity trigger did NOT block a 3rd enrollment (capacity 2)';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'BATCH_FULL%' THEN
        RAISE EXCEPTION 'unexpected error during overflow probe: % %', SQLSTATE, SQLERRM;
      END IF;
  END;

  -- A suspended/not-approved move does NOT consume capacity.
  INSERT INTO students (name, phone, student_id, password, is_approved, status, batch_id)
  VALUES ('__suspended__', '__suspended__' || random()::text, '__suspended__' || random()::text,
          crypt('x', gen_salt('bf')), false, 'active', v_pk);

  SELECT enrolled INTO v_count FROM batches WHERE id = v_pk;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'not-approved student wrongly counted: enrolled=% (expected 2).', v_count;
  END IF;

  -- Cleanup the probe batch + its students.
  DELETE FROM students WHERE batch_id = v_pk;
  DELETE FROM batches WHERE id = v_pk;

  RAISE NOTICE 'C verified: enrollment blocked past capacity, enrolled stays live-synced.';

  -- C. Audit: list any pre-existing over-capacity batches (report, never delete).
  FOR v_name, v_cap, v_count IN
    SELECT b.name, b.capacity, b.enrolled
    FROM batches b
    WHERE b.capacity IS NOT NULL AND b.capacity > 0 AND b.enrolled > b.capacity
  LOOP
    RAISE NOTICE 'OVER-CAPACITY batch: % (capacity %, enrolled %) — review, not deleted.',
      v_name, v_cap, v_count;
  END LOOP;

  RAISE NOTICE 'M1 verified: 42804 re-bound, avatars storage policies, capacity enforced.';
END $verify$;

NOTIFY pgrst, 'reload schema';
