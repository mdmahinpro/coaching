import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migrationName = '20250915000006_atomic_message_job_aggregate.sql';
const sql = readFileSync(resolve(import.meta.dirname, migrationName), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/schema/migration-manifest.json'), 'utf8')) as {
  migrations: Array<{ file: string; phase: string; classification: string }>;
};

function position(fragment: string): number {
  const index = sql.indexOf(fragment);
  expect(index, `missing SQL fragment: ${fragment}`).toBeGreaterThan(-1);
  return index;
}

describe('atomic message job aggregate migration', () => {
  it('serializes concurrent refreshes on the job row before reading delivery counts or updating the job', () => {
    const lock = position('WHERE j.id = p_job_id\n  FOR UPDATE;');
    const aggregateRead = position('FROM public.message_deliveries AS d\n  WHERE d.job_id = p_job_id;');
    const aggregateWrite = position('UPDATE public.message_jobs AS j');

    expect(lock).toBeLessThan(aggregateRead);
    expect(aggregateRead).toBeLessThan(aggregateWrite);
    expect(sql).toContain('SET status = v_job_status');
    expect(sql).toContain('updated_at = now()');
  });

  it('counts every delivery state including unknown and returns the complete typed API summary', () => {
    for (const state of ['accepted', 'delivered', 'failed', 'bounced', 'unknown']) {
      expect(sql).toContain(`d.status = '${state}'`);
    }
    expect(sql).toContain("d.status IN ('pending', 'processing')");
    expect(sql).toMatch(/RETURNS TABLE \([\s\S]*job_id UUID,[\s\S]*status TEXT,[\s\S]*total INTEGER,[\s\S]*accepted INTEGER,[\s\S]*failed INTEGER,[\s\S]*pending INTEGER,[\s\S]*unknown INTEGER,[\s\S]*requires_review BOOLEAN,[\s\S]*dry_run BOOLEAN/);
    expect(sql).toContain('v_accepted_count + v_delivered_count');
    expect(sql).toContain('v_failed_count + v_bounced_count');
  });

  it('is service-role-only and a required forward migration', () => {
    expect(sql).toContain('SECURITY DEFINER SET search_path = public, extensions');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.refresh_message_job_aggregate(UUID) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.refresh_message_job_aggregate(UUID) TO service_role;');
    expect(manifest.migrations).toContainEqual({ file: migrationName, phase: 'messaging', classification: 'required-security' });
  });
});
