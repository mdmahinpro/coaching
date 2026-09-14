import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPrivateAvatarRef, privateAvatarStudentId, resolveAvatarUrl } from './avatarRetrieval';

const UUID = '11111111-2222-3333-4444-555555555555';
const LEGACY = `https://project.supabase.co/storage/v1/object/public/avatars/students/${UUID}-photo.jpg`;

afterEach(() => vi.unstubAllGlobals());

describe('private avatar references', () => {
  it('recognizes canonical, bare, and legacy public-url forms as private', () => {
    expect(isPrivateAvatarRef(`avatars/students/${UUID}-photo.jpg`)).toBe(true);
    expect(isPrivateAvatarRef(`students/${UUID}-photo.jpg`)).toBe(true);
    expect(isPrivateAvatarRef(`${LEGACY}?cache=old`)).toBe(true);
    expect(privateAvatarStudentId(LEGACY)).toBe(UUID);
  });

  it('does not capture unrelated public or arbitrary storage URLs', () => {
    expect(isPrivateAvatarRef('https://randomuser.me/api/portraits/men/1.jpg')).toBe(false);
    expect(isPrivateAvatarRef(`https://project.supabase.co/storage/v1/object/public/public-assets/teachers/${UUID}.jpg`)).toBe(false);
    expect(isPrivateAvatarRef(`avatars/teachers/${UUID}.jpg`)).toBe(false);
  });
});

describe('resolveAvatarUrl', () => {
  it('passes intentional public assets through without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const url = 'https://project.supabase.co/storage/v1/object/public/public-assets/site/logo.png';
    await expect(resolveAvatarUrl(url, 'token')).resolves.toBe(url);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retrieves a student-owned signed URL without an admin target query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"signedURL":"https://signed.example/a"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(resolveAvatarUrl(`avatars/students/${UUID}-photo.jpg`, 'portal-token')).resolves.toBe('https://signed.example/a');
    expect(fetchMock).toHaveBeenCalledWith('/api/retrieve-avatar', expect.objectContaining({ headers: { Authorization: 'Bearer portal-token' } }));
  });

  it('routes admin retrieval with the explicitly authorized target id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"signedURL":"https://signed.example/b"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await resolveAvatarUrl(LEGACY, 'admin-jwt', { studentId: UUID });
    expect(fetchMock).toHaveBeenCalledWith(`/api/retrieve-avatar?student_id=${UUID}`, expect.any(Object));
  });
});
