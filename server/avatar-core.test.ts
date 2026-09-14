import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRetrieveAvatar, handleUploadAvatar, handleUploadPublicAsset } from './avatar-core';

const PROJECT_REF = 'aaaaaaaaaaaaaaaaaaaa';
const PROJECT = `https://${PROJECT_REF}.supabase.co`;
const ANON = 'sb_publishable_test_anon_key';
const SERVICE = 'service-role-key';
const STUDENT_ID = '11111111-2222-4333-8444-555555555555';
const PNG_DATA = `base64,${Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).toString('base64')}`;

function env() {
  vi.stubEnv('SUPABASE_URL', PROJECT);
  vi.stubEnv('SUPABASE_ANON_KEY', ANON);
  vi.stubEnv('EXPECTED_SUPABASE_PROJECT_REF', PROJECT_REF);
  vi.stubEnv('ENVIRONMENT_KIND', 'test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
}

beforeEach(env);
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('private avatar upload boundary', () => {
  it('refuses avatar and public-asset operations before I/O on project mismatch', async () => {
    vi.stubEnv('EXPECTED_SUPABASE_PROJECT_REF', 'bbbbbbbbbbbbbbbbbbbb');
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect((await handleUploadAvatar('POST', 'Bearer token', {})).status).toBe(503);
    expect((await handleRetrieveAvatar('GET', 'Bearer token', {})).status).toBe(503);
    expect((await handleUploadPublicAsset('POST', 'Bearer token', {})).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects anonymous uploads before storage', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect((await handleUploadAvatar('POST', undefined, {})).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('derives portal target from the validated session and returns no public URL', async () => {
    env();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(`[{"id":"${STUDENT_ID}"}]`, { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleUploadAvatar('POST', 'Bearer portal-token', { type: 'image/png', data: PNG_DATA });
    expect(result).toEqual({ status: 200, body: { path: `students/${STUDENT_ID}-photo.jpg`, avatarRef: `avatars/students/${STUDENT_ID}-photo.jpg` } });
    expect(result.body.publicUrl).toBeUndefined();
    expect(fetchMock.mock.calls[1][0]).toBe(`${PROJECT}/storage/v1/object/avatars/students/${STUDENT_ID}-photo.jpg`);
  });

  it('allows an admin JWT to upload a named student UUID after is_admin()', async () => {
    env();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('true', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleUploadAvatar('POST', 'Bearer admin-jwt', { studentId: STUDENT_ID, type: 'image/png', data: PNG_DATA });
    expect(result.status).toBe(200);
    expect(String(fetchMock.mock.calls[1][0])).toContain(`/avatars/students/${STUDENT_ID}-photo.jpg`);
  });

  it('rejects a named target for a non-admin before storage', async () => {
    env();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('false', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleUploadAvatar('POST', 'Bearer user-jwt', { studentId: STUDENT_ID, type: 'image/png', data: PNG_DATA });
    expect(result.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('signed private retrieval', () => {
  it('resolves the portal owner then signs the canonical avatars path', async () => {
    env();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(`[{"path":"avatars/students/${STUDENT_ID}-photo.jpg"}]`, { status: 200 }))
      .mockResolvedValueOnce(new Response('{"signedURL":"/storage/v1/object/sign/avatars/signed-token"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleRetrieveAvatar('GET', 'Bearer portal-token', {});
    expect(result.body.signedURL).toBe(`${PROJECT}/storage/v1/object/sign/avatars/signed-token`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${PROJECT}/storage/v1/object/sign/avatars/students/${STUDENT_ID}-photo.jpg`);
  });
});

describe('public asset upload boundary', () => {
  it('uses public-assets only after admin authorization', async () => {
    env();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('true', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleUploadPublicAsset('POST', 'Bearer admin-jwt', { category: 'teachers', type: 'image/png', data: PNG_DATA });
    expect(result.status).toBe(200);
    expect(result.body.publicUrl).toMatch(new RegExp(`^${PROJECT}/storage/v1/object/public/public-assets/teachers/`));
    expect(String(fetchMock.mock.calls[1][0])).toContain('/storage/v1/object/public-assets/teachers/');
  });

  it('rejects unknown categories without storage access', async () => {
    env();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('true', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleUploadPublicAsset('POST', 'Bearer admin-jwt', { category: 'students', type: 'image/png', data: PNG_DATA });
    expect(result.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
