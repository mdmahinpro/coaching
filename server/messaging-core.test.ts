import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchProvider } from './safe-url';
import {
  handleMimDlrSync,
  handleMessagingReadiness,
  handleMessagingTestSend,
  handleProcessMessagingJobs,
  handleResendWebhook,
  handleSendEmail,
  handleSendSms,
  normalizeBangladeshPhone,
  normalizeEmail,
} from './messaging-core';

vi.mock('./safe-url', () => ({ fetchProvider: vi.fn() }));
const fixtures = JSON.parse(readFileSync(`${process.cwd()}/server/__fixtures__/messaging-providers.json`, 'utf8'));
const provider = vi.mocked(fetchProvider);
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const CONFIG_REVISION = '99999999-9999-4999-8999-999999999999';
function snapshot(channel: string) {
  return channel === 'sms'
    ? { provider_name: 'mim', provider_config_snapshot: { providerName: 'mim', userName: process.env.SMS_USERNAME ?? '', senderName: process.env.SMS_SENDER_NAME ?? '' }, provider_config_revision: CONFIG_REVISION }
    : { provider_name: 'resend', provider_config_snapshot: { providerName: 'resend', from: process.env.RESEND_FROM ?? '' }, provider_config_revision: CONFIG_REVISION };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

type StoredDelivery = { id: string; job_id: string; recipient: string; status: string; provider_message_id: string | null; accepted_at?: string | null; attempt_count?: number; locked_by?: string | null; locked_at?: string | null };
function installPersistence(options: { deliveries?: StoredDelivery[]; claimed?: unknown[]; recentSms?: boolean; recentEmail?: boolean; workerLive?: boolean; failAttemptRpc?: boolean; failAttemptRpcTimes?: number; failBeginRpc?: boolean; expireLeaseBeforeBegin?: boolean } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const deliveries: StoredDelivery[] = [...(options.deliveries ?? [])];
  let failedAttemptRpcsRemaining = options.failAttemptRpc ? Number.POSITIVE_INFINITY : options.failAttemptRpcTimes ?? 0;
  let recipients: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith('/rpc/is_admin')) { return json((init?.headers as Record<string, string> | undefined)?.Authorization !== 'Bearer wrong'); }
    if (url.includes('message_jobs?idempotency_key=')) { return json([]); }
    if (url.endsWith('/rpc/enqueue_message_job')) {
      recipients = JSON.parse(String(init?.body)).p_recipients;
      recipients.forEach((recipient: string, index: number) => deliveries.push({ id: `22222222-2222-4222-8222-22222222222${index}`, job_id: JOB_ID, recipient, status: 'pending', provider_message_id: null }));
      return json(JOB_ID);
    }
    if (url.endsWith('/rpc/claim_message_job_delivery')) {
      const body = JSON.parse(String(init?.body));
      const row = deliveries.find((item) => item.job_id === body.p_job_id && item.status === 'pending');
      if (!row) { return json([]); }
      row.status = 'processing'; row.attempt_count = (row.attempt_count ?? 0) + 1; row.locked_by = body.p_worker_id; row.locked_at = new Date().toISOString();
      return json([{ delivery_id: row.id, job_id: row.job_id, recipient: row.recipient, attempt_no: row.attempt_count, ...snapshot(process.env.SMS_USERNAME ? 'sms' : 'email') }]);
    }
    if (url.endsWith('/rpc/claim_message_deliveries')) {
      const body = JSON.parse(String(init?.body));
      const allClaims = (options.claimed ?? []) as Array<{ delivery_id: string; channel: string; attempt_no: number }>;
      const claims = allClaims.filter((claim) => {
        if (claim.channel !== body.p_channel) { return false; }
        const row = deliveries.find((item) => item.id === claim.delivery_id);
        return Boolean(row && (row.status === 'pending' || (row.status === 'processing' && !row.locked_by)));
      }).slice(0, body.p_limit);
      for (const claim of claims) {
        const row = deliveries.find((item) => item.id === claim.delivery_id);
        if (row) { row.status = 'processing'; row.attempt_count = claim.attempt_no; row.locked_by = body.p_worker_id; row.locked_at = new Date().toISOString(); }
      }
      return json(claims.map((claim) => ({ ...claim, ...snapshot(claim.channel) })));
    }
    if (url.endsWith('/rpc/begin_non_idempotent_dispatch')) {
      if (options.failBeginRpc) { return json({ error: 'begin rejected' }, 409); }
      const body = JSON.parse(String(init?.body)); const row = deliveries.find((item) => item.id === body.p_delivery_id);
      if (options.expireLeaseBeforeBegin || !row || row.status !== 'processing' || row.locked_by !== body.p_worker_id) { return json({ error: 'lease mismatch' }, 409); }
      row.status = 'dispatching';
      return json(true);
    }
    if (url.endsWith('/rpc/record_message_attempt')) {
      if (failedAttemptRpcsRemaining > 0) { failedAttemptRpcsRemaining -= 1; return json({ error: 'attempt insert failed' }, 500); }
      const body = JSON.parse(String(init?.body)); const row = deliveries.find((item) => item.id === body.p_delivery_id);
      if (!row || !['processing', 'dispatching'].includes(row.status) || row.locked_by !== body.p_worker_id) { return json({ error: 'lease mismatch' }, 409); }
      const retryable = row.status !== 'dispatching' && body.p_outcome === 'failed' && body.p_retryable === true;
      row.status = body.p_outcome === 'unknown' ? 'unknown' : retryable ? 'pending' : body.p_outcome;
      row.provider_message_id = body.p_provider_message_id ?? row.provider_message_id;
      if (row.status === 'accepted') { row.accepted_at = new Date().toISOString(); }
      row.locked_by = null;
      return json(row.status);
    }
    if (url.endsWith('/rpc/refresh_message_job_aggregate')) {
      const body = JSON.parse(String(init?.body)); const rows = deliveries.filter((row) => row.job_id === body.p_job_id);
      const acceptedOnly = rows.filter((row) => row.status === 'accepted').length; const delivered = rows.filter((row) => row.status === 'delivered').length;
      const failedOnly = rows.filter((row) => row.status === 'failed').length; const bounced = rows.filter((row) => row.status === 'bounced').length;
      const unknown = rows.filter((row) => row.status === 'unknown' || row.status === 'dispatching').length; const pending = rows.filter((row) => row.status === 'pending' || row.status === 'processing').length;
      const failed = failedOnly + bounced; const status = unknown > 0 ? 'requires_review' : pending > 0 ? 'processing' : failed === rows.length ? 'failed' : failed > 0 ? 'partial' : 'completed';
      return json([{ job_id: body.p_job_id, status, total: rows.length, accepted: acceptedOnly + delivered, failed, pending, unknown, requires_review: unknown > 0, dry_run: false }]);
    }
    if (url.includes('messaging_worker_heartbeat?id=eq.messaging-worker') && init?.method === 'PATCH') { return json({}); }
    if (url.includes('messaging_worker_heartbeat?id=eq.messaging-worker')) { return json(options.workerLive ? [{ id: 'messaging-worker' }] : []); }
    if (url.includes('message_deliveries?accepted_at=gte.')) {
      const channel = url.includes('channel=eq.sms') ? 'sms' : 'email';
      return json((channel === 'sms' ? options.recentSms : options.recentEmail) ? [{ id: 'recent' }] : []);
    }
    if (url.includes('message_deliveries?status=eq.accepted')) {
      return json(deliveries.filter((row) => row.status === 'accepted' && row.provider_message_id).map((row) => ({ id: row.id, job_id: row.job_id, recipient: row.recipient, provider_message_id: row.provider_message_id, accepted_at: row.accepted_at, message_jobs: snapshot('sms') })));

    }
    if (url.includes('message_deliveries?job_id=eq.') && init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body));
      const selected = deliveries.filter((row) => row.job_id === JOB_ID && row.status === 'pending');
      selected.forEach((row) => Object.assign(row, patch));
      return json(selected.map((row) => ({ id: row.id, recipient: row.recipient, status: row.status, provider_message_id: row.provider_message_id })));
    }
    if (url.includes('message_deliveries?job_id=eq.') && !init?.method) {
      const jobId = decodeURIComponent(url.match(/job_id=eq\.([^&]+)/)?.[1] ?? '');
      return json(deliveries.filter((row) => row.job_id === jobId).map((row) => ({ status: row.status })));
    }
    if (url.includes('message_deliveries?id=eq.') && init?.method === 'PATCH') {
      const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)?.[1] ?? ''); const patch = JSON.parse(String(init.body)); const row = deliveries.find((item) => item.id === id); if (row) { Object.assign(row, patch); }
      return json({});
    }
    if (url.includes('message_deliveries?provider_message_id=eq.') && init?.method === 'PATCH') {
      const providerId = decodeURIComponent(url.match(/provider_message_id=eq\.([^&]+)/)?.[1] ?? ''); const patch = JSON.parse(String(init.body));
      const eligible = decodeURIComponent(url.match(/status=in\.\(([^)]+)\)/)?.[1] ?? '').split(',').filter(Boolean);
      const changed = deliveries.filter((row) => row.provider_message_id === providerId && (!eligible.length || eligible.includes(row.status))); changed.forEach((row) => Object.assign(row, patch)); return json(changed.map((row) => ({ job_id: row.job_id })));
    }
    return json({});
  }));
  return { calls, deliveries, recipients };
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co');
  vi.stubEnv('SUPABASE_ANON_KEY', 'sb_publishable_synthetic');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test');
  vi.stubEnv('EXPECTED_SUPABASE_PROJECT_REF', 'aaaaaaaaaaaaaaaaaaaa');
  vi.stubEnv('ENVIRONMENT_KIND', 'test');
  provider.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('recipient normalization', () => {
  it('canonicalizes Bangladesh mobile formats and rejects other destinations', () => {
    expect(normalizeBangladeshPhone('+880 1700-000000')).toBe('8801700000000');
    expect(normalizeBangladeshPhone('01700000000')).toBe('8801700000000');
    expect(normalizeBangladeshPhone('447700900000')).toBeNull();
  });
  it('normalizes email case and rejects malformed addresses', () => {
    expect(normalizeEmail(' Test@Example.COM ')).toBe('test@example.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
  });
});

describe('official provider contracts', () => {
  it('fails closed with 503 and zero send accounting when MIM credentials are absent', async () => {
    installPersistence();
    const response = await handleSendSms('POST', 'Bearer admin', { phones: ['01700000000'], message: 'hello' });
    expect(response).toEqual({ status: 503, body: { status: 'unavailable', error: 'SMS provider credentials are incomplete' } });
    expect(provider).not.toHaveBeenCalled();
  });

  it('POSTs one normalized 8801 recipient with userName and transactionType T', async () => {
    installPersistence();
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    provider.mockResolvedValue(json(fixtures.mimAccepted));
    const response = await handleSendSms('POST', 'Bearer admin', { phones: ['+8801700000000'], message: 'hello' }, { 'idempotency-key': 'sms-1' });
    expect(response.body).toMatchObject({ status: 'completed', total: 1, accepted: 1, failed: 0, pending: 0 });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(String(provider.mock.calls[0][0])).toBe('https://api.mimsms.com/api/V2/SMS');
    expect(JSON.parse(String(provider.mock.calls[0][1]?.body))).toEqual({ apiKey: 'secret', userName: 'relaycore', senderName: 'CoachMS', transactionType: 'T', mobileNumber: '8801700000000', message: 'hello' });
  });

  it('never retries a rejected MIM response', async () => {
    installPersistence();
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    provider.mockResolvedValue(json(fixtures.mimRejected, 503));
    const response = await handleSendSms('POST', 'Bearer admin', { phones: ['01700000000'], message: 'hello' });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(response.body).toMatchObject({ status: 'failed', accepted: 0, failed: 1, pending: 0 });
  });

  it.each([new Error('socket ended'), new DOMException('timed out', 'TimeoutError')])('never retries an ambiguous MIM transport outcome', async (failure) => {
    const store = installPersistence();
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    provider.mockRejectedValue(failure);
    const response = await handleSendSms('POST', 'Bearer admin', { phones: ['01700000000'], message: 'hello' });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(response.body).toMatchObject({ status: 'requires_review', accepted: 0, failed: 0, pending: 0, unknown: 1, requiresReview: true });
    expect(store.deliveries[0]).toMatchObject({ status: 'unknown', attempt_count: 1, provider_message_id: null });
  });

  it('refuses provider I/O when the SMS lease expires before dispatch begins', async () => {
    const store = installPersistence({ expireLeaseBeforeBegin: true });
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    const response = await handleSendSms('POST', 'Bearer admin', { phones: ['01700000000'], message: 'hello' });
    expect(response.body).toMatchObject({ status: 'processing', pending: 1 });
    expect(provider).not.toHaveBeenCalled();
    expect(store.deliveries[0]).toMatchObject({ status: 'processing', attempt_count: 1 });
  });

  it('never fetches MIM when begin_non_idempotent_dispatch fails', async () => {
    const store = installPersistence({ failBeginRpc: true });
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    await handleSendSms('POST', 'Bearer admin', { phones: ['01700000000'], message: 'hello' });
    expect(store.calls.some((call) => call.url.endsWith('/rpc/begin_non_idempotent_dispatch'))).toBe(true);
    expect(provider).not.toHaveBeenCalled();
  });

  it('leaves a crash-before-record SMS dispatch in manual review and never reclaims it', async () => {
    const delivery = { id: 'sms-crash', job_id: JOB_ID, recipient: '8801700000000', status: 'pending', provider_message_id: null };
    const claim = { delivery_id: delivery.id, job_id: JOB_ID, channel: 'sms' as const, recipient: delivery.recipient, content: { body: 'Approved' }, attempt_no: 1 };
    const store = installPersistence({ deliveries: [delivery], claimed: [claim], failAttemptRpc: true });
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    provider.mockResolvedValue(json(fixtures.mimAccepted));

    expect((await handleProcessMessagingJobs('POST', 'Bearer admin')).status).toBe(503);
    expect(store.deliveries[0]).toMatchObject({ status: 'dispatching', attempt_count: 1 });
    expect((await handleProcessMessagingJobs('POST', 'Bearer admin')).status).toBe(200);
    expect(store.calls.filter((call) => call.url.endsWith('/rpc/claim_message_deliveries'))).toHaveLength(4);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(store.deliveries[0].status).toBe('dispatching');
  });

  it('marks an ambiguous MIM HTTP 200 for operator review and preserves its tracking id', async () => {
    const store = installPersistence();
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    provider.mockResolvedValue(json({ statusCode: '200', status: 'unexpected', trackingId: 'mim-ambiguous-1' }));
    const response = await handleSendSms('POST', 'Bearer admin', { phones: ['01700000000'], message: 'hello' });
    expect(response.body).toMatchObject({ status: 'requires_review', pending: 0, unknown: 1, requiresReview: true });
    expect(store.deliveries[0]).toMatchObject({ status: 'unknown', provider_message_id: 'mim-ambiguous-1' });
    const attempt = store.calls.find((call) => call.url.endsWith('/rpc/record_message_attempt'));
    expect(JSON.parse(String(attempt?.init?.body))).toMatchObject({ p_outcome: 'unknown', p_provider_message_id: 'mim-ambiguous-1', p_failure_category: 'unknown', p_retryable: false });
  });

  it('rejects SMS bodies over 1500 characters before persistence or provider I/O', async () => {
    const store = installPersistence();
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    const response = await handleSendSms('POST', 'Bearer admin', { phones: ['01700000000'], message: 'x'.repeat(1501) });
    expect(response).toEqual({ status: 400, body: { error: 'SMS message must be no more than 1500 characters' } });
    expect(store.calls.some((call) => call.url.endsWith('/rpc/enqueue_message_job'))).toBe(false);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(['', 'Coach Center', 'Coach_Center', 'ABCDEFGHIJKL', 'কোচ'])('fails closed for invalid MIM sender name %j', async (senderName) => {
    installPersistence();
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', senderName);
    const response = await handleSendSms('POST', 'Bearer admin', { phones: ['01700000000'], message: 'hello' });
    expect(response).toEqual({ status: 503, body: { status: 'unavailable', error: senderName ? 'SMS_SENDER_NAME must be 1-11 ASCII alphanumeric characters' : 'SMS provider credentials are incomplete' } });
    expect(provider).not.toHaveBeenCalled();
  });

  it('POSTs one recipient to the official Resend emails endpoint with delivery-stable idempotency', async () => {
    const store = installPersistence();
    vi.stubEnv('RESEND_API_KEY', 're_secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>');
    provider.mockResolvedValue(json({ id: 'email-1' }));
    const response = await handleSendEmail('POST', 'Bearer admin', { emails: ['A@example.com'], subject: 'News', html: '<p>Private</p>' }, { 'idempotency-key': 'email-1' });
    expect(response.body).toMatchObject({ total: 1, accepted: 1, failed: 0, pending: 0 });
    expect(String(provider.mock.calls[0][0])).toBe('https://api.resend.com/emails');
    const request = provider.mock.calls[0][1]!; const key = (request.headers as Record<string, string>)['Idempotency-Key'];
    expect(key).toMatch(/^message-delivery\/[a-f0-9]{64}$/);
    const payload = JSON.parse(String(request.body));
    expect(payload).toEqual({ from: 'Coach <coach@example.com>', to: ['a@example.com'], subject: 'News', html: '<p>Private</p>', text: 'Private' });
    expect(payload.text).not.toMatch(/<[^>]*>/);
    expect(store.deliveries.map((row) => row.provider_message_id)).toEqual(['email-1']);
  });

  it('converts sanitized HTML into readable plain text with no tags in every Resend item', async () => {
    installPersistence();
    vi.stubEnv('RESEND_API_KEY', 're_secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>');
    provider.mockResolvedValue(json({ id: 'email-1' }));
    await handleSendEmail('POST', 'Bearer admin', { emails: ['a@example.com'], subject: 'News', html: '<h1>News &amp; updates</h1><p>Hello<br>there</p>' });
    const item = JSON.parse(String(provider.mock.calls[0][1]?.body)) as { text: string };
    expect(item.text).toBe('News & updates\n\nHello\nthere');
    expect(item.text).not.toMatch(/<[^>]*>/);
  });

  it('always queues multi-recipient campaigns instead of sending inline', async () => {
    const store = installPersistence();
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    const response = await handleSendSms('POST', 'Bearer admin', { phones: ['01700000000', '01800000000'], message: 'hello', queue: false });
    expect(response).toMatchObject({ status: 202, body: { status: 'queued', total: 2, pending: 2 } });
    expect(provider).not.toHaveBeenCalled();
    expect(store.deliveries.every((row) => row.status === 'pending')).toBe(true);

    vi.stubEnv('RESEND_API_KEY', 're_secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>');
    const emailResponse = await handleSendEmail('POST', 'Bearer admin', { emails: ['a@example.com', 'b@example.com'], subject: 'News', html: '<p>Private</p>', queue: false });
    expect(emailResponse).toMatchObject({ status: 202, body: { status: 'queued', total: 2, pending: 2 } });
    expect(provider).not.toHaveBeenCalled();
  });

  it('claims 100 Resend deliveries and sends them individually with bounded concurrency', async () => {
    const emailDeliveries = Array.from({ length: 101 }, (_, index) => ({ id: `email-${index}`, job_id: JOB_ID, recipient: `student${index}@example.com`, status: 'pending', provider_message_id: null }));
    const emailClaims = emailDeliveries.map((row) => ({ delivery_id: row.id, job_id: JOB_ID, channel: 'email', recipient: row.recipient, content: { subject: 'Hi', body: '<p>Private</p>' }, attempt_no: 1 }));
    installPersistence({ deliveries: emailDeliveries, claimed: emailClaims });
    vi.stubEnv('RESEND_API_KEY', 're_secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>');
    let active = 0; let maximumActive = 0; let providerId = 0;
    provider.mockImplementation(async () => {
      active += 1; maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1; providerId += 1;
      return json({ id: `provider-${providerId}` });
    });
    const response = await handleProcessMessagingJobs('POST', 'Bearer admin');
    expect(response.body).toMatchObject({ processed: 100 });
    expect(provider).toHaveBeenCalledTimes(100);
    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(5);
    for (const call of provider.mock.calls) {
      expect(String(call[0])).toBe('https://api.resend.com/emails');
      expect(JSON.parse(String(call[1]?.body)).to).toHaveLength(1);
    }
  });

  it('classifies a malformed Resend 2xx response as terminal unknown rather than accepted', async () => {
    const store = installPersistence();
    vi.stubEnv('RESEND_API_KEY', 're_secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>');
    provider.mockResolvedValue(json(fixtures.resendMalformedSuccess));
    const response = await handleSendEmail('POST', 'Bearer admin', { emails: ['a@example.com'], subject: 'News', html: '<p>Private</p>' });
    expect(response.body).toMatchObject({ status: 'requires_review', accepted: 0, failed: 0, pending: 0, unknown: 1 });
    expect(store.deliveries.every((row) => row.status === 'unknown' && row.provider_message_id === null)).toBe(true);
  });
  it('claims a synchronous delivery with a job-specific worker lease before provider I/O', async () => {
    const store = installPersistence();
    vi.stubEnv('RESEND_API_KEY', 're_secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>');
    provider.mockResolvedValue(json({ id: 'email-lease-1' }));
    await handleSendEmail('POST', 'Bearer admin', { emails: ['leased@example.com'], subject: 'News', html: '<p>Private</p>' });
    const claimIndex = store.calls.findIndex((call) => call.url.endsWith('/rpc/claim_message_job_delivery'));
    const attemptIndex = store.calls.findIndex((call) => call.url.endsWith('/rpc/record_message_attempt'));
    expect(claimIndex).toBeGreaterThan(-1);
    expect(attemptIndex).toBeGreaterThan(claimIndex);
    const claim = JSON.parse(String(store.calls[claimIndex].init?.body));
    const attempt = JSON.parse(String(store.calls[attemptIndex].init?.body));
    expect(claim.p_job_id).toBe(JOB_ID);
    expect(claim.p_worker_id).toMatch(/^relaycore-inline-/);
    expect(attempt.p_worker_id).toBe(claim.p_worker_id);
    expect(store.calls.some((call) => call.url.endsWith('/message_attempts'))).toBe(false);
  });

  it('retries provider success after persistence failure with the exact same delivery key and payload', async () => {
    const delivery = { id: 'atomic-failure', job_id: JOB_ID, recipient: 'student@example.com', status: 'pending', provider_message_id: null };
    const claim = { delivery_id: delivery.id, job_id: JOB_ID, channel: 'email' as const, recipient: delivery.recipient, content: { subject: 'Hi', body: '<p>Private</p>' }, attempt_no: 1 };
    const store = installPersistence({ deliveries: [delivery], claimed: [claim], failAttemptRpcTimes: 1 });
    vi.stubEnv('RESEND_API_KEY', 're_secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>');
    provider.mockImplementation(async () => json({ id: 'provider-once' }));

    expect((await handleProcessMessagingJobs('POST', 'Bearer admin')).status).toBe(503);
    expect(store.deliveries[0]).toMatchObject({ status: 'processing', attempt_count: 1 });
    expect(store.deliveries[0].locked_by).toMatch(/^relaycore-/);

    store.deliveries[0].locked_by = null;
    store.deliveries[0].locked_at = null;
    expect((await handleProcessMessagingJobs('POST', 'Bearer admin')).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(2);
    const [firstUrl, firstRequest] = provider.mock.calls[0];
    const [retryUrl, retryRequest] = provider.mock.calls[1];
    expect(retryUrl).toBe(firstUrl);
    expect(retryRequest?.body).toBe(firstRequest?.body);
    expect((retryRequest?.headers as Record<string, string>)['Idempotency-Key']).toBe((firstRequest?.headers as Record<string, string>)['Idempotency-Key']);
    expect((firstRequest?.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^message-delivery\/[a-f0-9]{64}$/);
    expect(store.deliveries[0]).toMatchObject({ status: 'accepted', provider_message_id: 'provider-once' });
  });
});

describe('DLR, aggregation, readiness, and auth', () => {
  it('waits five minutes, sends the documented DLR body, maps terminal codes, and leaves temporary codes accepted', async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const store = installPersistence({ deliveries: [
      { id: 'd1', job_id: JOB_ID, recipient: '8801700000000', status: 'accepted', provider_message_id: 'mim-track-1', accepted_at: old },
      { id: 'd2', job_id: JOB_ID, recipient: '8801800000000', status: 'accepted', provider_message_id: 'mim-track-2', accepted_at: old },
      { id: 'd3', job_id: JOB_ID, recipient: '8801900000000', status: 'accepted', provider_message_id: 'mim-track-3', accepted_at: old },
    ] });
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    provider.mockResolvedValueOnce(json(fixtures.mimDlrDelivered)).mockResolvedValueOnce(json(fixtures.mimDlrTerminal)).mockResolvedValueOnce(json(fixtures.mimDlrTemporary));
    const response = await handleMimDlrSync('POST', 'Bearer admin');
    expect(response.body).toMatchObject({ checked: 3, updated: 2 });
    expect(store.calls.find((call) => call.url.includes('status=eq.accepted'))?.url).toContain('accepted_at=lte.');
    expect(JSON.parse(String(provider.mock.calls[0][1]?.body))).toEqual({ apiKey: 'secret', userName: 'relaycore', mobileNumber: '8801700000000', trackingId: 'mim-track-1' });
    expect(store.deliveries.map((row) => row.status)).toEqual(['delivered', 'failed', 'accepted']);
    expect(store.calls.some((call) => call.url.endsWith('/rpc/refresh_message_job_aggregate'))).toBe(true);
    expect(store.calls.some((call) => call.url.includes('message_deliveries?job_id=eq.') && !call.init?.method)).toBe(false);
  });

  it.each(['32', '5', '13', '9', '36'])('classifies documented terminal MIM DLR code %s as failed', async (dlrCode) => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const store = installPersistence({ deliveries: [{ id: 'd1', job_id: JOB_ID, recipient: '8801700000000', status: 'accepted', provider_message_id: 'mim-track-1', accepted_at: old }] });
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    provider.mockResolvedValue(json({ statusCode: '200', dlrCode, operatorStatus: 'UNDELIVERED' }));
    expect((await handleMimDlrSync('POST', 'Bearer admin')).body).toMatchObject({ checked: 1, updated: 1 });
    expect(store.deliveries[0].status).toBe('failed');
  });

  it.each(['6', '31', '34', '8', '400', '456'])('keeps retryable MIM DLR code %s accepted for later polling', async (dlrCode) => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const store = installPersistence({ deliveries: [{ id: 'd1', job_id: JOB_ID, recipient: '8801700000000', status: 'accepted', provider_message_id: 'mim-track-1', accepted_at: old }] });
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    provider.mockResolvedValue(json({ statusCode: '200', dlrCode, operatorStatus: 'SYSTEM FAILURE' }));
    expect((await handleMimDlrSync('POST', 'Bearer admin')).body).toMatchObject({ checked: 1, updated: 0 });
    expect(store.deliveries[0].status).toBe('accepted');
  });

  it('does not treat code 0 as delivered without the DELIVERED operator status', async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const store = installPersistence({ deliveries: [{ id: 'd1', job_id: JOB_ID, recipient: '8801700000000', status: 'accepted', provider_message_id: 'mim-track-1', accepted_at: old }] });
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    provider.mockResolvedValue(json({ statusCode: '200', dlrCode: '0', operatorStatus: 'UNDELIVERED' }));
    expect((await handleMimDlrSync('POST', 'Bearer admin')).body).toMatchObject({ checked: 1, updated: 0 });
    expect(store.deliveries[0].status).toBe('accepted');
  });

  it('relies on atomic attempt aggregation without a redundant worker refresh or job patch', async () => {
    const store = installPersistence({ deliveries: [
      { id: 'existing', job_id: JOB_ID, recipient: 'existing@example.com', status: 'delivered', provider_message_id: 'old' },
      { id: 'claimed', job_id: JOB_ID, recipient: 'new@example.com', status: 'processing', provider_message_id: null },
    ], claimed: [{ delivery_id: 'claimed', job_id: JOB_ID, channel: 'email', recipient: 'new@example.com', content: { subject: 'Hi', body: '<p>Hi</p>' }, attempt_no: 1 }] });
    vi.stubEnv('RESEND_API_KEY', 're_secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>'); vi.stubEnv('MESSAGING_WORKER_SECRET', 'worker-secret');
    provider.mockResolvedValue(json({ id: 'new-id' }));
    await handleProcessMessagingJobs('POST', undefined, 'worker-secret');
    const claimCalls = store.calls.filter((call) => call.url.endsWith('/rpc/claim_message_deliveries'));
    expect(claimCalls).toHaveLength(2);
    expect(claimCalls.map((call) => JSON.parse(String(call.init?.body)).p_channel)).toEqual(['sms', 'email']);
    expect(store.calls.some((call) => call.url.endsWith('/rpc/refresh_message_job_aggregate'))).toBe(false);
    expect(store.calls.some((call) => call.url.includes(`message_jobs?id=eq.${JOB_ID}`) && call.init?.method === 'PATCH')).toBe(false);
    expect(store.deliveries.map((row) => row.status)).toEqual(['delivered', 'accepted']);
  });

  it('limits each scheduled run to one SMS claim while retaining 100-email throughput', async () => {
    const smsDeliveries = Array.from({ length: 2 }, (_, index) => ({ id: `sms-${index}`, job_id: `sms-job-${index}`, recipient: `8801${index + 7}00000000`, status: 'pending', provider_message_id: null }));
    const emailDeliveries = Array.from({ length: 101 }, (_, index) => ({ id: `throughput-email-${index}`, job_id: JOB_ID, recipient: `throughput${index}@example.com`, status: 'pending', provider_message_id: null }));
    const claims = [
      ...smsDeliveries.map((row) => ({ delivery_id: row.id, job_id: row.job_id, channel: 'sms', recipient: row.recipient, content: { body: 'Hi' }, attempt_no: 1 })),
      ...emailDeliveries.map((row) => ({ delivery_id: row.id, job_id: row.job_id, channel: 'email', recipient: row.recipient, content: { subject: 'Hi', body: '<p>Hi</p>' }, attempt_no: 1 })),
    ];
    const store = installPersistence({ deliveries: [...smsDeliveries, ...emailDeliveries], claimed: claims });
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    vi.stubEnv('RESEND_API_KEY', 're_secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>');
    let emailProviderId = 0;
    provider.mockImplementation(async (url) => String(url).includes('mimsms')
      ? json(fixtures.mimAccepted)
      : json({ id: `email-provider-${emailProviderId += 1}` }));

    const response = await handleProcessMessagingJobs('POST', 'Bearer admin');
    const claimBodies = store.calls.filter((call) => call.url.endsWith('/rpc/claim_message_deliveries')).map((call) => JSON.parse(String(call.init?.body)));
    expect(claimBodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ p_channel: 'sms', p_limit: 1 }),
      expect.objectContaining({ p_channel: 'email', p_limit: 100 }),
    ]));
    expect(response.body).toMatchObject({ processed: 101 });
    expect(store.deliveries.filter((row) => row.id.startsWith('sms-') && row.status === 'accepted')).toHaveLength(1);
    expect(store.deliveries.filter((row) => row.id.startsWith('throughput-email-') && row.status === 'accepted')).toHaveLength(100);
  });

  it('still scans queued snapshot revisions when current readiness is unavailable', async () => {
    const store = installPersistence();
    const response = await handleProcessMessagingJobs('POST', 'Bearer admin');
    expect(response).toEqual({ status: 200, body: { status: 'completed', sms: 'unavailable', email: 'unavailable', processed: 0 } });
    expect(store.calls.filter((call) => call.url.endsWith('/rpc/claim_message_deliveries'))).toHaveLength(2);
    expect(provider).not.toHaveBeenCalled();
  });

  it('normalizes local queued SMS recipients before provider I/O', async () => {
    const store = installPersistence({ deliveries: [
      { id: 'claimed-sms', job_id: JOB_ID, recipient: '01700000000', status: 'processing', provider_message_id: null },
    ], claimed: [{ delivery_id: 'claimed-sms', job_id: JOB_ID, channel: 'sms', recipient: '01700000000', content: { body: 'Approved' }, attempt_no: 1 }] });
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    provider.mockResolvedValue(json(fixtures.mimAccepted));
    const response = await handleProcessMessagingJobs('POST', 'Bearer admin');
    expect(response.body).toMatchObject({ status: 'completed', processed: 1, sms: 'configured', email: 'unavailable' });
    expect(JSON.parse(String(provider.mock.calls[0][1]?.body))).toMatchObject({ mobileNumber: '8801700000000' });
    expect(store.deliveries[0].recipient).toBe('8801700000000');
  });

  it('finalizes an invalid claimed recipient with a sanitized invalid_recipient attempt', async () => {
    const store = installPersistence({ deliveries: [
      { id: 'invalid-sms', job_id: JOB_ID, recipient: 'not-a-phone', status: 'processing', provider_message_id: null },
    ], claimed: [{ delivery_id: 'invalid-sms', job_id: JOB_ID, channel: 'sms', recipient: 'not-a-phone', content: { body: 'Approved' }, attempt_no: 1 }] });
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS');
    const response = await handleProcessMessagingJobs('POST', 'Bearer admin');
    expect(response.body).toMatchObject({ status: 'completed', processed: 1 });
    expect(provider).not.toHaveBeenCalled();
    expect(store.deliveries[0].status).toBe('failed');
    const attempt = store.calls.find((call) => call.url.endsWith('/rpc/record_message_attempt'));
    expect(JSON.parse(String(attempt?.init?.body))).toMatchObject({
      p_delivery_id: 'invalid-sms', p_outcome: 'failed', p_provider_message_id: null,
      p_failure_category: 'invalid_recipient', p_failure_code: 'invalid_recipient',
      p_failure_message: 'Recipient validation failed', p_retryable: false,
    });
    expect(String(attempt?.init?.body)).not.toContain('not-a-phone');
  });

  it('accepts constant-time worker and cron bearer secrets while preserving header and admin JWT auth', async () => {
    installPersistence(); vi.stubEnv('MESSAGING_WORKER_SECRET', 'worker-secret'); vi.stubEnv('RESEND_API_KEY', 're_secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>'); vi.stubEnv('CRON_SECRET', 'cron-secret');
    expect((await handleProcessMessagingJobs('POST', 'Bearer wrong')).status).toBe(401);
    expect((await handleProcessMessagingJobs('POST', undefined, 'worker-secret')).status).toBe(200);
    expect((await handleProcessMessagingJobs('GET', 'Bearer worker-secret')).status).toBe(200);
    expect((await handleProcessMessagingJobs('GET', 'Bearer cron-secret')).status).toBe(200);
    expect((await handleProcessMessagingJobs('POST', 'Bearer admin')).status).toBe(200);
  });

  it('persists a heartbeat only after a successful queue-worker run', async () => {
    const store = installPersistence(); vi.stubEnv('MESSAGING_WORKER_SECRET', 'worker-secret'); vi.stubEnv('RESEND_API_KEY', 're_secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>');
    expect((await handleProcessMessagingJobs('POST', undefined, 'worker-secret')).status).toBe(200);
    expect(store.calls.some((call) => call.url.includes('messaging_worker_heartbeat?id=eq.messaging-worker') && call.init?.method === 'PATCH')).toBe(true);
  });

  it('reports unavailable, configured, and live-ready without exposing credentials', async () => {
    installPersistence({ recentSms: true, recentEmail: false, workerLive: true });
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'sms-secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS'); vi.stubEnv('RESEND_API_KEY', 'email-secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>');
    const response = await handleMessagingReadiness('GET', 'Bearer admin');
    expect(response).toEqual({ status: 200, body: { status: 'configured', sms: 'live-ready', email: 'configured', persistence: 'live-ready' } });
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('reports an actionable unavailable readiness state for an invalid MIM sender name', async () => {
    installPersistence({ workerLive: true });
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'sms-secret'); vi.stubEnv('SMS_SENDER_NAME', 'Coach Center'); vi.stubEnv('RESEND_API_KEY', 'email-secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>');
    expect(await handleMessagingReadiness('GET', 'Bearer admin')).toEqual({ status: 503, body: { status: 'unavailable', sms: 'unavailable', email: 'configured', persistence: 'live-ready', smsError: 'SMS_SENDER_NAME must be 1-11 ASCII alphanumeric characters' } });
  });

  it('does not claim live readiness before a recent successful worker heartbeat', async () => {
    installPersistence({ recentSms: true, recentEmail: true, workerLive: false });
    vi.stubEnv('SMS_USERNAME', 'relaycore'); vi.stubEnv('SMS_API_KEY', 'sms-secret'); vi.stubEnv('SMS_SENDER_NAME', 'CoachMS'); vi.stubEnv('RESEND_API_KEY', 'email-secret'); vi.stubEnv('RESEND_FROM', 'Coach <coach@example.com>');
    expect(await handleMessagingReadiness('GET', 'Bearer admin')).toEqual({ status: 200, body: { status: 'configured', sms: 'configured', email: 'configured', persistence: 'configured' } });
  });

  it('keeps raw-body Svix verification and refreshes the affected job aggregate', async () => {
    const store = installPersistence({ deliveries: [{ id: 'd1', job_id: JOB_ID, recipient: 'a@example.com', status: 'accepted', provider_message_id: 'email-1', accepted_at: new Date().toISOString() }] });
    vi.stubEnv('RESEND_WEBHOOK_SECRET', `whsec_${Buffer.from('webhook-secret').toString('base64')}`);
    const raw = JSON.stringify({ type: 'email.delivered', data: { email_id: 'email-1' } }); const timestamp = String(Math.floor(Date.now() / 1000)); const id = 'msg_1'; const signature = createHmac('sha256', Buffer.from('webhook-secret')).update(`${id}.${timestamp}.${raw}`).digest('base64');
    expect(await handleResendWebhook('POST', raw, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` })).toEqual({ status: 200, body: { received: true } });
    expect(store.deliveries[0].status).toBe('delivered');
    expect(store.calls.some((call) => call.url.endsWith('/rpc/refresh_message_job_aggregate'))).toBe(true);
    expect(store.calls.some((call) => call.url.includes(`message_deliveries?job_id=eq.${JOB_ID}`) && !call.init?.method)).toBe(false);
    const sentRaw = JSON.stringify({ type: 'email.sent', data: { email_id: 'email-1' } }); const sentId = 'msg_2'; const sentSignature = createHmac('sha256', Buffer.from('webhook-secret')).update(`${sentId}.${timestamp}.${sentRaw}`).digest('base64');
    expect((await handleResendWebhook('POST', sentRaw, { 'svix-id': sentId, 'svix-timestamp': timestamp, 'svix-signature': `v1,${sentSignature}` })).status).toBe(200);
    expect(store.deliveries[0].status).toBe('delivered');
    expect((await handleResendWebhook('POST', `${raw} `, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` })).status).toBe(401);
  });

  it('allows only allowlisted dry-run tests and transmits nothing', async () => {
    installPersistence(); vi.stubEnv('MESSAGING_TEST_RECIPIENT_ALLOWLIST', '01700000000,test@example.com');
    expect((await handleMessagingTestSend('POST', 'Bearer admin', { channel: 'email', recipient: 'other@example.com', dryRun: true })).status).toBe(400);
    expect((await handleMessagingTestSend('POST', 'Bearer admin', { channel: 'email', recipient: 'TEST@example.com', dryRun: true })).body).toMatchObject({ status: 'dry_run', total: 1, pending: 0 });
    expect(provider).not.toHaveBeenCalled();
  });
});
