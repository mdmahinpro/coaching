#!/usr/bin/env node
/** Read-only destination state inspection for the failed install retry. */
import process from 'node:process';

const expected = {
  project: 'hjzwbicauyxffrmdhvgy',
  host: 'aws-0-ap-northeast-1.pooler.supabase.com',
  port: '5432',
  database: 'postgres',
  login_username: 'postgres.hjzwbicauyxffrmdhvgy',
  sqlRole: 'postgres',
};

function blocked(message) {
  console.error(`BLOCKED: ${message}`);
  process.exitCode = 2;
}

function parseTarget(raw) {
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('TARGET_DATABASE_URL is not a valid URI'); }
  const parseable = {
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || '5432',
    database: decodeURIComponent(parsed.pathname.slice(1)),
    login_username: decodeURIComponent(parsed.username),
  };
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('database URI must use postgres/postgresql');
  if (parseable.host !== expected.host) throw new Error('database host does not match the approved destination');
  if (parseable.port !== expected.port) throw new Error('database port does not match the approved destination');
  if (parseable.database !== expected.database) throw new Error('database name does not match the approved destination');
  if (parseable.login_username !== expected.login_username) throw new Error('database login username does not match the approved project');
  if (process.env.TARGET_PROJECT_REF !== expected.project || process.env.TARGET_DATABASE_PROJECT_REF !== expected.project) throw new Error('destination project variables are not both set to the approved project');
  if (process.env.TARGET_SUPABASE_URL !== `https://${expected.project}.supabase.co`) throw new Error('TARGET_SUPABASE_URL does not match the approved project');
  return parseable;
}

async function main() {
  const raw = process.env.TARGET_DATABASE_URL?.trim();
  if (!raw) return blocked('TARGET_DATABASE_URL is not configured in this process');

  let parsed;
  try { parsed = parseTarget(raw); } catch (error) { return blocked(String(error?.message ?? error)); }

  const { Client } = await import('pg').catch(() => ({ Client: null }));
  if (!Client) return blocked('pg package is unavailable');

  const client = new Client({ connectionString: raw, ssl: { rejectUnauthorized: true } });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const meta = (await client.query("SELECT current_database() AS database, current_user AS current_user, session_user AS session_user, current_setting('server_version') AS server_version, current_setting('transaction_read_only') AS transaction_read_only")).rows[0];
    if (meta.database !== 'postgres') throw new Error('current_database did not match the approved destination');
    if (meta.current_user !== 'postgres') throw new Error('current_user did not match the expected SQL role postgres');
    if (meta.session_user !== 'postgres') throw new Error('session_user did not match the expected SQL role postgres');
    if (meta.transaction_read_only !== 'on') throw new Error('read-only transaction verification failed');

    const appObjects = await client.query(
      `SELECT c.relname AS name, c.relkind AS kind, c.reltuples::bigint AS estimated_rows
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
        ORDER BY c.relname`,
      [['students', 'teachers', 'batches', 'fees', 'exams', 'notices', 'admission_requests', 'contact_messages', 'sms_logs', 'mcq_questions', 'mcq_submissions', 'site_settings', 'fee_audit_logs', 'notice_reads', 'payment_approvals', 'exam_tokens', 'student_sessions', 'login_attempts', 'admin_users', 'feedback', 'email_logs', 'provider_secrets', 'backups', 'database_keepalive']]
    );

    const ledgerRows = await client.query('SELECT version, sha256, applied_at FROM provisioning_migrations ORDER BY version').catch(() => ({ rows: [] }));
    const unexpectedDataRows = await client.query(
      `SELECT relname AS table_name, n_live_tup::bigint AS live_tuples
         FROM pg_stat_user_tables
        WHERE schemaname = 'public' AND n_live_tup > 0
        ORDER BY relname`
    ).catch(() => ({ rows: [] }));

    await client.query('ROLLBACK');
    console.log(JSON.stringify({
      status: 'destination-state-read-only',
      parsed,
      metadata: { current_database: meta.database, current_user: meta.current_user, session_user: meta.session_user, server_version: meta.server_version, transaction_read_only: meta.transaction_read_only },
      application_objects: appObjects.rows,
      migration_ledger: ledgerRows.rows,
      unexpected_data: unexpectedDataRows.rows,
      writes_performed: false,
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    blocked(`read-only destination state check failed: ${String(error?.message ?? error).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted-uri]')}`);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => blocked(String(error?.message ?? error)));