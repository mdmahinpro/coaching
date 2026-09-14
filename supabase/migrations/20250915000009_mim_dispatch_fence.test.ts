import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migrationName = '20250915000009_mim_dispatch_fence.sql';
const sql = readFileSync(resolve(import.meta.dirname, migrationName), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/schema/migration-manifest.json'), 'utf8')) as {
  migrations: Array<{ file: string; phase: string; classification: string }>;
};

function functionBody(): string {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.begin_non_idempotent_dispatch');
  const end = sql.indexOf('REVOKE ALL ON FUNCTION public.begin_non_idempotent_dispatch');
  return sql.slice(start, end);
}

describe('MIM dispatch fencing forward migration', () => {
  it('is required and ordered immediately after the provider-neutral migration', () => {
    const files = manifest.migrations.map((entry) => entry.file);
    expect(manifest.migrations).toContainEqual({
      file: migrationName,
      phase: 'messaging',
      classification: 'required-security',
    });
    expect(files.indexOf(migrationName)).toBe(files.indexOf('20250915000008_provider_neutral_messaging.sql') + 1);
  });

  it('accepts real MIM snapshots without requiring an idempotency placement', () => {
    const body = functionBody();
    expect(body).toContain("IF v_provider_name = 'mim' THEN");
    expect(body).not.toMatch(/v_provider_name = 'mim'[^;]+v_idempotency_placement/s);
  });

  it('accepts only explicit none idempotency for custom providers and rejects Resend/header/body snapshots', () => {
    const body = functionBody();
    expect(body).toContain("ELSIF v_provider_name = 'custom' AND v_idempotency_placement = 'none' THEN");
    expect(body).toContain("RAISE EXCEPTION 'Provider snapshot is not non-idempotent'");
    expect(body).not.toMatch(/v_provider_name\s*=\s*'resend'/);
    expect(body).not.toMatch(/v_idempotency_placement\s+IN\s*\([^)]*'header'|'body'/);
  });

  it('preserves lease ownership, non-reclaimable dispatching, and derived requires-review aggregation', () => {
    const body = functionBody();
    for (const contract of [
      "v_delivery.status <> 'processing'::public.message_delivery_status",
      'v_delivery.locked_by IS DISTINCT FROM p_worker_id',
      'v_delivery.locked_at IS NULL',
      'v_delivery.locked_at < now() - make_interval(secs => v_lease_seconds)',
      "status = 'dispatching'::public.message_delivery_status",
      'FOR UPDATE;',
      "status = 'requires_review'::public.message_job_status",
      "status IN ('unknown', 'dispatching')",
    ]) expect(body).toContain(contract);
    expect(body).not.toContain('unknown_count=unknown_count+1');
  });

  it('keeps the RPC service-role-only', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.begin_non_idempotent_dispatch(UUID, TEXT) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.begin_non_idempotent_dispatch(UUID, TEXT) TO service_role;');
  });
});
