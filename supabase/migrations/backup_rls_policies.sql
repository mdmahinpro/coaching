-- RLS policies for the backups table
-- Only authenticated admin users should be able to read backups.

ALTER TABLE backups ENABLE ROW LEVEL SECURITY;

-- Admins (authenticated via Supabase Auth): full access
DROP POLICY IF EXISTS "Allow auth all backups" ON backups;
CREATE POLICY "Allow auth all backups"
  ON backups FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- No anon/public access — backup data should not be exposed without auth
