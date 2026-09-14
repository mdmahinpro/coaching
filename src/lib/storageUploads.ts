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
  // Upload the public branding asset straight to the PUBLIC public-assets
  // bucket using the authenticated admin's own session. The
  // public_assets_admin_* storage policies (is_admin()) gate the write, so no
  // serverless /api route or SUPABASE_SERVICE_ROLE_KEY is required, and this
  // works on a plain Vite dev server too.
  if (!ALLOWED_IMAGE_TYPES.has(type)) {throw new Error('Unsupported image type');}
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${category}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from('public-assets')
    .upload(path, image, { contentType: type, upsert: false });
  if (error) {throw new Error(`Asset upload failed (${error.message})`);}
  const { data } = supabase.storage.from('public-assets').getPublicUrl(path);
  if (!data?.publicUrl) {throw new Error('Asset upload returned no URL');}
  return data.publicUrl;
}
