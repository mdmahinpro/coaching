-- Backup payload redaction and historical snapshot scrub.
-- Optional operational migration: apply only after automated_backups.sql and
-- 20250905000001..000004. It keeps portable business/audit data while ensuring
-- credentials, authentication tokens, and provider internals are never retained.

BEGIN;

-- Recursively remove secret-shaped object keys from JSON values. Table-specific
-- exclusions below also handle fields whose names are not intrinsically secret.
CREATE OR REPLACE FUNCTION public._backup_redact_json(p_value JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT CASE jsonb_typeof(p_value)
    WHEN 'object' THEN COALESCE(
      (
        SELECT jsonb_object_agg(e.key, public._backup_redact_json(e.value))
        FROM jsonb_each(p_value) AS e
        WHERE lower(e.key) !~ '(^|_)(password|passwd|password_hash|default_password|api_key|apikey|secret|token|access_token|refresh_token|authorization|provider_response)(_|$)'
      ),
      '{}'::jsonb
    )
    WHEN 'array' THEN COALESCE(
      (
        SELECT jsonb_agg(public._backup_redact_json(a.value) ORDER BY a.ordinality)
        FROM jsonb_array_elements(p_value) WITH ORDINALITY AS a(value, ordinality)
      ),
      '[]'::jsonb
    )
    ELSE p_value
  END
$fn$;

CREATE OR REPLACE FUNCTION public._backup_sanitize_tables(p_tables JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT public._backup_redact_json(
    ((CASE WHEN jsonb_typeof(p_tables) = 'object' THEN p_tables ELSE '{}'::jsonb END)
      - 'provider_secrets'
      - 'messaging_provider_credentials'
      - 'student_sessions'
      - 'exam_tokens'
      - 'admin_users')
    || CASE
      WHEN jsonb_typeof(p_tables -> 'students') = 'array' THEN
        jsonb_build_object(
          'students',
          (SELECT COALESCE(jsonb_agg(s.row - 'password' - 'password_hash'), '[]'::jsonb)
           FROM jsonb_array_elements(p_tables -> 'students') AS s(row))
        )
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN jsonb_typeof(p_tables -> 'admission_requests') = 'array' THEN
        jsonb_build_object(
          'admission_requests',
          (SELECT COALESCE(jsonb_agg(a.row - 'reference_no' - 'default_password'), '[]'::jsonb)
           FROM jsonb_array_elements(p_tables -> 'admission_requests') AS a(row))
        )
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN jsonb_typeof(p_tables -> 'sms_logs') = 'array' THEN
        jsonb_build_object(
          'sms_logs',
          (SELECT COALESCE(jsonb_agg(l.row - 'response' - 'provider_response'), '[]'::jsonb)
           FROM jsonb_array_elements(p_tables -> 'sms_logs') AS l(row))
        )
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN jsonb_typeof(p_tables -> 'email_logs') = 'array' THEN
        jsonb_build_object(
          'email_logs',
          (SELECT COALESCE(jsonb_agg(l.row - 'response' - 'provider_response'), '[]'::jsonb)
           FROM jsonb_array_elements(p_tables -> 'email_logs') AS l(row))
        )
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN jsonb_typeof(p_tables -> 'site_settings') = 'array' THEN
        jsonb_build_object(
          'site_settings',
          (SELECT COALESCE(jsonb_agg(s.row), '[]'::jsonb)
           FROM jsonb_array_elements(p_tables -> 'site_settings') AS s(row)
           WHERE COALESCE(s.row ->> 'key', '') !~* '(password|passwd|api[_-]?key|secret|token|authorization|credential)')
        )
      ELSE '{}'::jsonb
    END
  )
$fn$;

-- Accept both historical formats: a tables object, or the legacy envelope that
-- nested the table object under a top-level "tables" key.
CREATE OR REPLACE FUNCTION public._backup_sanitize_payload(p_payload JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT CASE
    WHEN jsonb_typeof(p_payload -> 'tables') = 'object' THEN
      p_payload || jsonb_build_object(
        'tables', public._backup_sanitize_tables(p_payload -> 'tables')
      )
    ELSE public._backup_sanitize_tables(p_payload)
  END
$fn$;

CREATE OR REPLACE FUNCTION public.create_automated_backup()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  tables_payload JSONB;
  total_records INTEGER := 0;
  institute_val TEXT;
BEGIN
  SELECT value INTO institute_val
  FROM public.site_settings
  WHERE key = 'institute_name'
  LIMIT 1;

  institute_val := COALESCE(institute_val, 'CoachingCenter');

  -- Deliberately omit ephemeral/session tables and provider_secrets. Explicit
  -- subtraction prevents known sensitive columns from entering the snapshot;
  -- the sanitizer is defense in depth for nested/future secret-shaped fields.
  tables_payload := public._backup_sanitize_tables(jsonb_build_object(
    'site_settings', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.site_settings AS t),
    'batches', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.batches AS t),
    'teachers', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.teachers AS t),
    'students', (SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'password' - 'password_hash'), '[]'::jsonb) FROM public.students AS t),
    'fees', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fees AS t),
    'payment_approvals', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.payment_approvals AS t),
    'fee_audit_logs', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fee_audit_logs AS t),
    'notices', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notices AS t),
    'exams', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.exams AS t),
    'mcq_questions', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.mcq_questions AS t),
    'mcq_submissions', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.mcq_submissions AS t),
    'sms_logs', (SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'response' - 'provider_response'), '[]'::jsonb) FROM public.sms_logs AS t),
    'admission_requests', (SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'reference_no' - 'default_password'), '[]'::jsonb) FROM public.admission_requests AS t)
  ));

  SELECT COALESCE(SUM(jsonb_array_length(value)), 0)
  INTO total_records
  FROM jsonb_each(tables_payload)
  WHERE jsonb_typeof(value) = 'array';

  INSERT INTO public.backups (institute_name, tables, record_count, triggered_by)
  VALUES (institute_val, tables_payload, total_records, 'cron');
END;
$fn$;

-- Destructively remove forbidden fields from snapshots already stored in the
-- operational backup table, preserving all remaining business/audit fields.
WITH sanitized AS (
  SELECT b.id, public._backup_sanitize_payload(b.tables) AS payload
  FROM public.backups AS b
), recounted AS (
  SELECT
    s.id,
    s.payload,
    COALESCE((
      SELECT SUM(jsonb_array_length(e.value))
      FROM jsonb_each(
        CASE WHEN jsonb_typeof(s.payload -> 'tables') = 'object'
          THEN s.payload -> 'tables'
          ELSE s.payload
        END
      ) AS e
      WHERE jsonb_typeof(e.value) = 'array'
    ), 0)::INTEGER AS record_count
  FROM sanitized AS s
)
UPDATE public.backups AS b
SET tables = r.payload,
    record_count = r.record_count
FROM recounted AS r
WHERE b.id = r.id
  AND (b.tables IS DISTINCT FROM r.payload OR b.record_count IS DISTINCT FROM r.record_count);

-- Reassert admin-only table access even if a legacy broad policy still exists.
ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow auth all backups" ON public.backups;
DROP POLICY IF EXISTS backups_admin_all ON public.backups;
CREATE POLICY backups_admin_all ON public.backups
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON TABLE public.backups FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.backups TO authenticated;

REVOKE ALL ON FUNCTION public._backup_redact_json(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._backup_sanitize_tables(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._backup_sanitize_payload(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_automated_backup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_automated_backup() TO service_role;

COMMIT;
