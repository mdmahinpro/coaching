-- Protected provider configuration. API keys are never stored in public site_settings.

BEGIN;

CREATE TABLE IF NOT EXISTS public.provider_secrets (
  provider TEXT PRIMARY KEY,
  api_key TEXT,
  endpoint TEXT,
  sender_id TEXT,
  from_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_secrets_admin_all ON public.provider_secrets;
CREATE POLICY provider_secrets_admin_all ON public.provider_secrets
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

COMMIT;
