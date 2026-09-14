-- ============================================================
--  public-assets: allow authenticated ADMINS to upload from the browser.
--
--  The public-assets bucket holds PUBLIC, non-sensitive branding (site logo,
--  banners, teacher/admin images). The upload currently requires the
--  /api/upload-public-asset serverless function, which needs a
--  SUPABASE_SERVICE_ROLE_KEY environment variable and does not run on a plain
--  Vite dev server. This policy lets an authenticated admin (is_admin()) write
--  to that PUBLIC bucket directly via the normal Supabase client, so logo
--  upload works without any serverless function or service key.
--
--  The private `avatars` bucket (student photos) is NOT touched — it remains
--  service-role-only (personal data).
-- ============================================================

DROP POLICY IF EXISTS public_assets_admin_insert ON storage.objects;
CREATE POLICY "public_assets_admin_insert"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'public-assets' AND public.is_admin());

DROP POLICY IF EXISTS public_assets_admin_update ON storage.objects;
CREATE POLICY "public_assets_admin_update"
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'public-assets' AND public.is_admin())
  WITH CHECK (bucket_id = 'public-assets' AND public.is_admin());

DROP POLICY IF EXISTS public_assets_admin_delete ON storage.objects;
CREATE POLICY "public_assets_admin_delete"
  ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'public-assets' AND public.is_admin());