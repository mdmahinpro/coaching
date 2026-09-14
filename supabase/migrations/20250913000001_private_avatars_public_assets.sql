-- Reconcile storage with the production server boundaries.
-- Student photos are private service-role-only objects. Intentionally public
-- branding, teacher, feedback and admin images live in a separate public bucket
-- and are also service-role-only for writes (via /api/upload-public-asset).
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars', 'avatars', false, 2097152,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'public-assets', 'public-assets', true, 2097152,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Remove every historical browser write/read policy for the old mixed bucket.
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_delete" ON storage.objects;
DROP POLICY IF EXISTS "avatars_anon_upload" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_auth_delete" ON storage.objects;

-- Deliberately create no INSERT/UPDATE/DELETE policy for either bucket. Public
-- means unauthenticated reads only; all writes require the server service role.

-- Normalize legacy student public URLs to opaque private references. The server
-- retrieval endpoint supports these refs and signs only the caller-authorized
-- student's canonical object path.
UPDATE public.students
SET photo_url = regexp_replace(
  photo_url,
  '^https://[^/]+/storage/v1/object/public/avatars/(students/[0-9a-fA-F-]{36}-photo\.jpg)(\?.*)?$',
  'avatars/\1'
)
WHERE photo_url ~ '^https://[^/]+/storage/v1/object/public/avatars/students/[0-9a-fA-F-]{36}-photo\.jpg(\?.*)?$';

COMMIT;
