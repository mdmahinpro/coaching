/** Resolve private student-photo references through the authenticated server boundary. */
const OBJECT_REF_RE = /^(?:avatars\/)?students\/([0-9a-f-]{36})-photo\.jpg$/i;
const LEGACY_PUBLIC_RE = /^https:\/\/[^/]+\/storage\/v1\/object\/public\/avatars\/students\/([0-9a-f-]{36})-photo\.jpg(?:\?.*)?$/i;

export function privateAvatarStudentId(value: string | null | undefined): string | null {
  if (!value) {return null;}
  return OBJECT_REF_RE.exec(value)?.[1] ?? LEGACY_PUBLIC_RE.exec(value)?.[1] ?? null;
}

export function isPrivateAvatarRef(value: string | null | undefined): boolean {
  return privateAvatarStudentId(value) !== null;
}

const signedCache = new Map<string, { url: string; expires: number }>();

async function requestSignedUrl(url: string, bearer: string): Promise<string> {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!res.ok) {throw new Error(`avatar retrieval failed (${res.status})`);}
  const data = (await res.json()) as { signedURL?: string };
  if (!data.signedURL) {throw new Error('avatar retrieval returned no url');}
  return data.signedURL;
}

export async function resolveAvatarUrl(
  ref: string | null | undefined,
  bearer: string,
  opts: { studentId?: string } = {}
): Promise<string | null> {
  if (!ref) {return null;}
  if (!isPrivateAvatarRef(ref)) {return ref;}
  if (!bearer) {return null;}

  const studentId = opts.studentId;
  const query = studentId ? `?student_id=${encodeURIComponent(studentId)}` : '';
  const key = `${ref}|${bearer}|${studentId ?? ''}`;
  const cached = signedCache.get(key);
  if (cached && cached.expires > Date.now()) {return cached.url;}

  try {
    const signed = await requestSignedUrl(`/api/retrieve-avatar${query}`, bearer);
    signedCache.set(key, { url: signed, expires: Date.now() + 55_000 });
    return signed;
  } catch {
    if (typeof console !== 'undefined') {console.error('avatar retrieval failed for', ref);}
    return null;
  }
}
