import { describe, expect, it, vi, afterEach } from 'vitest';
import { isPrivateAvatarRef, originalAvatarPublicUrl, resolveAvatarUrl } from './avatarRetrieval';

const PROJECT = 'https://flbvusudwszxdylxevfe.supabase.co';
const UUID = '11111111-2222-3333-4444-555555555555';

describe('isPrivateAvatarRef', () => {
  it('detects private student avatar object refs', () => {
    expect(isPrivateAvatarRef('students/11111111-2222-3333-4444-555555555555-photo.jpg')).toBe(
      true
    );
    expect(
      isPrivateAvatarRef('avatars/students/11111111-2222-3333-4444-555555555555-photo.jpg')
    ).toBe(true);
  });

  it('does not treat public http(s) URLs as private refs', () => {
    expect(
      isPrivateAvatarRef(
        'https://x.supabase.co/storage/v1/object/public/avatars/students/a-photo.jpg'
      )
    ).toBe(false);
    expect(isPrivateAvatarRef('https://randomuser.me/api/portraits/men/1.jpg')).toBe(false);
  });

  it('rejects null/undefined/empty', () => {
    expect(isPrivateAvatarRef(null)).toBe(false);
    expect(isPrivateAvatarRef(undefined)).toBe(false);
    expect(isPrivateAvatarRef('')).toBe(false);
  });

  it('rejects non-avatar object paths', () => {
    expect(isPrivateAvatarRef('students/not-a-uuid.jpg')).toBe(false);
    expect(
      isPrivateAvatarRef('other-bucket/students/11111111-2222-3333-4444-555555555555-photo.jpg')
    ).toBe(false);
  });
});

describe('resolveAvatarUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes public URLs through unchanged without calling the endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const publicUrl = 'https://randomuser.me/api/portraits/men/1.jpg';
    await expect(resolveAvatarUrl(publicUrl, 'token')).resolves.toBe(publicUrl);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for empty values', async () => {
    await expect(resolveAvatarUrl('', 'token')).resolves.toBeNull();
    await expect(resolveAvatarUrl(null, 'token')).resolves.toBeNull();
    await expect(resolveAvatarUrl(undefined, 'token')).resolves.toBeNull();
  });

  it('expands the validated original avatars ref to a public URL without any RPC call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveAvatarUrl(`avatars/students/${UUID}-photo.jpg`, 'portal-token', {
      supabaseUrl: PROJECT,
    });

    expect(resolved).toBe(`${PROJECT}/storage/v1/object/public/avatars/students/${UUID}-photo.jpg`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call absent retrieval RPCs for the original public-avatar flow', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await resolveAvatarUrl(`avatars/students/${UUID}-photo.jpg`, 'portal-token', {
      supabaseUrl: PROJECT,
    });

    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes('portal_get_avatar_path'))).toBe(false);
    expect(calledUrls.some((u) => u.includes('admin_get_avatar_path'))).toBe(false);
    expect(calledUrls.some((u) => u.includes('/api/retrieve-avatar'))).toBe(false);
  });
});

describe('originalAvatarPublicUrl', () => {
  it('builds the project-bound public URL for the exact original reference', () => {
    expect(originalAvatarPublicUrl(`avatars/students/${UUID}-photo.jpg`, PROJECT)).toBe(
      `${PROJECT}/storage/v1/object/public/avatars/students/${UUID}-photo.jpg`
    );
  });

  it('is null without a configured project url', () => {
    expect(originalAvatarPublicUrl(`avatars/students/${UUID}-photo.jpg`, undefined)).toBeNull();
  });

  it('accepts only the validated original format (no arbitrary paths)', () => {
    expect(originalAvatarPublicUrl(`students/${UUID}-photo.jpg`, PROJECT)).toBeNull();
    expect(originalAvatarPublicUrl(`avatars/teachers/${UUID}.jpg`, PROJECT)).toBeNull();
    expect(originalAvatarPublicUrl('avatars/students/not-a-uuid-photo.jpg', PROJECT)).toBeNull();
    expect(originalAvatarPublicUrl(`other/students/${UUID}-photo.jpg`, PROJECT)).toBeNull();
    expect(originalAvatarPublicUrl(`avatars/students/${UUID}-photo.jpg?x=1`, PROJECT)).toBeNull();
  });

  it('does not double slashes when the project url ends with a slash', () => {
    expect(originalAvatarPublicUrl(`avatars/students/${UUID}-photo.jpg`, `${PROJECT}/`)).toBe(
      `${PROJECT}/storage/v1/object/public/avatars/students/${UUID}-photo.jpg`
    );
  });
});
