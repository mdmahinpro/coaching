import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_REQUEST_LIMITS, handleSendEmail } from './email-core';
import { SMS_REQUEST_LIMITS, handleSendSms } from './sms-core';

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co');
  vi.stubEnv('SUPABASE_ANON_KEY', 'sb_publishable_synthetic_anon');
  vi.stubEnv('EXPECTED_SUPABASE_PROJECT_REF', 'aaaaaaaaaaaaaaaaaaaa');
  vi.stubEnv('ENVIRONMENT_KIND', 'test');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('refuses SMS and email before any I/O when the server project identity mismatches', async () => {
  vi.stubEnv('EXPECTED_SUPABASE_PROJECT_REF', 'bbbbbbbbbbbbbbbbbbbb');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  expect((await handleSendSms('POST', 'Bearer token', { phones: ['01700000000'], message: 'hi' })).status).toBe(503);
  expect((await handleSendEmail('POST', 'Bearer token', { emails: ['a@example.com'], subject: 'hi', html: '<p>hi</p>' })).status).toBe(503);
  expect(fetchMock).not.toHaveBeenCalled();
});

function authenticatedFetch() {
  const fetchMock = vi.fn().mockResolvedValueOnce(
    new Response('true', { status: 200, headers: { 'Content-Type': 'application/json' } })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('SMS request caps', () => {
  it('rejects oversized raw bodies before authorization/provider requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleSendSms(
      'POST',
      'Bearer token',
      'x'.repeat(SMS_REQUEST_LIMITS.bodyBytes + 1)
    );
    expect(result.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects recipient and message limit violations before provider configuration', async () => {
    let fetchMock = authenticatedFetch();
    let result = await handleSendSms('POST', 'Bearer token', {
      phones: Array.from({ length: SMS_REQUEST_LIMITS.recipients + 1 }, () => '01700000000'),
      message: 'hello',
    });
    expect(result.status).toBe(413);
    expect(result.body).toEqual({ error: 'SMS requests support at most 1000 recipients; split this campaign into smaller requests' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock = authenticatedFetch();
    result = await handleSendSms('POST', 'Bearer token', {
      phones: ['01700000000'],
      message: 'x'.repeat(SMS_REQUEST_LIMITS.messageCharacters + 1),
    });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'SMS message must be no more than 1500 characters' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('email request caps', () => {
  it('rejects oversized raw bodies before authorization/provider requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleSendEmail(
      'POST',
      'Bearer token',
      'x'.repeat(EMAIL_REQUEST_LIMITS.bodyBytes + 1)
    );
    expect(result.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects recipient, subject and HTML caps before provider configuration', async () => {
    let fetchMock = authenticatedFetch();
    let result = await handleSendEmail('POST', 'Bearer token', {
      emails: Array.from({ length: EMAIL_REQUEST_LIMITS.recipients + 1 }, () => 'a@example.com'),
      subject: 'subject',
      html: '<p>hello</p>',
    });
    expect(result.status).toBe(413);
    expect(result.body).toEqual({ error: 'Email requests support at most 1000 recipients; split this campaign into smaller requests' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock = authenticatedFetch();
    result = await handleSendEmail('POST', 'Bearer token', {
      emails: ['a@example.com'],
      subject: 'x'.repeat(EMAIL_REQUEST_LIMITS.subjectCharacters + 1),
      html: '<p>hello</p>',
    });
    expect(result.status).toBe(413);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock = authenticatedFetch();
    result = await handleSendEmail('POST', 'Bearer token', {
      emails: ['a@example.com'],
      subject: 'subject',
      html: 'ü'.repeat(EMAIL_REQUEST_LIMITS.htmlBytes / 2 + 1),
    });
    expect(result.status).toBe(413);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
