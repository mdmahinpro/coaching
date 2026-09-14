import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'supabase/schema/migration-manifest.json'), 'utf8'));

function readMigration(file) {
  return fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8');
}

describe('recovered disposable installation manifest', () => {
  it('loads canonical.sql and every manifest follow-on through the apply file path', () => {
    expect(fs.readFileSync(path.join(root, manifest.baseline.file), 'utf8').length).toBeGreaterThan(0);
    expect(manifest.migrations.length).toBeGreaterThan(30);
    const migrationFiles = manifest.migrations.map((entry) => entry.file);
    expect(migrationFiles).toContain('20250912000001_student_auth_hardening.sql');
    expect(migrationFiles).toContain('20250913000001_private_avatars_public_assets.sql');
    expect(manifest.operationalMigrations.every((entry) => entry.classification === 'optional-operational')).toBe(true);
    for (const file of manifest.migrations.map((entry) => entry.file)) {
      expect(readMigration(file).length, file).toBeGreaterThan(0);
    }
  });

  it('loads the support-table SQL before dependent exam RPC SQL', () => {
    const supportIndex = manifest.migrations.map((entry) => entry.file).indexOf('20250817000000_support_tables.sql');
    const examIndex = manifest.migrations.map((entry) => entry.file).indexOf('20250818000002_exam_rpcs.sql');
    expect(supportIndex).toBeGreaterThanOrEqual(0);
    expect(examIndex).toBeGreaterThan(supportIndex);
    expect(readMigration('20250817000000_support_tables.sql')).toContain('CREATE TABLE IF NOT EXISTS public.mcq_questions');
  });

  it('contains one outer transaction contract and corrected file loading', () => {
    const runner = fs.readFileSync(path.join(root, 'scripts/migrate-disposable.mjs'), 'utf8');
    expect(runner).toContain("await client.query('BEGIN')");
    expect(runner).toContain("await client.query('COMMIT')");
    expect(runner).toContain('stripTransactionWrappers');
    expect(runner).toContain("fs.readFile(path.join(migrationDir, item.file), 'utf8')");
  });
});
