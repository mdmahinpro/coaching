import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationFile = '20250905000007_backup_payload_redaction.sql';
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', migrationFile),
  'utf8'
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'supabase/schema/migration-manifest.json'), 'utf8')
) as {
  operationalMigrations: Array<{ file: string; classification: string }>;
};

describe('backup payload redaction migration', () => {
  it('is an optional operational forward migration after every backup prerequisite', () => {
    const entries = manifest.operationalMigrations;
    const files = entries.map(({ file }) => file);
    const hardened = files.indexOf(migrationFile);

    expect(hardened).toBeGreaterThan(files.indexOf('automated_backups.sql'));
    for (const prerequisite of [
      '20250905000001_backups_admin_rls.sql',
      '20250905000002_backup_coverage.sql',
      '20250905000003_backup_restore_coverage.sql',
      '20250905000004_admin_backup_now.sql',
    ]) {
      expect(hardened, prerequisite).toBeGreaterThan(files.indexOf(prerequisite));
    }
    expect(entries[hardened]?.classification).toBe('optional-operational');
  });

  it('redefines automated snapshots without credential, response, or token tables', () => {
    const createBackup = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.create_automated_backup'),
      migration.indexOf('-- Destructively remove forbidden fields')
    );

    expect(createBackup).toContain("to_jsonb(t) - 'password' - 'password_hash'");
    expect(createBackup).toContain("to_jsonb(t) - 'reference_no' - 'default_password'");
    expect(createBackup).toContain("to_jsonb(t) - 'response' - 'provider_response'");
    expect(createBackup).toContain('public._backup_sanitize_tables(jsonb_build_object(');
    expect(createBackup).not.toMatch(/['"](provider_secrets|student_sessions|exam_tokens)['"]\s*,\s*\(SELECT/);
  });

  it('scrubs legacy rows, including envelopes, then recounts retained rows', () => {
    expect(migration).toContain("- 'provider_secrets'");
    expect(migration).toContain("- 'messaging_provider_credentials'");
    expect(migration).toContain("- 'student_sessions'");
    expect(migration).toContain("- 'exam_tokens'");
    expect(migration).toContain("p_payload || jsonb_build_object(\n        'tables'");
    expect(migration).toContain('UPDATE public.backups AS b');
    expect(migration).toContain('SET tables = r.payload');
    expect(migration).toContain('record_count = r.record_count');
    expect(migration).toContain("WHERE COALESCE(s.row ->> 'key', '') !~*");
  });

  it('keeps backup rows admin-only and helper functions non-callable by clients', () => {
    expect(migration).toContain('USING (public.is_admin()) WITH CHECK (public.is_admin())');
    expect(migration).toContain('REVOKE ALL ON TABLE public.backups FROM PUBLIC, anon;');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public._backup_sanitize_payload(JSONB) FROM PUBLIC, anon, authenticated;'
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.create_automated_backup() FROM PUBLIC, anon, authenticated;'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.create_automated_backup() TO service_role;'
    );
  });
});
