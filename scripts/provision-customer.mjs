#!/usr/bin/env node
/** Fresh-customer provisioning. Dry-run by default; never use for populated/showcase databases. */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  applyFreshProvisioning,
  assertStrictTarget,
  checksumFile,
  loadManifest,
  migrationsDir,
  pgConfig,
  root,
  verifyFreshProvisioning,
} from './lib/provisioning.mjs';

const reportDir = path.join(root, 'provisioning-reports');
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(4).toString('hex')}`;
const apply = process.env.PROVISION_APPLY === '1';
const customerId = process.env.CUSTOMER_ID?.trim();
const customerName = process.env.CUSTOMER_NAME?.trim();
const databaseUrl = process.env.CUSTOMER_DATABASE_URL?.trim();
const projectRef = process.env.CUSTOMER_PROJECT_REF?.trim();
const environment = process.env.CUSTOMER_ENVIRONMENT?.trim();
const allowedEnvironment = process.env.PROVISION_ALLOWED_ENVIRONMENT?.trim();

function redacted(value) {
  if (!value) return null;
  try { const url = new URL(value); return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`; }
  catch { return '[configured]'; }
}

async function writeReport(report) {
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(path.join(reportDir, `${report.customer_id ?? 'unassigned'}-${report.run_id}.json`), JSON.stringify(report, null, 2));
}

async function main() {
  const report = {
    run_id: runId,
    customer_id: customerId ?? null,
    customer_name: customerName ?? null,
    project_ref: projectRef ?? null,
    environment: environment ?? null,
    database: redacted(databaseUrl),
    mode: apply ? 'apply' : 'dry-run',
    baseline: null,
    migrations: [],
    optional_operational_migrations: [],
    verification: {},
    errors: [],
    warnings: [],
  };

  try {
    if (!customerId || !customerName) throw new Error('CUSTOMER_ID and CUSTOMER_NAME are required');
    const manifest = await loadManifest();
    const baselinePath = path.join(root, manifest.baseline.file);
    const baseline = { ...manifest.baseline, sha256: await checksumFile(baselinePath) };
    const migrations = [];
    for (const entry of manifest.migrations) {
      migrations.push({ ...entry, sha256: await checksumFile(path.join(migrationsDir, entry.file)) });
    }
    report.baseline = baseline;
    report.migrations = migrations;
    report.optional_operational_migrations = manifest.operationalMigrations;
    report.warnings.push('Optional operational migrations are reported but never applied by fresh provisioning.');

    if (!apply) {
      report.warnings.push('Dry-run performs no network connection and no database writes.');
      await writeReport(report);
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    assertStrictTarget({ databaseUrl, projectRef, environment, allowedEnvironment });
    const units = [{
      version: manifest.baseline.file,
      sha256: baseline.sha256,
      sql: await fs.readFile(baselinePath, 'utf8'),
    }];
    for (const migration of migrations) {
      units.push({
        version: migration.file,
        sha256: migration.sha256,
        sql: await fs.readFile(path.join(migrationsDir, migration.file), 'utf8'),
      });
    }

    const { Client } = await import('pg');
    const client = new Client(pgConfig(databaseUrl));
    try {
      await client.connect();
      const identity = await client.query('SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS server_address');
      report.verification.identity = identity.rows[0];

      await applyFreshProvisioning(client, {
        units,
        customerId,
        businessTables: manifest.verification.businessTables,
      });
      report.verification.preflight_empty_target = true;

      Object.assign(report.verification, await verifyFreshProvisioning(client, {
        businessTables: manifest.verification.businessTables,
        requiredFunctions: manifest.verification.requiredFunctions,
        units,
        customerId,
      }));
      report.status = 'provisioned-schema-only';
    } finally {
      await client.end().catch(() => {});
    }
  } catch (error) {
    report.errors.push(String(error?.message ?? error));
    process.exitCode = 1;
  }

  await writeReport(report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error('Provisioning fatal:', error.message); process.exitCode = 1; });
