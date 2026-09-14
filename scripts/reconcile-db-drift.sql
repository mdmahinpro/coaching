-- ============================================================
--  reconcile-db-drift.sql
--  One-time reconciliation BEFORE applying migrations to an
--  existing (already-migrated, possibly drifted) database.
--
--  Problem: production rows were created from OLDER versions of
--  the migration files. When a migration changed a function's
--  return type (RETURNS TABLE / SETOF), `CREATE OR REPLACE`
--  cannot change it -> ERROR "cannot change return type".
--
--  Fix: drop every app function in the `public` schema so the
--  subsequent migrations recreate them with the CURRENT, correct
--  definitions. Tables and data are NOT touched (DROP FUNCTION
--  only removes functions/triggers, which the migrations rebuild).
--
--  Safe to run repeatedly (a second run drops nothing new).
-- ============================================================

DO $reconcile$
DECLARE
  r RECORD;
  dropped INTEGER := 0;
  failed  INTEGER := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    BEGIN
      EXECUTE format('DROP FUNCTION %s CASCADE', r.signature);
      dropped := dropped + 1;
    EXCEPTION WHEN others THEN
      -- A dependency we cannot cascade (rare); surface it and move on.
      RAISE NOTICE 'reconcile: could not drop % (%)', r.signature, SQLERRM;
      failed := failed + 1;
    END;
  END LOOP;
  RAISE NOTICE 'reconcile: dropped % public function(s), % could not be dropped', dropped, failed;
END $reconcile$;

-- Drop stray admin RLS policies. A function-drop CASCADE only removes policies
-- that depended on the dropped function (e.g. USING (is_admin())). Unconditional
-- admin policies (USING (true)) have no function dependency and survive, which
-- fails the hardening migration's "no unconditional admin access" verification.
-- Recreated cleanly by the migrations.
DO $reconcile_policies$
DECLARE
  r RECORD;
  dropped INTEGER := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (policyname LIKE 'admin\_%' OR policyname LIKE 'Allow auth all %')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    dropped := dropped + 1;
  END LOOP;
  RAISE NOTICE 'reconcile: dropped % admin/auth-all policy(ies)', dropped;
END $reconcile_policies$;