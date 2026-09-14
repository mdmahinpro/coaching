import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, from } = vi.hoisted(() => ({ getSession: vi.fn(), from: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession }, from },
}));
vi.mock('@/utils/logger', () => ({ logError: vi.fn() }));

import {
  dedupeRecipients,
  deleteMessagingProviderConfig,
  emptyMessagingConfiguration,
  formatMessagingResult,
  getMessagingProviderConfigs,
  hasUnresolvedTemplate,
  messagingIdempotencyKey,
  processMessageQueue,
  redactMessagingData,
  saveMessagingProviderConfig,
  sendMessage,
  serializeMessagingConfigSave,
  testConfiguredMessagingProvider,
  validateMessagingConfiguration,
} from './messaging';
import { sendSMS } from './sms';
import { sendEmail } from './email';

const response = (ok: boolean, status: number, value: unknown, jsonReject = false) => ({
  ok,
  status,
  json: jsonReject
    ? vi.fn().mockRejectedValue(new Error('not json'))
    : vi.fn().mockResolvedValue(value),
});

beforeEach(() => {
  vi.restoreAllMocks();
  getSession.mockResolvedValue({ data: { session: { access_token: 'token' } } });
  from.mockClear();
});

describe('messaging service', () => {
  it('does not interpret missing provider configuration/pending as accepted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response(true, 200, { status: 'pending', sent: 0 }))
    );
    const result = await sendSMS(['01700', '01701'], 'hello', 'test');
    expect(result).toMatchObject({
      status: 'pending',
      total: 2,
      accepted: 0,
      failed: 0,
      pending: 2,
    });
  });

  it('fails closed for non-JSON success and non-2xx responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(true, 200, null, true))
      .mockResolvedValueOnce(response(false, 502, { status: 'pending' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendSMS('01700', 'hello')).toMatchObject({ accepted: 0, failed: 1, pending: 0 });
    expect(await sendEmail('a@example.com', 'subject', '<p>hello</p>')).toMatchObject({
      accepted: 0,
      failed: 1,
      pending: 0,
    });
  });

  it('preserves partial accepted, failed, and pending counts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response(true, 200, {
          jobId: 'job-1',
          status: 'partial',
          total: 4,
          accepted: 2,
          failed: 1,
          pending: 1,
          dryRun: false,
        })
      )
    );
    const result = await sendSMS(['1', '2', '3', '4'], 'hello');
    expect(result).toEqual({
      jobId: 'job-1',
      status: 'partial',
      total: 4,
      accepted: 2,
      failed: 1,
      pending: 1,
      unknown: 0,
      requiresReview: false,
      dryRun: false,
    });
  });

  it('preserves ambiguous unknown results and warns that operator review is required', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response(true, 200, {
          jobId: 'job-review',
          status: 'requires_review',
          total: 1,
          accepted: 0,
          failed: 0,
          pending: 0,
          unknown: 1,
          requiresReview: true,
          dryRun: false,
        })
      )
    );
    const result = await sendSMS('01700', 'hello');
    expect(result).toEqual({
      jobId: 'job-review',
      status: 'requires_review',
      total: 1,
      accepted: 0,
      failed: 0,
      pending: 0,
      unknown: 1,
      requiresReview: true,
      dryRun: false,
    });
    expect(formatMessagingResult(result)).toBe(
      'Accepted 0, failed 0, pending 0, unknown 1. Warning: operator review required.'
    );
  });

  it('does not reclassify a requires-review response during a requested dry run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response(true, 200, {
          status: 'requires_review',
          total: 1,
          accepted: 0,
          failed: 0,
          pending: 0,
          unknown: 1,
          requiresReview: true,
          dryRun: true,
        })
      )
    );
    const result = await sendMessage({
      channel: 'sms',
      recipients: ['01700'],
      message: 'hello',
      idempotencyKey: 'dry-review',
      dryRun: true,
    });
    expect(result).toMatchObject({ status: 'requires_review', unknown: 1, requiresReview: true });
  });

  it('deduplicates recipients and requests safe per-recipient email privacy', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(true, 200, { status: 'accepted', accepted: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendEmail(
      ['A@example.com', 'a@example.com', 'b@example.com'],
      'subject',
      '<p>hello</p>'
    );
    expect(result.total).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.emails).toEqual(['A@example.com', 'b@example.com']);
    expect(body.recipientPrivacy).toBe('individual');
    expect(body.queue).toBe(true);
  });

  it('queues every SMS send above one recipient', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(true, 202, { status: 'queued', pending: 2 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendSMS(['01700', '01800'], 'hello');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.queue).toBe(true);
  });

  it('reuses stable idempotency keys and never writes logs directly', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(true, 200, { status: 'accepted', accepted: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const key = messagingIdempotencyKey('fee-reminder', 'fee-123');
    const request = {
      channel: 'sms' as const,
      recipients: ['01700'],
      message: 'hello',
      idempotencyKey: key,
    };
    await sendMessage(request);
    await sendMessage(request);
    expect(fetchMock.mock.calls.map((call) => call[1].headers['Idempotency-Key'])).toEqual([
      key,
      key,
    ]);
    expect(from).not.toHaveBeenCalled();
  });

  it('blocks unresolved templates before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendSMS('01700', 'Hello {নাম}');
    expect(hasUnresolvedTemplate('Hello {নাম}')).toBe(true);
    expect(result.failed).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('processes the durable queue with the authenticated recovery endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(true, 200, { status: 'completed', processed: 3 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(processMessageQueue()).resolves.toEqual({ processed: 3 });
    expect(fetchMock).toHaveBeenCalledWith('/api/process-messaging-jobs', {
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
    });
  });

  it('normalizes recipient deduplication', () => {
    expect(dedupeRecipients('sms', ['017 00', '01700', '(018)00'])).toEqual(['017 00', '(018)00']);
  });

  it('redacts secrets, ciphertext, and full fingerprints while retaining safe credential metadata', () => {
    const safe = redactMessagingData({
      credentialConfigured: true,
      credentialHint: '…1234',
      credentialFingerprint: 'a'.repeat(64),
      apiKey: 'plain-secret',
      nested: {
        api_key_ciphertext: 'cipher-secret',
        token: 'bearer-secret',
        endpoint: 'https://example.test',
      },
    });
    expect(JSON.stringify(safe)).not.toMatch(/plain-secret|cipher-secret|bearer-secret|aaaaaaaa/);
    expect(safe).toEqual({
      credentialConfigured: true,
      credentialHint: '…1234',
      nested: { endpoint: 'https://example.test' },
    });
  });

  it('serializes exact built-in provider schema and preserve/replace/remove secret actions', () => {
    const config = {
      ...emptyMessagingConfiguration('sms'),
      enabled: false,
      providerName: 'mim' as const,
      providerConfig: { providerName: 'mim' as const, userName: 'operator', senderName: 'Coach' },
      configRevision: 'r3',
      credentialConfigured: true,
    };
    expect(serializeMessagingConfigSave(config, 'preserve')).toEqual({
      channel: 'sms',
      providerName: 'mim',
      enabled: false,
      providerConfig: { providerName: 'mim', userName: 'operator', senderName: 'Coach' },
      secretAction: 'preserve',
    });
    expect(serializeMessagingConfigSave(config, 'replace', 'new-secret')).toEqual({
      channel: 'sms',
      providerName: 'mim',
      enabled: false,
      providerConfig: { providerName: 'mim', userName: 'operator', senderName: 'Coach' },
      secretAction: 'replace',
      secret: { apiKey: 'new-secret' },
    });
    expect(serializeMessagingConfigSave(config, 'remove')).toEqual({
      channel: 'sms',
      providerName: 'mim',
      enabled: false,
      providerConfig: { providerName: 'mim', userName: 'operator', senderName: 'Coach' },
      secretAction: 'remove',
    });
  });

  it('serializes exact custom schema and custom secret envelope without built-in endpoint metadata', () => {
    const config = {
      ...emptyMessagingConfiguration('email'),
      enabled: true,
      providerName: 'custom' as const,
      providerConfig: {
        providerName: 'custom' as const,
        endpoint: 'https://notify.example.test/send',
        method: 'POST' as const,
        auth: { placement: 'body' as const, path: 'auth.key' },
        idempotency: { placement: 'header' as const, name: 'Idempotency-Key' },
        fieldMappings: { recipient: 'to', subject: 'title' },
        acceptedStatuses: [200, 202],
        success: { path: 'ok', value: true },
        providerIdPath: 'data.id',
        senderIdentity: 'Coach',
      },
    };
    expect(serializeMessagingConfigSave(config, 'replace', 'custom-secret')).toEqual({
      channel: 'email',
      providerName: 'custom',
      enabled: true,
      providerConfig: config.providerConfig,
      secretAction: 'replace',
      secret: { secret: 'custom-secret' },
    });
    expect(
      JSON.stringify(
        serializeMessagingConfigSave(
          { ...emptyMessagingConfiguration('email'), enabled: true },
          'preserve'
        )
      )
    ).not.toContain('endpoint');
  });

  it('normalizes GET configurations from the canonical collection and excludes unsafe metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response(true, 200, {
          configurations: [
            {
              channel: 'email',
              providerName: 'resend',
              enabled: true,
              providerConfig: {
                providerName: 'resend',
                from: 'Coach <n@example.com>',
                apiKey: 'leak',
              },
              configRevision: 'rev-1',
              credentialConfigured: true,
              credentialFingerprint: 'full',
              credentialHint: '…4321',
            },
          ],
        })
      )
    );
    const result = await getMessagingProviderConfigs();
    expect(result).toEqual({
      configurations: [
        {
          channel: 'email',
          providerName: 'resend',
          enabled: true,
          providerConfig: { providerName: 'resend', from: 'Coach <n@example.com>' },
          configRevision: 'rev-1',
          credentialConfigured: true,
          credentialHint: '…4321',
        },
      ],
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/messaging-configuration',
      expect.objectContaining({ headers: { Authorization: 'Bearer token' } })
    );
    expect(JSON.stringify(result)).not.toMatch(/leak|Fingerprint|full/);
  });

  it('PUT uses only the canonical route and exact request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(true, 200, {
        channel: 'email',
        providerName: 'resend',
        enabled: true,
        providerConfig: { providerName: 'resend', from: 'Coach <n@example.com>' },
        configRevision: 'rev-2',
        credentialConfigured: true,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const config = {
      ...emptyMessagingConfiguration('email'),
      enabled: true,
      providerConfig: { providerName: 'resend' as const, from: 'Coach <n@example.com>' },
    };
    await saveMessagingProviderConfig(config, 'replace', 're_secret');
    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe('/api/messaging-configuration');
    expect(JSON.parse(init.body)).toEqual({
      channel: 'email',
      providerName: 'resend',
      enabled: true,
      providerConfig: { providerName: 'resend', from: 'Coach <n@example.com>' },
      secretAction: 'replace',
      secret: { apiKey: 're_secret' },
    });
  });

  it('DELETE uses the canonical route and channel-only body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(true, 200, { deleted: true, channel: 'sms' }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteMessagingProviderConfig('sms');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/messaging-configuration');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ channel: 'sms' });
  });

  it('binds tests to provider/recipient/revision via idempotency while sending canonical test body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(true, 200, {
        jobId: 'j1',
        status: 'dry_run',
        total: 1,
        accepted: 0,
        failed: 0,
        pending: 0,
        unknown: 0,
        requiresReview: false,
        dryRun: true,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    await testConfiguredMessagingProvider({
      channel: 'sms',
      providerName: 'mim',
      recipient: '01700000000',
      configRevision: 'rev-9',
      live: false,
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe('/api/messaging-test-send');
    expect(JSON.parse(init.body)).toEqual({
      channel: 'sms',
      recipient: '01700000000',
      dryRun: true,
      confirmRealSend: false,
    });
    expect(init.headers['Idempotency-Key']).toContain('provider-config-test-sms');
    expect(JSON.stringify(init.body)).not.toContain('rev-9');
  });

  it('returns structured custom-provider validation errors', () => {
    const config = {
      ...emptyMessagingConfiguration('email'),
      providerName: 'custom' as const,
      providerConfig: {
        providerName: 'custom' as const,
        endpoint: 'http://insecure.test',
        method: 'POST' as const,
        auth: { placement: 'header' as const, name: '' },
        idempotency: { placement: 'none' as const },
        fieldMappings: { recipient: 'bad field!' },
        acceptedStatuses: [],
        providerIdPath: '',
      },
    };
    expect(validateMessagingConfiguration(config)).toEqual(
      expect.arrayContaining([
        { field: 'endpoint', message: 'Custom endpoint must be an exact HTTPS URL.' },
        { field: 'auth', message: 'Authentication header is required.' },
        { field: 'acceptedStatuses', message: 'At least one accepted HTTP status is required.' },
        {
          field: 'fieldMappings.recipient',
          message: 'Field mappings must use an allowed semantic and a safe field path.',
        },
      ])
    );
  });
});
