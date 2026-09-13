-- ============================================================
--  fee_audit_logs: restore admin-write + admin-read RLS
-- ============================================================
-- `fee_audit_logs` was created out of band (support-tables migration 20250817
-- deliberately omitted policies: "security migrations apply the reviewed final
-- access model later"), but the hardening migration 20250824000000 (H2c) never
-- added it to its is_admin()-gated loop, which only covered the 12 core tables
-- plus the session/token tables. The result: the table is RLS-enabled with no
-- usable policy for the `authenticated` role.
--
-- Symptom (verified on the disposable target):
--   authenticated  INSERT  -> 42501 "new row violates row-level security policy"
--   -> the admin "Record Payment" UI marks the fee paid but silently fails to
--      write its mandatory `payment_recorded` audit entry (logFeeAudit swallows
--      the error), and the Audit Log tab cannot fetch entries.
--
-- Fix: apply the exact canonical policy every other core table gets, gated by
-- is_admin(). Admins keep full CRUD (record payment audit + audit tab read +
-- e2e cleanup); anon / non-admin users remain fully denied.

ALTER TABLE public.fee_audit_logs ENABLE ROW LEVEL SECURITY;

-- Remove any legacy permissive all-authenticated policy first so behavior is
-- deterministic regardless of what the out-of-band schema left behind.
DROP POLICY IF EXISTS "Allow auth all fee_audit_logs" ON public.fee_audit_logs;
DROP POLICY IF EXISTS "admin_all_fee_audit_logs"     ON public.fee_audit_logs;
DROP POLICY IF EXISTS "admin_read_fee_audit_logs"    ON public.fee_audit_logs;

CREATE POLICY "admin_all_fee_audit_logs"
  ON public.fee_audit_logs
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Deny anonymous/public table access to the financial audit trail.
REVOKE ALL ON public.fee_audit_logs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fee_audit_logs TO authenticated;