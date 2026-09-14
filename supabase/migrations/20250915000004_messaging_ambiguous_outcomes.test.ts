import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migrationName = '20250915000004_messaging_ambiguous_outcomes.sql';
const sql = readFileSync(resolve(import.meta.dirname, migrationName), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/schema/migration-manifest.json'), 'utf8')) as {
  migrations: Array<{ file: string; phase: string; classification: string }>;
};

describe('ambiguous messaging outcome migration', () => {
  it('adds forward-safe operator review states without rebuilding enums', () => {
    expect(sql).toContain("ALTER TYPE public.message_delivery_status ADD VALUE IF NOT EXISTS 'unknown'");
    expect(sql).toContain("ALTER TYPE public.message_job_status ADD VALUE IF NOT EXISTS 'requires_review'");
    expect(sql).not.toMatch(/DROP TYPE|CREATE TYPE/);
  });

  it('aggregates unknown deliveries into requires_review and retains provider ids', () => {
    expect(sql).toContain("WHEN p_failure_category = 'unknown' THEN 'unknown'::public.message_delivery_status");
    expect(sql).toContain("WHEN count(*) FILTER (WHERE status = 'unknown') > 0 THEN 'requires_review'::public.message_job_status");
    expect(sql).toContain('provider_message_id = COALESCE(p_provider_message_id, provider_message_id)');
    expect(sql).toContain("count(*) FILTER (WHERE status = 'unknown')::INTEGER AS unknown_count");
  });

  it('does not widen the claim RPC to reclaim unknown deliveries', () => {
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.claim_message_deliveries');
  });

  it('is present in the authoritative messaging manifest', () => {
    expect(manifest.migrations).toContainEqual({
      file: migrationName,
      phase: 'messaging',
      classification: 'required-security',
    });
  });
});
