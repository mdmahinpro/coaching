import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  scanTopLevelTransactionControls,
  extractDollarBodies,
} from './lib/sql-scanner.mjs';

const root = process.cwd();
const manifestPath = path.join(root, 'supabase', 'schema', 'migration-manifest.json');
const installPath = path.join(root, 'staging', 'STAGING_INSTALL.sql');

const install = () => fs.readFileSync(installPath, 'utf8');

// Bounds of the OUTER transaction wrapper within the generated bundle.
function outerTransactionBounds(s) {
  const controls = scanTopLevelTransactionControls(s);
  const begins = controls.filter((t) => t.kind === 'BEGIN');
  const commits = controls.filter((t) => t.kind === 'COMMIT');
  const rollbacks = controls.filter((t) => t.kind === 'ROLLBACK');
  return { controls, begins, commits, rollbacks };
}

// Slice of the bundle strictly between the outer BEGIN; and outer COMMIT;.
function transactionalRegion(s) {
  const { controls } = outerTransactionBounds(s);
  const begin = controls.find((t) => t.kind === 'BEGIN');
  const commit = controls.find((t) => t.kind === 'COMMIT');
  if (!begin || !commit || commit.line <= begin.line) return '';
  const lines = s.split(/\r?\n/);
  return lines.slice(begin.line, commit.line - 1).join('\n');
}

describe('staging install bundle contract', () => {
  it('is Dashboard SQL Editor compatible (no psql directives)', () => {
    const s = install();
    const psql = ['echo', 'set', '\\i', 'include', 'connect', 'gexec', 'copy', '\\d', 'q', 'o', 'g'];
    for (const directive of psql) {
      expect(s).not.toMatch(new RegExp(`^\\\\${directive}\\b`, 'i'));
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect((s.match(/-- === Migration:/gm) ?? []).length).toBe(manifest.migrations.length);
  });

  it('wraps the install in exactly ONE outer BEGIN; ... COMMIT;', () => {
    const { begins, commits, rollbacks } = outerTransactionBounds(install());
    expect(begins).toHaveLength(1);
    expect(commits).toHaveLength(1);
    expect(rollbacks).toHaveLength(0);
    expect(begins[0].line).toBeLessThan(commits[0].line);
  });

  it('has NO unintended top-level transaction-control inside the outer transaction', () => {
    const region = transactionalRegion(install());
    const inside = scanTopLevelTransactionControls(region);
    expect(inside.filter((t) => t.kind === 'BEGIN' || t.kind === 'COMMIT' || t.kind === 'ROLLBACK')).toEqual([]);
  });

  it('emits the post-COMMIT verification sections OUTSIDE the outer transaction', () => {
    const s = install();
    const { commits } = outerTransactionBounds(s);
    const commitLine = commits[0].line;
    const lines = s.split(/\r?\n/);
    const after = lines.slice(commitLine).join('\n');
    // The dedicated non-atomic verification banner is present after COMMIT;.
    expect(after).toContain('POST-INSTALL VERIFICATION');
    expect(after).toContain('NON-ATOMIC');
  });

  it('preserves the canonical baseline and every migration function/DO body verbatim', () => {
    const s = install();
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const sources = ['canonical.sql', ...manifest.migrations.map((entry) => entry.file)].map((file) => {
      const src = fs.readFileSync(
        file === 'canonical.sql' ? path.join(root, 'supabase', 'schema', file) : path.join(root, 'supabase', 'migrations', file),
        'utf8',
      );
      return { file, src };
    });

    let sourceBodyCount = 0;
    for (const { file, src } of sources) {
      const bodies = extractDollarBodies(src);
      sourceBodyCount += bodies.length;
      for (const body of bodies) {
        // Whitespace-insensitive presence check: the body (including its own
        // dollar delimiters) must survive into the generated bundle verbatim.
        const needle = body.block.replace(/\s+/g, ' ');
        const haystack = s.replace(/\s+/g, ' ');
        expect(haystack).toContain(needle);
      }
    }
    expect(sourceBodyCount).toBeGreaterThan(0);
  });

  it('creates support tables before exam RPCs', () => {
    const s = install();
    const i = s.indexOf('20250818000002_exam_rpcs.sql');
    expect(i).toBeGreaterThan(-1);
    expect(s.slice(0, i)).toContain('CREATE TABLE IF NOT EXISTS public.mcq_questions');
    expect(s.slice(0, i)).toContain('CREATE TABLE IF NOT EXISTS public.mcq_submissions');
  });

  it('keeps backup and cron operations out of the required staging install', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const required = manifest.migrations.map((entry) => entry.file);
    const operational = manifest.operationalMigrations.map((entry) => entry.file);

    expect(required).not.toContain('keep_alive_cron.sql');
    expect(required).not.toContain('automated_backups.sql');
    expect(required).not.toContain('20250905000002_backup_coverage.sql');
    expect(operational.indexOf('20250905000002_backup_coverage.sql')).toBeGreaterThan(
      operational.indexOf('20250905000001_backups_admin_rls.sql')
    );

    const s = install();
    expect(s).not.toContain('-- === Migration: keep_alive_cron.sql ===');
    expect(s).not.toContain('-- === Migration: automated_backups.sql ===');
    expect(s).not.toContain('-- === Migration: 20250905000002_backup_coverage.sql ===');
  });

  it('includes S1 security removal and the ledger', () => {
    const s = install();
    expect(s).toContain('avatars_anon_upload');
    expect(s).toContain('public.provisioning_migrations');
    // The fresh installer must NOT silently overwrite a previously recorded
    // ledger checksum. A plain INSERT (no ON CONFLICT upsert on the version
    // key) makes any conflicting existing installation state fail loudly
    // instead of being papered over.
    expect(s).not.toContain('ON CONFLICT (version) DO UPDATE');
  });

  it('has exact ledger checksums matching the manifest files', () => {
    const s = install();
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const file of ['canonical.sql', ...manifest.migrations.map((entry) => entry.file)]) {
      const src = fs.readFileSync(
        file === 'canonical.sql' ? path.join(root, 'supabase', 'schema', file) : path.join(root, 'supabase', 'migrations', file),
        'utf8',
      );
      const sha = crypto.createHash('sha256').update(src, 'utf8').digest('hex');
      const version = file === 'canonical.sql' ? 'canonical-baseline' : file;
      expect(s).toContain(`'${version}', '${sha}'`);
    }
  });

  it('counter RPCs fail closed and privilege checks resolve OIDs via to_regprocedure', () => {
    const s = install();
    // The final installed counter bodies (re-defined in
    // 20250829000001_security_controls.sql) fail closed on NULL is_admin().
    // (Both counter functions must carry the guard; >= 2 occurrences required,
    // since the post-install repair's admin_get_avatar_path also uses it.)
    const countCoalesce = (s.match(/IF NOT COALESCE\(is_admin\(\), false\) THEN/g) ?? []).length;
    expect(countCoalesce).toBeGreaterThanOrEqual(2);
    // Every counter body must fail closed: the pattern must appear at least
    // once inside BOTH the increment- and decrement-enrolled definitions.
    const inc = s.indexOf('CREATE FUNCTION increment_enrolled');
    const dec = s.indexOf('CREATE FUNCTION decrement_enrolled');
    expect(inc).toBeGreaterThan(-1);
    expect(dec).toBeGreaterThan(-1);
    expect(s.slice(inc, dec)).toMatch(/COALESCE\(is_admin\(\), false\)/);
    expect(s.slice(dec)).toMatch(/COALESCE\(is_admin\(\), false\)/);
    // The post-commit verify resolves BOTH counters by exact schema-qualified
    // signature to an OID, asserts they exist, and uses those OIDs for the
    // privilege checks. It never re-identifies by name or by assuming the
    // identity-arguments string equals 'uuid'.
    expect(s).toContain("oid_inc oid := to_regprocedure('public.increment_enrolled(uuid)')");
    expect(s).toContain("oid_dec oid := to_regprocedure('public.decrement_enrolled(uuid)')");
    expect(s).toContain('HAS_FUNCTION_PRIVILEGE(\'public\', oid_inc, \'EXECUTE\')');
    expect(s).toContain('HAS_FUNCTION_PRIVILEGE(\'public\', oid_dec, \'EXECUTE\')');
  });
});

describe('staging precheck/verify Dashboard compatibility', () => {
  const precheck = fs.readFileSync(path.join(root, 'staging', 'STAGING_PRECHECK.sql'), 'utf8');
  const verify = fs.readFileSync(path.join(root, 'staging', 'STAGING_VERIFY.sql'), 'utf8');
  const psql = ['echo', 'set', '\\i', 'include', 'connect', 'gexec', 'copy', '\\d', 'q', 'o', 'g'];

  it('precheck has no psql directives', () => {
    for (const d of psql) expect(precheck).not.toMatch(new RegExp(`^\\\\${d}\\b`, 'i'));
  });
  it('verify has no psql directives', () => {
    for (const d of psql) expect(verify).not.toMatch(new RegExp(`^\\\\${d}\\b`, 'i'));
  });
});