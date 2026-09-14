-- Durable server-only message outbox, delivery state, and admission notification.
-- No provider credentials or raw provider responses belong in these tables.

BEGIN;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'message_channel') THEN
    CREATE TYPE public.message_channel AS ENUM ('sms', 'email');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'message_job_status') THEN
    CREATE TYPE public.message_job_status AS ENUM ('queued', 'processing', 'completed', 'partially_failed', 'failed', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'message_delivery_status') THEN
    CREATE TYPE public.message_delivery_status AS ENUM ('pending', 'processing', 'accepted', 'delivered', 'failed', 'bounced');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'message_attempt_outcome') THEN
    CREATE TYPE public.message_attempt_outcome AS ENUM ('accepted', 'delivered', 'failed', 'bounced');
  END IF;
END
$do$;

CREATE TABLE IF NOT EXISTS public.messaging_configuration (
  channel public.message_channel PRIMARY KEY,
  provider_name TEXT NOT NULL CHECK (provider_name ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  enabled BOOLEAN NOT NULL DEFAULT false,
  sender_label TEXT CHECK (sender_label IS NULL OR char_length(sender_label) BETWEEN 1 AND 100),
  max_attempts SMALLINT NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  base_retry_seconds INTEGER NOT NULL DEFAULT 60 CHECK (base_retry_seconds BETWEEN 5 AND 86400),
  lease_seconds INTEGER NOT NULL DEFAULT 120 CHECK (lease_seconds BETWEEN 15 AND 3600),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (lower(provider_name) !~ '(secret|token|password|api.?key|credential)'),
  CHECK (sender_label IS NULL OR lower(sender_label) !~ '(secret|token|password|api.?key|credential)')
);

COMMENT ON TABLE public.messaging_configuration IS
  'Non-secret operational messaging settings only. Provider credentials remain server-side and must never be stored here.';

CREATE TABLE IF NOT EXISTS public.message_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  channel public.message_channel NOT NULL,
  status public.message_job_status NOT NULL DEFAULT 'queued',
  source_type TEXT NOT NULL CHECK (source_type ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  source_id UUID,
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object' AND content <> '{}'::jsonb),
  recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  delivered_count INTEGER NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  bounced_count INTEGER NOT NULL DEFAULT 0 CHECK (bounced_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (accepted_count + delivered_count + failed_count + bounced_count <= recipient_count),
  CHECK (content ? 'body'),
  CHECK (NOT (content ?| ARRAY['password', 'reference_no', 'default_password', 'api_key', 'secret', 'token', 'provider_response']))
);

COMMENT ON COLUMN public.message_jobs.content IS
  'Rendered message fields only; passwords, admission references, provider responses, and credentials are forbidden.';

CREATE TABLE IF NOT EXISTS public.message_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.message_jobs(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL CHECK (char_length(recipient) BETWEEN 3 AND 320),
  status public.message_delivery_status NOT NULL DEFAULT 'pending',
  provider_message_id TEXT CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 255),
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT CHECK (locked_by IS NULL OR char_length(locked_by) BETWEEN 1 AND 100),
  accepted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, recipient)
);

CREATE TABLE IF NOT EXISTS public.message_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_id UUID NOT NULL REFERENCES public.message_deliveries(id) ON DELETE CASCADE,
  attempt_no SMALLINT NOT NULL CHECK (attempt_no BETWEEN 1 AND 20),
  outcome public.message_attempt_outcome NOT NULL,
  provider_message_id TEXT CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 255),
  failure_category TEXT CHECK (failure_category IS NULL OR failure_category IN ('configuration', 'authentication', 'rate_limit', 'provider', 'network', 'invalid_recipient', 'unknown')),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  failure_message TEXT CHECK (
    failure_message IS NULL OR
    (char_length(failure_message) <= 500 AND lower(failure_message) !~ '(authorization|bearer|api.?key|password|secret|token|credential|provider.response)')
  ),
  retryable BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, attempt_no),
  CHECK ((outcome IN ('failed', 'bounced')) OR (failure_category IS NULL AND failure_code IS NULL AND failure_message IS NULL))
);

COMMENT ON TABLE public.message_attempts IS
  'Sanitized attempt audit only: never store request bodies, recipient values, credentials, headers, or raw provider responses.';

CREATE INDEX IF NOT EXISTS message_jobs_ready_idx ON public.message_jobs (available_at, created_at)
  WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS message_jobs_source_idx ON public.message_jobs (source_type, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_jobs_created_at_idx ON public.message_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS message_deliveries_claim_idx ON public.message_deliveries (next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS message_deliveries_job_status_idx ON public.message_deliveries (job_id, status);
CREATE INDEX IF NOT EXISTS message_deliveries_created_at_idx ON public.message_deliveries (created_at DESC);
CREATE INDEX IF NOT EXISTS message_attempts_delivery_idx ON public.message_attempts (delivery_id, attempt_no DESC);
CREATE INDEX IF NOT EXISTS message_attempts_created_at_idx ON public.message_attempts (created_at DESC);

ALTER TABLE public.messaging_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY messaging_configuration_admin_read ON public.messaging_configuration
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY message_jobs_admin_read ON public.message_jobs
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY message_deliveries_admin_read ON public.message_deliveries
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY message_attempts_admin_read ON public.message_attempts
  FOR SELECT TO authenticated USING (public.is_admin());

REVOKE ALL ON TABLE public.messaging_configuration, public.message_jobs, public.message_deliveries, public.message_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.messaging_configuration, public.message_jobs, public.message_deliveries, public.message_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messaging_configuration, public.message_jobs, public.message_deliveries, public.message_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.message_attempts_id_seq TO service_role;

-- Provider credentials are server-only. Remove the legacy browser-admin policy and
-- every direct browser grant; service_role remains the sole SQL API role allowed.
ALTER TABLE public.provider_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_secrets_admin_all ON public.provider_secrets;
REVOKE ALL ON TABLE public.provider_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.provider_secrets TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_message_job(
  p_idempotency_key TEXT,
  p_channel public.message_channel,
  p_source_type TEXT,
  p_source_id UUID,
  p_content JSONB,
  p_recipients TEXT[],
  p_available_at TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_job_id UUID;
  v_recipients TEXT[];
BEGIN
  SELECT COALESCE(array_agg(recipient ORDER BY recipient), ARRAY[]::TEXT[])
    INTO v_recipients
  FROM (
    SELECT DISTINCT btrim(value) AS recipient
    FROM unnest(COALESCE(p_recipients, ARRAY[]::TEXT[])) AS value
    WHERE btrim(value) <> ''
  ) AS normalized;

  IF cardinality(v_recipients) = 0 THEN
    RAISE EXCEPTION 'At least one recipient is required';
  END IF;

  INSERT INTO public.message_jobs (
    idempotency_key, channel, source_type, source_id, content, recipient_count, available_at
  ) VALUES (
    p_idempotency_key, p_channel, p_source_type, p_source_id, p_content,
    cardinality(v_recipients), COALESCE(p_available_at, now())
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_job_id;

  IF v_job_id IS NULL THEN
    SELECT id INTO v_job_id
    FROM public.message_jobs
    WHERE idempotency_key = p_idempotency_key;
    RETURN v_job_id;
  END IF;

  INSERT INTO public.message_deliveries (job_id, recipient, next_attempt_at)
  SELECT v_job_id, recipient, COALESCE(p_available_at, now())
  FROM unnest(v_recipients) AS recipient;

  RETURN v_job_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.claim_message_deliveries(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  delivery_id UUID,
  job_id UUID,
  channel public.message_channel,
  recipient TEXT,
  content JSONB,
  attempt_no SMALLINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
BEGIN
  IF btrim(COALESCE(p_worker_id, '')) = '' OR char_length(p_worker_id) > 100 THEN
    RAISE EXCEPTION 'Invalid worker id';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 15 AND 3600 THEN
    RAISE EXCEPTION 'Invalid claim limits';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
    FROM public.message_deliveries AS d
    JOIN public.message_jobs AS j ON j.id = d.job_id
    LEFT JOIN public.messaging_configuration AS c ON c.channel = j.channel
    WHERE j.status IN ('queued', 'processing')
      AND j.available_at <= now()
      AND COALESCE(c.enabled, false)
      AND d.attempt_count < COALESCE(c.max_attempts, 5)
      AND (
        (d.status = 'pending' AND d.next_attempt_at <= now()) OR
        (d.status = 'processing' AND d.locked_at < now() - make_interval(secs => p_lease_seconds))
      )
    ORDER BY d.next_attempt_at, d.created_at
    FOR UPDATE OF d SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.message_deliveries AS d
    SET status = 'processing',
        attempt_count = d.attempt_count + 1,
        locked_at = now(),
        locked_by = p_worker_id,
        updated_at = now()
    FROM candidates AS x
    WHERE d.id = x.id
    RETURNING d.id, d.job_id, d.recipient, d.attempt_count
  ), touched_jobs AS (
    UPDATE public.message_jobs AS j
    SET status = 'processing', started_at = COALESCE(j.started_at, now()), updated_at = now()
    WHERE j.id IN (SELECT c.job_id FROM claimed AS c)
    RETURNING j.id
  )
  SELECT c.id, c.job_id, j.channel, c.recipient, j.content, c.attempt_count
  FROM claimed AS c
  JOIN public.message_jobs AS j ON j.id = c.job_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.record_message_attempt(
  p_delivery_id UUID,
  p_worker_id TEXT,
  p_outcome public.message_attempt_outcome,
  p_provider_message_id TEXT DEFAULT NULL,
  p_failure_category TEXT DEFAULT NULL,
  p_failure_code TEXT DEFAULT NULL,
  p_failure_message TEXT DEFAULT NULL,
  p_retryable BOOLEAN DEFAULT false,
  p_next_attempt_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.message_delivery_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_delivery public.message_deliveries%ROWTYPE;
  v_max_attempts SMALLINT;
  v_status public.message_delivery_status;
  v_job_status public.message_job_status;
BEGIN
  SELECT d.*
    INTO v_delivery
  FROM public.message_deliveries AS d
  WHERE d.id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message delivery not found'; END IF;

  SELECT COALESCE(c.max_attempts, 5)
    INTO v_max_attempts
  FROM public.message_jobs AS j
  LEFT JOIN public.messaging_configuration AS c ON c.channel = j.channel
  WHERE j.id = v_delivery.job_id;
  IF v_delivery.status <> 'processing' OR v_delivery.locked_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Message delivery lease is not owned by this worker';
  END IF;

  INSERT INTO public.message_attempts (
    delivery_id, attempt_no, outcome, provider_message_id,
    failure_category, failure_code, failure_message, retryable
  ) VALUES (
    v_delivery.id, v_delivery.attempt_count, p_outcome, p_provider_message_id,
    p_failure_category, p_failure_code, p_failure_message, p_retryable
  );

  v_status := CASE
    WHEN p_outcome = 'accepted' THEN 'accepted'::public.message_delivery_status
    WHEN p_outcome = 'delivered' THEN 'delivered'::public.message_delivery_status
    WHEN p_outcome = 'bounced' THEN 'bounced'::public.message_delivery_status
    WHEN p_retryable AND v_delivery.attempt_count < v_max_attempts THEN 'pending'::public.message_delivery_status
    ELSE 'failed'::public.message_delivery_status
  END;

  UPDATE public.message_deliveries
  SET status = v_status,
      provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
      next_attempt_at = CASE WHEN v_status = 'pending' THEN COALESCE(p_next_attempt_at, now() + interval '1 minute') ELSE next_attempt_at END,
      locked_at = NULL,
      locked_by = NULL,
      accepted_at = CASE WHEN v_status = 'accepted' THEN now() ELSE accepted_at END,
      delivered_at = CASE WHEN v_status = 'delivered' THEN now() ELSE delivered_at END,
      failed_at = CASE WHEN v_status = 'failed' THEN now() ELSE failed_at END,
      bounced_at = CASE WHEN v_status = 'bounced' THEN now() ELSE bounced_at END,
      updated_at = now()
  WHERE id = v_delivery.id;

  SELECT CASE
    WHEN count(*) FILTER (WHERE status IN ('pending', 'processing')) > 0 THEN 'processing'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('failed', 'bounced')) = count(*) THEN 'failed'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('failed', 'bounced')) > 0 THEN 'partially_failed'::public.message_job_status
    ELSE 'completed'::public.message_job_status
  END
  INTO v_job_status
  FROM public.message_deliveries
  WHERE job_id = v_delivery.job_id;

  UPDATE public.message_jobs AS j
  SET status = v_job_status,
      recipient_count = a.recipient_count,
      accepted_count = a.accepted_count,
      delivered_count = a.delivered_count,
      failed_count = a.failed_count,
      bounced_count = a.bounced_count,
      completed_at = CASE WHEN v_job_status IN ('completed', 'partially_failed', 'failed') THEN COALESCE(j.completed_at, now()) ELSE NULL END,
      updated_at = now()
  FROM (
    SELECT
      count(*)::INTEGER AS recipient_count,
      count(*) FILTER (WHERE status = 'accepted')::INTEGER AS accepted_count,
      count(*) FILTER (WHERE status = 'delivered')::INTEGER AS delivered_count,
      count(*) FILTER (WHERE status = 'failed')::INTEGER AS failed_count,
      count(*) FILTER (WHERE status = 'bounced')::INTEGER AS bounced_count
    FROM public.message_deliveries
    WHERE job_id = v_delivery.job_id
  ) AS a
  WHERE j.id = v_delivery.job_id;

  RETURN v_status;
END
$fn$;

REVOKE ALL ON FUNCTION public.enqueue_message_job(TEXT, public.message_channel, TEXT, UUID, JSONB, TEXT[], TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_message_deliveries(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_message_job(TEXT, public.message_channel, TEXT, UUID, JSONB, TEXT[], TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_message_deliveries(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;

-- Preserve the existing RPC signature/return contract while making student creation,
-- approval, and credential notification one transaction. The notification never
-- repeats the admission reference or password.
CREATE OR REPLACE FUNCTION public.admin_approve_admission(
  p_admission_id UUID,
  p_student_id TEXT,
  p_password TEXT
)
RETURNS TABLE (student_id TEXT, student_uuid UUID, status TEXT, created BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  a public.admission_requests%ROWTYPE;
  s public.students%ROWTYPE;
  v_channel public.message_channel;
  v_recipient TEXT;
  v_job_id UUID;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin authorization required'; END IF;

  SELECT * INTO a FROM public.admission_requests WHERE id = p_admission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Admission not found'; END IF;

  IF a.status <> 'pending' THEN
    SELECT * INTO s FROM public.students WHERE phone = a.phone ORDER BY created_at DESC LIMIT 1;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Admission is already processed but student is missing'; END IF;
    RETURN QUERY SELECT s.student_id, s.id, a.status, false;
    RETURN;
  END IF;

  INSERT INTO public.students (
    name, phone, student_id, password, email, guardian_name, guardian_phone,
    address, class_level, gender, batch_id, status, is_approved, photo_url
  ) VALUES (
    a.name, a.phone, p_student_id, crypt(p_password, gen_salt('bf')), a.email,
    a.guardian_name, a.guardian_phone, a.address, a.class_level, a.gender,
    a.batch_id, 'active', true, NULL
  )
  RETURNING * INTO s;

  IF a.batch_id IS NOT NULL THEN PERFORM public.increment_enrolled(a.batch_id); END IF;
  UPDATE public.admission_requests SET status = 'approved' WHERE id = a.id;

  IF NULLIF(btrim(a.phone), '') IS NOT NULL THEN
    v_channel := 'sms';
    v_recipient := btrim(a.phone);
  ELSIF NULLIF(btrim(a.email), '') IS NOT NULL THEN
    v_channel := 'email';
    v_recipient := btrim(a.email);
  ELSE
    RAISE EXCEPTION 'Admission has no notification recipient';
  END IF;

  v_job_id := public.enqueue_message_job(
    'admission-approved:' || a.id::TEXT,
    v_channel,
    'admission_approval',
    a.id,
    jsonb_build_object(
      'subject', 'Admission approved',
      'body', format('Your admission is approved. Student ID: %s. Use the admission reference you already saved as your initial password. For security, the reference is not repeated in this message.', s.student_id)
    ),
    ARRAY[v_recipient],
    now()
  );

  RETURN QUERY SELECT s.student_id, s.id, 'approved'::TEXT, true;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Student already exists or generated student ID is already used';
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_approve_admission(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_admission(UUID, TEXT, TEXT) TO authenticated;

-- Defense in depth for historical/portable backup payloads. This helper can be
-- installed before or after the optional backup subsystem.
CREATE OR REPLACE FUNCTION public._backup_redact_message_tables(p_tables JSONB)
RETURNS JSONB
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $fn$
  SELECT (CASE WHEN jsonb_typeof(p_tables) = 'object' THEN p_tables ELSE '{}'::jsonb END)
    - 'provider_secrets'
    - 'message_jobs'
    - 'message_deliveries'
    - 'message_attempts'
    - 'messaging_configuration'
$fn$;

REVOKE ALL ON FUNCTION public._backup_redact_message_tables(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._backup_redact_message_tables(JSONB) TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.backups') IS NOT NULL THEN
    UPDATE public.backups
    SET tables = CASE
      WHEN jsonb_typeof(tables -> 'tables') = 'object' THEN
        tables || jsonb_build_object('tables', public._backup_redact_message_tables(tables -> 'tables'))
      ELSE public._backup_redact_message_tables(tables)
    END
    WHERE tables ?| ARRAY['provider_secrets', 'message_jobs', 'message_deliveries', 'message_attempts', 'messaging_configuration']
       OR (jsonb_typeof(tables -> 'tables') = 'object' AND (tables -> 'tables') ?| ARRAY['provider_secrets', 'message_jobs', 'message_deliveries', 'message_attempts', 'messaging_configuration']);
  END IF;
END
$do$;

COMMIT;
