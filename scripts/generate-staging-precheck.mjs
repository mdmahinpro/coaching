#!/usr/bin/env node
// Generate STAGING_PRECHECK.sql — a READ-ONLY preflight gate for STAGING_INSTALL.sql.
//
// Why the ledger needs dynamic SQL:
//   A static `SELECT count(*) FROM public.provisioning_migrations` raises 42P01
//   the moment that relation is absent, and PostgreSQL resolves a missing
//   relation at parse/plan time — even when the reference sits inside a CASE,
//   WHERE EXISTS, or other conditional. So the ledger (which is legitimately
//   ABSENT on a fresh disposable database) must be probed with guarded dynamic
//   SQL: only when to_regclass('public.provisioning_migrations') IS NOT NULL do
//   we EXECUTE the count/row SELECT. When it is absent we report
//   ledger_exists=false instead of erroring.
//
// Every other application-table check queries the SYSTEM CATALOG (pg_class,
// pg_proc, pg_policies, information_schema) — never the app tables themselves —
// so those checks are safe on a database with no application objects.
//
// The precheck is NON-MUTATING: it creates no tables, inserts no rows, drops
// nothing, and yields to nothing. It only reads the catalog and conditionally
// issues a read-only SELECT against the ledger when present.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outPath = path.join(root, 'staging', 'STAGING_PRECHECK.sql');

// Authoritative application tables inspected by the precheck. The ledger
// (provisioning_migrations) is listed so existence is reported, but it is
// handled separately because it legitimately does not exist on a fresh DB.
const appTables = [
  'students', 'teachers', 'batches', 'fees', 'exams', 'notices',
  'admission_requests', 'contact_messages', 'sms_logs',
  'mcq_questions', 'mcq_submissions', 'site_settings', 'fee_audit_logs',
  'notice_reads', 'payment_approvals', 'exam_tokens', 'student_sessions',
  'login_attempts', 'admin_users', 'feedback', 'email_logs',
  'provider_secrets', 'backups', 'database_keepalive',
];

// Distinct tables that carry business/tuple data for the live-tuples view
// (the ledger is excluded here; it is reported separately).
const tupleTables = appTables.filter((t) => t !== 'provisioning_migrations');

const appFunctionNames = [
  'exam_join', 'exam_get_questions', 'exam_submit', 'exam_get_review',
  'exam_get_leaderboard', 'portal_get_exams', 'portal_get_fees',
  'portal_get_submissions', 'portal_get_notices', 'admin_approve_payment',
  'admin_restore_backup', 'admin_create_backup_now',
];

const tableList = () => appTables.map((t) => `  '${t}'`).join(',\n');
const tupleList = () => tupleTables.map((t) => `  '${t}'`).join(',\n');
const functionList = () => appFunctionNames.map((f) => `  '${f}'`).join(',\n');

const block = [];
block.push('-- ============================================================================');
block.push('-- STAGING_PRECHECK.sql');
block.push('-- Target: temporary Supabase project hjzwbicauyxffrmdhvgy');
block.push('-- Source revision: 3df7c31b41192172476e7869071316347e1ec764 (branch fix/portal-rpc-verification)');
block.push('-- Purpose: READ-ONLY precheck. It only reads the catalog and conditionally runs');
block.push('--          a read-only SELECT against the migration ledger if the ledger exists.');
block.push('--          It makes NO schema, data, or policy changes. Run BEFORE STAGING_INSTALL.sql.');
block.push('--');
block.push('-- Dashboard SQL Editor compatible: no psql-only directives (\\echo etc.).');
block.push('--');
block.push('-- RESULT MEANINGS');
block.push('--   ledger_exists=false  AND  application_tables_found=0  AND  application_functions_found=0');
block.push('--       -> FRESH-INSTALL CANDIDATE. Run the installer.');
block.push('--   application_tables_found>0 OR application_functions_found>0 (even if rows=0)');
block.push('--       -> STOP FOR REVIEW. Application objects already exist; do not reset/drop anything.');
block.push('--   ledger_exists=true');
block.push('--       -> STOP FOR REVIEW. A migration ledger already exists. Inspect ledger_rows and the');
block.push('--          entries below; do NOT assume it matches the installer just because it exists.');
block.push('-- ============================================================================');
block.push('');

// Consolidated summary: every field here is catalog-safe. `ledger_exists` uses
// to_regclass() (a system catalog lookup) so it never fails on a missing table.
block.push('-- Consolidated summary (single row). ledger_exists is derived from the catalog,');
block.push('-- so this SELECT never touches provisioning_migrations and cannot raise 42P01.');
block.push('SELECT');
block.push('  \'precheck-summary\' AS check_name,');
block.push('  (');
block.push('    SELECT count(*) FROM (');
block.push('      SELECT c.relname');
block.push('        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace');
block.push('       WHERE n.nspname = \'public\' AND c.relname IN (');
block.push(tableList());
block.push('       )');
block.push('    ) x');
block.push('  ) AS application_tables_found,');
block.push('  (');
block.push('    SELECT count(*) FROM (');
block.push('      SELECT p.proname');
block.push('        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace');
block.push('       WHERE n.nspname = \'public\' AND p.prokind = \'f\' AND p.proname IN (');
block.push(functionList());
block.push('       )');
block.push('    ) z');
block.push('  ) AS application_functions_found,');
block.push('  to_regclass(\'public.provisioning_migrations\') IS NOT NULL AS ledger_exists;');
block.push('');

// STOP_GUIDANCE
block.push('-- Decision guide (single row, easy to interpret).');
block.push('SELECT \'DECISION\' AS outcome,');
block.push('       CASE');
block.push('         WHEN to_regclass(\'public.provisioning_migrations\') IS NOT NULL THEN \'STOP: an existing migration ledger was found. Inspect ledger rows/entries; do not assume it matches the installer.\'');
block.push('         WHEN EXISTS (');
block.push('           SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace');
block.push('            WHERE n.nspname = \'public\' AND c.relname IN (');
block.push(tableList());
block.push('           )');
block.push('         ) THEN \'STOP: application objects already exist (even if empty). Do not drop/reset; review first.\'');
block.push('         WHEN EXISTS (');
block.push('           SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace');
block.push('            WHERE n.nspname = \'public\' AND p.prokind = \'f\' AND p.proname IN (');
block.push(functionList());
block.push('           )');
block.push('         ) THEN \'STOP: application functions already exist. Do not install over them; review first.\'');
block.push('         ELSE \'GO: fresh-install candidate. Run STAGING_INSTALL.sql.\'');
block.push('       END AS guidance;');
block.push('');

// 1) Application tables present (catalog only).
block.push('-- 1) Application tables present (empty result = no application tables).');
block.push('SELECT c.relname            AS relation_name,');
block.push('       c.relkind            AS relation_kind,');
block.push('       pg_size_pretty(pg_total_relation_size(c.oid)) AS size');
block.push('  FROM pg_class c');
block.push('  JOIN pg_namespace n ON n.oid = c.relnamespace');
block.push(' WHERE n.nspname = \'public\'');
block.push('   AND c.relname IN (');
block.push(tableList());
block.push('   )');
block.push(' ORDER BY c.relname;');
block.push('');

// 2) Live tuples (catalog estimate; safe, never touches app tables directly).
block.push('-- 2) Application tables with estimated live tuples (informational).');
block.push('SELECT n.nspname, c.relname AS relation_name, c.reltuples::bigint AS live_tuples');
block.push('  FROM pg_class c');
block.push('  JOIN pg_namespace n ON n.oid = c.relnamespace');
block.push(' WHERE n.nspname = \'public\'');
block.push('   AND c.relkind = \'r\'');
block.push('   AND c.relname IN (');
block.push(tupleList());
block.push('   )');
block.push(' ORDER BY c.relname;');
block.push('');

// 3) Ledger — guarded dynamic SQL. This is the ONLY place the ledger relation
//    is referenced, and it is referenced from a PL/pgSQL string executed only
//    when to_regclass says the table exists.
block.push('-- 3) Migration ledger (guarded dynamic SQL: safe whether or not the table exists).');
block.push('DO $$');
block.push('DECLARE');
block.push('  v_ledger_exists BOOLEAN := to_regclass(\'public.provisioning_migrations\') IS NOT NULL;');
block.push('  v_rows INT;');
block.push('BEGIN');
block.push('  IF NOT v_ledger_exists THEN');
block.push('    RAISE NOTICE \'ledger_exists=false: provisioning_migrations is absent (expected on a fresh disposable DB). ledger_rows=0. Fresh-install candidate.\';');
block.push('  ELSE');
block.push('    -- The table exists; the dynamic string is compiled only now, so a live ledger');
block.push('    -- count/read is safe and the missing-relation failure mode is unreachable.');
block.push('    EXECUTE \'SELECT count(*) FROM public.provisioning_migrations\' INTO v_rows;');
block.push('    RAISE NOTICE \'ledger_exists=true: ledger_rows=%\', v_rows;');
block.push('  END IF;');
block.push('END');
block.push('$$;');
block.push('');

// 3b) Ledger rows (guarded dynamic query).
block.push('-- 3b) Existing migration ledger entries (guarded dynamic query; run only if the table exists).');
block.push('DO $$');
block.push('DECLARE');
block.push('  r RECORD;');
block.push('BEGIN');
block.push('  IF to_regclass(\'public.provisioning_migrations\') IS NOT NULL THEN');
block.push('    -- Table present: list its entries. The query text is compiled only here, so a');
block.push('    -- static reference (which would 42P01 when the table is absent) is never formed.');
block.push('    FOR r IN EXECUTE \'SELECT version, sha256, applied_at FROM public.provisioning_migrations ORDER BY version\' LOOP');
block.push('      RAISE NOTICE \'ledger row: % | sha256=% | applied_at=%\', r.version, r.sha256, r.applied_at;');
block.push('    END LOOP;');
block.push('  ELSE');
block.push('    RAISE NOTICE \'ledger_exists=false: no provisioning_migrations entries to list.\';');
block.push('  END IF;');
block.push('END');
block.push('$$;');
block.push('');

// 4) Application functions (catalog only).
block.push('-- 4) Existing application FUNCTIONS that would conflict (catalog only).');
block.push('SELECT p.proname AS function_name,');
block.push('       p.oid::regprocedure::text AS signature');
block.push('  FROM pg_proc p');
block.push('  JOIN pg_namespace n ON n.oid = p.pronamespace');
block.push(' WHERE n.nspname = \'public\'');
block.push('   AND p.prokind = \'f\'');
block.push('   AND p.proname IN (');
block.push(functionList());
block.push('   )');
block.push(' ORDER BY p.proname;');
block.push('');

// 5) RLS state (catalog only).
block.push('-- 5) RLS state on the intended application tables (catalog only).');
block.push('SELECT c.relname AS relation_name,');
block.push('       c.relrowsecurity AS rls_enabled,');
block.push('       c.relforcerowsecurity AS rls_forced');
block.push('  FROM pg_class c');
block.push('  JOIN pg_namespace n ON n.oid = c.relnamespace');
block.push(' WHERE n.nspname = \'public\'');
block.push('   AND c.relkind = \'r\'');
block.push('   AND c.relname IN (');
block.push(tableList());
block.push('   )');
block.push(' ORDER BY c.relname;');
block.push('');

// Reading guide
block.push('-- ============================================================================');
block.push('-- HOW TO READ THIS');
block.push('-- ============================================================================');
block.push('--  * GO condition: ledger_exists=false AND application_tables_found=0 AND');
block.push('--    application_functions_found=0.');
block.push('--  * STOP condition: any application table or application function already exists,');
block.push('--    even with zero rows.');
block.push('--  * ledger_exists=true always means STOP for review: inspect ledger_rows and the');
block.push('--    entries listed in step 3b. A present ledger is NOT proof it matches the');
block.push('--    installer (STAGING_INSTALL.sql writes canonical-baseline + 39 migrations, and');
block.push('--    the installer bundles sha256 hashes against its source files).');
block.push('--  * Auth/Storage platform objects are expected and are NOT application objects;');
block.push('--    their presence is not an application install.');
block.push('-- ============================================================================');

fs.mkdirSync(path.join(root, 'staging'), { recursive: true });
fs.writeFileSync(outPath, block.join('\n'), 'utf8');
console.log(`Wrote ${outPath}`);
console.log(`app_tables=${appTables.length} function_names=${appFunctionNames.length}`);