-- Fence non-idempotent MIM provider I/O behind a durable, non-reclaimable state.

BEGIN;

ALTER TYPE public.message_delivery_status ADD VALUE IF NOT EXISTS 'dispatching';

-- PostgreSQL cannot resolve a newly-added enum label until this transaction commits.
SET LOCAL check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.begin_non_idempotent_dispatch(
  p_delivery_id UUID,
  p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_delivery public.message_deliveries%ROWTYPE;
  v_channel public.message_channel;
  v_lease_seconds INTEGER;
BEGIN
  IF p_delivery_id IS NULL THEN RAISE EXCEPTION 'Message delivery is required'; END IF;
  IF btrim(COALESCE(p_worker_id, '')) = '' OR char_length(p_worker_id) > 100 THEN
    RAISE EXCEPTION 'Invalid worker id';
  END IF;

  SELECT d, j.channel, COALESCE(c.lease_seconds, 120)
    INTO v_delivery, v_channel, v_lease_seconds
  FROM public.message_deliveries AS d
  JOIN public.message_jobs AS j ON j.id = d.job_id
  LEFT JOIN public.messaging_configuration AS c ON c.channel = j.channel
  WHERE d.id = p_delivery_id
  FOR UPDATE OF d;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message delivery not found'; END IF;
  IF v_channel <> 'sms'::public.message_channel THEN
    RAISE EXCEPTION 'Non-idempotent dispatch is only valid for SMS';
  END IF;
  IF v_delivery.status <> 'processing'::public.message_delivery_status
     OR v_delivery.locked_by IS DISTINCT FROM p_worker_id
     OR v_delivery.locked_at IS NULL
     OR v_delivery.locked_at < now() - make_interval(secs => v_lease_seconds) THEN
    RAISE EXCEPTION 'Message delivery lease is not owned by this worker';
  END IF;

  -- Once this commits, claim RPCs cannot reclaim the row: they only select pending
  -- or expired processing rows. A worker crash after this point requires review.
  UPDATE public.message_deliveries AS d
  SET status = 'dispatching'::public.message_delivery_status,
      updated_at = now()
  WHERE d.id = v_delivery.id;

  -- Serialize every aggregate writer for the job and expose the unknown outcome
  -- before any non-idempotent provider request can begin.
  PERFORM 1 FROM public.message_jobs AS j WHERE j.id = v_delivery.job_id FOR UPDATE;
  UPDATE public.message_jobs AS j
  SET status = 'requires_review'::public.message_job_status,
      recipient_count = a.recipient_count,
      accepted_count = a.accepted_count,
      delivered_count = a.delivered_count,
      failed_count = a.failed_count,
      bounced_count = a.bounced_count,
      unknown_count = a.unknown_count,
      completed_at = COALESCE(j.completed_at, now()),
      updated_at = now()
  FROM (
    SELECT count(*)::INTEGER AS recipient_count,
      count(*) FILTER (WHERE status = 'accepted')::INTEGER AS accepted_count,
      count(*) FILTER (WHERE status = 'delivered')::INTEGER AS delivered_count,
      count(*) FILTER (WHERE status = 'failed')::INTEGER AS failed_count,
      count(*) FILTER (WHERE status = 'bounced')::INTEGER AS bounced_count,
      count(*) FILTER (WHERE status IN ('unknown', 'dispatching'))::INTEGER AS unknown_count
    FROM public.message_deliveries
    WHERE job_id = v_delivery.job_id
  ) AS a
  WHERE j.id = v_delivery.job_id;

  RETURN true;
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
  v_provider_message_id TEXT;
  v_failure_category TEXT;
  v_failure_code TEXT;
  v_failure_message TEXT;
BEGIN
  SELECT d.* INTO v_delivery
  FROM public.message_deliveries AS d
  WHERE d.id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message delivery not found'; END IF;
  IF v_delivery.status NOT IN ('processing'::public.message_delivery_status, 'dispatching'::public.message_delivery_status)
     OR v_delivery.locked_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Message delivery lease is not owned by this worker';
  END IF;

  PERFORM 1 FROM public.message_jobs AS j WHERE j.id = v_delivery.job_id FOR UPDATE;

  SELECT COALESCE(c.max_attempts, 5) INTO v_max_attempts
  FROM public.message_jobs AS j
  LEFT JOIN public.messaging_configuration AS c ON c.channel = j.channel
  WHERE j.id = v_delivery.job_id;

  v_provider_message_id := NULLIF(left(btrim(COALESCE(p_provider_message_id, '')), 255), '');
  IF p_outcome IN ('accepted', 'delivered') THEN
    v_failure_category := NULL;
    v_failure_code := NULL;
    v_failure_message := NULL;
  ELSE
    v_failure_category := CASE WHEN p_failure_category IN
      ('configuration', 'authentication', 'rate_limit', 'provider', 'network', 'invalid_recipient', 'unknown')
      THEN p_failure_category ELSE 'unknown' END;
    v_failure_code := CASE WHEN p_failure_code ~ '^[A-Za-z0-9_.:-]{1,100}$' THEN p_failure_code ELSE 'unknown' END;
    v_failure_message := CASE
      WHEN p_failure_message IS NULL THEN NULL
      WHEN lower(p_failure_message) ~ '(authorization|bearer|api.?key|password|secret|token|credential|provider.response)'
        THEN 'Provider attempt failed (details redacted)'
      ELSE left(p_failure_message, 500) END;
  END IF;

  INSERT INTO public.message_attempts (
    delivery_id, attempt_no, outcome, provider_message_id,
    failure_category, failure_code, failure_message, retryable
  ) VALUES (
    v_delivery.id, v_delivery.attempt_count, p_outcome, v_provider_message_id,
    v_failure_category, v_failure_code, v_failure_message, p_retryable
  );

  v_status := CASE
    WHEN p_outcome = 'accepted' THEN 'accepted'::public.message_delivery_status
    WHEN p_outcome = 'delivered' THEN 'delivered'::public.message_delivery_status
    WHEN p_outcome = 'bounced' THEN 'bounced'::public.message_delivery_status
    WHEN p_outcome = 'unknown' THEN 'unknown'::public.message_delivery_status
    WHEN p_retryable AND v_delivery.status <> 'dispatching'::public.message_delivery_status
      AND v_delivery.attempt_count < v_max_attempts THEN 'pending'::public.message_delivery_status
    ELSE 'failed'::public.message_delivery_status
  END;

  UPDATE public.message_deliveries
  SET status = v_status,
      provider_message_id = COALESCE(v_provider_message_id, provider_message_id),
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
    WHEN count(*) FILTER (WHERE status IN ('unknown', 'dispatching')) > 0 THEN 'requires_review'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('pending', 'processing')) > 0 THEN 'processing'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('failed', 'bounced')) = count(*) THEN 'failed'::public.message_job_status
    WHEN count(*) FILTER (WHERE status IN ('failed', 'bounced')) > 0 THEN 'partially_failed'::public.message_job_status
    ELSE 'completed'::public.message_job_status
  END INTO v_job_status
  FROM public.message_deliveries
  WHERE job_id = v_delivery.job_id;

  UPDATE public.message_jobs AS j
  SET status = v_job_status,
      recipient_count = a.recipient_count,
      accepted_count = a.accepted_count,
      delivered_count = a.delivered_count,
      failed_count = a.failed_count,
      bounced_count = a.bounced_count,
      unknown_count = a.unknown_count,
      completed_at = CASE WHEN v_job_status IN ('completed', 'partially_failed', 'failed', 'requires_review')
        THEN COALESCE(j.completed_at, now()) ELSE NULL END,
      updated_at = now()
  FROM (
    SELECT count(*)::INTEGER AS recipient_count,
      count(*) FILTER (WHERE status = 'accepted')::INTEGER AS accepted_count,
      count(*) FILTER (WHERE status = 'delivered')::INTEGER AS delivered_count,
      count(*) FILTER (WHERE status = 'failed')::INTEGER AS failed_count,
      count(*) FILTER (WHERE status = 'bounced')::INTEGER AS bounced_count,
      count(*) FILTER (WHERE status IN ('unknown', 'dispatching'))::INTEGER AS unknown_count
    FROM public.message_deliveries
    WHERE job_id = v_delivery.job_id
  ) AS a
  WHERE j.id = v_delivery.job_id;

  RETURN v_status;
END
$fn$;

CREATE OR REPLACE FUNCTION public.refresh_message_job_aggregate(
  p_job_id UUID
)
RETURNS TABLE (
  job_id UUID,
  status TEXT,
  total INTEGER,
  accepted INTEGER,
  failed INTEGER,
  pending INTEGER,
  unknown INTEGER,
  requires_review BOOLEAN,
  dry_run BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_job public.message_jobs%ROWTYPE;
  v_recipient_count INTEGER;
  v_accepted_count INTEGER;
  v_delivered_count INTEGER;
  v_failed_count INTEGER;
  v_bounced_count INTEGER;
  v_pending_count INTEGER;
  v_unknown_count INTEGER;
  v_job_status public.message_job_status;
BEGIN
  IF p_job_id IS NULL THEN RAISE EXCEPTION 'Message job is required'; END IF;
  SELECT j.* INTO v_job FROM public.message_jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message job not found'; END IF;

  SELECT count(*)::INTEGER,
    count(*) FILTER (WHERE d.status = 'accepted')::INTEGER,
    count(*) FILTER (WHERE d.status = 'delivered')::INTEGER,
    count(*) FILTER (WHERE d.status = 'failed')::INTEGER,
    count(*) FILTER (WHERE d.status = 'bounced')::INTEGER,
    count(*) FILTER (WHERE d.status IN ('pending', 'processing'))::INTEGER,
    count(*) FILTER (WHERE d.status IN ('unknown', 'dispatching'))::INTEGER
  INTO v_recipient_count, v_accepted_count, v_delivered_count, v_failed_count,
    v_bounced_count, v_pending_count, v_unknown_count
  FROM public.message_deliveries AS d
  WHERE d.job_id = p_job_id;

  v_job_status := CASE
    WHEN v_job.source_type = 'api_dry_run' THEN 'cancelled'::public.message_job_status
    WHEN v_unknown_count > 0 THEN 'requires_review'::public.message_job_status
    WHEN v_pending_count > 0 THEN 'processing'::public.message_job_status
    WHEN v_recipient_count > 0 AND v_failed_count + v_bounced_count = v_recipient_count THEN 'failed'::public.message_job_status
    WHEN v_failed_count + v_bounced_count > 0 THEN 'partially_failed'::public.message_job_status
    ELSE 'completed'::public.message_job_status
  END;

  UPDATE public.message_jobs AS j
  SET status = v_job_status, recipient_count = v_recipient_count,
      accepted_count = v_accepted_count, delivered_count = v_delivered_count,
      failed_count = v_failed_count, bounced_count = v_bounced_count,
      unknown_count = v_unknown_count,
      completed_at = CASE WHEN v_job_status IN ('completed', 'partially_failed', 'failed', 'requires_review', 'cancelled')
        THEN COALESCE(j.completed_at, now()) ELSE NULL END,
      updated_at = now()
  WHERE j.id = p_job_id;

  RETURN QUERY SELECT p_job_id,
    CASE WHEN v_job.source_type = 'api_dry_run' THEN 'dry_run'
      WHEN v_job_status = 'partially_failed' THEN 'partial' ELSE v_job_status::TEXT END,
    v_recipient_count, v_accepted_count + v_delivered_count,
    v_failed_count + v_bounced_count, v_pending_count, v_unknown_count,
    v_unknown_count > 0, v_job.source_type = 'api_dry_run';
END
$fn$;

REVOKE ALL ON FUNCTION public.begin_non_idempotent_dispatch(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_non_idempotent_dispatch(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_message_job_aggregate(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_message_job_aggregate(UUID) TO service_role;

COMMIT;
