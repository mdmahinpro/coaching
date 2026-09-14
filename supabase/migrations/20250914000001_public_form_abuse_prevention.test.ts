import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migrationName = '20250914000001_public_form_abuse_prevention.sql';
const sql = readFileSync(resolve(import.meta.dirname, migrationName), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/schema/migration-manifest.json'), 'utf8')) as {
  migrations: Array<{ file: string; classification: string }>;
};

describe('public form abuse-prevention migration', () => {
  it('removes direct anonymous inserts and exposes only a service-role RPC', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "anon_insert_admission_requests"');
    expect(sql).toContain('DROP POLICY IF EXISTS "anon_insert_contact_messages"');
    expect(sql).toContain('REVOKE INSERT ON public.admission_requests FROM anon');
    expect(sql).toContain('REVOKE INSERT ON public.contact_messages FROM anon');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.submit_public_form(TEXT, INET, JSONB, TEXT) TO service_role');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.submit_public_form(TEXT, INET, JSONB, TEXT) FROM PUBLIC, anon, authenticated');
  });

  it('enforces durable IP, phone, and email counters atomically', () => {
    expect(sql).toContain('public.public_form_rate_events');
    expect(sql).toContain('ip_hash');
    expect(sql).toContain('phone_hash');
    expect(sql).toContain('email_hash');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain("MESSAGE = 'rate_limited'");
  });

  it('is listed in the authoritative required migration manifest', () => {
    expect(manifest.migrations).toContainEqual({
      file: migrationName,
      phase: 'security',
      classification: 'required-security',
    });
  });
});
