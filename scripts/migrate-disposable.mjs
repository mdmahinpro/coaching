#!/usr/bin/env node
/**
 * Parameterized migration runner. Safe default is preflight only.
 *
 * Required for every invocation:
 *   TARGET_PROJECT_REF=hjzwbicauyxffrmdhvgy
 *   TARGET_DATABASE_PROJECT_REF=hjzwbicauyxffrmdhvgy
 *   TARGET_DATABASE_URL=postgres://...        (only needed for apply)
 *
 * Apply additionally requires MIGRATION_APPLY=1. This runner has no fallback
 * target and never prints connection strings or passwords.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const expectedProject = 'hjzwbicauyxffrmdhvgy';
const migrationDir = path.join(root, 'supabase', 'migrations');
const baseline = path.join(root, 'supabase', 'schema', 'canonical.sql');
const manifestPath = path.join(root, 'supabase', 'schema', 'migration-manifest.json');
const appObjects = [
  'students', 'teachers', 'batches', 'fees', 'exams', 'notices',
  'admission_requests', 'contact_messages', 'sms_logs',
];
const privateTables = [
  'students', 'fees', 'exams', 'mcq_questions', 'mcq_submissions',
  'student_sessions', 'exam_tokens', 'provider_secrets',
];

function fail(message) {
  console.error(`BLOCKED: ${message}`);
  process.exitCode = 2;
}

function parseAndVerifyTarget(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const hostname = parsed.hostname.toLowerCase();
  const username = decodeURIComponent(parsed.username);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  const directHost = `db.${expectedProject}.supabase.co`;
  const poolerHost = 'aws-0-ap-northeast-1.pooler.supabase.com';
  const expectedUser = `postgres.${expectedProject}`;
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('database URI must use postgres/postgresql');
  if (hostname !== directHost && hostname !== poolerHost) throw new Error('database host does not exactly identify the authorized project');
  if ((parsed.port || '5432') !== '5432') throw new Error('database port does not match the approved destination');
  if (database !== 'postgres') throw new Error('database name does not match the approved destination');
  if (username !== expectedUser) throw new Error('database login username does not match the approved project');
  return { hostname, port: parsed.port || '5432', database, loginUsername: username };
}

async function verifyDatabaseIdentity(client, parsedTarget) {
  const result = await client.query("SELECT current_database() AS database, current_user AS current_user, session_user AS session_user, current_setting('server_version') AS server_version, current_setting('transaction_read_only') AS transaction_read_only");
  const row = result.rows[0];
  if (row.database !== 'postgres') throw new Error('current_database did not match the approved destination');
  if (row.current_user !== 'postgres') throw new Error('current_user did not match the expected SQL role postgres');
  if (row.session_user !== 'postgres') throw new Error('session_user did not match the expected SQL role postgres');
  if (row.transaction_read_only !== 'on') throw new Error('read-only transaction verification failed');
  return { ...parsedTarget, currentUser: row.current_user, sessionUser: row.session_user, serverVersion: row.server_version };
}

async function inspectEmptyDestination(client) {
  const result = await client.query(
    `SELECT c.relname AS object_name, c.relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
      ORDER BY c.relname`,
    [appObjects]
  );
  if (result.rows.length) {
    throw new Error(`destination has conflicting application objects: ${result.rows.map((row) => row.object_name).join(', ')}`);
  }
}

function stripTransactionWrappers(sql) {
  return sql.replace(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/gim, '');
}

function safeSqlContext(sql, position) {
  if (!position) return 'statement position unavailable';
  const start = Math.max(0, Number(position) - 120);
  return sql
    .slice(start, Number(position) + 120)
    .replace(/'(?:''|[^'])*'/g, '[literal]')
    .replace(/--[^\r\n]*/g, '-- [comment]')
    .replace(/\s+/g, ' ')
    .slice(0, 260);
}

function verifyManifestOrder(files) {
  const index = new Map(files.map((file, i) => [file, i]));
  const dependencies = [
    ['20250817000000_support_tables.sql', '20250818000002_exam_rpcs.sql'],
    ['20250817000000_support_tables.sql', '20250825000001_gate_exam_leaderboard.sql'],
    ['20250830000001_exam_batch_backfill.sql', '20250830000002_payment_approvals.sql'],
    ['20250830000002_payment_approvals.sql', '20250906000003_phase2_payment_audit_atomic.sql'],
  ];
  for (const [dependency, consumer] of dependencies) {
    if (!index.has(dependency) || !index.has(consumer)) {
      throw new Error(`manifest is missing required dependency pair: ${dependency} -> ${consumer}`);
    }
    if (index.get(dependency) >= index.get(consumer)) {
      throw new Error(`migration order invalid: ${dependency} must run before ${consumer}`);
    }
  }
  if (new Set(files).size !== files.length) throw new Error('migration manifest contains duplicate filenames');
}

async function executeMigration(client, file, sql) {
  const source = stripTransactionWrappers(sql);
  try {
    await client.query(source);
  } catch (error) {
    const detail = {
      file,
      code: error?.code ?? 'unknown',
      position: error?.position ? Number(error.position) : null,
      context: safeSqlContext(source, error?.position),
      message: error?.message ?? 'migration statement failed',
    };
    throw new Error(JSON.stringify(detail));
  }
}

async function lockPrivateTables(client) {
  for (const table of privateTables) {
    await client.query(`DO $lock$ BEGIN IF to_regclass('public.${table}') IS NOT NULL THEN REVOKE ALL ON TABLE public.${table} FROM anon; END IF; END $lock$;`);
  }
}

async function main() {
  const target = process.env.TARGET_PROJECT_REF?.trim();
  const mapped = process.env.TARGET_DATABASE_PROJECT_REF?.trim();
  const supabaseUrl = process.env.TARGET_SUPABASE_URL?.trim();
  const databaseUrl = process.env.TARGET_DATABASE_URL?.trim();
  const apply = process.env.MIGRATION_APPLY === '1';

  if (target !== expectedProject) return fail(`TARGET_PROJECT_REF must equal ${expectedProject}`);
  if (mapped !== expectedProject) return fail(`TARGET_DATABASE_PROJECT_REF must equal ${expectedProject}`);
  if (supabaseUrl !== `https://${expectedProject}.supabase.co`) return fail(`TARGET_SUPABASE_URL must equal https://${expectedProject}.supabase.co`);
  if (apply && !databaseUrl) return fail('TARGET_DATABASE_URL is required only when MIGRATION_APPLY=1');
  if (await fs.access(baseline).then(() => false).catch(() => true)) {
    return fail(`canonical baseline is missing: ${path.relative(root, baseline)}`);
  }

  const migrationManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const requiredMigrations = migrationManifest.migrations.map((entry) => entry.file);
  verifyManifestOrder(requiredMigrations);
  const manifest = [];
  for (const file of requiredMigrations) {
    const source = await fs.readFile(path.join(migrationDir, file));
    manifest.push({ file, sha256: crypto.createHash('sha256').update(source).digest('hex') });
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply-requested' : 'preflight-only',
    target_project_ref: expectedProject,
    baseline: path.relative(root, baseline),
    manifest: path.relative(root, manifestPath),
    migrations: manifest,
    writes_performed: false,
  }, null, 2));

  if (!apply) return;
  const { Client } = await import('pg').catch(() => ({ Client: null }));
  if (!Client) return fail('pg package is required in the operator environment');

  let parsedTarget;
  try {
    parsedTarget = parseAndVerifyTarget(databaseUrl);
  } catch (error) {
    return fail(String(error?.message ?? error));
  }
  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: true } });
  let transactionStarted = false;
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const identity = await verifyDatabaseIdentity(client, parsedTarget);
    await inspectEmptyDestination(client);
    await client.query('ROLLBACK');
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query('CREATE TABLE IF NOT EXISTS provisioning_migrations (version TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const baselineSource = await fs.readFile(baseline, 'utf8');
    const baselineHash = crypto.createHash('sha256').update(baselineSource).digest('hex');
    await executeMigration(client, 'canonical.sql', baselineSource);
    await lockPrivateTables(client);
    await client.query('INSERT INTO provisioning_migrations(version,sha256) VALUES ($1,$2)', ['canonical-baseline', baselineHash]);
    const applied = ['canonical-baseline'];
    for (const item of manifest) {
      await executeMigration(client, item.file, await fs.readFile(path.join(migrationDir, item.file), 'utf8'));
      await lockPrivateTables(client);
      await client.query('INSERT INTO provisioning_migrations(version,sha256) VALUES ($1,$2)', [item.file, item.sha256]);
      applied.push(item.file);
    }
    await client.query('COMMIT');
    transactionStarted = false;
    console.log(JSON.stringify({ status: 'migration-committed', target_project_ref: expectedProject, identity, applied_migrations: applied, committed: true, rolled_back: false, writes_performed: true }, null, 2));
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => {});
    fail(JSON.stringify({ status: 'migration-rolled-back', target_project_ref: expectedProject, committed: false, rolled_back: transactionStarted, error: String(error?.message ?? error).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted-uri]') }));
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => fail(String(error?.message ?? error)));
