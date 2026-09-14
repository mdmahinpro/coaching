import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyFreshProvisioning,
  applySqlUnit,
  assertStrictTarget,
  loadManifest,
  verifyFreshProvisioning,
} from './lib/provisioning.mjs';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'scripts/provision-customer.mjs'), 'utf8');

describe('customer provisioning safety', () => {
  it('uses the authoritative classified manifest including required security fixes', async () => {
    const manifest = await loadManifest();
    expect(source).toContain('loadManifest()');
    expect(source).not.toContain('const migrationFiles');
    expect(manifest.migrations.some((entry) => entry.file === '20250910000001_fee_audit_logs_admin_rls.sql')).toBe(true);
    expect(manifest.migrations.some((entry) => entry.file === '20250911000001_atomic_exam_deletion.sql')).toBe(true);
    expect(manifest.verification.requiredFunctions).toContain('admin_delete_exam');
    expect(manifest.operationalMigrations.every((entry) => entry.classification === 'optional-operational')).toBe(true);
  });

  it('requires strict project/environment identity and verify-full TLS', () => {
    expect(() => assertStrictTarget({
      databaseUrl: 'postgresql://postgres.abcdefghijklmnopqrst:x@aws-0.pooler.supabase.com/postgres?sslmode=require',
      projectRef: 'abcdefghijklmnopqrst', environment: 'production', allowedEnvironment: 'production',
    })).toThrow('sslmode=verify-full');
    expect(() => assertStrictTarget({
      databaseUrl: 'postgresql://postgres.otherprojectrefxxxx:x@aws-0.pooler.supabase.com/postgres?sslmode=verify-full',
      projectRef: 'abcdefghijklmnopqrst', environment: 'production', allowedEnvironment: 'production',
    })).toThrow('does not match');
  });

  it('preserves strict TLS and performs the fresh-target check inside the atomic apply', () => {
    expect(source).toContain('applyFreshProvisioning');
    expect(source).toContain('manifest.baseline.file');
    expect(source).toContain('verifyFreshProvisioning');
    const helper = fs.readFileSync(path.join(root, 'scripts/lib/provisioning.mjs'), 'utf8');
    expect(helper).toContain('rejectUnauthorized: true');
    expect(helper.indexOf("await client.query('BEGIN')", helper.indexOf('applyFreshProvisioning')))
      .toBeLessThan(helper.indexOf('await assertFreshTarget', helper.indexOf('applyFreshProvisioning')));
  });

  it('safely unwraps a migration transaction and excludes its post-COMMIT verification', async () => {
    const calls = [];
    const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; } };
    await applySqlUnit(client, {
      version: 'wrapped.sql', sha256: 'a'.repeat(64), customerId: 'customer',
      sql: 'BEGIN;\nCREATE TABLE example(id int);\nCOMMIT;\nSELECT 1;',
    });
    expect(calls.filter((call) => call.sql === 'BEGIN')).toHaveLength(1);
    expect(calls.some((call) => call.sql.includes('CREATE TABLE example'))).toBe(true);
    expect(calls.some((call) => call.sql.trim() === 'SELECT 1;')).toBe(false);
    expect(calls.at(-1).sql).toBe('COMMIT');
  });

  it('commits baseline, required migration bodies, and ledger entries in one transaction', async () => {
    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('information_schema.tables')) return { rows: [], rowCount: 0 };
        if (sql.includes("to_regclass('public.provisioning_migrations')")) return { rows: [{ ledger: null }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    };
    await applyFreshProvisioning(client, {
      customerId: 'customer',
      businessTables: ['students'],
      units: [
        { version: 'baseline.sql', sha256: 'a'.repeat(64), sql: 'CREATE TABLE students(id int);' },
        { version: 'migration.sql', sha256: 'b'.repeat(64), sql: 'BEGIN;\nALTER TABLE students ADD name text;\nCOMMIT;\nSELECT dangerous_verification();' },
      ],
    });

    expect(calls.filter((call) => call.sql === 'BEGIN')).toHaveLength(1);
    expect(calls.filter((call) => call.sql === 'COMMIT')).toHaveLength(1);
    expect(calls.filter((call) => call.sql.startsWith('INSERT INTO provisioning_migrations'))).toHaveLength(2);
    expect(calls.some((call) => call.sql.includes('SELECT dangerous_verification'))).toBe(false);
    expect(calls.at(0).sql).toBe('BEGIN');
    expect(calls.at(-1).sql).toBe('COMMIT');
  });

  it('rolls back the entire fresh installation when any migration body fails', async () => {
    const calls = [];
    const client = {
      query: async (sql) => {
        calls.push(sql);
        if (sql.includes('information_schema.tables')) return { rows: [], rowCount: 0 };
        if (sql.includes("to_regclass('public.provisioning_migrations')")) return { rows: [{ ledger: null }], rowCount: 1 };
        if (sql.includes('BROKEN BODY')) throw new Error('migration failed');
        return { rows: [], rowCount: 0 };
      },
    };

    await expect(applyFreshProvisioning(client, {
      customerId: 'customer',
      businessTables: ['students'],
      units: [
        { version: 'baseline.sql', sha256: 'a'.repeat(64), sql: 'CREATE TABLE students(id int);' },
        { version: 'broken.sql', sha256: 'b'.repeat(64), sql: 'BROKEN BODY;' },
      ],
    })).rejects.toThrow('migration failed');
    expect(calls.filter((sql) => sql === 'BEGIN')).toHaveLength(1);
    expect(calls.at(-1)).toBe('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });

  it('uses only read-only SELECTs for final verification', async () => {
    const calls = [];
    const unit = { version: 'baseline.sql', sha256: 'a'.repeat(64) };
    const client = {
      query: async (sql) => {
        calls.push(sql);
        if (sql.includes('information_schema.tables')) return { rows: [{ table_name: 'students' }], rowCount: 1 };
        if (sql.includes('pg_proc')) return { rows: [{ name: 'is_admin' }], rowCount: 1 };
        if (sql.includes('provisioning_migrations')) {
          return { rows: [{ version: unit.version, sha256: unit.sha256, customer_id: 'customer' }], rowCount: 1 };
        }
        if (sql.includes('count(*)')) return { rows: [{ count: '0' }], rowCount: 1 };
        throw new Error(`Unexpected verification query: ${sql}`);
      },
    };

    const verification = await verifyFreshProvisioning(client, {
      businessTables: ['students'], requiredFunctions: ['is_admin'], units: [unit], customerId: 'customer',
    });
    expect(verification.empty_business_data.empty).toBe(true);
    expect(calls.every((sql) => sql.trimStart().toUpperCase().startsWith('SELECT'))).toBe(true);
  });

  it('keeps optional operational migrations out of apply', () => {
    expect(source).toContain('optional_operational_migrations');
    expect(source).not.toContain('operationalMigrations) {');
  });
});
