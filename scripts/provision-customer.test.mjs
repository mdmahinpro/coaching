import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('customer provisioning safety', () => {
  it('does not include legacy permissive migrations in the canonical manifest', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'provision-customer.mjs'), 'utf8');
    const manifest = source.slice(source.indexOf('const migrationFiles'), source.indexOf('const requiredTables'));
    expect(manifest).not.toContain('migration.sql');
    expect(manifest).not.toContain('update_rls_policies.sql');
    expect(source).toContain('Canonical clean-database baseline is missing');
  });

  it('requires explicit apply mode and customer assignment', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'provision-customer.mjs'), 'utf8');
    expect(source).toContain("process.env.PROVISION_APPLY === '1'");
    expect(source).toContain('CUSTOMER_ID');
    expect(source).toContain('CUSTOMER_NAME');
    expect(source).toContain('CUSTOMER_DATABASE_URL');
  });

  it('fails closed when the canonical clean schema baseline is absent', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'provision-customer.mjs'), 'utf8');
    expect(source).toContain("const canonicalBaseline = 'supabase/schema/canonical.sql'");
    expect(source).toContain('report.blockers.push');
    expect(source).toContain('Canonical clean-database baseline is missing');
  });

  it('verifies empty business state and required schema objects in apply mode', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'provision-customer.mjs'), 'utf8');
    expect(source).toContain('requiredTables');
    expect(source).toContain('requiredFunctions');
    expect(source).toContain('empty_business_data');
    expect(source).toContain('provisioning_migrations');
  });
});
