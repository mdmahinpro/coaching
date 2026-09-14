import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const root = resolve(import.meta.dirname, '../..');
const migrationName = '20250915000008_provider_neutral_messaging.sql';
const sql = readFileSync(resolve(import.meta.dirname, migrationName), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/schema/migration-manifest.json'), 'utf8')) as { migrations: Array<{ file: string; phase: string; classification: string }> };
describe('authoritative provider-neutral messaging migration', () => {
  it('is a required messaging security migration', () => expect(manifest.migrations).toContainEqual({ file: migrationName, phase: 'messaging', classification: 'required-security' }));
  it('stores only safe provider JSON plus UUID revision and operational fields', () => {
    expect(sql).toContain('ADD COLUMN provider_config JSONB');
    expect(sql).toContain('ADD COLUMN config_revision UUID');
    expect(sql).toContain('_messaging_provider_config_valid');
    expect(sql).toMatch(/max_attempts|base_retry_seconds|lease_seconds/);
    for (const rejected of ["ARRAY['headers','body','bodyTemplate','script']", '__proto__', 'authorization', 'eval']) expect(sql.toLowerCase()).toContain(rejected.toLowerCase());
  });
  it('uses service-role-only versioned canonical-base64 credential rows', () => {
    expect(sql).toContain('PRIMARY KEY (channel, provider_name, config_revision)');
    for (const column of ['ciphertext TEXT', 'iv TEXT', 'auth_tag TEXT', 'key_id TEXT', 'fingerprint TEXT', 'hint TEXT']) expect(sql).toContain(column);
    expect(sql).toContain('REVOKE ALL ON TABLE public.messaging_provider_credentials FROM PUBLIC, anon, authenticated');
  });
  it('keeps enqueue at seven arguments and snapshots configuration internally', () => {
    expect(sql).toContain('p_recipients TEXT[], p_available_at TIMESTAMPTZ DEFAULT now()');
    expect(sql).toContain('v_config.provider_name,v_config.provider_config,v_config.config_revision');
    const enqueue = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.enqueue_message_job'), sql.indexOf('-- Service-role RPC'));
    expect(enqueue).not.toMatch(/p_provider_name|p_provider_config_snapshot|p_revision/);
  });
  it('atomically saves/rotates/removes credentials and protects queued jobs', () => {
    expect(sql).toContain('FUNCTION public.save_messaging_configuration');
    expect(sql).toContain("p_secret_action NOT IN ('preserve','replace','remove')");
    expect(sql).toContain('credential versions referenced by nonterminal jobs');
    expect(sql).toContain('FUNCTION public.remove_messaging_configuration');
  });
  it('returns provider, config snapshot, and exact UUID revision from both claims', () => {
    expect(sql.match(/provider_config_revision UUID/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql.match(/j\.provider_name,j\.provider_config_snapshot,j\.provider_config_revision/g)?.length).toBe(2);
    expect(sql).toContain("provider_config_snapshot #>> '{idempotency,placement}'");
  });
});
