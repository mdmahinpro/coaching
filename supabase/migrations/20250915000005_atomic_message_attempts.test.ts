import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migrationName = '20250915000005_atomic_message_attempts.sql';
const sql = readFileSync(resolve(import.meta.dirname, migrationName), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/schema/migration-manifest.json'), 'utf8')) as {
  migrations: Array<{ file: string; phase: string; classification: string }>;
};

describe('atomic messaging attempt migration', () => {
  it('extends the attempt outcome forward-safely and permits sanitized unknown metadata', () => {
    expect(sql).toContain("ALTER TYPE public.message_attempt_outcome ADD VALUE IF NOT EXISTS 'unknown'");
    expect(sql).toContain("outcome NOT IN ('accepted', 'delivered')");
    expect(sql).not.toMatch(/DROP TYPE|CREATE TYPE/);
  });

  it('atomically records the attempt, verifies lease ownership, transitions state, clears lease, and aggregates unknown', () => {
    expect(sql).toContain("v_delivery.locked_by IS DISTINCT FROM p_worker_id");
    expect(sql).toContain('PERFORM 1 FROM public.message_jobs AS j WHERE j.id = v_delivery.job_id FOR UPDATE');
    expect(sql).toContain('INSERT INTO public.message_attempts');
    expect(sql).toContain("WHEN p_outcome = 'unknown' THEN 'unknown'::public.message_delivery_status");
    expect(sql).toContain("WHEN p_retryable AND v_delivery.attempt_count < v_max_attempts THEN 'pending'");
    expect(sql).toContain('locked_at = NULL');
    expect(sql).toContain('locked_by = NULL');
    expect(sql).toContain("WHEN count(*) FILTER (WHERE status = 'unknown') > 0 THEN 'requires_review'::public.message_job_status");
    expect(sql).toContain("count(*) FILTER (WHERE status = 'unknown')::INTEGER AS unknown_count");
  });

  it('provides a job-specific SKIP LOCKED claim restricted to service role', () => {
    expect(sql).toContain('FUNCTION public.claim_message_job_delivery');
    expect(sql).toContain('d.job_id = p_job_id');
    expect(sql).toContain('FOR UPDATE OF d SKIP LOCKED');
    expect(sql).toContain('locked_by = p_worker_id');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.claim_message_job_delivery(UUID, TEXT, INTEGER) TO service_role');
  });

  it('is required by the authoritative migration manifest', () => {
    expect(manifest.migrations).toContainEqual({ file: migrationName, phase: 'messaging', classification: 'required-security' });
  });
});
