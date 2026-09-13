-- STAGING_VERIFY_CONSOLIDATED.sql
-- Intended project: hjzwbicauyxffrmdhvgy. Select it in the Dashboard yourself.
-- A project-name constant and current_database() DO NOT authenticate project identity.
-- Run this WHOLE file in one new Supabase SQL Editor query as the project owner.
-- ONE SELECT, ONE result table: section / status / details (JSON).
-- No installation, repair, policy changes, Auth operations, fixture writes,
-- backup creation, cron execution, permanent or temporary helper objects.
-- Only PostgreSQL catalog functions and guarded SELECTs are invoked.
-- query_to_xml + XMLTABLE permit SELECTs against optional tables without static
-- references that would error at parse time when an object is missing.
-- Requires PostgreSQL XML support (standard Supabase PostgreSQL builds).
-- EXISTS may read rows internally; no application row values are returned.
-- Raw function bodies, policy expressions/defaults and cron commands are NOT printed.
-- POLICY_METADATA_NEEDS_REVIEW and SOURCE_MARKERS_ONLY are NOT security passes.
-- Role checks are read-only: this script never assumes a student identity.
-- Execute permissions and RLS presence are not behavioral authorization tests.
-- Upload's expected names/columns/signatures are a checklist, not a full schema spec.
-- No expected constraint definitions or full approved checksum manifest were supplied.
-- Ledger comparison below uses 40 expected names and TWO hashes explicitly
-- reported from the current database; other hashes are displayed, not certified.
-- A missing bucket is SETUP_PENDING, not a reason to rerun the installer.
-- Stop on an error; never drop/recreate schema to make verification pass.

WITH
expected_tables(name) AS (VALUES ('students'),('teachers'),('batches'),('fees'),('exams'),('notices'),('admission_requests'),('contact_messages'),('sms_logs'),('mcq_questions'),('mcq_submissions'),('site_settings'),('fee_audit_logs'),('notice_reads'),('payment_approvals'),('exam_tokens'),('student_sessions'),('login_attempts'),('admin_users'),('feedback'),('email_logs'),('provider_secrets'),('backups'),('database_keepalive')),
expected_columns(table_name,column_name) AS (VALUES ('students','id'),
('students','student_id'),
('students','status'),
('students','is_approved'),
('students','password'),
('students','phone'),
('students','batch_id'),
('teachers','id'),
('teachers','name'),
('teachers','photo_url'),
('batches','id'),
('batches','enrolled'),
('batches','capacity'),
('batches','code'),
('batches','end_time'),
('batches','teacher_id'),
('fees','id'),
('fees','status'),
('fees','student_id'),
('exams','id'),
('exams','strict_mode'),
('exams','batch_ids'),
('exams','exam_date'),
('notices','id'),
('notices','is_published'),
('notices','target'),
('admission_requests','id'),
('admission_requests','status'),
('admission_requests','gender'),
('admission_requests','reference_no'),
('contact_messages','id'),
('sms_logs','id'),
('sms_logs','phone'),
('sms_logs','message'),
('mcq_questions','id'),
('mcq_questions','correct_option'),
('mcq_submissions','id'),
('mcq_submissions','answers'),
('mcq_submissions','score'),
('mcq_submissions','raw_score'),
('mcq_submissions','penalty_marks'),
('mcq_submissions','red_cards'),
('site_settings','id'),
('site_settings','key'),
('site_settings','value'),
('fee_audit_logs','id'),
('fee_audit_logs','action'),
('notice_reads','notice_id'),
('notice_reads','student_id'),
('notice_reads','read_at'),
('admin_users','user_id'),
('admin_users','email'),
('payment_approvals','id'),
('payment_approvals','status'),
('payment_approvals','reviewed_by'),
('payment_approvals','reviewed_at'),
('feedback','id'),
('feedback','rating'),
('email_logs','id'),
('email_logs','status'),
('provider_secrets','provider'),
('provider_secrets','api_key'),
('backups','id'),
('backups','tables'),
('backups','record_count'),
('exam_tokens','token'),
('exam_tokens','expires_at'),
('student_sessions','token'),
('student_sessions','expires_at'),
('login_attempts','id'),
('login_attempts','phone_number'),
('database_keepalive','id'),
('database_keepalive','created_at')),
expected_rpcs(signature) AS (VALUES ('verify_student_login(text,text)'),
('logout_student_session(text)'),
('portal_validate_session(text)'),
('portal_get_profile(text)'),
('portal_get_fees(text)'),
('portal_get_exams(text)'),
('portal_get_submissions(text)'),
('portal_get_notices(text,text)'),
('portal_update_photo(text,text)'),
('portal_change_password(text,text,text)'),
('portal_update_email(text,text)'),
('portal_mark_notice_read(text,uuid)'),
('portal_get_notice_reads(text)'),
('exam_get_meta(uuid)'),
('exam_join(uuid,text)'),
('exam_get_questions(text)'),
('exam_submit(text,jsonb,integer,integer)'),
('exam_get_my_submission(text)'),
('exam_get_leaderboard(uuid,text,text)'),
('exam_get_review(uuid,text,text)'),
('is_admin()'),
('admin_self_check()'),
('admin_approve_admission(uuid,text,text)'),
('admin_delete_student(uuid)'),
('admin_restore_backup(jsonb)'),
('admin_create_backup_now()'),
('admin_approve_payment(uuid)'),
('admin_reject_payment(uuid)'),
('create_automated_backup()'),
('portal_get_avatar_path(text)'),
('admin_get_avatar_path(uuid)')),
expected_versions(version) AS (VALUES ('canonical-baseline'),
('20250816000000_update_student_auth.sql'),
('20250816000001_rate_limiting.sql'),
('20250817000000_support_tables.sql'),
('20250818000000_student_sessions.sql'),
('20250818000001_portal_rpcs.sql'),
('20250818000002_exam_rpcs.sql'),
('20250818000003_core_rls.sql'),
('20250820000000_restore_student_portal.sql'),
('20250824000000_security_hardening.sql'),
('20250825000000_lock_counter_rpcs.sql'),
('20250825000001_gate_exam_leaderboard.sql'),
('20250825000002_narrow_teacher_columns.sql'),
('20250825000003_fix_exam_join_ambiguity.sql'),
('20250825000004_fix_latent_ambiguity.sql'),
('20250827000001_batch_fixes.sql'),
('20250827000002_student_id.sql'),
('20250827000003_exam_batches.sql'),
('20250827000004_exam_penalty.sql'),
('20250829000001_security_controls.sql'),
('20250829000002_exam_auth_penalty.sql'),
('20250829000003_fix_portal_exams_42804.sql'),
('20250830000001_exam_batch_backfill.sql'),
('20250830000002_payment_approvals.sql'),
('20250830000004_admission_reference_gender.sql'),
('20250831000001_fix_default_password_login.sql'),
('20250831000002_batch_end_time.sql'),
('20250904000001_admin_safe_mutations.sql'),
('keep_alive_cron.sql'),
('automated_backups.sql'),
('20250905000001_backups_admin_rls.sql'),
('20250905000002_backup_coverage.sql'),
('20250905000003_backup_restore_coverage.sql'),
('20250905000004_admin_backup_now.sql'),
('20250905000005_feedback_email.sql'),
('20250905000006_provider_secrets.sql'),
('20250906000001_phase2_session_validation.sql'),
('20250906000002_atomic_admission_approval.sql'),
('20250906000003_phase2_payment_audit_atomic.sql'),
('20250907000001_exam_session_only_and_avatar_storage.sql'),
('20250909000001_postinstall_repairs.sql')),
operator_role AS (
 SELECT oid,rolsuper,rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user
),
roles AS (
 SELECT
 (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='anon') AS anon_oid,
 (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='authenticated') AS auth_oid,
 (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role') AS svc_oid
),
app_tables AS (
 SELECT e.name,c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity
 FROM expected_tables e
 LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
 LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.name
),
column_checks AS (
 SELECT e.table_name,e.column_name,
 a.attnum IS NOT NULL AS present,
 CASE WHEN a.attnum IS NOT NULL THEN pg_catalog.format_type(a.atttypid,a.atttypmod) END AS actual_type,
 a.attnotnull AS not_null
 FROM expected_columns e
 LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
 LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.table_name AND c.relkind IN ('r','p')
 LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=e.column_name AND a.attnum>0 AND NOT a.attisdropped
),
rpcs AS (
 SELECT e.signature,p.oid,p.prosecdef AS security_definer,
 CASE WHEN p.oid IS NOT NULL THEN pg_catalog.has_function_privilege('public',p.oid,'EXECUTE') END AS public_exec,
 CASE WHEN p.oid IS NOT NULL AND r.anon_oid IS NOT NULL THEN pg_catalog.has_function_privilege(r.anon_oid,p.oid,'EXECUTE') END AS anon_exec,
 CASE WHEN p.oid IS NOT NULL AND r.auth_oid IS NOT NULL THEN pg_catalog.has_function_privilege(r.auth_oid,p.oid,'EXECUTE') END AS authenticated_exec,
 CASE WHEN p.oid IS NOT NULL AND r.svc_oid IS NOT NULL THEN pg_catalog.has_function_privilege(r.svc_oid,p.oid,'EXECUTE') END AS service_role_exec
 FROM expected_rpcs e CROSS JOIN roles r
 LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure('public.'||e.signature)
),
unsafe_rpcs(signature) AS (VALUES ('exam_join(uuid,text,text)'),('exam_get_leaderboard(uuid)'),('exam_submit(text,jsonb,integer)')),
unsafe_checks AS (
 SELECT signature,pg_catalog.to_regprocedure('public.'||signature) IS NOT NULL AS present FROM unsafe_rpcs
),
helper_checks AS (
 SELECT p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
 pg_catalog.has_function_privilege('public',p.oid,'EXECUTE') AS public_exec,
 CASE WHEN r.anon_oid IS NOT NULL THEN pg_catalog.has_function_privilege(r.anon_oid,p.oid,'EXECUTE') END AS anon_exec,
 CASE WHEN r.auth_oid IS NOT NULL THEN pg_catalog.has_function_privilege(r.auth_oid,p.oid,'EXECUTE') END AS authenticated_exec
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace CROSS JOIN roles r
 WHERE n.nspname='public' AND p.prokind='f'
 AND p.proname IN ('_student_id_from_token','_issue_student_session','_exam_token_resolve','_exam_token_issue','_exam_gate')
),
policy_metadata AS (
 SELECT schemaname,tablename,policyname,permissive,cmd,roles,
 qual IS NOT NULL AS has_using_expression,with_check IS NOT NULL AS has_check_expression,
 pg_catalog.md5(COALESCE(qual,'')) AS using_expression_md5,
 pg_catalog.md5(COALESCE(with_check,'')) AS check_expression_md5,
 COALESCE(qual ~* 'is_admin',false) OR COALESCE(with_check ~* 'is_admin',false) AS contains_admin_marker,
 regexp_replace(COALESCE(qual,''),'[[:space:]()]','','g')='true' AS using_literal_true,
 regexp_replace(COALESCE(with_check,''),'[[:space:]()]','','g')='true' AS check_literal_true
 FROM pg_catalog.pg_policies
 WHERE schemaname='public' OR (schemaname='storage' AND tablename='objects')
),
counter_names(signature) AS (VALUES ('increment_enrolled(uuid)'),('decrement_enrolled(uuid)')),
counters AS (
 SELECT e.signature,p.oid IS NOT NULL AS present,
 CASE WHEN p.oid IS NOT NULL THEN p.prosrc ~* 'coalesce[[:space:]]*\([[:space:]]*(public[.])?is_admin[[:space:]]*\([[:space:]]*\)[[:space:]]*,[[:space:]]*false[[:space:]]*\)' END AS coalesce_false_marker,
 CASE WHEN p.oid IS NOT NULL THEN p.prosrc ~* 'from[[:space:]]+(public[.])?students' END AS students_query_marker,
 CASE WHEN p.oid IS NOT NULL THEN pg_catalog.has_function_privilege('public',p.oid,'EXECUTE') END AS public_exec,
 CASE WHEN p.oid IS NOT NULL AND r.anon_oid IS NOT NULL THEN pg_catalog.has_function_privilege(r.anon_oid,p.oid,'EXECUTE') END AS anon_exec,
 CASE WHEN p.oid IS NOT NULL AND r.auth_oid IS NOT NULL THEN pg_catalog.has_function_privilege(r.auth_oid,p.oid,'EXECUTE') END AS authenticated_exec
 FROM counter_names e CROSS JOIN roles r
 LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure('public.'||e.signature)
),
trigger_checks AS (
 SELECT t.tgname AS trigger_name,c.relname AS table_name,t.tgenabled,
 fn.nspname AS function_schema,p.proname AS function_name
 FROM pg_catalog.pg_trigger t
 JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
 JOIN pg_catalog.pg_namespace fn ON fn.oid=p.pronamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal
 AND t.tgname IN ('enforce_batch_capacity_trg','sync_batch_enrolled_trg')
),
constraint_inventory AS (
 SELECT c.relname AS table_name,con.conname AS constraint_name,con.contype,con.convalidated,
 CASE WHEN con.confrelid<>0 THEN con.confrelid::regclass::text END AS referenced_table
 FROM pg_catalog.pg_constraint con
 JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN expected_tables e ON e.name=c.relname
 WHERE n.nspname='public'
),
-- These are fixed, locally authored SELECTs. No user-provided SQL is executed.
read_specs(key,schema_name,table_name,required_columns,read_sql) AS (
 VALUES ('rows:students','public','students',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."students"))::text AS payload'),
('rows:teachers','public','teachers',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."teachers"))::text AS payload'),
('rows:batches','public','batches',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."batches"))::text AS payload'),
('rows:fees','public','fees',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."fees"))::text AS payload'),
('rows:exams','public','exams',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."exams"))::text AS payload'),
('rows:notices','public','notices',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."notices"))::text AS payload'),
('rows:admission_requests','public','admission_requests',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."admission_requests"))::text AS payload'),
('rows:contact_messages','public','contact_messages',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."contact_messages"))::text AS payload'),
('rows:sms_logs','public','sms_logs',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."sms_logs"))::text AS payload'),
('rows:mcq_questions','public','mcq_questions',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."mcq_questions"))::text AS payload'),
('rows:mcq_submissions','public','mcq_submissions',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."mcq_submissions"))::text AS payload'),
('rows:site_settings','public','site_settings',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."site_settings"))::text AS payload'),
('rows:fee_audit_logs','public','fee_audit_logs',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."fee_audit_logs"))::text AS payload'),
('rows:notice_reads','public','notice_reads',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."notice_reads"))::text AS payload'),
('rows:payment_approvals','public','payment_approvals',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."payment_approvals"))::text AS payload'),
('rows:exam_tokens','public','exam_tokens',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."exam_tokens"))::text AS payload'),
('rows:student_sessions','public','student_sessions',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."student_sessions"))::text AS payload'),
('rows:login_attempts','public','login_attempts',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."login_attempts"))::text AS payload'),
('rows:admin_users','public','admin_users',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."admin_users"))::text AS payload'),
('rows:feedback','public','feedback',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."feedback"))::text AS payload'),
('rows:email_logs','public','email_logs',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."email_logs"))::text AS payload'),
('rows:provider_secrets','public','provider_secrets',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."provider_secrets"))::text AS payload'),
('rows:backups','public','backups',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."backups"))::text AS payload'),
('rows:database_keepalive','public','database_keepalive',ARRAY[]::text[],'SELECT jsonb_build_object(''has_rows'', EXISTS (SELECT 1 FROM public."database_keepalive"))::text AS payload'),
('ledger','public','provisioning_migrations',ARRAY['version','sha256']::text[],'SELECT COALESCE(jsonb_agg(jsonb_build_object(''version'',version,''sha256'',sha256) ORDER BY version),''[]''::jsonb)::text AS payload FROM public.provisioning_migrations'),
('avatars','storage','buckets',ARRAY['id','public','file_size_limit','allowed_mime_types']::text[],'SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'',id,''public'',public,''file_size_limit'',file_size_limit,''allowed_mime_types'',allowed_mime_types)),''[]''::jsonb)::text AS payload FROM storage.buckets WHERE id=''avatars'''),
('cron','cron','job',ARRAY['jobid','jobname','schedule','active','database','username','command']::text[],'SELECT COALESCE(jsonb_agg(jsonb_build_object(''jobid'',jobid,''jobname'',jobname,''schedule'',schedule,''active'',active,''database'',database,''username'',username,''command_present'',COALESCE(length(command)>0,false),''references_original_project'',COALESCE(position(''flbvusudwszxdylxevfe'' IN command)>0,false),''contains_http_text'',COALESCE(command ~* ''https?://'',false),''references_expected_project'',COALESCE(position(''hjzwbicauyxffrmdhvgy'' IN command)>0,false)) ORDER BY jobid),''[]''::jsonb)::text AS payload FROM cron.job')
),
read_checks AS (
 SELECT s.*,
 CASE
 WHEN c.oid IS NULL THEN 'OBJECT_MISSING'
 WHEN c.relkind NOT IN ('r','p') THEN 'UNEXPECTED_RELATION_KIND'
 WHEN EXISTS (SELECT 1 FROM unnest(s.required_columns) AS rc(name)
   WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid=c.oid AND a.attname=rc.name AND a.attnum>0 AND NOT a.attisdropped)) THEN 'COLUMN_MISSING'
 WHEN NOT pg_catalog.has_table_privilege(c.oid,'SELECT') THEN 'ACCESS_DENIED'
 WHEN c.relrowsecurity AND NOT (me.rolsuper OR me.rolbypassrls OR (c.relowner=me.oid AND NOT c.relforcerowsecurity)) THEN 'RLS_VISIBILITY_UNVERIFIED'
 ELSE 'READY' END AS read_status
 FROM read_specs s
 LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=s.schema_name
 LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=s.table_name
 CROSS JOIN operator_role me
),
read_results AS MATERIALIZED (
 SELECT s.key,s.table_name,s.read_status,x.payload::jsonb AS payload
 FROM read_checks s
 CROSS JOIN XMLTABLE('/table/row'
   PASSING pg_catalog.query_to_xml(
     CASE WHEN s.read_status='READY' THEN s.read_sql ELSE 'SELECT ''null''::text AS payload' END,
     false,false,'')
   COLUMNS payload text PATH 'payload'
 ) AS x
),
ledger_rows AS (
 SELECT item->>'version' AS version,item->>'sha256' AS sha256
 FROM read_results r CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(r.payload)='array' THEN r.payload ELSE '[]'::jsonb END) AS a(item)
 WHERE r.key='ledger'
),
ledger_checks AS (
 SELECT COALESCE(e.version,l.version) AS version,l.sha256,
 CASE WHEN e.version IS NULL THEN 'UNEXPECTED_VERSION'
 WHEN l.version IS NULL THEN 'MISSING_VERSION'
 WHEN e.version='20250825000000_lock_counter_rpcs.sql'
   AND lower(l.sha256)='cdf67da2aab602c4a8702106dbcabe318284b25e0269b7777ca144697895f841'
   THEN 'MATCHES_REPORTED_INSTALLED_HASH_VERIFICATION_ONLY_SOURCE_CHANGE_REPORTED'
 WHEN e.version='20250829000001_security_controls.sql'
   AND lower(l.sha256)='49d0faaf7c47733d46384a27902e0cd8dc6e5afbf5b8d55364f23d9110c46537'
   THEN 'MATCHES_REPORTED_INSTALLED_HASH'
 WHEN e.version IN ('20250825000000_lock_counter_rpcs.sql','20250829000001_security_controls.sql')
   THEN 'DIFFERS_FROM_REPORTED_INSTALLED_HASH'
 ELSE 'VERSION_PRESENT_HASH_NOT_INDEPENDENTLY_VERIFIED' END AS comparison
 FROM expected_versions e FULL JOIN ledger_rows l ON l.version=e.version
),
section_results(section,status,details) AS (
 SELECT '00_summary','CATALOG_REPORT_NOT_RELEASE_SIGNOFF',jsonb_build_object(
   'intended_project','hjzwbicauyxffrmdhvgy',
   'project_identity_verified_by_this_script',false,
   'database',current_database(),'database_role',current_user,
   'expected_tables',24,'tables_found',(SELECT count(*) FROM app_tables WHERE relkind IN ('r','p')),
   'missing_tables',(SELECT COALESCE(jsonb_agg(name),'[]'::jsonb) FROM app_tables WHERE oid IS NULL),
   'missing_columns',(SELECT count(*) FROM column_checks WHERE NOT present),
   'missing_expected_rpcs',(SELECT count(*) FROM rpcs WHERE oid IS NULL),
   'obsolete_overloads_present',(SELECT count(*) FROM unsafe_checks WHERE present),
   'tables_with_rls_disabled',(SELECT COALESCE(jsonb_agg(name),'[]'::jsonb) FROM app_tables WHERE relkind IN ('r','p') AND NOT relrowsecurity),
   'ledger_read_status',(SELECT read_status FROM read_results WHERE key='ledger'),
    'expected_ledger_entries',41,'observed_ledger_entries',(SELECT count(*) FROM ledger_rows),
   'storage_server_code','NOT_TESTED','auth_setup','NOT_TESTED','workflows','NOT_TESTED',
   'note','Do not rerun installer based on this report. Source-marker checks and grants are not behavioral security proof.'
 )
 UNION ALL
 SELECT '01_tables_and_rls',
 CASE WHEN EXISTS(SELECT 1 FROM app_tables WHERE oid IS NULL OR relkind NOT IN ('r','p') OR NOT relrowsecurity) THEN 'MISSING_OR_RLS_REVIEW' ELSE 'CATALOG_CHECKS_PRESENT' END,
 (SELECT jsonb_agg(jsonb_build_object('table',name,'exists',oid IS NOT NULL,'kind',relkind,'rls_enabled',relrowsecurity,'force_rls',relforcerowsecurity) ORDER BY name) FROM app_tables)
 UNION ALL
 SELECT '02_required_columns',CASE WHEN EXISTS(SELECT 1 FROM column_checks WHERE NOT present) THEN 'MISSING_COLUMNS' ELSE 'LISTED_COLUMNS_PRESENT_TYPES_NEED_SPEC_REVIEW' END,
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name,column_name) FROM column_checks c)
 UNION ALL
 SELECT '03_rpc_signatures_and_grants',CASE WHEN EXISTS(SELECT 1 FROM rpcs WHERE oid IS NULL) THEN 'MISSING_RPCS' ELSE 'REVIEW_EFFECTIVE_GRANTS' END,
 (SELECT jsonb_agg((to_jsonb(r)-'oid')||jsonb_build_object('deployed',oid IS NOT NULL) ORDER BY signature) FROM rpcs r)
 UNION ALL
 SELECT '04_obsolete_overloads',CASE WHEN EXISTS(SELECT 1 FROM unsafe_checks WHERE present) THEN 'UNSAFE_OVERLOAD_PRESENT' ELSE 'LISTED_OBSOLETE_OVERLOADS_ABSENT' END,
 (SELECT jsonb_agg(to_jsonb(u) ORDER BY signature) FROM unsafe_checks u)
 UNION ALL
 SELECT '05_internal_helper_grants',CASE WHEN EXISTS(SELECT 1 FROM helper_checks WHERE public_exec OR anon_exec OR authenticated_exec) THEN 'EXPOSED_HELPER_REVIEW' ELSE 'NO_EXPOSED_MATCHING_HELPER_FOUND' END,
 jsonb_build_object('functions',COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM helper_checks h),'[]'::jsonb),'note','An empty list does not prove all required helpers exist.')
 UNION ALL
 SELECT '06_policy_metadata','MANUAL_POLICY_REVIEW_REQUIRED',jsonb_build_object(
 'policies',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM policy_metadata p),'[]'::jsonb),
 'note','Raw expressions redacted. Markers do not prove authorization. Inspect actual expressions locally and perform negative tests; public content policies may be intentional.')
 UNION ALL
 SELECT '07_counter_markers_and_triggers','SOURCE_MARKERS_AND_METADATA_ONLY',jsonb_build_object(
 'counters',(SELECT jsonb_agg(to_jsonb(c) ORDER BY signature) FROM counters c),
 'seat_triggers',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM trigger_checks t),'[]'::jsonb),
 'exam_join_authentication_required_marker',(SELECT position('AUTHENTICATION_REQUIRED' IN prosrc)>0 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.exam_join(uuid,text)')),
 'note','A source substring does not establish executable authorization or trigger correctness; missing markers require inspection, not automatic rewriting.')
 UNION ALL
 SELECT '08_avatar_bucket',
 CASE WHEN r.read_status<>'READY' THEN r.read_status
 WHEN jsonb_array_length(r.payload)=0 THEN 'SETUP_PENDING'
 WHEN (r.payload->0->>'public')::boolean THEN 'PUBLIC_BUCKET_REQUIRES_REVIEW'
 WHEN (r.payload->0->>'file_size_limit')::bigint IS DISTINCT FROM 2097152 THEN 'BUCKET_LIMIT_NOT_2_MIB'
 WHEN NOT (COALESCE(r.payload->0->'allowed_mime_types','null'::jsonb) @> '["image/jpeg","image/png","image/webp"]'::jsonb
 AND COALESCE(r.payload->0->'allowed_mime_types','null'::jsonb) <@ '["image/jpeg","image/png","image/webp"]'::jsonb) THEN 'BUCKET_MIME_CONFIGURATION_REVIEW'
 ELSE 'BUCKET_CONFIG_MATCHES_SERVER_AND_ACCESS_TESTS_PENDING' END,
 jsonb_build_object('read_status',r.read_status,'bucket',r.payload,'expected_max_bytes',2097152,
 'server_upload_limit_and_content_validation','NOT_TESTED','authorized_retrieval','NOT_TESTED',
 'note','Private bucket configuration alone does not certify ownership or access policies.')
 FROM read_results r WHERE r.key='avatars'
 UNION ALL
 SELECT '09_cron_redacted',
 CASE WHEN r.read_status<>'READY' THEN r.read_status
 WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(r.payload) AS a(j) WHERE (j->>'references_original_project')::boolean) THEN 'ORIGINAL_PROJECT_REFERENCE_FOUND'
 ELSE 'TARGET_AND_JOB_BEHAVIOR_NOT_CERTIFIED' END,
 jsonb_build_object('read_status',r.read_status,'jobs',r.payload,
 'expected_names','["daily-heartbeat","daily-automated-backup"]'::jsonb,
 'note','All visible jobs listed. Absence of a literal original-project ID does not prove safe targeting. Wrappers and dynamic URLs need separate inspection. No jobs executed.')
 FROM read_results r WHERE r.key='cron'
 UNION ALL
 SELECT '10_data_presence','EXACT_EXISTS_NOT_ROW_CONTENTS',
 (SELECT jsonb_agg(jsonb_build_object('table',r.table_name,'read_status',r.read_status,
 'has_rows',CASE WHEN r.read_status='READY' THEN r.payload->'has_rows' ELSE 'null'::jsonb END,
 'is_empty',CASE WHEN r.read_status='READY' THEN NOT (r.payload->>'has_rows')::boolean END) ORDER BY r.table_name)
 FROM read_results r WHERE r.key LIKE 'rows:%')
 UNION ALL
 SELECT '11_ledger',
 CASE WHEN r.read_status<>'READY' THEN r.read_status
 WHEN EXISTS(SELECT 1 FROM ledger_checks WHERE comparison IN ('MISSING_VERSION','UNEXPECTED_VERSION','DIFFERS_FROM_REPORTED_INSTALLED_HASH')) THEN 'LEDGER_DIFFERENCES_REVIEW'
  WHEN (SELECT count(*) FROM ledger_rows)<>41 THEN 'LEDGER_ROW_COUNT_REVIEW'
 ELSE 'EXPECTED_VERSIONS_PRESENT_FULL_HASH_CERTIFICATION_NOT_PERFORMED' END,
 jsonb_build_object('read_status',r.read_status,'observed_rows',(SELECT count(*) FROM ledger_rows),
 'entries',(SELECT jsonb_agg(to_jsonb(l) ORDER BY version) FROM ledger_checks l),
 'note','Recorded hashes are historical evidence, not execution/security proof. Preserve cdf67da2; its verification-only source difference was reported by your agent, not independently reconstructed here.')
 FROM read_results r WHERE r.key='ledger'
 UNION ALL
 SELECT '12_constraints','INVENTORY_NOT_FULL_SPEC_COMPARISON',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name,constraint_name) FROM constraint_inventory c),'[]'::jsonb)
 UNION ALL
 SELECT '13_remaining_stages','NOT_VERIFIED_BY_THIS_SCRIPT',jsonb_build_object(
 'policy_semantics_and_negative_authorization_tests','PENDING',
 'avatar_server_upload_and_private_retrieval','PENDING',
 'synthetic_auth_admin_and_roster_login','PENDING',
 'exam_recovery_payments_profile_notices_logout','PENDING',
 'backup_restore_drill','PENDING',
 'deployment_and_provider_checks','PENDING',
 'production_release_approved',false)
)
SELECT section,status,details
FROM section_results
ORDER BY section;