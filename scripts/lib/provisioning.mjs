import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { splitTransactionAndPostCommit, scanTopLevelTransactionControls } from './sql-scanner.mjs';

export const root = path.resolve(import.meta.dirname, '..', '..');
export const manifestPath = path.join(root, 'supabase', 'schema', 'migration-manifest.json');
export const migrationsDir = path.join(root, 'supabase', 'migrations');

export async function loadManifest() {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.manifestVersion !== 2 || !manifest.baseline?.file || !Array.isArray(manifest.migrations)) {
    throw new Error('Unsupported or malformed migration manifest');
  }
  const all = [...manifest.migrations, ...(manifest.operationalMigrations ?? [])];
  const names = all.map((entry) => entry.file);
  if (new Set(names).size !== names.length) throw new Error('Migration manifest contains duplicate files');
  if (!manifest.migrations.some((entry) => entry.file === '20250910000001_fee_audit_logs_admin_rls.sql')) {
    throw new Error('Authoritative manifest is missing the fee audit migration');
  }
  if (!manifest.migrations.some((entry) => entry.file === '20250911000001_atomic_exam_deletion.sql')) {
    throw new Error('Authoritative manifest is missing the atomic exam deletion migration');
  }
  if (all.some((entry) => !entry.phase || !entry.classification)) throw new Error('Every migration needs phase and classification');
  if (manifest.migrations.some((entry) => entry.classification === 'optional-operational')) {
    throw new Error('Optional operational migrations must stay outside the required chain');
  }
  return manifest;
}

export async function checksumFile(filePath) {
  const body = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(body).digest('hex');
}

export function assertStrictTarget({ databaseUrl, projectRef, environment, allowedEnvironment }) {
  if (!databaseUrl || !projectRef || !environment || !allowedEnvironment) {
    throw new Error('Database URL, project ref, environment, and allowed environment are all required');
  }
  if (environment !== allowedEnvironment) throw new Error('Environment identity mismatch');
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error('Project ref must be the exact 20-character Supabase ref');
  const url = new URL(databaseUrl);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('Target must use PostgreSQL');
  const direct = url.hostname === `db.${projectRef}.supabase.co`;
  const pooled = url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username).endsWith(`.${projectRef}`);
  if (!direct && !pooled) throw new Error('Database URL does not match the declared Supabase project ref');
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode !== 'verify-full') throw new Error('CUSTOMER_DATABASE_URL must set sslmode=verify-full');
  return url;
}

export function pgConfig(databaseUrl) {
  return { connectionString: databaseUrl, ssl: { rejectUnauthorized: true } };
}

export async function assertFreshTarget(client, businessTables) {
  const found = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])`,
    [businessTables],
  );
  if (found.rowCount) throw new Error(`Fresh provisioning refused: business tables already exist (${found.rows.map((r) => r.table_name).join(', ')})`);
  const ledger = await client.query(`SELECT to_regclass('public.provisioning_migrations') AS ledger`);
  if (ledger.rows[0]?.ledger) throw new Error('Fresh provisioning refused: provisioning ledger already exists');
}

export function transactionalSqlBody({ version, sql }) {
  const controls = scanTopLevelTransactionControls(sql);
  if (controls.some((item) => item.kind === 'ROLLBACK')) throw new Error(`${version} contains a top-level ROLLBACK`);
  return splitTransactionAndPostCommit(sql).txBody;
}

async function insertLedgerEntry(client, { version, sha256, customerId }) {
  await client.query(
    'INSERT INTO provisioning_migrations(version,sha256,customer_id) VALUES ($1,$2,$3)',
    [version, sha256, customerId],
  );
}

export async function applySqlUnit(client, unit) {
  const txBody = transactionalSqlBody(unit);
  await client.query('BEGIN');
  try {
    await client.query(txBody);
    await insertLedgerEntry(client, unit);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function applyFreshProvisioning(client, { units, customerId, businessTables }) {
  if (!Array.isArray(units) || units.length === 0) throw new Error('Fresh provisioning requires baseline and migration units');
  const prepared = units.map((unit) => ({ ...unit, customerId, txBody: transactionalSqlBody(unit) }));

  await client.query('BEGIN');
  try {
    await assertFreshTarget(client, businessTables);
    await client.query(`CREATE TABLE public.provisioning_migrations (
      version TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      customer_id TEXT NOT NULL
    )`);
    for (const unit of prepared) {
      await client.query(unit.txBody);
      await insertLedgerEntry(client, unit);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function inspectBusinessCounts(client, tables) {
  const result = {};
  for (const table of tables) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`Unsafe table identifier: ${table}`);
    const value = await client.query(`SELECT count(*)::bigint AS count FROM public.${table}`);
    result[table] = Number(value.rows[0].count);
  }
  return result;
}

export async function verifyFreshProvisioning(client, { businessTables, requiredFunctions, units, customerId }) {
  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])`,
    [businessTables],
  );
  const functions = await client.query(
    `SELECT DISTINCT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname = ANY($1::text[])`,
    [requiredFunctions],
  );
  const ledger = await client.query(
    'SELECT version, sha256, customer_id FROM public.provisioning_migrations',
  );

  const foundTables = tables.rows.map((row) => row.table_name);
  const foundFunctions = functions.rows.map((row) => row.name);
  if (!businessTables.every((name) => foundTables.includes(name))) throw new Error('Required table verification failed');
  if (!requiredFunctions.every((name) => foundFunctions.includes(name))) throw new Error('Required function verification failed');

  const expectedLedger = new Map(units.map((unit) => [unit.version, unit.sha256]));
  const ledgerMatches = ledger.rowCount === expectedLedger.size && ledger.rows.every((row) => (
    row.customer_id === customerId && expectedLedger.get(row.version) === row.sha256
  ));
  if (!ledgerMatches) throw new Error('Provisioning ledger verification failed');

  const counts = await inspectBusinessCounts(client, businessTables);
  const empty = Object.values(counts).every((count) => count === 0);
  if (!empty) throw new Error('Fresh target contains business rows after schema provisioning');

  return {
    tables: { required: businessTables, found: foundTables },
    functions: { required: requiredFunctions, found: foundFunctions },
    ledger: { expected: units.map((unit) => ({ version: unit.version, sha256: unit.sha256 })), found: ledger.rows },
    empty_business_data: { counts, empty },
  };
}

export function schemaSignature({ projectRef, tables, ledger }) {
  return crypto.createHash('sha256').update(JSON.stringify({ projectRef, tables, ledger })).digest('hex');
}
