import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { compareLedger, expectedMigrationLedger, prerequisiteReport, tableCount } from './lib/onboarding.mjs';
import {
  EXTRA_FRESH_BUSINESS_TABLES,
  MESSAGING_DEFAULTS,
  SITE_SETTING_DEFAULTS,
  main,
  validateSeededConfiguration,
} from './onboarding-preflight.mjs';

const root = process.cwd();
const preflightSource = fs.readFileSync(path.join(root, 'scripts/onboarding-preflight.mjs'), 'utf8');
const helperSource = fs.readFileSync(path.join(root, 'scripts/lib/onboarding.mjs'), 'utf8');
const seededFreshState = {
  siteSettings: Object.entries(SITE_SETTING_DEFAULTS).map(([key, value], index) => ({
    id: index + 1, key, value, updated_at: '2026-01-01T00:00:00Z',
  })),
  messagingConfiguration: Object.entries(MESSAGING_DEFAULTS).map(([channel, values], index) => ({
    channel, ...values,
    provider_config: channel === 'sms' ? { providerName: 'mim', userName: 'configure-me', senderName: 'MIM' } : { providerName: 'resend', from: 'configure@example.invalid' },
    config_revision: `${index + 1}1111111-1111-4111-8111-111111111111`,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  })),
};

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('onboarding preflight', () => {
  it('compares every required migration by version and checksum', () => {
    const expected = [{ version: 'a.sql', sha256: 'aaa' }, { version: 'b.sql', sha256: 'bbb' }];
    expect(compareLedger(expected, expected)).toMatchObject({ ok: true, missing: [], mismatched: [] });
    expect(compareLedger(expected, [{ version: 'a.sql', sha256: 'wrong' }])).toMatchObject({
      ok: false, missing: ['b.sql'], mismatched: ['a.sql'],
    });
  });

  it('limits zero-row checks to business/transaction tables', () => {
    expect(EXTRA_FRESH_BUSINESS_TABLES).toEqual(expect.arrayContaining([
      'contact_messages', 'message_jobs', 'message_deliveries', 'message_attempts',
    ]));
    expect(EXTRA_FRESH_BUSINESS_TABLES).not.toContain('site_settings');
    expect(EXTRA_FRESH_BUSINESS_TABLES).not.toContain('messaging_configuration');
    expect(helperSource).toContain("Prefer: 'count=exact'");
    expect(helperSource).toContain("method: 'HEAD'");
    expect(preflightSource).not.toMatch(/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
  });

  it('accepts only the expected seeded safe configuration fixture', () => {
    expect(validateSeededConfiguration(
      seededFreshState.siteSettings,
      seededFreshState.messagingConfiguration,
    )).toMatchObject({ ok: true, siteSettings: { rowCount: 2 }, messagingConfiguration: { rowCount: 2 } });

    const secretColumn = [{ ...seededFreshState.messagingConfiguration[0], api_key: 'not-allowed' }];
    expect(validateSeededConfiguration(seededFreshState.siteSettings, secretColumn).ok).toBe(false);
    const wrongProvider = seededFreshState.messagingConfiguration.map((row) => (
      row.channel === 'sms' ? { ...row, provider_name: 'other' } : row
    ));
    expect(validateSeededConfiguration(seededFreshState.siteSettings, wrongProvider).ok).toBe(false);
  });

  it('reports coreReady honestly but handoverReady false for a seeded fresh state without providers', async () => {
    const { entries } = await expectedMigrationLedger();
    const json = (value) => new Response(JSON.stringify(value), { status: 200 });
    const fetchFixture = vi.fn(async (url, options = {}) => {
      if (options.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'content-range': '0-0/0' } });
      }
      if (url.includes('/provisioning_migrations?')) {
        return json(entries);
      }
      if (url.includes('/site_settings?')) {
        return json(seededFreshState.siteSettings);
      }
      if (url.includes('/messaging_configuration?')) {
        return json(seededFreshState.messagingConfiguration);
      }
      if (url.includes('/messaging_provider_credentials?')) {
        return json([]);
      }
      if (url.endsWith('/storage/v1/bucket')) {
        return json([{ id: 'avatars', public: false }, { id: 'public-assets', public: true }]);
      }
      if (url.includes('/auth/v1/admin/users')) {
        return json({ users: [{
          id: '123e4567-e89b-42d3-a456-426614174000', email: 'owner@example.com',
          email_confirmed_at: '2026-01-01T00:00:00Z', email_change: '',
          identities: [{
            provider: 'email', user_id: '123e4567-e89b-42d3-a456-426614174000',
            identity_data: { email: 'owner@example.com' },
          }],
        }] });
      }
      if (url.includes('/admin_users?')) {
        return json([{ user_id: '123e4567-e89b-42d3-a456-426614174000', email: 'owner@example.com' }]);
      }
      throw new Error(`Unexpected fixture URL: ${url}`);
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const report = await main(fetchFixture, {
      ONBOARD_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co/',
      ONBOARD_PROJECT_REF: 'abcdefghijklmnopqrst',
      ONBOARD_ENVIRONMENT: 'production',
      ONBOARD_ALLOWED_ENVIRONMENT: 'production',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
      BOOTSTRAP_ADMIN_USER_ID: '123e4567-e89b-42d3-a456-426614174000',
      BOOTSTRAP_ADMIN_EMAIL: 'owner@example.com',
    });
    expect(report.coreReady).toBe(true);
    expect(report.handoverReady).toBe(false);
    expect(report.providers.active).toEqual([]);
    expect(report.providers.ready).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(JSON.stringify(report)).not.toContain('service-role-secret');
  });

  it('reads an exact table count from Content-Range and fails if unavailable', async () => {
    const okFetch = async () => new Response(null, { status: 200, headers: { 'content-range': '0-0/0' } });
    await expect(tableCount(okFetch, {
      origin: 'https://abcdefghijklmnopqrst.supabase.co', serviceRoleKey: 'secret', table: 'students',
    })).resolves.toBe(0);
    const badFetch = async () => new Response(null, { status: 200 });
    await expect(tableCount(badFetch, {
      origin: 'https://abcdefghijklmnopqrst.supabase.co', serviceRoleKey: 'secret', table: 'students',
    })).rejects.toThrow('count unavailable');
  });

  it('reports provider readiness as booleans and never exposes credential values', () => {
    const env = {
      MIM_API_ACTIVATED: '1', MIM_WHITELIST_CONFIRMED: '1', MIM_EXPECTED_SENDER_ID: 'ExactSender',
      SMS_SENDER_NAME: 'ExactSender', SMS_USERNAME: 'username-secret', SMS_API_KEY: 'key-secret',
      RESEND_API_KEY: 'resend-secret', RESEND_FROM: 'Sender <sender@example.com>',
      RESEND_WEBHOOK_SECRET: 'webhook-secret', RESEND_DOMAIN_VERIFIED: '1',
    };
    const configurations = [
      { channel: 'sms', provider_name: 'mim', enabled: true, provider_config: { providerName: 'mim' }, config_revision: 'r1' },
      { channel: 'email', provider_name: 'custom', enabled: true, provider_config: { providerName: 'custom' }, config_revision: 'r2' },
    ];
    const credentials = [{ channel: 'email', provider_name: 'custom', config_revision: 'r2' }];
    const report = prerequisiteReport(env, configurations, credentials);
    expect(report.ready).toBe(true);
    expect(report.active).toHaveLength(2);
    expect(report.liveDeliveryVerified).toBe(false);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('username-secret');
    expect(serialized).not.toContain('key-secret');
    expect(serialized).not.toContain('resend-secret');
    expect(serialized).not.toContain('webhook-secret');
  });

  it('checks only enabled providers and supports encrypted custom credentials', () => {
    const rows = [
      { channel: 'sms', provider_name: 'mim', enabled: false, provider_config: { providerName: 'mim' }, config_revision: 'old' },
      { channel: 'email', provider_name: 'custom', enabled: true, provider_config: { providerName: 'custom' }, config_revision: 'new' },
    ];
    const withoutCredential = prerequisiteReport({}, rows, []);
    expect(withoutCredential).toMatchObject({ ready: false, active: [{ providerName: 'custom', credentialConfigured: false }] });
    const withCredential = prerequisiteReport({}, rows, [{ channel: 'email', provider_name: 'custom', config_revision: 'new' }]);
    expect(withCredential).toMatchObject({ ready: true, active: [{ providerName: 'custom', credentialConfigured: true }] });
  });
});
