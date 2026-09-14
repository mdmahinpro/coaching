-- Consolidated, read-only staging verification. Run after STAGING_INSTALL.sql.
-- This file intentionally contains no psql meta-commands and performs no writes.

DO $verify$
DECLARE
  missing_tables text[];
  missing_functions text[];
  rls_disabled text[];
  fence_definition text;
BEGIN
  SELECT array_agg(required.name ORDER BY required.name)
  INTO missing_tables
  FROM (VALUES
    ('students'), ('teachers'), ('batches'), ('fees'), ('exams'),
    ('notices'), ('admission_requests'), ('student_sessions'),
    ('mcq_questions'), ('mcq_submissions'), ('payment_approvals'),
    ('fee_audit_logs'), ('feedback'), ('email_logs'), ('provider_secrets'),
    ('messaging_configuration'), ('messaging_provider_credentials'),
    ('message_jobs'), ('message_deliveries'),
    ('message_attempts'), ('messaging_worker_heartbeat')
  ) AS required(name)
  WHERE to_regclass('public.' || required.name) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Missing required tables: %', missing_tables;
  END IF;

  SELECT array_agg(required.name ORDER BY required.name)
  INTO missing_functions
  FROM (VALUES
    ('is_admin'), ('portal_validate_session'), ('admin_delete_student'),
    ('admin_approve_admission'), ('admin_approve_payment'),
    ('enqueue_message_job'), ('claim_message_deliveries'),
    ('claim_message_job_delivery'), ('save_messaging_configuration'),
    ('remove_messaging_configuration'), ('begin_non_idempotent_dispatch'),
    ('record_message_attempt'), ('refresh_message_job_aggregate')
  ) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = required.name
  );

  IF missing_functions IS NOT NULL THEN
    RAISE EXCEPTION 'Missing required functions: %', missing_functions;
  END IF;

  SELECT array_agg(c.relname ORDER BY c.relname)
  INTO rls_disabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname = ANY (ARRAY[
      'students', 'teachers', 'batches', 'fees', 'exams', 'notices',
      'admission_requests', 'student_sessions', 'mcq_questions',
      'mcq_submissions', 'payment_approvals', 'fee_audit_logs',
      'feedback', 'email_logs', 'provider_secrets', 'messaging_configuration',
      'messaging_provider_credentials', 'message_jobs', 'message_deliveries', 'message_attempts',
      'messaging_worker_heartbeat'
    ])
    AND NOT c.relrowsecurity;

  IF rls_disabled IS NOT NULL THEN
    RAISE EXCEPTION 'RLS is disabled on required tables: %', rls_disabled;
  END IF;

  SELECT pg_get_functiondef(to_regprocedure('public.begin_non_idempotent_dispatch(uuid,text)'))
  INTO fence_definition;
  IF fence_definition IS NULL
     OR fence_definition NOT LIKE '%v_provider_name = ''mim''%'
     OR fence_definition NOT LIKE '%v_provider_name = ''custom'' AND v_idempotency_placement = ''none''%'
     OR fence_definition NOT LIKE '%v_delivery.locked_by IS DISTINCT FROM p_worker_id%'
     OR fence_definition NOT LIKE '%v_delivery.locked_at < now() - make_interval(secs => v_lease_seconds)%'
     OR fence_definition NOT LIKE '%status = ''dispatching''::public.message_delivery_status%'
     OR fence_definition NOT LIKE '%status = ''requires_review''::public.message_job_status%'
     OR fence_definition NOT LIKE '%status IN (''unknown'', ''dispatching'')%'
  THEN
    RAISE EXCEPTION 'Non-idempotent dispatch fence does not match the verified MIM/custom-none contract';
  END IF;
END
$verify$;

SELECT
  count(*) FILTER (WHERE version = 'supabase/schema/canonical.sql') AS baseline_rows,
  count(*) AS ledger_rows
FROM public.provisioning_migrations;
