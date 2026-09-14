import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migrationName = '20250915000001_durable_message_outbox.sql';
const sql = readFileSync(resolve(import.meta.dirname, migrationName), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/schema/migration-manifest.json'), 'utf8')) as {
  migrations: Array<{ file: string; phase: string; classification: string }>;
};

describe('durable message outbox migration', () => {
  it('defines durable, idempotent job/delivery/attempt contracts and claim indexes', () => {
    expect(sql).toContain('CREATE TABLE public.message_jobs');
    expect(sql).toContain('idempotency_key TEXT NOT NULL UNIQUE');
    expect(sql).toContain('CREATE TABLE public.message_deliveries');
    expect(sql).toContain('UNIQUE (job_id, recipient)');
    expect(sql).toContain('CREATE TABLE public.message_attempts');
    expect(sql).toContain("CREATE TYPE public.message_delivery_status AS ENUM ('pending', 'processing', 'accepted', 'delivered', 'failed', 'bounced')");
    expect(sql).toContain('message_jobs_ready_idx');
    expect(sql).toContain('message_deliveries_claim_idx');
    expect(sql).toContain('message_attempts_created_at_idx');
  });

  it('allows browser admins to read only and reserves all writes/RPC processing for service_role', () => {
    for (const policy of [
      'messaging_configuration_admin_read',
      'message_jobs_admin_read',
      'message_deliveries_admin_read',
      'message_attempts_admin_read',
    ]) {
      expect(sql).toContain(`CREATE POLICY ${policy}`);
    }
    expect(sql).toContain('FOR SELECT TO authenticated USING (public.is_admin())');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('TO service_role;');
    expect(sql).not.toMatch(/CREATE POLICY message_[a-z_]+.*FOR (INSERT|UPDATE|DELETE|ALL) TO authenticated/s);
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.claim_message_deliveries(TEXT, INTEGER, INTEGER) TO service_role;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;');
  });

  it('makes provider credentials wholly server-only', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS provider_secrets_admin_all ON public.provider_secrets;');
    expect(sql).toContain('REVOKE ALL ON TABLE public.provider_secrets FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.provider_secrets TO service_role;');
    expect(sql).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*provider_secrets[^;]*TO\s+(anon|authenticated|PUBLIC)/i);
  });

  it('replaces admission approval atomically without placing the saved reference or password in message content', () => {
    const approval = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.admin_approve_admission'));
    expect(approval).toContain("'admission-approved:' || a.id::TEXT");
    expect(approval).toContain("'admission_approval'");
    expect(approval).toContain('Use the admission reference you already saved as your initial password.');
    expect(approval).toContain('the reference is not repeated in this message.');
    expect(approval).not.toMatch(/jsonb_build_object\([\s\S]*?(a\.reference_no|p_password)/);
    expect(approval).toContain("RETURN QUERY SELECT s.student_id, s.id, 'approved'::TEXT, true;");
  });

  it('stores only sanitized attempt failures and strips all message/secret tables from backups', () => {
    expect(sql).toContain("failure_category IS NULL OR failure_category IN ('configuration', 'authentication', 'rate_limit', 'provider', 'network', 'invalid_recipient', 'unknown')");
    expect(sql).toContain('char_length(failure_message) <= 500');
    expect(sql).not.toMatch(/message_attempts[\s\S]{0,1500}(raw_response|provider_response|request_body|headers)\s+[^,]+[,)]/i);
    for (const table of ['provider_secrets', 'message_jobs', 'message_deliveries', 'message_attempts', 'messaging_configuration']) {
      expect(sql).toContain(`- '${table}'`);
    }
    expect(sql).toContain("IF to_regclass('public.backups') IS NOT NULL THEN");
  });

  it('is a required security migration in the authoritative manifest', () => {
    expect(manifest.migrations).toContainEqual({
      file: migrationName,
      phase: 'messaging',
      classification: 'required-security',
    });
  });
});
