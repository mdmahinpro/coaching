#!/usr/bin/env node
/** Populated showcase upgrade. Read-only dry-run first; apply requires reviewed plan and backup evidence. */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  applySqlUnit,
  assertStrictTarget,
  checksumFile,
  inspectBusinessCounts,
  loadManifest,
  migrationsDir,
  pgConfig,
  root,
  schemaSignature,
} from './lib/provisioning.mjs';

const apply = process.env.UPGRADE_APPLY === '1';
const databaseUrl = process.env.CUSTOMER_DATABASE_URL?.trim();
const projectRef = process.env.CUSTOMER_PROJECT_REF?.trim();
const environment = process.env.CUSTOMER_ENVIRONMENT?.trim();
const allowedEnvironment = process.env.UPGRADE_ALLOWED_ENVIRONMENT?.trim();
const customerId = process.env.CUSTOMER_ID?.trim();
const planFile = process.env.UPGRADE_PLAN_FILE?.trim();
const backupEvidenceFile = process.env.UPGRADE_BACKUP_EVIDENCE_FILE?.trim();
const adoptionFile = process.env.UPGRADE_ADOPTION_FILE?.trim();
const reportDir = path.join(root, 'provisioning-reports');
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(4).toString('hex')}`;

async function readJson(file, label) {
  if (!file) throw new Error(`${label} is required`);
  return JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
}

function validateBackupEvidence(evidence) {
  if (evidence.projectRef !== projectRef) throw new Error('Backup evidence project ref mismatch');
  if (!evidence.createdAt || !evidence.verifiedAt || !evidence.immutableLocation || !/^[a-f0-9]{64}$/.test(evidence.sha256 ?? '')) {
    throw new Error('Backup evidence must include createdAt, verifiedAt, immutableLocation, and sha256');
  }
  if (Date.parse(evidence.createdAt) > Date.now() || Date.parse(evidence.verifiedAt) < Date.parse(evidence.createdAt)) {
    throw new Error('Backup evidence timestamps are invalid');
  }
}

async function inspect(client, manifest, expected) {
  const existingTables = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[]) ORDER BY table_name`,
    [manifest.verification.businessTables],
  );
  const names = existingTables.rows.map((row) => row.table_name);
  if (!names.length) throw new Error('Existing showcase upgrade refused: no business tables found; use fresh provisioning');
  const counts = await inspectBusinessCounts(client, names);
  if (!Object.values(counts).some((count) => count > 0)) throw new Error('Existing showcase upgrade requires populated business tables');
  const ledgerExists = Boolean((await client.query(`SELECT to_regclass('public.provisioning_migrations') AS ledger`)).rows[0]?.ledger);
  const ledger = ledgerExists
    ? (await client.query('SELECT version, sha256 FROM public.provisioning_migrations ORDER BY version')).rows
    : [];
  const signature = schemaSignature({ projectRef, tables: names.map((name) => [name, counts[name]]), ledger });
  if (expected && expected !== signature) throw new Error('Schema/adoption signature changed since the reviewed dry-run');
  return { tables: names, counts, ledgerExists, ledger, signature };
}

async function main() {
  const report = { run_id: runId, mode: apply ? 'apply' : 'dry-run', project_ref: projectRef ?? null, environment: environment ?? null, migrations: [], blockers: [], errors: [] };
  let client;
  try {
    if (!customerId) throw new Error('CUSTOMER_ID is required');
    assertStrictTarget({ databaseUrl, projectRef, environment, allowedEnvironment });
    const manifest = await loadManifest();
    const migrations = [];
    for (const entry of manifest.migrations) migrations.push({ ...entry, sha256: await checksumFile(path.join(migrationsDir, entry.file)) });
    report.optional_operational_migrations = manifest.operationalMigrations;
    const { Client } = await import('pg');
    client = new Client(pgConfig(databaseUrl));
    await client.connect();

    if (!apply) await client.query('BEGIN TRANSACTION READ ONLY');
    const state = await inspect(client, manifest);
    const ledgerByVersion = new Map(state.ledger.map((row) => [row.version, row.sha256]));
    for (const migration of migrations) {
      const recorded = ledgerByVersion.get(migration.file);
      const status = recorded === migration.sha256 ? 'applied' : recorded ? 'checksum-mismatch' : 'pending-or-untracked';
      report.migrations.push({ ...migration, status });
      if (status === 'checksum-mismatch') report.blockers.push(`Checksum mismatch: ${migration.file}`);
    }
    report.snapshot = state;

    if (!apply) {
      if (!state.ledgerExists) report.blockers.push('No provisioning ledger exists. A reviewed adoption file is required before apply.');
      report.next = 'Save this report, obtain immutable backup evidence, resolve blockers/adoption, then set UPGRADE_APPLY=1 and UPGRADE_PLAN_FILE to this exact report.';
      await client.query('ROLLBACK');
    } else {
      const plan = await readJson(planFile, 'UPGRADE_PLAN_FILE');
      if (plan.mode !== 'dry-run' || plan.project_ref !== projectRef || !plan.snapshot?.signature) throw new Error('Upgrade plan is not a matching dry-run report');
      const evidence = await readJson(backupEvidenceFile, 'UPGRADE_BACKUP_EVIDENCE_FILE');
      validateBackupEvidence(evidence);
      const current = await inspect(client, manifest, plan.snapshot.signature);
      if (plan.blockers?.some((item) => !String(item).startsWith('No provisioning ledger exists'))) throw new Error('Reviewed plan contains unresolved blockers');

      if (!current.ledgerExists) {
        const adoption = await readJson(adoptionFile, 'UPGRADE_ADOPTION_FILE');
        if (adoption.projectRef !== projectRef || adoption.schemaSignature !== current.signature || adoption.reviewed !== true) throw new Error('Adoption evidence does not match the reviewed schema snapshot');
        const declared = new Map((adoption.migrations ?? []).map((entry) => [entry.file, entry.sha256]));
        for (const migration of migrations) {
          if (declared.get(migration.file) !== migration.sha256) throw new Error(`Adoption evidence missing exact checksum: ${migration.file}`);
        }
        await client.query(`CREATE TABLE public.provisioning_migrations (version TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), customer_id TEXT NOT NULL, adopted BOOLEAN NOT NULL DEFAULT false)`);
        for (const migration of migrations) {
          await client.query('INSERT INTO public.provisioning_migrations(version,sha256,customer_id,adopted) VALUES ($1,$2,$3,true)', [migration.file, migration.sha256, customerId]);
        }
        report.adoption = { applied: true, evidence: path.resolve(adoptionFile) };
      } else {
        const ledger = new Map(current.ledger.map((row) => [row.version, row.sha256]));
        for (const migration of migrations) {
          const recorded = ledger.get(migration.file);
          if (recorded && recorded !== migration.sha256) throw new Error(`Migration checksum mismatch: ${migration.file}`);
          if (recorded) continue;
          const sql = await fs.readFile(path.join(migrationsDir, migration.file), 'utf8');
          await applySqlUnit(client, { version: migration.file, sha256: migration.sha256, sql, customerId });
        }
      }
      report.backup_evidence = { projectRef: evidence.projectRef, createdAt: evidence.createdAt, verifiedAt: evidence.verifiedAt, immutableLocation: evidence.immutableLocation, sha256: evidence.sha256 };
      report.status = 'upgraded';
    }
  } catch (error) {
    if (!apply && client) await client.query('ROLLBACK').catch(() => {});
    report.errors.push(String(error?.message ?? error));
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
  await fs.mkdir(reportDir, { recursive: true });
  const output = path.join(reportDir, `upgrade-${projectRef ?? 'unassigned'}-${runId}.json`);
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report_file: output }, null, 2));
}

main().catch((error) => { console.error('Upgrade fatal:', error.message); process.exitCode = 1; });
