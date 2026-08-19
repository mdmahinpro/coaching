import { describe, expect, it } from 'vitest';
import {
  assertPublicSupabaseClientKey,
  classifySupabaseClientKey,
  isPublicSupabaseClientKey,
} from './supabaseKey';

function jwtWithRole(role: string): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role })}.signature`;
}

describe('Supabase client key validation', () => {
  it('accepts public publishable keys', () => {
    const key = 'sb_publishable_public-browser-key';

    expect(classifySupabaseClientKey(key)).toBe('publishable');
    expect(isPublicSupabaseClientKey(key)).toBe(true);
    expect(() => assertPublicSupabaseClientKey(key)).not.toThrow();
  });

  it('accepts legacy anon JWTs', () => {
    const key = jwtWithRole('anon');

    expect(classifySupabaseClientKey(key)).toBe('anon');
    expect(isPublicSupabaseClientKey(key)).toBe(true);
  });

  it('rejects secret keys', () => {
    const key = 'sb_secret_privileged-server-key';

    expect(classifySupabaseClientKey(key)).toBe('privileged');
    expect(() => assertPublicSupabaseClientKey(key)).toThrow(/privileged Supabase key/);
  });

  it('rejects legacy service-role JWTs', () => {
    const key = jwtWithRole('service_role');

    expect(classifySupabaseClientKey(key)).toBe('privileged');
    expect(() => assertPublicSupabaseClientKey(key)).toThrow(/rotate the exposed privileged key/);
  });

  it('rejects malformed or placeholder values', () => {
    expect(classifySupabaseClientKey('not-a-supabase-key')).toBe('invalid');
    expect(() => assertPublicSupabaseClientKey('not-a-supabase-key')).toThrow(
      /public anon JWT or sb_publishable_ key/
    );
  });
});
