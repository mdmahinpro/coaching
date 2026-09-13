#!/usr/bin/env node
/**
 * Canonical separate-project customer provisioning entry point.
 *
 * Safe default: dry-run only. A real apply requires:
 *   PROVISION_APPLY=1
 *   CUSTOMER_DATABASE_URL (prefer a short-lived, explicitly assigned project URL)
 *   CUSTOMER_ID, CUSTOMER_NAME
 *
 * This command never selects migration.sql/update_rls_policies.sql or other
 * legacy permissive files. It does not create paid Supabase projects or billing
 * subscriptions; project creation/billing/domain choices remain external.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const reportDir = path.join(root, 'provisioning-reports');
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(4).toString('hex')}`;

// Ordered, safe migration chain. Legacy permissive SQL is intentionally absent.
const migrationFiles = [
  '20250816000000_update_student_auth.sql',
  '20250816000001_rate_limiting.sql',
  '20250817000000_support_tables.sql',
  '20250818000000_student_sessions.sql',
  '20250818000001_portal_rpcs.sql',
  '20250818000002_exam_rpcs.sql',
  '20250818000003_core_rls.sql',
  '20250820000000_restore_student_portal.sql',
  '20250824000000_security_hardening.sql',
  '20250825000000_lock_counter_rpcs.sql',
  '20250825000001_gate_exam_leaderboard.sql',
  '20250825000002_narrow_teacher_columns.sql',
  '20250825000003_fix_exam_join_ambiguity.sql',
  '20250825000004_fix_latent_ambiguity.sql',
  '20250827000001_batch_fixes.sql',
  '20250827000002_student_id.sql',
  '20250827000003_exam_batches.sql',
  '20250827000004_exam_penalty.sql',
  '20250829000001_security_controls.sql',
  '20250829000002_exam_auth_penalty.sql',
  '20250829000003_fix_portal_exams_42804.sql',
  '20250830000001_exam_batch_backfill.sql',
  '20250830000002_payment_approvals.sql',
  '20250830000004_admission_reference_gender.sql',
  '20250831000001_fix_default_password_login.sql',
  '20250831000002_batch_end_time.sql',
  '20250904000001_admin_safe_mutations.sql',
  'keep_alive_cron.sql',
  'automated_backups.sql',
  '20250905000001_backups_admin_rls.sql',
  '20250905000002_backup_coverage.sql',
  '20250905000003_backup_restore_coverage.sql',
  '20250905000004_admin_backup_now.sql',
  '20250905000005_feedback_email.sql',
  '20250905000006_provider_secrets.sql',
  '20250906000001_phase2_session_validation.sql',
  '20250906000002_atomic_admission_approval.sql',
  '20250906000003_phase2_payment_audit_atomic.sql',
  '20250907000001_exam_session_only_and_avatar_storage.sql',
  '20250909000001_postinstall_repairs.sql',
  '20250910000001_fee_audit_logs_admin_rls.sql',
];

const requiredTables = ['students', 'teachers', 'batches', 'fees', 'exams', 'notices', 'admission_requests', 'sms_logs', 'student_sessions', 'mcq_questions', 'mcq_submissions', 'payment_approvals', 'fee_audit_logs', 'feedback', 'email_logs', 'provider_secrets', 'backups'];
const requiredFunctions = ['is_admin', 'portal_validate_session', 'admin_delete_student', 'admin_restore_backup', 'admin_approve_admission', 'admin_approve_payment', 'admin_create_backup_now'];
const canonicalBaseline = 'supabase/schema/canonical.sql';

const customerId = process.env.CUSTOMER_ID?.trim();
const customerName = process.env.CUSTOMER_NAME?.trim();
const databaseUrl = process.env.CUSTOMER_DATABASE_URL?.trim();
const apply = process.env.PROVISION_APPLY === '1';

function redacted(value) {
  if (!value) return null;
  try { const u = new URL(value); return `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`; }
  catch { return '[configured]'; }
}

async function checksums() {
  const out = [];
  for (const file of migrationFiles) {
    const source = await fs.readFile(path.join(migrationsDir, file));
    out.push({ file, sha256: crypto.createHash('sha256').update(source).digest('hex') });
  }
  return out;
}

async function main() {
  const report = {
    run_id: runId, customer_id: customerId ?? null, customer_name: customerName ?? null,
    database: redacted(databaseUrl), mode: apply ? 'apply' : 'dry-run',
    migrations: [], verification: {}, handover: {}, errors: [], warnings: [], blockers: [],
  };

  if (!customerId || !customerName) report.errors.push('CUSTOMER_ID and CUSTOMER_NAME are required');
  if (migrationFiles.some((f) => f === 'migration.sql' || f === 'update_rls_policies.sql')) report.errors.push('Legacy permissive migration selected');
  try { await fs.access(path.join(root, canonicalBaseline)); }
  catch { report.blockers.push(`Canonical clean-database baseline is missing: ${canonicalBaseline}. Existing ordered migrations assume a pre-existing schema and cannot safely provision a new customer project.`); }
  if (apply && !databaseUrl) report.errors.push('CUSTOMER_DATABASE_URL is required when PROVISION_APPLY=1');

  const files = await checksums();
  report.migrations = files;
  if (report.errors.length || report.blockers.length || !apply) {
    report.warnings.push('Dry-run does not create projects, write SQL, invite administrators, configure domains, or create billing/subscriptions.');
    await writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.errors.length || report.blockers.length ? 1 : 0;
    return;
  }

  const { Client } = await import('pg').catch(() => ({ Client: null }));
  if (!Client) {
    report.errors.push('The apply path requires the pg package; install it only in the provisioning/operator environment, not the browser bundle.');
    await writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }
  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS provisioning_migrations (version TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), customer_id TEXT NOT NULL)`);
    for (const migration of files) {
      const existing = await client.query('SELECT sha256 FROM provisioning_migrations WHERE version=$1', [migration.file]);
      if (existing.rowCount && existing.rows[0].sha256 !== migration.sha256) throw new Error(`Migration checksum mismatch: ${migration.file}`);
      if (existing.rowCount) continue;
      const sql = await fs.readFile(path.join(migrationsDir, migration.file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO provisioning_migrations(version,sha256,customer_id) VALUES ($1,$2,$3)', [migration.file, migration.sha256, customerId]);
    }
    await client.query('COMMIT');

    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`, [requiredTables]);
    const functions = await client.query(`SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname = ANY($1)`, [requiredFunctions]);
    report.verification.tables = { required: requiredTables, found: tables.rows.map((r) => r.table_name), ok: tables.rowCount === requiredTables.length };
    report.verification.functions = { required: requiredFunctions, found: functions.rows.map((r) => r.name), ok: requiredFunctions.every((f) => functions.rows.some((r) => r.name === f)) };
    report.verification.empty_business_data = await emptyState(client);
    report.handover = { customer_id: customerId, customer_name: customerName, database_host: redacted(databaseUrl), status: 'provisioned_schema_only', next: 'Create/invite first admin and configure deployment/domain/provider secrets through approved control-plane operations.' };
    if (!report.verification.tables.ok || !report.verification.functions.ok) throw new Error('Required schema/RPC verification failed');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    report.errors.push(String(error?.message ?? error));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
  await writeReport(report);
  console.log(JSON.stringify(report, null, 2));
}

async function emptyState(client) {
  const business = ['students', 'teachers', 'batches', 'fees', 'exams', 'notices', 'admission_requests', 'feedback'];
  const counts = {};
  for (const table of business) counts[table] = Number((await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count);
  return { counts, empty: Object.values(counts).every((v) => v === 0) };
}

async function writeReport(report) {
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(path.join(reportDir, `${report.customer_id ?? 'unassigned'}-${report.run_id}.json`), JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error('Provisioning fatal:', error.message); process.exitCode = 1; });
