import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptMessagingCredential, parseMessagingKeyring } from './messaging-configuration';
import { fetchProvider } from './safe-url';
import { handleProcessMessagingJobs } from './messaging-core';

vi.mock('./safe-url', () => ({ fetchProvider: vi.fn() }));
const provider = vi.mocked(fetchProvider);
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
const revision = '99999999-9999-4999-8999-999999999999';
const customConfig = { providerName: 'custom', endpoint: 'https://notify.example.com/send', method: 'POST', fieldMappings: { recipient: 'to', message: 'message' }, auth: { placement: 'header', name: 'X-Provider-Auth', scheme: 'Bearer ' }, idempotency: { placement: 'header', name: 'Idempotency-Key' }, acceptedStatuses: [202], success: { path: 'ok', value: true }, providerIdPath: 'result.id' };

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co');
  vi.stubEnv('SUPABASE_ANON_KEY', 'sb_publishable_synthetic');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-test');
  vi.stubEnv('EXPECTED_SUPABASE_PROJECT_REF', 'aaaaaaaaaaaaaaaaaaaa');
  vi.stubEnv('ENVIRONMENT_KIND', 'test');
  vi.stubEnv('MESSAGING_CUSTOM_ENDPOINT_ALLOWLIST', 'https://notify.example.com/send');
  vi.stubEnv('PROVIDER_HOST_ALLOWLIST', 'notify.example.com');
  vi.stubEnv('MESSAGING_ENCRYPTION_KEYS_JSON', JSON.stringify({ current: 'v1', keys: { v1: randomBytes(32).toString('base64') } }));
  provider.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function install(claim: Record<string, unknown>, options: { begin?: boolean } = {}) {
  const credential = encryptMessagingCredential({ secret: 'db-secret' }, 'email', 'custom', revision, parseMessagingKeyring());
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith('/rpc/is_admin')) return json(true);
    if (url.includes('messaging_configuration?channel=eq.sms')) return json([]);
    if (url.includes('messaging_configuration?channel=eq.email')) return json([{ channel: 'email', provider_name: 'custom', provider_config: customConfig, config_revision: revision }]);
    if (url.includes('messaging_provider_credentials?channel=eq.email&provider_name=eq.custom')) return json([credential]);
    if (url.includes('messaging_provider_credentials?channel=eq.email&provider_name=eq.resend')) return json([]);
    if (url.endsWith('/rpc/claim_message_deliveries')) {
      const body = JSON.parse(String(init?.body)); return json(body.p_channel === claim.channel ? [claim] : []);
    }
    if (url.endsWith('/rpc/begin_non_idempotent_dispatch')) {
      const placement = (claim.provider_config_snapshot as { idempotency?: { placement?: string } } | undefined)?.idempotency?.placement;
      const fenceAllowsSnapshot = claim.provider_name === 'mim' || (claim.provider_name === 'custom' && placement === 'none');
      return fenceAllowsSnapshot && options.begin !== false
        ? json(true)
        : json({ error: 'Provider snapshot is not non-idempotent' }, 409);
    }
    if (url.endsWith('/rpc/record_message_attempt')) return json('accepted');
    if (url.includes('messaging_worker_heartbeat') && init?.method === 'PATCH') return json({});
    return json([]);
  }));
  return calls;
}

describe('job-snapshot adapter resolution', () => {
  it('uses the provider frozen on the job after the current provider changes', async () => {
    vi.stubEnv('RESEND_API_KEY', 'env-resend'); vi.stubEnv('RESEND_FROM', 'Coach <n@example.com>');
    install({ delivery_id: 'd1', job_id: 'j1', channel: 'email', recipient: 'student@example.com', content: { subject: 'Hi', body: '<p>Hello</p>' }, attempt_no: 1, provider_name: 'resend', provider_config_snapshot: { providerName: 'resend', from: 'Coach <old@example.com>' }, provider_config_revision: revision });
    provider.mockResolvedValue(json({ id: 'resend-id' }));
    expect((await handleProcessMessagingJobs('POST', 'Bearer admin')).body).toMatchObject({ processed: 1 });
    expect(provider).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST' }));
    const request = provider.mock.calls[0][1]!;
    expect(JSON.parse(String(request.body)).from).toBe('Coach <old@example.com>');
  });

  it('compiles custom mappings, uses DB credentials, and reuses a delivery-derived idempotency key', async () => {
    install({ delivery_id: 'custom-delivery', job_id: 'j2', channel: 'email', recipient: 'student@example.com', content: { subject: 'Hi', body: '<p>Hello</p>' }, attempt_no: 2, provider_name: 'custom', provider_config_snapshot: customConfig, provider_config_revision: revision });
    provider.mockResolvedValue(json({ ok: true, result: { id: 'custom-id' } }, 202));
    await handleProcessMessagingJobs('POST', 'Bearer admin');
    await handleProcessMessagingJobs('POST', 'Bearer admin');
    expect(provider).toHaveBeenCalledTimes(2);
    const first = provider.mock.calls[0][1]!; const second = provider.mock.calls[1][1]!;
    expect(JSON.parse(String(first.body))).toEqual({ to: 'student@example.com', message: '<p>Hello</p>' });
    expect((first.headers as Record<string, string>)['X-Provider-Auth']).toBe('Bearer db-secret');
    expect((first.headers as Record<string, string>)['Idempotency-Key']).toBe((second.headers as Record<string, string>)['Idempotency-Key']);
    expect((first.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^message-delivery\/[a-f0-9]{64}$/);
  });

  it('passes a real MIM snapshot with no idempotency descriptor through the fence', async () => {
    vi.stubEnv('SMS_USERNAME', 'relaycore');
    vi.stubEnv('SMS_API_KEY', 'secret');
    vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    const calls = install({ delivery_id: 'mim-delivery', job_id: 'mim-job', channel: 'sms', recipient: '8801700000000', content: { body: 'Hello' }, attempt_no: 1, provider_name: 'mim', provider_config_snapshot: { providerName: 'mim', userName: 'relaycore', senderName: 'CoachMS' }, provider_config_revision: revision });
    provider.mockResolvedValue(json({ statusCode: '200', status: 'success', success_Data: { trackingId: 'mim-id' } }));
    await handleProcessMessagingJobs('POST', 'Bearer admin');
    expect(calls.some((call) => call.url.endsWith('/rpc/begin_non_idempotent_dispatch'))).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('passes a custom provider with explicit none idempotency through the fence', async () => {
    const noIdempotency = { ...customConfig, idempotency: { placement: 'none' } };
    const calls = install({ delivery_id: 'custom-none', job_id: 'j3', channel: 'email', recipient: 'student@example.com', content: { body: 'Hello' }, attempt_no: 1, provider_name: 'custom', provider_config_snapshot: noIdempotency, provider_config_revision: revision });
    provider.mockResolvedValue(json({ ok: true, result: { id: 'custom-id' } }, 202));
    await handleProcessMessagingJobs('POST', 'Bearer admin');
    expect(calls.some((call) => call.url.endsWith('/rpc/begin_non_idempotent_dispatch'))).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('never performs provider I/O when fencing a custom none snapshot fails', async () => {
    const noIdempotency = { ...customConfig, idempotency: { placement: 'none' } };
    install({ delivery_id: 'd4', job_id: 'j4', channel: 'email', recipient: 'student@example.com', content: { body: 'Hello' }, attempt_no: 1, provider_name: 'custom', provider_config_snapshot: noIdempotency, provider_config_revision: revision }, { begin: false });
    await handleProcessMessagingJobs('POST', 'Bearer admin');
    expect(provider).not.toHaveBeenCalled();
  });
});
