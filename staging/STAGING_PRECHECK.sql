-- ============================================================================
-- STAGING_PRECHECK.sql
-- Target: temporary Supabase project hjzwbicauyxffrmdhvgy
-- Source revision: 3df7c31b41192172476e7869071316347e1ec764 (branch fix/portal-rpc-verification)
-- Purpose: READ-ONLY precheck. It only reads the catalog and conditionally runs
--          a read-only SELECT against the migration ledger if the ledger exists.
--          It makes NO schema, data, or policy changes. Run BEFORE STAGING_INSTALL.sql.
--
-- Dashboard SQL Editor compatible: no psql-only directives (\echo etc.).
--
-- RESULT MEANINGS
--   ledger_exists=false  AND  application_tables_found=0  AND  application_functions_found=0
--       -> FRESH-INSTALL CANDIDATE. Run the installer.
--   application_tables_found>0 OR application_functions_found>0 (even if rows=0)
--       -> STOP FOR REVIEW. Application objects already exist; do not reset/drop anything.
--   ledger_exists=true
--       -> STOP FOR REVIEW. A migration ledger already exists. Inspect ledger_rows and the
--          entries below; do NOT assume it matches the installer just because it exists.
-- ============================================================================

-- Consolidated summary (single row). ledger_exists is derived from the catalog,
-- so this SELECT never touches provisioning_migrations and cannot raise 42P01.
SELECT
  'precheck-summary' AS check_name,
  (
    SELECT count(*) FROM (
      SELECT c.relname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN (
  'students',
  'teachers',
  'batches',
  'fees',
  'exams',
  'notices',
  'admission_requests',
  'contact_messages',
  'sms_logs',
  'mcq_questions',
  'mcq_submissions',
  'site_settings',
  'fee_audit_logs',
  'notice_reads',
  'payment_approvals',
  'exam_tokens',
  'student_sessions',
  'login_attempts',
  'admin_users',
  'feedback',
  'email_logs',
  'provider_secrets',
  'backups',
  'database_keepalive',
  'public_form_rate_events',
  'messaging_configuration',
  'messaging_provider_credentials',
  'message_jobs',
  'message_deliveries',
  'message_attempts',
  'messaging_worker_heartbeat'
       )
    ) x
  ) AS application_tables_found,
  (
    SELECT count(*) FROM (
      SELECT p.proname
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname IN (
  'exam_join',
  'exam_get_questions',
  'exam_submit',
  'exam_get_review',
  'exam_get_leaderboard',
  'portal_get_exams',
  'portal_get_fees',
  'portal_get_submissions',
  'portal_get_notices',
  'admin_approve_payment',
  'admin_restore_backup',
  'admin_create_backup_now',
  'submit_public_form',
  'enqueue_message_job',
  'claim_message_deliveries',
  'claim_message_job_delivery',
  'save_messaging_configuration',
  'remove_messaging_configuration',
  'begin_non_idempotent_dispatch',
  'record_message_attempt',
  'refresh_message_job_aggregate'
       )
    ) z
  ) AS application_functions_found,
  to_regclass('public.provisioning_migrations') IS NOT NULL AS ledger_exists;

-- Decision guide (single row, easy to interpret).
SELECT 'DECISION' AS outcome,
       CASE
         WHEN to_regclass('public.provisioning_migrations') IS NOT NULL THEN 'STOP: an existing migration ledger was found. Inspect ledger rows/entries; do not assume it matches the installer.'
         WHEN EXISTS (
           SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname IN (
  'students',
  'teachers',
  'batches',
  'fees',
  'exams',
  'notices',
  'admission_requests',
  'contact_messages',
  'sms_logs',
  'mcq_questions',
  'mcq_submissions',
  'site_settings',
  'fee_audit_logs',
  'notice_reads',
  'payment_approvals',
  'exam_tokens',
  'student_sessions',
  'login_attempts',
  'admin_users',
  'feedback',
  'email_logs',
  'provider_secrets',
  'backups',
  'database_keepalive',
  'public_form_rate_events',
  'messaging_configuration',
  'messaging_provider_credentials',
  'message_jobs',
  'message_deliveries',
  'message_attempts',
  'messaging_worker_heartbeat'
           )
         ) THEN 'STOP: application objects already exist (even if empty). Do not drop/reset; review first.'
         WHEN EXISTS (
           SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname IN (
  'exam_join',
  'exam_get_questions',
  'exam_submit',
  'exam_get_review',
  'exam_get_leaderboard',
  'portal_get_exams',
  'portal_get_fees',
  'portal_get_submissions',
  'portal_get_notices',
  'admin_approve_payment',
  'admin_restore_backup',
  'admin_create_backup_now',
  'submit_public_form',
  'enqueue_message_job',
  'claim_message_deliveries',
  'claim_message_job_delivery',
  'save_messaging_configuration',
  'remove_messaging_configuration',
  'begin_non_idempotent_dispatch',
  'record_message_attempt',
  'refresh_message_job_aggregate'
           )
         ) THEN 'STOP: application functions already exist. Do not install over them; review first.'
         ELSE 'GO: fresh-install candidate. Run STAGING_INSTALL.sql.'
       END AS guidance;

-- 1) Application tables present (empty result = no application tables).
SELECT c.relname            AS relation_name,
       c.relkind            AS relation_kind,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN (
  'students',
  'teachers',
  'batches',
  'fees',
  'exams',
  'notices',
  'admission_requests',
  'contact_messages',
  'sms_logs',
  'mcq_questions',
  'mcq_submissions',
  'site_settings',
  'fee_audit_logs',
  'notice_reads',
  'payment_approvals',
  'exam_tokens',
  'student_sessions',
  'login_attempts',
  'admin_users',
  'feedback',
  'email_logs',
  'provider_secrets',
  'backups',
  'database_keepalive',
  'public_form_rate_events',
  'messaging_configuration',
  'messaging_provider_credentials',
  'message_jobs',
  'message_deliveries',
  'message_attempts',
  'messaging_worker_heartbeat'
   )
 ORDER BY c.relname;

-- 2) Application tables with estimated live tuples (informational).
SELECT n.nspname, c.relname AS relation_name, c.reltuples::bigint AS live_tuples
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   AND c.relname IN (
  'students',
  'teachers',
  'batches',
  'fees',
  'exams',
  'notices',
  'admission_requests',
  'contact_messages',
  'sms_logs',
  'mcq_questions',
  'mcq_submissions',
  'site_settings',
  'fee_audit_logs',
  'notice_reads',
  'payment_approvals',
  'exam_tokens',
  'student_sessions',
  'login_attempts',
  'admin_users',
  'feedback',
  'email_logs',
  'provider_secrets',
  'backups',
  'database_keepalive',
  'public_form_rate_events',
  'messaging_configuration',
  'messaging_provider_credentials',
  'message_jobs',
  'message_deliveries',
  'message_attempts',
  'messaging_worker_heartbeat'
   )
 ORDER BY c.relname;

-- 3) Migration ledger (guarded dynamic SQL: safe whether or not the table exists).
DO $$
DECLARE
  v_ledger_exists BOOLEAN := to_regclass('public.provisioning_migrations') IS NOT NULL;
  v_rows INT;
BEGIN
  IF NOT v_ledger_exists THEN
    RAISE NOTICE 'ledger_exists=false: provisioning_migrations is absent (expected on a fresh disposable DB). ledger_rows=0. Fresh-install candidate.';
  ELSE
    -- The table exists; the dynamic string is compiled only now, so a live ledger
    -- count/read is safe and the missing-relation failure mode is unreachable.
    EXECUTE 'SELECT count(*) FROM public.provisioning_migrations' INTO v_rows;
    RAISE NOTICE 'ledger_exists=true: ledger_rows=%', v_rows;
  END IF;
END
$$;

-- 3b) Existing migration ledger entries (guarded dynamic query; run only if the table exists).
DO $$
DECLARE
  r RECORD;
BEGIN
  IF to_regclass('public.provisioning_migrations') IS NOT NULL THEN
    -- Table present: list its entries. The query text is compiled only here, so a
    -- static reference (which would 42P01 when the table is absent) is never formed.
    FOR r IN EXECUTE 'SELECT version, sha256, applied_at FROM public.provisioning_migrations ORDER BY version' LOOP
      RAISE NOTICE 'ledger row: % | sha256=% | applied_at=%', r.version, r.sha256, r.applied_at;
    END LOOP;
  ELSE
    RAISE NOTICE 'ledger_exists=false: no provisioning_migrations entries to list.';
  END IF;
END
$$;

-- 4) Existing application FUNCTIONS that would conflict (catalog only).
SELECT p.proname AS function_name,
       p.oid::regprocedure::text AS signature
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.prokind = 'f'
   AND p.proname IN (
  'exam_join',
  'exam_get_questions',
  'exam_submit',
  'exam_get_review',
  'exam_get_leaderboard',
  'portal_get_exams',
  'portal_get_fees',
  'portal_get_submissions',
  'portal_get_notices',
  'admin_approve_payment',
  'admin_restore_backup',
  'admin_create_backup_now',
  'submit_public_form',
  'enqueue_message_job',
  'claim_message_deliveries',
  'claim_message_job_delivery',
  'save_messaging_configuration',
  'remove_messaging_configuration',
  'begin_non_idempotent_dispatch',
  'record_message_attempt',
  'refresh_message_job_aggregate'
   )
 ORDER BY p.proname;

-- 5) RLS state on the intended application tables (catalog only).
SELECT c.relname AS relation_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   AND c.relname IN (
  'students',
  'teachers',
  'batches',
  'fees',
  'exams',
  'notices',
  'admission_requests',
  'contact_messages',
  'sms_logs',
  'mcq_questions',
  'mcq_submissions',
  'site_settings',
  'fee_audit_logs',
  'notice_reads',
  'payment_approvals',
  'exam_tokens',
  'student_sessions',
  'login_attempts',
  'admin_users',
  'feedback',
  'email_logs',
  'provider_secrets',
  'backups',
  'database_keepalive',
  'public_form_rate_events',
  'messaging_configuration',
  'messaging_provider_credentials',
  'message_jobs',
  'message_deliveries',
  'message_attempts',
  'messaging_worker_heartbeat'
   )
 ORDER BY c.relname;

-- ============================================================================
-- HOW TO READ THIS
-- ============================================================================
--  * GO condition: ledger_exists=false AND application_tables_found=0 AND
--    application_functions_found=0.
--  * STOP condition: any application table or application function already exists,
--    even with zero rows.
--  * ledger_exists=true always means STOP for review: inspect ledger_rows and the
--    entries listed in step 3b. A present ledger is NOT proof it matches the
--    installer (STAGING_INSTALL.sql writes canonical-baseline + 39 migrations, and
--    the installer bundles sha256 hashes against its source files).
--  * Auth/Storage platform objects are expected and are NOT application objects;
--    their presence is not an application install.
-- ============================================================================