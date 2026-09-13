import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleUploadAvatar } from './avatar-core';

const PROJECT = 'https://flbvusudwszxdylxevfe.supabase.co';
const ANON = 'sb_publishable_test-public-key';
const SERVICE = 'test-service-role-key';
const STUDENT_ID = '11111111-2222-3333-4444-555555555555';

/** A tiny PNG payload that passes the signature/size checks. */
const PNG_DATA = `base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`;

function stubConfiguredEnv() {
  vi.stubEnv('SUPABASE_URL', PROJECT);
  vi.stubEnv('SUPABASE_ANON_KEY', ANON);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
}

function resolveSession(fetchMock: ReturnType<typeof vi.fn>) {
  // First call: portal_get_profile resolves the opaque token to the student id.
  fetchMock.mockImplementationOnce(
    async () => new Response(`[{"id":"${STUDENT_ID}"}]`, { status: 200 })
  );
}

describe('avatar upload authorization boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('rejects anonymous uploads before touching storage', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleUploadAvatar('POST', undefined, {
      type: 'image/png',
      data: 'base64,iVBORw0KGgo=',
    });

    expect(result.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported content without touching storage', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleUploadAvatar('POST', 'Bearer synthetic-token', {
      type: 'image/svg+xml',
      data: 'base64,PHN2Zy8+',
    });

    expect(result.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a valid-looking request when the session cannot resolve', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://synthetic.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'synthetic-anon-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleUploadAvatar('POST', 'Bearer synthetic-token', {
      type: 'image/png',
      data: 'base64,iVBORw0KGgo=',
    });

    expect(result.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an image over the 2 MiB approved limit once the session resolves', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://synthetic.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'synthetic-anon-key');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key');
    // Session resolves to a student id on the first call.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async () => new Response('[{"id":"11111111-2222-3333-4444-555555555555"}]', { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);

    // PNG magic + 2 MiB + 1 byte of payload, base64-encoded.
    const big = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(2 * 1024 * 1024 + 1, 1),
    ]);
    const data = `base64,${big.toString('base64')}`;

    const result = await handleUploadAvatar('POST', 'Bearer synthetic-token', {
      type: 'image/png',
      data,
    });

    // The decoder rejects it before any storage write.
    expect(result.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the project/bucket publicUrl for the uploaded object on success', async () => {
    stubConfiguredEnv();
    const fetchMock = vi.fn();
    resolveSession(fetchMock);
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleUploadAvatar('POST', 'Bearer portal-token', {
      type: 'image/png',
      data: PNG_DATA,
    });

    expect(result.status).toBe(200);
    expect(result.body.publicUrl).toBe(
      `${PROJECT}/storage/v1/object/public/avatars/students/${STUDENT_ID}-photo.jpg`
    );
    // `path` is retained for existing callers.
    expect(result.body.path).toBe(`students/${STUDENT_ID}-photo.jpg`);
    // No credential or signed URL is leaked.
    expect(JSON.stringify(result.body)).not.toContain(SERVICE);
    expect(JSON.stringify(result.body)).not.toContain(ANON);
    expect(JSON.stringify(result.body)).not.toContain('token=');

    // The storage write targets the configured project's avatars bucket path.
    const storageCall = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes('/storage/v1/object/'));
    expect(storageCall).toBe(
      `${PROJECT}/storage/v1/object/avatars/students/${STUDENT_ID}-photo.jpg`
    );
  });

  it('derives identity from the validated session, not the request body', async () => {
    stubConfiguredEnv();
    const fetchMock = vi.fn();
    resolveSession(fetchMock);
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleUploadAvatar('POST', 'Bearer portal-token', {
      type: 'image/png',
      data: PNG_DATA,
      // A client-supplied id MUST be ignored.
      studentId: '99999999-9999-4999-8999-999999999999',
      path: 'students/99999999-9999-4999-8999-999999999999-photo.jpg',
    });

    expect(result.status).toBe(200);
    expect(result.body.path).toBe(`students/${STUDENT_ID}-photo.jpg`);
    expect(result.body.publicUrl).toContain(`students/${STUDENT_ID}-photo.jpg`);
    expect(JSON.stringify(result.body)).not.toContain('99999999-9999-4999-8999-999999999999');
  });

  it("ignores a cross-student attempt and never writes another student's object", async () => {
    stubConfiguredEnv();
    const fetchMock = vi.fn();
    // Session resolves to STUDENT_ID; caller tries to write another object.
    resolveSession(fetchMock);
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleUploadAvatar('POST', 'Bearer portal-token', {
      type: 'image/png',
      data: PNG_DATA,
      studentId: '99999999-9999-4999-8999-999999999999',
    });

    // Upload is bound to the session's own id; the other student's object is
    // never touched, so the cross-student target fails.
    expect(result.status).toBe(200);
    const storageCall = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes('/storage/v1/object/'));
    expect(storageCall).toContain(`students/${STUDENT_ID}-photo.jpg`);
    expect(storageCall).not.toContain('99999999');
  });

  it('rejects an expired/invalid session before any storage write', async () => {
    stubConfiguredEnv();
    const fetchMock = vi
      .fn()
      // portal_get_profile returns an empty row set for an invalid token.
      .mockImplementationOnce(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleUploadAvatar('POST', 'Bearer expired-token', {
      type: 'image/png',
      data: PNG_DATA,
    });

    expect(result.status).toBe(401);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/storage/v1/object/'))).toBe(
      false
    );
  });

  it('does not return a publicUrl when the storage write fails', async () => {
    stubConfiguredEnv();
    const fetchMock = vi.fn();
    resolveSession(fetchMock);
    fetchMock.mockImplementationOnce(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleUploadAvatar('POST', 'Bearer portal-token', {
      type: 'image/png',
      data: PNG_DATA,
    });

    expect(result.status).toBe(502);
    expect(result.body.publicUrl).toBeUndefined();
  });
});
