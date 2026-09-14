import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migrationName = '20250915000003_messaging_channel_claims.sql';
const sql = readFileSync(resolve(import.meta.dirname, migrationName), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/schema/migration-manifest.json'), 'utf8')) as {
  migrations: Array<{ file: string; phase: string; classification: string }>;
};

describe('messaging channel claim migration', () => {
  it('upserts enabled non-secret defaults for MIM SMS and Resend email', () => {
    expect(sql).toContain("('sms'::public.message_channel, 'mim', true)");
    expect(sql).toContain("('email'::public.message_channel, 'resend', true)");
    expect(sql).toContain('ON CONFLICT (channel) DO UPDATE');
    expect(sql).not.toMatch(/(api.?key|password|secret|token)\s*=/i);
  });

  it('removes the unscoped claim RPC and requires a non-null channel filter', () => {
    expect(sql).toContain('DROP FUNCTION public.claim_message_deliveries(TEXT, INTEGER, INTEGER);');
    expect(sql).toContain('p_channel public.message_channel');
    expect(sql).toContain('IF p_channel IS NULL THEN');
    expect(sql).toContain('WHERE j.channel = p_channel');
    expect(sql).toContain('AND c.enabled');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.claim_message_deliveries(TEXT, public.message_channel, INTEGER, INTEGER) TO service_role;');
  });

  it('is a required migration for fresh installs and upgrades', () => {
    expect(manifest.migrations).toContainEqual({
      file: migrationName,
      phase: 'messaging',
      classification: 'required-security',
    });
  });
});
