-- Automated backup coverage hardening
-- Apply after automated_backups.sql. This replaces the backup function while
-- preserving the existing backups table and cron job.

CREATE OR REPLACE FUNCTION create_automated_backup()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    tables_payload JSONB;
    total_records INTEGER := 0;
    institute_val TEXT;
BEGIN
    SELECT value INTO institute_val
    FROM site_settings
    WHERE key = 'institute_name'
    LIMIT 1;

    institute_val := COALESCE(institute_val, 'CoachingCenter');

    -- Durable business and audit data only. Session tokens, exam tokens,
    -- admin roster, password hashes, and provider secrets are intentionally
    -- excluded from portable backups for security.
    tables_payload := jsonb_build_object(
        'site_settings', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM site_settings) t),
        'batches', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM batches) t),
        'teachers', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM teachers) t),
        'students', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM students) t),
        'fees', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM fees) t),
        'payment_approvals', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM payment_approvals) t),
        'fee_audit_logs', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM fee_audit_logs) t),
        'notices', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM notices) t),
        'exams', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM exams) t),
        'mcq_questions', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM mcq_questions) t),
        'mcq_submissions', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM mcq_submissions) t),
        'sms_logs', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM sms_logs) t),
        'admission_requests', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM admission_requests) t)
    );

    SELECT COALESCE(SUM(jsonb_array_length(value)), 0)
    INTO total_records
    FROM jsonb_each(tables_payload);

    INSERT INTO backups (institute_name, tables, record_count, triggered_by)
    VALUES (institute_val, tables_payload, total_records, 'cron');
END;
$$;

REVOKE ALL ON FUNCTION create_automated_backup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_automated_backup() TO service_role;

-- Replace the named schedule safely when this migration is re-run.
DO $$
DECLARE
    existing_job_id BIGINT;
BEGIN
    SELECT jobid INTO existing_job_id
    FROM cron.job
    WHERE jobname = 'daily-automated-backup'
    LIMIT 1;

    IF existing_job_id IS NOT NULL THEN
        PERFORM cron.unschedule(existing_job_id);
    END IF;

    PERFORM cron.schedule(
        'daily-automated-backup',
        '0 0 * * *',
        $cron$ SELECT create_automated_backup(); $cron$
    );
END;
$$;
