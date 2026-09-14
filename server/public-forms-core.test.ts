import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractTrustedClientIp,
  generateAdmissionReference,
  handlePublicForm,
} from './public-forms-core';
import { PUBLIC_FORM_LIMITS } from '../shared/public-form-schemas';

const PROJECT_REF = 'hjzwbicauyxffrmdhvgy';
const admission = {
  name: 'Test Student',
  email: 'student@example.com',
  phone: '01700000000',
  guardian_name: 'Test Guardian',
  guardian_phone: '01800000000',
  address: '',
  class_level: 'Class 10',
  gender: 'other',
  batch_id: '11111111-1111-4111-8111-111111111111',
  message: '',
  website: '',
};
const headers = {
  'content-type': 'application/json',
  'x-vercel-forwarded-for': '203.0.113.7',
};

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', `https://${PROJECT_REF}.supabase.co`);
  vi.stubEnv('SUPABASE_ANON_KEY', 'sb_publishable_test_anon_key');
  vi.stubEnv('EXPECTED_SUPABASE_PROJECT_REF', PROJECT_REF);
  vi.stubEnv('ENVIRONMENT_KIND', 'test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('public form abuse controls', () => {
  it('accepts only the hosting provider trusted client-IP header', () => {
    expect(extractTrustedClientIp('vercel', { 'x-forwarded-for': '1.2.3.4' })).toBeNull();
    expect(extractTrustedClientIp('vercel', { 'x-vercel-forwarded-for': '203.0.113.8, 10.0.0.1' })).toBe('203.0.113.8');
    expect(extractTrustedClientIp('netlify', { 'x-nf-client-connection-ip': '2001:db8::1' })).toBe('2001:db8::1');
  });

  it('uses a CSPRNG-shaped admission reference', () => {
    expect(generateAdmissionReference()).toMatch(/^APP-[A-Z0-9_-]{12}$/);
    expect(generateAdmissionReference()).not.toBe(generateAdmissionReference());
  });

  it('rejects oversized, non-JSON, malformed, unknown, and privileged fields before I/O', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await handlePublicForm('admission', 'POST', { ...headers, 'content-length': String(PUBLIC_FORM_LIMITS.bodyBytes + 1) }, admission, 'vercel')).status).toBe(413);
    expect((await handlePublicForm('admission', 'POST', { ...headers, 'content-type': 'text/plain' }, admission, 'vercel')).status).toBe(415);
    expect((await handlePublicForm('admission', 'POST', headers, '{', 'vercel')).status).toBe(400);
    expect((await handlePublicForm('admission', 'POST', headers, { ...admission, status: 'approved' }, 'vercel')).status).toBe(400);
    expect((await handlePublicForm('admission', 'POST', headers, { ...admission, reference_no: 'APP-ATTACK' }, 'vercel')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed on environment mismatch before database I/O', async () => {
    vi.stubEnv('EXPECTED_SUPABASE_PROJECT_REF', 'bbbbbbbbbbbbbbbbbbbb');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await handlePublicForm('admission', 'POST', headers, admission, 'vercel')).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('silently accepts a honeypot hit without database I/O', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await handlePublicForm('admission', 'POST', headers, { ...admission, website: 'spam.example' }, 'vercel');
    expect(result.status).toBe(201);
    expect(result.body.reference).toMatch(/^APP-[A-Z0-9_-]{12}$/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits validated data through the service-role RPC and returns the server reference', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true,"id":"11111111-1111-4111-8111-111111111111"}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await handlePublicForm('admission', 'POST', headers, admission, 'vercel');
    expect(result.status).toBe(201);
    expect(result.body.reference).toMatch(/^APP-[A-Z0-9_-]{12}$/);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/rest/v1/rpc/submit_public_form');
    expect(new Headers(init.headers).get('apikey')).toBe('test-service-role-key');
    const rpcBody = JSON.parse(String(init.body));
    expect(rpcBody.p_client_ip).toBe('203.0.113.7');
    expect(rpcBody.p_payload.status).toBeUndefined();
    expect(rpcBody.p_payload.reference_no).toBeUndefined();
    expect(rpcBody.p_reference_no).toBe(result.body.reference);
  });

  it('maps database rate limiting to 429 without leaking database errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"rate_limited internal detail"}', {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })));
    const result = await handlePublicForm('contact', 'POST', headers, {
      name: 'Test User', email: 'user@example.com', phone: '', message: 'A sufficiently long message', website: '',
    }, 'vercel');
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: 'Too many submissions. Please try again later.', code: 'RATE_LIMITED' });
    expect(JSON.stringify(result.body)).not.toContain('internal detail');
  });
});
