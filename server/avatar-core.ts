import { createClient } from '@supabase/supabase-js';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MiB (approved avatar limit)
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AVATAR_BUCKET = 'avatars';

type Result = { status: number; body: Record<string, unknown> };

/**
 * Project-bound public URL for an uploaded avatar object, using the Supabase
 * SDK's getPublicUrl against the configured project's `avatars` bucket. The
 * original project keeps that bucket public, so this is the reference the app
 * persists and displays. No credentials or signed URL are returned.
 */
export function buildPublicAvatarUrl(
  supabaseUrl: string,
  anonKey: string,
  objectPath: string
): string | null {
  if (!supabaseUrl || !anonKey || !objectPath) return null;
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client.storage.from(AVATAR_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

function fail(status: number, error: string): Result {
  return { status, body: { error } };
}

function decodeImage(raw: unknown): { type: string; bytes: Uint8Array } | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as { type?: unknown; data?: unknown };
  if (typeof value.type !== 'string' || !ALLOWED.has(value.type)) return null;
  if (typeof value.data !== 'string' || !value.data.startsWith('base64,')) return null;
  const bytes = Uint8Array.from(Buffer.from(value.data.slice(7), 'base64'));
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  return { type: value.type, bytes };
}

function hasImageSignature(type: string, bytes: Uint8Array): boolean {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png')
    return bytes.slice(0, 8).every((b, i) => b === [137, 80, 78, 71, 13, 10, 26, 10][i]);
  return (
    new TextDecoder().decode(bytes.slice(0, 12)).startsWith('RIFF') &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  );
}

async function verifyStudent(token: string) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const response = await fetch(`${url}/rest/v1/rpc/portal_get_profile`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token }),
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as Array<{ id?: string }>;
  return rows?.[0]?.id ?? null;
}

export async function handleUploadAvatar(
  method: string,
  authHeader: string | undefined,
  rawBody: unknown
): Promise<Result> {
  if (method !== 'POST') return fail(405, 'Method not allowed');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return fail(401, 'Unauthorized');
  // Identity is derived ONLY from the validated opaque session, never from the
  // request body, so one student can never write another student's object.
  const studentId = await verifyStudent(token).catch(() => null);
  if (!studentId) return fail(401, 'Unauthorized');
  const image = decodeImage(rawBody);
  if (!image || !hasImageSignature(image.type, image.bytes)) return fail(400, 'Invalid image');
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceKey) return fail(503, 'Avatar upload is not configured');
  const path = `students/${studentId}-photo.jpg`;
  const response = await fetch(`${url}/storage/v1/object/${AVATAR_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
    },
    body: new Blob([new Uint8Array(image.bytes).buffer as ArrayBuffer]),
  });
  if (!response.ok) return fail(502, 'Avatar upload failed');
  const publicUrl = buildPublicAvatarUrl(url, anon, path);
  if (!publicUrl) return fail(502, 'Avatar upload failed');
  // `path` is retained for existing callers; `publicUrl` is the value the
  // portal persists for the original public-bucket display flow.
  return { status: 200, body: { path, publicUrl } };
}

export type RetrieveAvatarRequest = { studentId?: string };

async function resolveAvatarPath(
  token: string,
  request: RetrieveAvatarRequest
): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  // Admin path: an explicit student_id is requested. The caller presents their
  // Supabase JWT (role=authenticated); admin_get_avatar_path is authenticated-
  // granted SECURITY DEFINER and enforces is_admin() against that caller.
  if (request.studentId) {
    const resp = await fetch(`${url}/rest/v1/rpc/admin_get_avatar_path`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_student_id: request.studentId }),
    });
    if (!resp.ok) return null;
    const rows = (await resp.json()) as Array<{ path?: string }>;
    return rows?.[0]?.path ?? null;
  }
  // Student path: the opaque portal session token resolves the caller's OWN
  // avatar server-side (students are not the Supabase authenticated role).
  const resp = await fetch(`${url}/rest/v1/rpc/portal_get_avatar_path`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token }),
  });
  if (!resp.ok) return null;
  const rows = (await resp.json()) as Array<{ path?: string }>;
  return rows?.[0]?.path ?? null;
}

async function signAvatarPath(path: string, expiresSeconds: number): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  // path is 'avatars/students/<id>-photo.jpg'; split bucket + object path.
  const slash = path.indexOf('/');
  if (slash < 1) return null;
  const bucketId = path.slice(0, slash);
  const objectPath = path.slice(slash + 1);
  const resp = await fetch(`${url}/storage/v1/object/sign/${bucketId}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: expiresSeconds, download: false }),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { signedURL?: string };
  return data?.signedURL ?? null;
}

export async function handleRetrieveAvatar(
  method: string,
  authHeader: string | undefined,
  request: RetrieveAvatarRequest
): Promise<Result> {
  if (method !== 'GET') return fail(405, 'Method not allowed');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return fail(401, 'Unauthorized');
  const path = await resolveAvatarPath(token, request).catch(() => null);
  if (!path) return fail(401, 'Unauthorized');
  const signed = await signAvatarPath(path, 60).catch(() => null);
  if (!signed) return fail(502, 'Avatar retrieval is not configured');
  const absolute = signed.startsWith('http') ? signed : `${process.env.SUPABASE_URL}${signed}`;
  return { status: 200, body: { signedURL: absolute } };
}
