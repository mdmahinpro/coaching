import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'scripts/migrate-disposable.mjs'), 'utf8');

describe('disposable migration runner safety contract', () => {
  it('requires the authorized project and defaults to preflight', () => {
    expect(source).toContain("const expectedProject = 'hjzwbicauyxffrmdhvgy'");
    expect(source).toContain("process.env.TARGET_PROJECT_REF");
    expect(source).toContain("process.env.TARGET_DATABASE_PROJECT_REF");
    expect(source).toContain("process.env.TARGET_SUPABASE_URL");
    expect(source).toContain("process.env.MIGRATION_APPLY === '1'");
    expect(source).toContain("mode: apply ? 'apply-requested' : 'preflight-only'");
  });

  it('has no legacy target or hard-coded credential fallback', () => {
    expect(source).not.toContain('flbvusudwszxdylxevfe');
    expect(source).not.toContain('PGPASSWORD');
    expect(source).toContain('database host does not exactly identify the authorized project');
    expect(source).toContain('db.${expectedProject}.supabase.co');
    expect(source).toContain('BEGIN READ ONLY');
    expect(source).toContain('inspectEmptyDestination');
    expect(source).toContain('migration-committed');
    expect(source).toContain('migration-rolled-back');
    expect(source).toContain('stripTransactionWrappers');
    expect(source).toContain('rolled_back: transactionStarted');
    expect(source).toContain('rejectUnauthorized: true');
    expect(source).toContain('canonical baseline is missing');
    expect(source).toContain("fs.readFile(path.join(migrationDir, item.file), 'utf8')");
    expect(source).toContain('verifyManifestOrder');
    expect(source).toContain('20250817000000_support_tables.sql');
    expect(source).toContain('20250818000002_exam_rpcs.sql');
  });
});
