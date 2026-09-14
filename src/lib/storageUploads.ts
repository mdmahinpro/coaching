import { supabase } from '@/lib/supabase';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function encodeImage(file: Blob, type: string): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(type)) {throw new Error('Unsupported image type');}
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {binary += String.fromCharCode(byte);}
  return `base64,${btoa(binary)}`;
}

async function adminBearer(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {throw new Error('Not signed in');}
  return token;
}

export async function uploadStudentAvatarAsAdmin(studentId: string, image: Blob): Promise<string> {
  const response = await fetch('/api/upload-avatar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await adminBearer()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, type: 'image/jpeg', data: await encodeImage(image, 'image/jpeg') }),
  });
  if (!response.ok) {throw new Error(`Avatar upload failed (${response.status})`);}
  const payload = (await response.json()) as { avatarRef?: string };
  if (!payload.avatarRef) {throw new Error('Avatar upload returned no reference');}
  return payload.avatarRef;
}

export type PublicAssetCategory = 'admins' | 'feedback' | 'site' | 'teachers';

export async function uploadPublicAsset(
  category: PublicAssetCategory,
  image: Blob,
  type: 'image/jpeg' | 'image/png' | 'image/webp'
): Promise<string> {
  const response = await fetch('/api/upload-public-asset', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await adminBearer()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, type, data: await encodeImage(image, type) }),
  });
  if (!response.ok) {throw new Error(`Asset upload failed (${response.status})`);}
  const payload = (await response.json()) as { publicUrl?: string };
  if (!payload.publicUrl) {throw new Error('Asset upload returned no URL');}
  return payload.publicUrl;
}
