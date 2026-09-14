import { describe, expect, it } from 'vitest';
import { validateBrowserEnvironment } from './environmentContract';

const valid = {
  VITE_SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_browser_test_key',
  VITE_EXPECTED_SUPABASE_PROJECT_REF: 'aaaaaaaaaaaaaaaaaaaa',
  VITE_ENVIRONMENT_KIND: 'production',
};

describe('browser deployment environment contract', () => {
  it('accepts an exact declared project identity', () => {
    expect(validateBrowserEnvironment(valid)).toEqual(valid);
  });

  it('requires the production identity declarations', () => {
    expect(() =>
      validateBrowserEnvironment({
        VITE_SUPABASE_URL: valid.VITE_SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: valid.VITE_SUPABASE_ANON_KEY,
      })
    ).toThrow(/VITE_EXPECTED_SUPABASE_PROJECT_REF, VITE_ENVIRONMENT_KIND/);
  });

  it.each([
    'https://bbbbbbbbbbbbbbbbbbbb.supabase.co',
    'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/',
    'http://aaaaaaaaaaaaaaaaaaaa.supabase.co',
    'https://aaaaaaaaaaaaaaaaaaaa.supabase.co/rest/v1',
  ])('rejects a URL that is not the exact project origin: %s', (url) => {
    expect(() => validateBrowserEnvironment({ ...valid, VITE_SUPABASE_URL: url })).toThrow(
      /does not exactly match/
    );
  });

  it('rejects unsupported kinds and browser secret keys', () => {
    expect(() =>
      validateBrowserEnvironment({ ...valid, VITE_ENVIRONMENT_KIND: 'customer' })
    ).toThrow(/Unsupported/);
    expect(() =>
      validateBrowserEnvironment({ ...valid, VITE_SUPABASE_ANON_KEY: 'sb_secret_not_public' })
    ).toThrow(/privileged/);
  });
});
