import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMessagingConfiguration } from './messaging-core';
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
const revision = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co'); vi.stubEnv('SUPABASE_ANON_KEY', 'sb_publishable_synthetic'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test'); vi.stubEnv('EXPECTED_SUPABASE_PROJECT_REF', 'aaaaaaaaaaaaaaaaaaaa'); vi.stubEnv('ENVIRONMENT_KIND', 'test');
  vi.stubEnv('MESSAGING_ENCRYPTION_KEYS_JSON', JSON.stringify({ current: 'v1', keys: { v1: randomBytes(32).toString('base64') } }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('admin provider-neutral messaging configuration API', () => {
  it('GET returns safe metadata and credential booleans/fingerprint hints only', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input); if (url.endsWith('/rpc/is_admin')) return json(true);
      if (url.includes('messaging_configuration?select=')) return json([{ channel: 'email', provider_name: 'resend', enabled: true, provider_config: { providerName: 'resend', from: 'Coach <n@example.com>' }, config_revision: revision }]);
      if (url.includes('messaging_provider_credentials?select=')) return json([{ channel: 'email', provider_name: 'resend', config_revision: revision, fingerprint: 'a'.repeat(64), hint: '…1234', ciphertext: 'must-not-leak' }]);
      return json([]);
    }));
    expect((await handleMessagingConfiguration('GET', undefined)).status).toBe(401);
    const response = await handleMessagingConfiguration('GET', 'Bearer admin');
    expect(response.body).toMatchObject({ configurations: [{ channel: 'email', providerName: 'resend', enabled: true, configRevision: revision, credentialConfigured: true, credentialHint: '…1234' }] });
    expect(JSON.stringify(response.body)).not.toMatch(/ciphertext|auth_tag|must-not-leak|apiKey/);
  });
  it('replace sends encrypted material to one atomic RPC and no provider override to enqueue', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => { const url = String(input); calls.push({ url, init }); if (url.endsWith('/rpc/is_admin')) return json(true); if (url.includes('messaging_configuration?channel=eq.email')) return json([]); return json(null); }));
    const response = await handleMessagingConfiguration('PUT', 'Bearer admin', { channel: 'email', providerName: 'resend', enabled: true, providerConfig: { providerName: 'resend', from: 'Coach <n@example.com>' }, secretAction: 'replace', secret: { apiKey: 're_plaintext' } });
    expect(response.status).toBe(200); expect(JSON.stringify(response.body)).not.toContain('re_plaintext');
    const save = calls.find((call) => call.url.endsWith('/rpc/save_messaging_configuration'))!;
    const payload = JSON.parse(String(save.init?.body));
    expect(payload).toMatchObject({ p_provider_name: 'resend', p_enabled: true, p_key_id: 'v1' });
    expect(payload.p_config_revision).toMatch(/^[0-9a-f-]{36}$/); expect(payload.p_ciphertext).not.toContain('re_plaintext');
  });
  it('rejects cross-provider preserve and maps referenced removal to conflict', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => { const url = String(input); if (url.endsWith('/rpc/is_admin')) return json(true); if (url.includes('messaging_configuration?channel=eq.email')) return json([{ config_revision: revision, provider_name: 'resend' }]); if (url.endsWith('/rpc/remove_messaging_configuration')) return new Response('nonterminal jobs reference provider', { status: 409 }); return json([]); }));
    vi.stubEnv('MESSAGING_CUSTOM_ENDPOINT_ALLOWLIST', 'https://notify.example.com/send');
    const changed = await handleMessagingConfiguration('PUT', 'Bearer admin', { channel: 'email', providerName: 'custom', enabled: true, providerConfig: { providerName: 'custom', endpoint: 'https://notify.example.com/send', method: 'POST', fieldMappings: { recipient: 'to' }, idempotency: { placement: 'none' }, acceptedStatuses: [200], providerIdPath: 'id' }, secretAction: 'preserve' });
    expect(changed.status).toBe(400);
    expect((await handleMessagingConfiguration('DELETE', 'Bearer admin', { channel: 'email' })).status).toBe(409);
  });
});
