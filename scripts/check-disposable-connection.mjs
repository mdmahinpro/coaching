#!/usr/bin/env node
/** Read-only destination identity/authentication check. Never prints the URI. */
import process from 'node:process';

const expected = {
  project: 'hjzwbicauyxffrmdhvgy',
  host: 'aws-0-ap-northeast-1.pooler.supabase.com',
  port: '5432',
  database: 'postgres',
  username: 'postgres.hjzwbicauyxffrmdhvgy',
  sqlRole: 'postgres',
};

function blocked(message) {
  console.error(`BLOCKED: ${message}`);
  process.exitCode = 2;
}

function blockedWithDiagnostics(message, diagnostics) {
  console.error(`BLOCKED: ${message}`);
  console.error(JSON.stringify({ diagnostics }, null, 2));
  process.exitCode = 2;
}

async function main() {
  const raw = process.env.TARGET_DATABASE_URL?.trim();
  if (!raw) return blocked('TARGET_DATABASE_URL is not configured in this process');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return blocked('TARGET_DATABASE_URL is not a valid URI');
  }

  const parsedFields = {
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || '5432',
    database: decodeURIComponent(parsed.pathname.slice(1)),
    login_username: decodeURIComponent(parsed.username),
  };
  const parsedDiagnostics = { parsed: parsedFields };
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return blockedWithDiagnostics('database URI must use postgres/postgresql', parsedDiagnostics);
  if (parsedFields.host !== expected.host) return blockedWithDiagnostics('parsed host failed validation', parsedDiagnostics);
  if (parsedFields.port !== expected.port) return blockedWithDiagnostics('parsed port failed validation', parsedDiagnostics);
  if (parsedFields.database !== expected.database) return blockedWithDiagnostics('parsed database failed validation', parsedDiagnostics);
  if (parsedFields.login_username !== expected.username) return blockedWithDiagnostics('parsed login username failed validation', parsedDiagnostics);
  if (process.env.TARGET_PROJECT_REF !== expected.project || process.env.TARGET_DATABASE_PROJECT_REF !== expected.project) return blocked('destination project variables are not both set to the approved project');
  if (process.env.TARGET_SUPABASE_URL !== `https://${expected.project}.supabase.co`) return blocked('TARGET_SUPABASE_URL does not match the approved project');

  const { Client } = await import('pg').catch(() => ({ Client: null }));
  if (!Client) return blocked('pg package is unavailable');

  const client = new Client({ connectionString: raw, ssl: { rejectUnauthorized: true } });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query("SELECT current_database() AS database, current_user AS current_user, session_user AS session_user, current_setting('server_version') AS server_version, current_setting('transaction_read_only') AS transaction_read_only");
    const row = result.rows[0];
    const actual = {
      current_database: row.database,
      current_user: row.current_user,
      session_user: row.session_user,
      transaction_read_only: row.transaction_read_only,
    };
    const failedField = row.database !== expected.database
      ? 'current_database'
      : row.current_user !== expected.sqlRole
        ? 'current_user'
        : row.session_user !== expected.sqlRole
          ? 'session_user'
          : row.transaction_read_only !== 'on'
            ? 'transaction_read_only'
            : null;
    if (failedField) {
      throw new Error(JSON.stringify({ field: failedField, parsed: parsedFields, actual }));
    }
    await client.query('ROLLBACK');
    console.log(JSON.stringify({
      status: 'authenticated-read-only',
      project_ref: expected.project,
      host: expected.host,
      port: Number(expected.port),
      database: row.database,
      login_username: parsedFields.login_username,
      current_user: row.current_user,
      session_user: row.session_user,
      server_version: row.server_version,
      transaction_read_only: row.transaction_read_only,
      writes_performed: false,
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const message = String(error?.message ?? error).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted-uri]');
    try {
      const detail = JSON.parse(message);
      blockedWithDiagnostics('read-only connection metadata failed validation', detail);
    } catch {
      blocked(`read-only connection failed: ${message}`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => blocked(String(error?.message ?? error)));
