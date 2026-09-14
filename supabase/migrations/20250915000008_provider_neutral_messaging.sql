-- Authoritative provider-neutral messaging contract: safe configuration, versioned encrypted credentials, immutable job snapshots.
BEGIN;

CREATE OR REPLACE FUNCTION public._messaging_safe_path(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $fn$
  SELECT char_length(p_path) BETWEEN 1 AND 256
    AND p_path ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}(\.[A-Za-z][A-Za-z0-9_-]{0,63})*$'
    AND p_path !~* '(^|\.)(__proto__|prototype|constructor|password|passwd|secret|token|api_?key|apikey|credential|authorization|cookie|private_?key)(\.|$)'
    AND p_path !~ E'[\r\n]'
$fn$;

CREATE OR REPLACE FUNCTION public._messaging_safe_header(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $fn$
  SELECT char_length(p_name) BETWEEN 1 AND 128
    AND p_name ~ '^[!#$%&''*+.^_`|~0-9A-Za-z-]+$'
    AND lower(p_name) <> ALL (ARRAY['authorization','proxy-authorization','cookie','set-cookie','host','content-length','connection','transfer-encoding','te','trailer','upgrade','keep-alive','proxy-authenticate','proxy-connection'])
    AND p_name !~* '(password|passwd|secret|token|api.?key|credential)'
$fn$;

CREATE OR REPLACE FUNCTION public._messaging_provider_config_valid(p_channel public.message_channel, p_provider TEXT, p_config JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $fn$
DECLARE v_key TEXT; v_value JSONB; v_auth JSONB; v_idem JSONB; v_endpoint TEXT;
BEGIN
  IF jsonb_typeof(p_config) <> 'object' OR p_config ->> 'providerName' IS DISTINCT FROM p_provider
    OR p_config::TEXT ~* '(-----BEGIN|bearer[[:space:]]+[A-Za-z0-9._~+/-]{8}|(^|[^a-z])(sk|pk|api)[_-][A-Za-z0-9_-]{12}|eyJ[A-Za-z0-9_-]{8,}\.|[A-Fa-f0-9]{32,}|eval[[:space:]]*\(|function[[:space:]]*\(|<%|\{\{)'
    OR p_config::TEXT ~ E'[\r\n]' THEN RETURN false; END IF;
  IF p_provider = 'mim' THEN
    RETURN p_channel = 'sms' AND p_config ?& ARRAY['providerName','userName','senderName']
      AND NOT p_config ?| ARRAY['endpoint','auth','idempotency','fieldMappings','acceptedStatuses','success','providerIdPath','from']
      AND (SELECT count(*) = 3 FROM jsonb_object_keys(p_config))
      AND p_config ->> 'userName' ~ '^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,99}$'
      AND p_config ->> 'senderName' ~ '^[A-Za-z0-9]{1,11}$';
  ELSIF p_provider = 'resend' THEN
    RETURN p_channel = 'email' AND (SELECT count(*) = 2 FROM jsonb_object_keys(p_config))
      AND p_config ?& ARRAY['providerName','from'] AND char_length(p_config ->> 'from') BETWEEN 1 AND 320;
  ELSIF p_provider <> 'custom' THEN RETURN false; END IF;
  IF NOT p_config ?& ARRAY['providerName','endpoint','method','idempotency','fieldMappings','acceptedStatuses','providerIdPath']
    OR p_config ?| ARRAY['headers','body','bodyTemplate','script']
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_config) k WHERE k <> ALL(ARRAY['providerName','endpoint','method','auth','idempotency','fieldMappings','acceptedStatuses','success','providerIdPath','senderIdentity']))
    OR p_config ->> 'method' <> 'POST' THEN RETURN false; END IF;
  v_endpoint := p_config ->> 'endpoint';
  IF char_length(v_endpoint) NOT BETWEEN 12 AND 2048 OR v_endpoint !~ '^https://[A-Za-z0-9.-]+/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*$'
    OR v_endpoint ~ '(^https://[^/]*@|[?#]|://[^/]+:[0-9]+/)' THEN RETURN false; END IF;
  IF jsonb_typeof(p_config -> 'fieldMappings') <> 'object' OR p_config -> 'fieldMappings' = '{}'::jsonb THEN RETURN false; END IF;
  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_config -> 'fieldMappings') LOOP
    IF v_key <> ALL(ARRAY['recipient','message','subject','html','text','sender']) OR jsonb_typeof(v_value) <> 'string' OR NOT public._messaging_safe_path(v_value #>> '{}') THEN RETURN false; END IF;
  END LOOP;
  v_auth := p_config -> 'auth';
  IF v_auth IS NOT NULL THEN
    IF jsonb_typeof(v_auth) <> 'object' OR v_auth ->> 'placement' NOT IN ('header','body') THEN RETURN false; END IF;
    IF v_auth ->> 'placement' = 'header' AND (NOT public._messaging_safe_header(v_auth ->> 'name') OR (v_auth ? 'path')) THEN RETURN false; END IF;
    IF v_auth ->> 'placement' = 'body' AND (NOT public._messaging_safe_path(v_auth ->> 'path') OR v_auth ?| ARRAY['name','scheme']) THEN RETURN false; END IF;
  END IF;
  v_idem := p_config -> 'idempotency';
  IF jsonb_typeof(v_idem) <> 'object' OR v_idem ->> 'placement' NOT IN ('header','body','none') THEN RETURN false; END IF;
  IF v_idem ->> 'placement' = 'header' AND NOT public._messaging_safe_header(v_idem ->> 'name') THEN RETURN false; END IF;
  IF v_idem ->> 'placement' = 'body' AND NOT public._messaging_safe_path(v_idem ->> 'path') THEN RETURN false; END IF;
  IF jsonb_typeof(p_config -> 'acceptedStatuses') <> 'array' OR jsonb_array_length(p_config -> 'acceptedStatuses') NOT BETWEEN 1 AND 20
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_config -> 'acceptedStatuses') x WHERE jsonb_typeof(x) <> 'number' OR (x #>> '{}')::INTEGER NOT BETWEEN 200 AND 599) THEN RETURN false; END IF;
  IF NOT public._messaging_safe_path(p_config ->> 'providerIdPath') THEN RETURN false; END IF;
  IF p_config ? 'success' AND (jsonb_typeof(p_config -> 'success') <> 'object' OR NOT (p_config -> 'success') ?& ARRAY['path','value'] OR NOT public._messaging_safe_path(p_config #>> '{success,path}') OR jsonb_typeof(p_config #> '{success,value}') NOT IN ('string','number','boolean','null')) THEN RETURN false; END IF;
  RETURN true;
END $fn$;

ALTER TABLE public.messaging_configuration
  ADD COLUMN IF NOT EXISTS provider_config JSONB,
  ADD COLUMN IF NOT EXISTS config_revision UUID;
UPDATE public.messaging_configuration SET
  provider_config = CASE channel
    WHEN 'sms'::public.message_channel THEN jsonb_build_object('providerName','mim','userName','configure-me','senderName',COALESCE(NULLIF(sender_label,''),'MIM'))
    ELSE jsonb_build_object('providerName','resend','from',COALESCE(NULLIF(sender_label,''),'configure@example.invalid')) END,
  config_revision = gen_random_uuid();
-- Legacy rows are safe placeholders only and remain disabled until the service-role configuration API saves reviewed metadata.
UPDATE public.messaging_configuration SET enabled = false;
ALTER TABLE public.messaging_configuration DROP CONSTRAINT IF EXISTS messaging_configuration_provider_config_check;
ALTER TABLE public.messaging_configuration
  ALTER COLUMN provider_config SET NOT NULL,
  ALTER COLUMN config_revision SET NOT NULL,
  ALTER COLUMN config_revision SET DEFAULT gen_random_uuid(),
  DROP COLUMN sender_label;
ALTER TABLE public.messaging_configuration
  ADD CONSTRAINT messaging_configuration_provider_config_check CHECK (public._messaging_provider_config_valid(channel, provider_name, provider_config));
COMMENT ON COLUMN public.messaging_configuration.provider_config IS 'Safe non-secret built-in/custom provider metadata only.';

CREATE TABLE IF NOT EXISTS public.messaging_provider_credentials (
  channel public.message_channel NOT NULL,
  provider_name TEXT NOT NULL,
  config_revision UUID NOT NULL,
  ciphertext TEXT NOT NULL CHECK (ciphertext ~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' AND char_length(ciphertext) BETWEEN 4 AND 90000),
  iv TEXT NOT NULL CHECK (iv ~ '^[A-Za-z0-9+/]{16}==$'),
  auth_tag TEXT NOT NULL CHECK (auth_tag ~ '^[A-Za-z0-9+/]{22}==$'),
  key_id TEXT NOT NULL CHECK (key_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  hint TEXT CHECK (hint IS NULL OR (char_length(hint) BETWEEN 1 AND 16 AND hint !~ E'[\r\n]')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, provider_name, config_revision)
);
ALTER TABLE public.messaging_provider_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.messaging_provider_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messaging_provider_credentials TO service_role;
COMMENT ON TABLE public.messaging_provider_credentials IS 'Versioned AES-256-GCM material. Canonical base64 TEXT; service-role only.';

ALTER TABLE public.message_jobs ADD COLUMN IF NOT EXISTS provider_name TEXT, ADD COLUMN IF NOT EXISTS provider_config_snapshot JSONB, ADD COLUMN IF NOT EXISTS provider_config_revision UUID;
UPDATE public.message_jobs j SET provider_name = c.provider_name, provider_config_snapshot = c.provider_config, provider_config_revision = c.config_revision FROM public.messaging_configuration c WHERE c.channel = j.channel;
DELETE FROM public.message_jobs WHERE provider_name IS NULL;
ALTER TABLE public.message_jobs DROP CONSTRAINT IF EXISTS message_jobs_provider_snapshot_check;
ALTER TABLE public.message_jobs ALTER COLUMN provider_name SET NOT NULL, ALTER COLUMN provider_config_snapshot SET NOT NULL, ALTER COLUMN provider_config_revision SET NOT NULL,
  ADD CONSTRAINT message_jobs_provider_snapshot_check CHECK (public._messaging_provider_config_valid(channel, provider_name, provider_config_snapshot));
COMMENT ON COLUMN public.message_jobs.provider_config_snapshot IS 'Immutable safe provider configuration captured atomically at enqueue; no credentials.';

CREATE OR REPLACE FUNCTION public.enqueue_message_job(p_idempotency_key TEXT, p_channel public.message_channel, p_source_type TEXT, p_source_id UUID, p_content JSONB, p_recipients TEXT[], p_available_at TIMESTAMPTZ DEFAULT now()) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v_job_id UUID; v_recipients TEXT[]; v_config public.messaging_configuration%ROWTYPE;
BEGIN
  SELECT * INTO v_config FROM public.messaging_configuration WHERE channel = p_channel AND enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No enabled messaging provider is configured for channel %', p_channel; END IF;
  SELECT COALESCE(array_agg(recipient ORDER BY recipient), ARRAY[]::TEXT[]) INTO v_recipients FROM (SELECT DISTINCT btrim(value) recipient FROM unnest(COALESCE(p_recipients, ARRAY[]::TEXT[])) value WHERE btrim(value) <> '') normalized;
  IF cardinality(v_recipients) = 0 THEN RAISE EXCEPTION 'At least one recipient is required'; END IF;
  INSERT INTO public.message_jobs(idempotency_key,channel,source_type,source_id,content,recipient_count,available_at,provider_name,provider_config_snapshot,provider_config_revision)
  VALUES(p_idempotency_key,p_channel,p_source_type,p_source_id,p_content,cardinality(v_recipients),COALESCE(p_available_at,now()),v_config.provider_name,v_config.provider_config,v_config.config_revision)
  ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_job_id;
  IF v_job_id IS NULL THEN SELECT id INTO v_job_id FROM public.message_jobs WHERE idempotency_key=p_idempotency_key; RETURN v_job_id; END IF;
  INSERT INTO public.message_deliveries(job_id,recipient,next_attempt_at) SELECT v_job_id,recipient,COALESCE(p_available_at,now()) FROM unnest(v_recipients) recipient;
  RETURN v_job_id;
END $fn$;

-- Service-role RPC: server validates metadata and performs encryption/re-encryption before this atomic write.
CREATE OR REPLACE FUNCTION public.save_messaging_configuration(
 p_channel public.message_channel,p_provider_name TEXT,p_enabled BOOLEAN,p_provider_config JSONB,p_config_revision UUID,p_secret_action TEXT,
 p_ciphertext TEXT,p_iv TEXT,p_auth_tag TEXT,p_key_id TEXT,p_fingerprint TEXT,p_hint TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $fn$
DECLARE v_old_provider TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF p_secret_action NOT IN ('preserve','replace','remove') OR NOT public._messaging_provider_config_valid(p_channel,p_provider_name,p_provider_config) THEN RAISE EXCEPTION 'invalid configuration'; END IF;
  SELECT provider_name INTO v_old_provider FROM public.messaging_configuration WHERE channel=p_channel FOR UPDATE;
  IF p_secret_action='preserve' AND v_old_provider IS NOT NULL AND v_old_provider<>p_provider_name THEN RAISE EXCEPTION 'cannot preserve across providers'; END IF;
  IF p_secret_action='remove' THEN
    IF EXISTS(SELECT 1 FROM public.message_jobs WHERE channel=p_channel AND provider_name=COALESCE(v_old_provider,p_provider_name) AND status IN ('queued','processing','requires_review')) THEN RAISE EXCEPTION 'credential versions referenced by nonterminal jobs'; END IF;
    DELETE FROM public.messaging_provider_credentials WHERE channel=p_channel AND provider_name=COALESCE(v_old_provider,p_provider_name);
  END IF;
  INSERT INTO public.messaging_configuration(channel,provider_name,enabled,provider_config,config_revision)
  VALUES(p_channel,p_provider_name,p_enabled,p_provider_config,p_config_revision)
  ON CONFLICT(channel) DO UPDATE SET provider_name=EXCLUDED.provider_name,enabled=EXCLUDED.enabled,provider_config=EXCLUDED.provider_config,config_revision=EXCLUDED.config_revision,updated_at=now();
  IF p_secret_action IN ('preserve','replace') AND p_ciphertext IS NOT NULL THEN
    INSERT INTO public.messaging_provider_credentials(channel,provider_name,config_revision,ciphertext,iv,auth_tag,key_id,fingerprint,hint)
    VALUES(p_channel,p_provider_name,p_config_revision,p_ciphertext,p_iv,p_auth_tag,p_key_id,p_fingerprint,p_hint);
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.remove_messaging_configuration(p_channel public.message_channel) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  PERFORM 1 FROM public.messaging_configuration WHERE channel=p_channel FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.message_jobs WHERE channel=p_channel AND status IN ('queued','processing','requires_review')) THEN RAISE EXCEPTION 'provider referenced by nonterminal jobs'; END IF;
  DELETE FROM public.messaging_provider_credentials WHERE channel=p_channel;
  DELETE FROM public.messaging_configuration WHERE channel=p_channel;
END $fn$;

-- Replace claims so workers receive the exact provider snapshot revision.
DROP FUNCTION public.claim_message_deliveries(TEXT, public.message_channel, INTEGER, INTEGER);
CREATE FUNCTION public.claim_message_deliveries(p_worker_id TEXT,p_channel public.message_channel,p_limit INTEGER DEFAULT 25,p_lease_seconds INTEGER DEFAULT 120)
RETURNS TABLE(delivery_id UUID,job_id UUID,channel public.message_channel,recipient TEXT,content JSONB,attempt_no SMALLINT,provider_name TEXT,provider_config_snapshot JSONB,provider_config_revision UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
 RETURN QUERY WITH candidates AS (SELECT d.id FROM public.message_deliveries d JOIN public.message_jobs j ON j.id=d.job_id WHERE j.channel=p_channel AND j.status IN ('queued','processing') AND j.available_at<=now() AND ((d.status='pending' AND d.next_attempt_at<=now()) OR (d.status='processing' AND d.locked_at<now()-make_interval(secs=>p_lease_seconds))) ORDER BY d.next_attempt_at,d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT p_limit), claimed AS (UPDATE public.message_deliveries d SET status='processing',attempt_count=d.attempt_count+1,locked_at=now(),locked_by=p_worker_id,updated_at=now() FROM candidates x WHERE d.id=x.id RETURNING d.id,d.job_id,d.recipient,d.attempt_count) SELECT x.id,x.job_id,j.channel,x.recipient,j.content,x.attempt_count,j.provider_name,j.provider_config_snapshot,j.provider_config_revision FROM claimed x JOIN public.message_jobs j ON j.id=x.job_id;
END $fn$;
DROP FUNCTION public.claim_message_job_delivery(UUID,TEXT,INTEGER);
CREATE FUNCTION public.claim_message_job_delivery(p_job_id UUID,p_worker_id TEXT,p_lease_seconds INTEGER DEFAULT 120)
RETURNS TABLE(delivery_id UUID,job_id UUID,channel public.message_channel,recipient TEXT,content JSONB,attempt_no SMALLINT,provider_name TEXT,provider_config_snapshot JSONB,provider_config_revision UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
 RETURN QUERY WITH candidate AS (SELECT d.id FROM public.message_deliveries d JOIN public.message_jobs j ON j.id=d.job_id WHERE d.job_id=p_job_id AND j.status IN ('queued','processing') AND d.status='pending' AND d.next_attempt_at<=now() ORDER BY d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1), claimed AS (UPDATE public.message_deliveries d SET status='processing',attempt_count=d.attempt_count+1,locked_at=now(),locked_by=p_worker_id,updated_at=now() FROM candidate x WHERE d.id=x.id RETURNING d.id,d.job_id,d.recipient,d.attempt_count) SELECT x.id,x.job_id,j.channel,x.recipient,j.content,x.attempt_count,j.provider_name,j.provider_config_snapshot,j.provider_config_revision FROM claimed x JOIN public.message_jobs j ON j.id=x.job_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.begin_non_idempotent_dispatch(p_delivery_id UUID,p_worker_id TEXT) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_mode TEXT; v_status public.message_delivery_status; v_locked_by TEXT;
BEGIN
 SELECT j.provider_config_snapshot #>> '{idempotency,placement}',d.status,d.locked_by INTO v_mode,v_status,v_locked_by FROM public.message_deliveries d JOIN public.message_jobs j ON j.id=d.job_id WHERE d.id=p_delivery_id FOR UPDATE OF d;
 IF v_mode IS DISTINCT FROM 'none' THEN RAISE EXCEPTION 'Provider snapshot is idempotent'; END IF;
 IF v_status<>'processing' OR v_locked_by IS DISTINCT FROM p_worker_id THEN RAISE EXCEPTION 'Message delivery lease is not owned'; END IF;
 UPDATE public.message_deliveries SET status='dispatching',updated_at=now() WHERE id=p_delivery_id;
 UPDATE public.message_jobs SET status='requires_review',unknown_count=unknown_count+1,completed_at=COALESCE(completed_at,now()),updated_at=now()
 WHERE id=(SELECT job_id FROM public.message_deliveries WHERE id=p_delivery_id);
 RETURN true;
END $fn$;

REVOKE ALL ON FUNCTION public._messaging_safe_path(TEXT),public._messaging_safe_header(TEXT),public._messaging_provider_config_valid(public.message_channel,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enqueue_message_job(TEXT,public.message_channel,TEXT,UUID,JSONB,TEXT[],TIMESTAMPTZ),public.save_messaging_configuration(public.message_channel,TEXT,BOOLEAN,JSONB,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),public.remove_messaging_configuration(public.message_channel),public.claim_message_deliveries(TEXT,public.message_channel,INTEGER,INTEGER),public.claim_message_job_delivery(UUID,TEXT,INTEGER),public.begin_non_idempotent_dispatch(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_message_job(TEXT,public.message_channel,TEXT,UUID,JSONB,TEXT[],TIMESTAMPTZ),public.save_messaging_configuration(public.message_channel,TEXT,BOOLEAN,JSONB,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),public.remove_messaging_configuration(public.message_channel),public.claim_message_deliveries(TEXT,public.message_channel,INTEGER,INTEGER),public.claim_message_job_delivery(UUID,TEXT,INTEGER),public.begin_non_idempotent_dispatch(UUID,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public._backup_redact_message_tables(p_tables JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $fn$ SELECT (CASE WHEN jsonb_typeof(p_tables)='object' THEN p_tables ELSE '{}'::jsonb END)-'provider_secrets'-'messaging_provider_credentials'-'message_jobs'-'message_deliveries'-'message_attempts'-'messaging_configuration' $fn$;
COMMIT;
