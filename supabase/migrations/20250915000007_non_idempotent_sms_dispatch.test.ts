import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migrationName = '20250915000007_non_idempotent_sms_dispatch.sql';
const sql = readFileSync(resolve(import.meta.dirname, migrationName), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/schema/migration-manifest.json'), 'utf8')) as {
  migrations: Array<{ file: string; phase: string; classification: string }>;
};

describe('non-idempotent SMS dispatch fence migration', () => {
  it('adds a non-reclaimable dispatching state and atomically verifies the live owning lease', () => {
    expect(sql).toContain("ALTER TYPE public.message_delivery_status ADD VALUE IF NOT EXISTS 'dispatching'");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.begin_non_idempotent_dispatch');
    expect(sql).toContain("v_delivery.status <> 'processing'::public.message_delivery_status");
    expect(sql).toContain('v_delivery.locked_by IS DISTINCT FROM p_worker_id');
    expect(sql).toContain('v_delivery.locked_at < now() - make_interval(secs => v_lease_seconds)');
    expect(sql).toContain("SET status = 'dispatching'::public.message_delivery_status");
    expect(sql).toContain("SET status = 'requires_review'::public.message_job_status");
  });

  it('permits only the owning worker to finalize dispatching and never schedules its retry', () => {
    expect(sql).toContain("v_delivery.status NOT IN ('processing'::public.message_delivery_status, 'dispatching'::public.message_delivery_status)");
    expect(sql).toContain("p_retryable AND v_delivery.status <> 'dispatching'::public.message_delivery_status");
    expect(sql).toContain("count(*) FILTER (WHERE status IN ('unknown', 'dispatching'))::INTEGER AS unknown_count");
    expect(sql).toContain("count(*) FILTER (WHERE d.status IN ('unknown', 'dispatching'))::INTEGER");
  });

  it('keeps the begin RPC service-role-only and includes the migration in required artifacts', () => {
    expect(sql).toContain('SECURITY DEFINER SET search_path = public, extensions');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.begin_non_idempotent_dispatch(UUID, TEXT) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.begin_non_idempotent_dispatch(UUID, TEXT) TO service_role;');
    expect(manifest.migrations).toContainEqual({ file: migrationName, phase: 'messaging', classification: 'required-security' });
  });
});
