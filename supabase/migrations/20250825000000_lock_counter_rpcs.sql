-- ============================================================
-- Lock down the enrolled-seat counter RPCs
-- Run ONCE in Supabase → SQL Editor, after
-- 20250824000000_security_hardening.sql has succeeded.
-- ============================================================
--
--   H6  increment_enrolled(UUID) and decrement_enrolled(UUID) were
--       EXECUTE-granted to `anon`. Both are SECURITY DEFINER, so they run
--       as the owner and bypass the RLS policies that otherwise stop an
--       anonymous caller from touching `batches`. Confirmed live: a bare
--       anon-key POST to /rest/v1/rpc/increment_enrolled moved a real
--       batch's `enrolled` from 18 to 19 (reverted immediately), while the
--       equivalent direct PATCH correctly affected zero rows.
--
--       Impact was integrity, not disclosure: an anonymous visitor could
--       inflate or deflate seat counts, which drive the "seats remaining"
--       display and the admission cut-off. No data was readable this way.
--
--       Both functions are called only from authenticated admin screens
--       (AdmissionsPage approval, StudentsPage create/edit/delete), so
--       `authenticated` is the correct audience. They are additionally
--       gated on is_admin() inside the body, since every authenticated
--       user is otherwise equal at the GRANT level and a signed-up
--       non-admin student account should not shift seat counts either.
--
--       The counters are also clamped at zero. `decrement_enrolled` had no
--       floor, so repeated calls could drive `enrolled` negative and make
--       "seats remaining" exceed max_seats.
-- ============================================================

BEGIN;

-- ── Assert both counters exist before changing anything ──────
-- Guarded on TO_REGPROCEDURE so a missing counter is reported rather than
-- silently skipped, leaving the operator thinking the lockdown ran.
DO $$
DECLARE
  fn    TEXT;
  found INT := 0;
BEGIN
  FOREACH fn IN ARRAY ARRAY['increment_enrolled(uuid)', 'decrement_enrolled(uuid)']
  LOOP
    IF TO_REGPROCEDURE('public.' || fn) IS NULL THEN
      RAISE NOTICE 'not present in this project: %', fn;
      CONTINUE;
    END IF;
    found := found + 1;
  END LOOP;

  RAISE NOTICE 'counter RPCs found: %', found;
  IF found = 0 THEN
    -- Fresh-install / clean-schema path: the legacy permissive counters were
    -- never created by any tracked migration (they existed only on the live
    -- project), so there is nothing to *de-escalate*. The DROP + CREATE below
    -- still defines both functions in their hardened is_admin()-gated form, so
    -- the final state is identical to a live lockdown. Do not fail a clean
    -- install; only warn so the operator knows no legacy grant needed revoking.
    RAISE WARNING
      'No legacy counter RPCs present (expected on a fresh install). Creating hardened increment_enrolled/decrement_enrolled below.';
  END IF;

  -- The new bodies call is_admin(); without it they would fail at runtime
  -- rather than at migration time, silently breaking both admin screens.
  IF TO_REGPROCEDURE('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION
      'is_admin() is missing. Run 20250824000000_security_hardening.sql first.';
  END IF;
END $$;

-- ── Re-define both with an is_admin() gate and a zero floor ──
-- DROP first rather than CREATE OR REPLACE: replace refuses to change an
-- input parameter name or return type, and these were authored outside the
-- numbered migrations, so neither is guaranteed. The grants that DROP
-- discards are re-stated explicitly below.
DROP FUNCTION IF EXISTS increment_enrolled(UUID);
DROP FUNCTION IF EXISTS decrement_enrolled(UUID);

CREATE FUNCTION increment_enrolled(batch_uuid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT COALESCE(is_admin(), false) THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  UPDATE batches
  SET enrolled = COALESCE(enrolled, 0) + 1
  WHERE id = batch_uuid;
END;
$$;

CREATE FUNCTION decrement_enrolled(batch_uuid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT COALESCE(is_admin(), false) THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  -- GREATEST clamps at zero: the counter is a cache of a row count and a
  -- negative value would render as more seats free than the batch has.
  UPDATE batches
  SET enrolled = GREATEST(COALESCE(enrolled, 0) - 1, 0)
  WHERE id = batch_uuid;
END;
$$;

-- DROP discarded the previous grants, so state the intended audience
-- explicitly. anon must not hold EXECUTE; the admin screens need
-- authenticated.
REVOKE ALL ON FUNCTION increment_enrolled(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION decrement_enrolled(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION increment_enrolled(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION decrement_enrolled(UUID) TO authenticated;

COMMIT;

-- ============================================================
-- Verification — runs after COMMIT so a failed assertion reports
-- loudly without rolling back work that already succeeded.
-- ============================================================
DO $$
DECLARE
  oid_inc oid := to_regprocedure('public.increment_enrolled(uuid)');
  oid_dec oid := to_regprocedure('public.decrement_enrolled(uuid)');
  missing TEXT[];
BEGIN
  -- Resolve both counters by exact schema-qualified signature and assert they
  -- exist. The OIDs obtained here are the authoritative handle for every
  -- privilege check below (never re-identified by name or by assuming the
  -- identity-arguments string equals 'uuid').
  missing := NULL;
  IF oid_inc IS NULL THEN
    missing := array_append(missing, 'public.increment_enrolled(uuid)');
  END IF;
  IF oid_dec IS NULL THEN
    missing := array_append(missing, 'public.decrement_enrolled(uuid)');
  END IF;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Counter RPC signature(s) missing: %', array_to_string(missing, ', ');
  END IF;

  -- 1. Neither counter may still be executable by anon or PUBLIC. PostgreSQL
  --    accepts lowercase 'public' as the pseudo-role argument to
  --    has_function_privilege (PG13+; explicitly in PG17).
  IF HAS_FUNCTION_PRIVILEGE('anon', oid_inc, 'EXECUTE')
     OR HAS_FUNCTION_PRIVILEGE('public', oid_inc, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon/public can still EXECUTE increment_enrolled';
  END IF;
  IF HAS_FUNCTION_PRIVILEGE('anon', oid_dec, 'EXECUTE')
     OR HAS_FUNCTION_PRIVILEGE('public', oid_dec, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon/public can still EXECUTE decrement_enrolled';
  END IF;

  -- 2. authenticated must retain EXECUTE, or the admin screens break.
  IF NOT HAS_FUNCTION_PRIVILEGE('authenticated', oid_inc, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated LOST EXECUTE on increment_enrolled';
  END IF;
  IF NOT HAS_FUNCTION_PRIVILEGE('authenticated', oid_dec, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated LOST EXECUTE on decrement_enrolled';
  END IF;

  -- 3. No batch may be left with a negative enrolled count.
  IF EXISTS (SELECT 1 FROM batches WHERE enrolled < 0) THEN
    RAISE EXCEPTION 'batches.enrolled is negative on % row(s)',
      (SELECT COUNT(*) FROM batches WHERE enrolled < 0);
  END IF;

  RAISE NOTICE 'H6 verified: counters are authenticated + is_admin() only, no negative counts.';
END $$;

NOTIFY pgrst, 'reload schema';
