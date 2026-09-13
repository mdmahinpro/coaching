-- Hardened RLS for the backups table.
--
-- The legacy source file backup_rls_policies.sql used a broad
-- "Allow auth all backups" policy (FOR ALL TO authenticated USING (true)),
-- which does not survive the reviewed security model. Backups contain full
-- business snapshots (students, fees, payment records), so access must be
-- gated on is_admin() exactly like feedback, email_logs, and provider_secrets.
-- This migration runs after automated_backups.sql (which creates the table).

ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS backups_admin_all ON public.backups;
CREATE POLICY backups_admin_all ON public.backups
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());