import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardServerEnvironment } from './environment-guard';

const REF = 'aaaaaaaaaaaaaaaaaaaa';

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', `https://${REF}.supabase.co`);
  vi.stubEnv('SUPABASE_ANON_KEY', 'sb_publishable_server_test_key');
  vi.stubEnv('EXPECTED_SUPABASE_PROJECT_REF', REF);
  vi.stubEnv('ENVIRONMENT_KIND', 'test');
});

afterEach(() => vi.unstubAllEnvs());

describe('server environment guard', () => {
  it('returns a normalized environment for an exact identity match', () => {
    expect(guardServerEnvironment()).toEqual({
      ok: true,
      environment: {
        supabaseUrl: `https://${REF}.supabase.co`,
        supabaseAnonKey: 'sb_publishable_server_test_key',
        expectedSupabaseProjectRef: REF,
        environmentKind: 'test',
      },
    });
  });

  it('fails closed when required configuration is missing', () => {
    vi.stubEnv('EXPECTED_SUPABASE_PROJECT_REF', '');
    const result = guardServerEnvironment();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.body).toMatchObject({
        code: 'SERVER_ENV_MISSING',
        missing: ['EXPECTED_SUPABASE_PROJECT_REF'],
      });
    }
  });

  it('rejects project mismatches, unsupported kinds, and secret anon keys', () => {
    vi.stubEnv('SUPABASE_URL', 'https://bbbbbbbbbbbbbbbbbbbb.supabase.co');
    expect(guardServerEnvironment().ok).toBe(false);

    vi.stubEnv('SUPABASE_URL', `https://${REF}.supabase.co`);
    vi.stubEnv('ENVIRONMENT_KIND', 'customer');
    expect(guardServerEnvironment().ok).toBe(false);

    vi.stubEnv('ENVIRONMENT_KIND', 'production');
    vi.stubEnv('SUPABASE_ANON_KEY', 'sb_secret_server_key');
    expect(guardServerEnvironment().ok).toBe(false);
  });
});
