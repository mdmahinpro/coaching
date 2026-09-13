/**
 * Avatar reference resolution.
 *
 * The original/released project keeps the `avatars` bucket PUBLIC, and those
 * public object URLs display directly. For the one validated original avatars
 * reference format (`avatars/students/<uuid>-photo.jpg`) this helper expands a
 * project-bound public URL locally, so the original public-avatar display path
 * does NOT depend on the absent `portal_get_avatar_path`/`admin_get_avatar_path`
 * RPCs.
 *
 * A separate OPTIONAL private-retrieval path remains for deployments that have
 * actually privatized the bucket; it is only used when no project URL is
 * available and is not required by the original setup.
 */

const PRIVATE_AVATAR_RE = /^(avatars\/)?students\/[0-9a-f-]{36}-photo\.jpg$/i;

/**
 * The validated ORIGINAL avatars reference format. The released app keeps the
 * `avatars` bucket public, so this one canonical bare path can be expanded to
 * the configured project's public object URL without any retrieval RPC. The
 * pattern is intentionally exact: no arbitrary/other-bucket paths are accepted.
 */
const ORIGINAL_AVATAR_REF_RE = /^avatars\/students\/[0-9a-f-]{36}-photo\.jpg$/i;

export function isPrivateAvatarRef(value: string | null | undefined): boolean {
  if (!value) return false;
  // A signed/public http(s) URL is not a private object ref.
  if (/^https?:\/\//i.test(value)) return false;
  return PRIVATE_AVATAR_RE.test(value);
}

/**
 * Expand the validated original avatars reference to a project-bound public
 * URL. Returns null for anything that is not exactly that reference, so this
 * cannot be used to expose arbitrary object paths.
 */
export function originalAvatarPublicUrl(
  value: string | null | undefined,
  supabaseUrl: string | undefined
): string | null {
  if (!value || !supabaseUrl || !ORIGINAL_AVATAR_REF_RE.test(value)) return null;
  const base = supabaseUrl.replace(/\/+$/, '');
  // `value` is 'avatars/students/<id>-photo.jpg'; strip the bucket prefix.
  const objectPath = value.slice('avatars/'.length);
  return `${base}/storage/v1/object/public/avatars/${objectPath}`;
}

const signedCache = new Map<string, { url: string; expires: number }>();

async function requestSignedUrl(url: string, bearer: string): Promise<string> {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!res.ok) throw new Error(`avatar retrieval failed (${res.status})`);
  const data = (await res.json()) as { signedURL?: string };
  if (!data.signedURL) throw new Error('avatar retrieval returned no url');
  return data.signedURL;
}

/**
 * Resolve an avatar reference to a displayable URL.
 * @param ref   stored photo_url value
 * @param bearer authorization token for the OPTIONAL private-retrieval endpoint.
 *        For a student this is the opaque portal token; for an admin it is the
 *        Supabase JWT (and you should also pass `studentId` for the target).
 * @param opts
 *   - studentId: for admin retrieval, the target student's UUID.
 *   - supabaseUrl: the configured project URL. When present, the validated
 *     original avatars reference resolves to a project-bound public URL without
 *     contacting any retrieval RPC (the original public-bucket flow).
 */
export async function resolveAvatarUrl(
  ref: string | null | undefined,
  bearer: string,
  opts: { studentId?: string; supabaseUrl?: string } = {}
): Promise<string | null> {
  if (!ref) return null;
  if (!isPrivateAvatarRef(ref)) return ref;

  // Original public-bucket flow: expand the validated reference locally and
  // never touch the absent retrieval RPCs.
  const projectPublicUrl = originalAvatarPublicUrl(ref, opts.supabaseUrl);
  if (projectPublicUrl) return projectPublicUrl;

  const query = opts.studentId ? `?student_id=${encodeURIComponent(opts.studentId)}` : '';
  const key = `${ref}|${bearer}|${opts.studentId ?? ''}`;
  const cached = signedCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.url;

  const url = resolveAvatarUrlPath(query);
  try {
    const signed = await requestSignedUrl(url, bearer);
    // Signed URLs are short-lived (~60s); cache just under that.
    const expires = Date.now() + 55_000;
    signedCache.set(key, { url: signed, expires });
    return signed;
  } catch {
    // Fail back to the private ref as-is (broken image) rather than throwing
    // and crashing a whole page; the app logs via the console.
    if (typeof console !== 'undefined') console.error('avatar retrieval failed for', ref);
    return null;
  }
}

function resolveAvatarUrlPath(query: string): string {
  return `/api/retrieve-avatar${query}`;
}
