-- Automated backup system using pg_cron
-- This creates a table to store backup snapshots and schedules
-- daily automated backups of all application tables.

-- 1. Create the backups table
CREATE TABLE IF NOT EXISTS backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_date TIMESTAMPTZ DEFAULT NOW(),
    institute_name TEXT DEFAULT 'CoachingCenter',
    tables JSONB NOT NULL,
    record_count INT DEFAULT 0,
    triggered_by TEXT DEFAULT 'cron',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create an index on backup_date for efficient querying
CREATE INDEX IF NOT EXISTS idx_backups_date ON backups(backup_date);

-- 3. Create the backup function
CREATE OR REPLACE FUNCTION create_automated_backup()
RETURNS VOID AS $$
DECLARE
    payload JSONB;
    total_records INT := 0;
    institute_val TEXT;
BEGIN
    -- Get institute name
    SELECT value INTO institute_val
    FROM site_settings
    WHERE key = 'institute_name'
    LIMIT 1;

    IF institute_val IS NULL THEN
        institute_val := 'CoachingCenter';
    END IF;

    -- Build backup payload from all tables
    payload := jsonb_build_object(
        'backup_version', '1.0',
        'backup_date', NOW(),
        'institute', institute_val,
        'tables', jsonb_build_object(
            'site_settings', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM site_settings) t),
            'batches', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM batches) t),
            'teachers', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM teachers) t),
            'students', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM students) t),
            'fees', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM fees) t),
            'notices', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM notices) t),
            'exams', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM exams) t),
            'mcq_questions', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM mcq_questions) t),
            'mcq_submissions', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM mcq_submissions) t),
            'sms_logs', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM sms_logs) t),
            'admission_requests', (SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) FROM (SELECT * FROM admission_requests) t)
        )
    );

    -- Count total records
    SELECT COALESCE(SUM(jsonb_array_length(value)), 0) INTO total_records
    FROM jsonb_each(payload->'tables');

    -- Insert backup
    INSERT INTO backups (institute_name, tables, record_count, triggered_by)
    VALUES (institute_val, payload, total_records, 'cron');
END;
$$ LANGUAGE plpgsql;

-- 4. Schedule daily automated backup at midnight
SELECT cron.schedule(
    'daily-automated-backup',
    '0 0 * * *',
    $$ SELECT create_automated_backup(); $$
);
