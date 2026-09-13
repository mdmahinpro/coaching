-- Admin-triggered automated backup verification.
-- Lets an administrator create and inspect a snapshot immediately without
-- waiting for the midnight pg_cron schedule.

CREATE OR REPLACE FUNCTION admin_create_backup_now()
RETURNS TABLE (
  id UUID,
  backup_date TIMESTAMPTZ,
  institute_name TEXT,
  record_count INTEGER,
  triggered_by TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  PERFORM create_automated_backup();

  RETURN QUERY
  SELECT b.id, b.backup_date, b.institute_name, b.record_count, b.triggered_by
  FROM backups b
  ORDER BY b.backup_date DESC
  LIMIT 1;
END;
$fn$;

REVOKE ALL ON FUNCTION admin_create_backup_now() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_create_backup_now() TO authenticated;
