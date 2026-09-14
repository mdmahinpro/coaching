import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertBootstrapAuthUser,
  assertHttpsIdentity,
  assertNoPasswordInput,
  findAuthUserByEmail,
  getAdminRosterEntry,
  insertAdminRosterEntry,
} from './lib/onboarding.mjs';

const identity = {
  supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co/',
  projectRef: 'abcdefghijklmnopqrst', environment: 'production', allowedEnvironment: 'production', serviceRoleKey: 'service-secret',
};
const source = fs.readFileSync(path.join(process.cwd(), 'scripts/bootstrap-first-admin.mjs'), 'utf8');
const userId = '123e4567-e89b-42d3-a456-426614174000';
const confirmedEmailUser = {
  id: userId,
  email: 'admin@example.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  email_change: '',
  identities: [{ provider: 'email', user_id: userId, identity_data: { email: 'admin@example.com' } }],
};

function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }

describe('first-admin bootstrap safety', () => {
  it('requires exact project/environment identity and HTTPS origin', () => {
    expect(assertHttpsIdentity(identity)).toBe('https://abcdefghijklmnopqrst.supabase.co');
    expect(() => assertHttpsIdentity({ ...identity, environment: 'staging' })).toThrow('Environment identity mismatch');
    expect(() => assertHttpsIdentity({ ...identity, supabaseUrl: 'https://example.com/' })).toThrow('exact HTTPS origin');
    expect(() => assertHttpsIdentity({ ...identity, supabaseUrl: 'http://abcdefghijklmnopqrst.supabase.co/' })).toThrow('exact HTTPS origin');
  });

  it('rejects password variables and password arguments', () => {
    expect(() => assertNoPasswordInput({ ADMIN_PASSWORD: 'forbidden' }, [])).toThrow('Password input is forbidden');
    expect(() => assertNoPasswordInput({}, ['--password=forbidden'])).toThrow('Password input is forbidden');
    expect(() => assertNoPasswordInput({}, [])).not.toThrow();
  });

  it('defaults to dry-run and binds apply confirmation to UUID/email/project/environment', () => {
    expect(source).toContain("process.env.BOOTSTRAP_ADMIN_APPLY === '1'");
    expect(source).toContain('ADD ${userId} ${email} TO ${projectRef}/${environment}');
    expect(source).toContain('BOOTSTRAP_ADMIN_CONFIRM !== confirmation');
  });

  it('finds only an already-existing auth user by exact UUID and email', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ users: [confirmedEmailUser] }));
    await expect(findAuthUserByEmail(fetchMock, {
      origin: 'https://abcdefghijklmnopqrst.supabase.co', serviceRoleKey: 'secret',
      userId, email: 'admin@example.com',
    })).resolves.toEqual(confirmedEmailUser);
    expect(fetchMock.mock.calls[0][0]).toContain('/auth/v1/admin/users?');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer secret');
  });

  it('requires exact UUID/email equality, confirmed approved identity, and no pending email change', () => {
    expect(() => assertBootstrapAuthUser({ ...confirmedEmailUser, email: 'Admin@example.com' }, {
      userId, email: 'admin@example.com',
    })).toThrow('exactly match');
    expect(() => assertBootstrapAuthUser({ ...confirmedEmailUser, email_confirmed_at: null }, {
      userId, email: 'admin@example.com',
    })).toThrow('not confirmed');
    expect(() => assertBootstrapAuthUser({ ...confirmedEmailUser, email_change: 'next@example.com' }, {
      userId, email: 'admin@example.com',
    })).toThrow('pending email change');
    expect(() => assertBootstrapAuthUser({ ...confirmedEmailUser, identities: [] }, {
      userId, email: 'admin@example.com',
    })).toThrow('approved email identity');
    expect(() => assertBootstrapAuthUser({ ...confirmedEmailUser, identities: [{
      provider: 'google', user_id: userId, identity_data: { email: 'admin@example.com' },
    }] }, { userId, email: 'admin@example.com' })).toThrow('approved email identity');
  });

  it('fails closed when auth user does not already exist', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ users: [] }));
    await expect(findAuthUserByEmail(fetchMock, {
      origin: 'https://abcdefghijklmnopqrst.supabase.co', serviceRoleKey: 'secret',
      userId, email: 'missing@example.com',
    })).rejects.toThrow('No existing Supabase Auth user');
  });

  it('uses read-only lookup before the narrowly scoped admin_users insert', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([{ user_id: 'u1', email: 'admin@example.com' }], 201));
    const args = { origin: 'https://abcdefghijklmnopqrst.supabase.co', serviceRoleKey: 'secret', userId: 'u1' };
    await expect(getAdminRosterEntry(fetchMock, args)).resolves.toBeNull();
    await insertAdminRosterEntry(fetchMock, {
      origin: args.origin, serviceRoleKey: args.serviceRoleKey, user: { id: 'u1', email: 'admin@example.com' },
    });
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
    expect(fetchMock.mock.calls[1][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ user_id: 'u1', email: 'admin@example.com' });
    expect(fetchMock.mock.calls[1][1].body).not.toMatch(/password/i);
  });
});
