import { randomUUID } from 'node:crypto';
import { guardServerEnvironment } from './environment-guard';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MiB (approved avatar limit)
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AVATAR_BUCKET = 'avatars';
const PUBLIC_ASSET_BUCKET = 'public-assets';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Result = { status: number; body: Record<string, unknown> };

function fail(status: number, error: string): Result {
  return { status, body: { error } };
}

function decodeImage(raw: unknown): { type: string; bytes: Uint8Array } | null {
  if (!raw || typeof raw !== 'object') {return null;}
  const value = raw as { type?: unknown; data?: unknown };
  if (typeof value.type !== 'string' || !ALLOWED.has(value.type)) {return null;}
  if (typeof value.data !== 'string' || !value.data.startsWith('base64,')) {return null;}
  const bytes = Uint8Array.from(Buffer.from(value.data.slice(7), 'base64'));
  if (!bytes.length || bytes.length > MAX_BYTES) {return null;}
  return { type: value.type, bytes };
}

function hasImageSignature(type: string, bytes: Uint8Array): boolean {
  if (type === 'image/jpeg') {return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;}
  if (type === 'image/png')
    {return bytes.slice(0, 8).every((b, i) => b === [137, 80, 78, 71, 13, 10, 26, 10][i]);}
  return (
    new TextDecoder().decode(bytes.slice(0, 12)).startsWith('RIFF') &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  );
}

async function verifyAdmin(token: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {return false;}
  const response = await fetch(`${url}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) {return false;}
  return (await response.json()) === true;
}

async function verifyStudent(token: string) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {return null;}
  const response = await fetch(`${url}/rest/v1/rpc/portal_get_profile`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token }),
  });
  if (!response.ok) {return null;}
  const rows = (await response.json()) as Array<{ id?: string }>;
  return rows?.[0]?.id ?? null;
}

export async function handleUploadAvatar(
  method: string,
  authHeader: string | undefined,
  rawBody: unknown
): Promise<Result> {
  if (method !== 'POST') {return fail(405, 'Method not allowed');}
  const environment = guardServerEnvironment();
  if (!environment.ok) {return environment.response;}
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) {return fail(401, 'Unauthorized');}
  const requestedStudentId =
    rawBody && typeof rawBody === 'object' && typeof (rawBody as { studentId?: unknown }).studentId === 'string'
      ? (rawBody as { studentId: string }).studentId
      : null;
  // Portal uploads derive identity only from the opaque session. Admin uploads
  // may name a target UUID, but only after the JWT passes the authoritative
  // is_admin() RPC; storage itself remains inaccessible to browser roles.
  const studentId = requestedStudentId
    ? UUID_RE.test(requestedStudentId) && (await verifyAdmin(token).catch(() => false))
      ? requestedStudentId
      : null
    : await verifyStudent(token).catch(() => null);
  if (!studentId) {return fail(401, 'Unauthorized');}
  const image = decodeImage(rawBody);
  if (!image || !hasImageSignature(image.type, image.bytes)) {return fail(400, 'Invalid image');}
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {return fail(503, 'Avatar upload is not configured');}
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
  if (!response.ok) {return fail(502, 'Avatar upload failed');}
  // Persist an opaque storage reference, never a public URL. Retrieval is
  // authorized independently and returns a short-lived signed URL.
  return { status: 200, body: { path, avatarRef: `${AVATAR_BUCKET}/${path}` } };
}

const PUBLIC_CATEGORIES = new Set(['admins', 'feedback', 'site', 'teachers']);

export async function handleUploadPublicAsset(
  method: string,
  authHeader: string | undefined,
  rawBody: unknown
): Promise<Result> {
  if (method !== 'POST') {return fail(405, 'Method not allowed');}
  const environment = guardServerEnvironment();
  if (!environment.ok) {return environment.response;}
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token || !(await verifyAdmin(token).catch(() => false))) {return fail(401, 'Unauthorized');}
  if (!rawBody || typeof rawBody !== 'object') {return fail(400, 'Invalid image');}
  const category = (rawBody as { category?: unknown }).category;
  if (typeof category !== 'string' || !PUBLIC_CATEGORIES.has(category)) {
    return fail(400, 'Invalid asset category');
  }
  const image = decodeImage(rawBody);
  if (!image || !hasImageSignature(image.type, image.bytes)) {return fail(400, 'Invalid image');}
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {return fail(503, 'Public asset upload is not configured');}
  const ext = image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${category}/${randomUUID()}.${ext}`;
  const response = await fetch(`${url}/storage/v1/object/${PUBLIC_ASSET_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': image.type,
      'x-upsert': 'false',
    },
    body: new Blob([new Uint8Array(image.bytes).buffer as ArrayBuffer]),
  });
  if (!response.ok) {return fail(502, 'Public asset upload failed');}
  return {
    status: 200,
    body: { path, publicUrl: `${url.replace(/\/+$/, '')}/storage/v1/object/public/${PUBLIC_ASSET_BUCKET}/${path}` },
  };
}

export type RetrieveAvatarRequest = { studentId?: string };

async function resolveAvatarPath(
  token: string,
  request: RetrieveAvatarRequest
): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {return null;}
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
    if (!resp.ok) {return null;}
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
  if (!resp.ok) {return null;}
  const rows = (await resp.json()) as Array<{ path?: string }>;
  return rows?.[0]?.path ?? null;
}

async function signAvatarPath(path: string, expiresSeconds: number): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {return null;}
  // path is 'avatars/students/<id>-photo.jpg'; split bucket + object path.
  const slash = path.indexOf('/');
  if (slash < 1) {return null;}
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
  if (!resp.ok) {return null;}
  const data = (await resp.json()) as { signedURL?: string };
  return data?.signedURL ?? null;
}

export async function handleRetrieveAvatar(
  method: string,
  authHeader: string | undefined,
  request: RetrieveAvatarRequest
): Promise<Result> {
  if (method !== 'GET') {return fail(405, 'Method not allowed');}
  const environment = guardServerEnvironment();
  if (!environment.ok) {return environment.response;}
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) {return fail(401, 'Unauthorized');}
  const path = await resolveAvatarPath(token, request).catch(() => null);
  if (!path) {return fail(401, 'Unauthorized');}
  const signed = await signAvatarPath(path, 60).catch(() => null);
  if (!signed) {return fail(502, 'Avatar retrieval is not configured');}
  const absolute = signed.startsWith('http') ? signed : `${process.env.SUPABASE_URL}${signed}`;
  return { status: 200, body: { signedURL: absolute } };
}
