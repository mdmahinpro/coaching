import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleHomeStats } from './stats-core';

const PROJECT_REF = 'hjzwbicauyxffrmdhvgy';
const PROJECT = `https://${PROJECT_REF}.supabase.co`;

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', PROJECT);
  vi.stubEnv('SUPABASE_ANON_KEY', 'sb_publishable_test_anon_key');
  vi.stubEnv('EXPECTED_SUPABASE_PROJECT_REF', PROJECT_REF);
  vi.stubEnv('ENVIRONMENT_KIND', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('handleHomeStats', () => {
  it('refuses lookup before I/O when the server project identity mismatches', async () => {
    vi.stubEnv('EXPECTED_SUPABASE_PROJECT_REF', 'bbbbbbbbbbbbbbbbbbbb');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await handleHomeStats()).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 when server configuration is missing', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const result = await handleHomeStats();
    expect(result.status).toBe(503);
  });

  it('returns the approved+active student count and the seed URL', async () => {
    vi.stubEnv('SUPABASE_URL', PROJECT);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: any) => {
      // Storage/auth-like calls are irrelevant here; the count path uses the
      // supabase client over fetch to PostgREST.
      if (String(url).includes('/rest/v1/students')) {
        return new Response('[]', { status: 200, headers: { 'content-range': '0-0/42' } });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleHomeStats();

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ students: 42 });
    // No student rows or secrets in the response body.
    expect(JSON.stringify(result.body)).not.toContain('"id"');
    expect(JSON.stringify(result.body)).not.toContain('test-service-key');
  });

  it('never returns student rows or internal errors on lookup failure', async () => {
    vi.stubEnv('SUPABASE_URL', PROJECT);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"message":"boom"}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleHomeStats();

    expect(result.status).toBe(502);
    expect(result.body).toEqual({ error: 'Stats lookup failed', code: 'STATS_LOOKUP_FAILED' });
    expect(JSON.stringify(result.body)).not.toMatch(/boom/);
    expect(JSON.stringify(result.body)).not.toContain('test-service-key');
  });

  it('surfaces a valid empty count as zero (honest)', async () => {
    vi.stubEnv('SUPABASE_URL', PROJECT);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('/rest/v1/students')) {
        return new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleHomeStats();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ students: 0 });
  });
});
