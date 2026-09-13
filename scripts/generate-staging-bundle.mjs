#!/usr/bin/env node
// Generate STAGING_INSTALL.sql from canonical.sql + manifest migrations.
//
// Structure of the emitted bundle:
//
//   BEGIN;                       <- ONE outer transaction (baseline + migrations + ledger)
//   ... canonical baseline       <- transactional body
//   ... each migration           <- transactional body (embedded BEGIN;/COMMIT; stripped)
//   ... provisioning_migrations  <- migration ledger
//   COMMIT;                      <- commit the outer transaction atomically
//   ... post-COMMIT verification <- NON-ATOMIC, emitted AFTER commit
//
// A migration's own BEGIN;/COMMIT; is an *embedded* transaction wrapper. Inside
// the outer transaction these must be removed (PostgreSQL has no nested BEGIN;
// statement), but the migration author deliberately placed verification / smoke
// tests AFTER their COMMIT; so a verification failure "reports loudly without
// rolling back work that already succeeded." Those post-COMMIT sections are
// therefore NOT part of the atomic block; they are emitted separately and
// documented as such. The bundle is NOT fully atomic — only the structural
// installation (DDL + ledger) is.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {
  scanTopLevelTransactionControls,
  splitTransactionAndPostCommit,
} from './lib/sql-scanner.mjs';

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.join(root, 'supabase', 'schema', 'migration-manifest.json');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const canonicalPath = path.join(root, 'supabase', 'schema', 'canonical.sql');
const outPath = path.join(root, 'staging', 'STAGING_INSTALL.sql');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const files = ['canonical.sql', ...manifest.followOnMigrations];

// Ledger contract: baseline plus each migration, keyed by version with sha256.
const rows = [];
for (const file of files) {
  const source = fs.readFileSync(
    file === 'canonical.sql' ? canonicalPath : path.join(migrationsDir, file),
    'utf8',
  );
  rows.push([file === 'canonical.sql' ? 'canonical-baseline' : file, crypto.createHash('sha256').update(source, 'utf8').digest('hex')]);
}
const ledgerSql = rows.map(([version, sha]) => `  ('${version}', '${sha}')`).join(',\n');

// Split each source into its transactional body (goes inside the outer
// BEGIN;/COMMIT;) and its post-COMMIT verification section (goes after it).
// A one-file/body is never mutated; only structural scanning happens here.
function splitFile(file) {
  const source = fs.readFileSync(
    file === 'canonical.sql' ? canonicalPath : path.join(migrationsDir, file),
    'utf8',
  );
  const controls = scanTopLevelTransactionControls(source);
  const rollbacks = controls.filter((t) => t.kind === 'ROLLBACK');
  const commits = controls.filter((t) => t.kind === 'COMMIT');
  if (rollbacks.length > 0) {
    throw new Error(`refusing to assemble ${file}: contains top-level ROLLBACK; at lines ${rollbacks.map((r) => r.line).join(', ')}`);
  }
  if (commits.length > 1) {
    throw new Error(`refusing to assemble ${file}: multiple top-level COMMIT; (${commits.map((c) => c.line).join(', ')}) — cannot map to one transaction body`);
  }
  return splitTransactionAndPostCommit(source);
}

const { txBody: canonicalBody } = splitFile('canonical.sql');
const postCommitSteps = [];

const block = [];
block.push('-- ============ STAGING_INSTALL.sql ============');
block.push('-- Generated from the reviewed canonical baseline and manifest.');
block.push('-- Source revision: 3df7c31b41192172476e7869071316347e1ec764');
block.push('-- Do not run if STAGING_PRECHECK.sql shows existing application objects or a ledger.');
block.push('--');
block.push('-- TRANSACTION BOUNDARY');
block.push('--   BEGIN; ... COMMIT; wraps the canonical baseline, every follow-on migration,');
block.push('--   and the migration-ledger writes. All of that is atomic: if any DDL/ledger');
block.push('--   statement fails, the whole install rolls back.');
block.push('--');
block.push('--   Several reviewed migrations intentionally carry verification / smoke-test');
block.push('--   DO blocks AFTER their own COMMIT; so a verification failure reports loudly');
block.push('--   WITHOUT rolling back already-committed work. Those blocks are emitted below,');
block.push('--   OUTSIDE the outer transaction, in the "Post-install verification" section,');
block.push('--   and are NOT part of the atomic unit. The entire setup is therefore NOT');
block.push('--   atomic end-to-end; only baseline + migrations + ledger are.');
block.push('--');
block.push('-- No data/Auth/Storage rows are seeded. No psql-only directives are emitted.');
block.push('');

block.push('-- ═══════════ OUTER TRANSACTION: BEGIN ═══════════');
block.push('BEGIN;');
block.push('');

// Canonical baseline (transactional body)
block.push('-- Canonical application tables');
block.push('-- (support tables mcq_questions/mcq_submissions/site_settings/fee_audit_logs');
block.push('--  are created by 20250817000000_support_tables.sql below)');
block.push(canonicalBody.trim());
block.push('');

// Follow-on migrations (transactional bodies only)
for (const file of manifest.followOnMigrations) {
  const { txBody, postCommit } = splitFile(file);
  block.push(`-- === Migration: ${file} ===`);
  block.push(txBody.trim());
  block.push('');
  if (postCommit.trim()) {
    postCommitSteps.push({ file, postCommit });
  }
}

// Ledger
block.push('-- Migration ledger (contract: provisioning_migrations)');
block.push('CREATE TABLE IF NOT EXISTS public.provisioning_migrations (');
block.push('  version TEXT PRIMARY KEY,');
block.push('  sha256  TEXT NOT NULL,');
block.push('  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()');
block.push(');');
block.push('');
block.push('-- Ledger rows for the canonical baseline and every follow-on migration.');
block.push('-- NOTE: this is a plain INSERT with NO ON CONFLICT upsert. A fresh');
block.push('-- installer must FAIL LOUDLY if any version already exists in the ledger');
block.push('-- (with the same or a different sha256), instead of silently overwriting');
block.push('-- a previously recorded checksum. Conflicting existing installation state');
block.push('-- is a STOP condition, not something to paper over.');
block.push('INSERT INTO public.provisioning_migrations (version, sha256) VALUES');
block.push(ledgerSql);
block.push(';');
block.push('');

block.push('-- ═══════════ OUTER TRANSACTION: COMMIT ═══════════');
block.push('COMMIT;');
block.push('');

// Post-commit verification sections (NOT atomic, run after COMMIT)
if (postCommitSteps.length > 0) {
  block.push('-- ═══════════ POST-INSTALL VERIFICATION (NON-ATOMIC) ═══════════');
  block.push('-- The outer transaction above is ALREADY COMMITted. The following blocks');
  block.push('-- are the deliberate post-COMMIT; verification sections carried over from');
  block.push('-- the reviewed migrations. They run after the atomic install; a failure here');
  block.push('-- reports loudly but does NOT roll back the committed baseline/migrations/ledger.');
  block.push('');
  for (const { file, postCommit } of postCommitSteps) {
    block.push(`-- === Post-commit verification: ${file} ===`);
    block.push(postCommit.trim());
    block.push('');
  }
}

fs.mkdirSync(path.join(root, 'staging'), { recursive: true });
fs.writeFileSync(outPath, block.join('\n'), 'utf8');
console.log(`Wrote ${outPath}`);
console.log(`files_in_bundle=${files.length} (canonical + ${files.length - 1} migrations)`);
console.log(`post_commit_verification_steps=${postCommitSteps.length}`);