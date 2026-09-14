import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migrationName = '20250915000002_messaging_worker_heartbeat.sql';
const sql = readFileSync(resolve(import.meta.dirname, migrationName), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/schema/migration-manifest.json'), 'utf8')) as {
  migrations: Array<{ file: string; phase: string; classification: string }>;
};

describe('messaging worker heartbeat migration', () => {
  it('adds a non-secret singleton heartbeat writable only by service_role', () => {
    expect(sql).toContain('CREATE TABLE public.messaging_worker_heartbeat');
    expect(sql).toContain("CHECK (id = 'messaging-worker')");
    expect(sql).toContain('last_success_at TIMESTAMPTZ');
    expect(sql).toContain('REVOKE ALL ON TABLE public.messaging_worker_heartbeat FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT SELECT, UPDATE ON TABLE public.messaging_worker_heartbeat TO service_role;');
    expect(sql).not.toMatch(/(secret|token|credential)\s+(TEXT|JSONB)/i);
  });

  it('is a required forward messaging migration', () => {
    expect(manifest.migrations).toContainEqual({ file: migrationName, phase: 'messaging', classification: 'required-security' });
  });
});
