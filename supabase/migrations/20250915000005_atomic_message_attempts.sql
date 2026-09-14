-- Make every provider attempt finalization atomic and require a real lease for inline sends.

BEGIN;

ALTER TYPE public.message_attempt_outcome ADD VALUE IF NOT EXISTS 'unknown';

ALTER TABLE public.message_attempts
  DROP CONSTRAINT IF EXISTS message_attempts_check;
ALTER TABLE public.message_attempts
  DROP CONSTRAINT IF EXISTS message_attempts_outcome_fields_check;
ALTER TABLE public.message_attempts
  ADD CONSTRAINT message_attempts_outcome_fields_check
  CHECK ((outcome NOT IN ('accepted', 'delivered')) OR
    (failure_category IS NULL AND failure_code IS NULL AND failure_message IS NULL));

-- PostgreSQL cannot resolve a newly-added enum label until this transaction commits.
SET LOCAL check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.claim_message_job_delivery(
  p_job_id UUID,
  p_worker_id TEXT,
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
  IF p_job_id IS NULL THEN RAISE EXCEPTION 'Message job is required'; END IF;
  IF btrim(COALESCE(p_worker_id, '')) = '' OR char_length(p_worker_id) > 100 THEN
    RAISE EXCEPTION 'Invalid worker id';
  END IF;
  IF p_lease_seconds NOT BETWEEN 15 AND 3600 THEN RAISE EXCEPTION 'Invalid lease duration'; END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT d.id
    FROM public.message_deliveries AS d
    JOIN public.message_jobs AS j ON j.id = d.job_id
    JOIN public.messaging_configuration AS c ON c.channel = j.channel
    WHERE d.job_id = p_job_id
      AND j.status IN ('queued', 'processing')
      AND j.available_at <= now()
      AND c.enabled
      AND d.status = 'pending'
      AND d.next_attempt_at <= now()
      AND d.attempt_count < c.max_attempts
    ORDER BY d.created_at
    FOR UPDATE OF d SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE public.message_deliveries AS d
    SET status = 'processing',
        attempt_count = d.attempt_count + 1,
        locked_at = now(),
        locked_by = p_worker_id,
        updated_at = now()
    FROM candidate AS x
    WHERE d.id = x.id
    RETURNING d.id, d.job_id, d.recipient, d.attempt_count
  ), touched_job AS (
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
  IF v_delivery.status <> 'processing' OR v_delivery.locked_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Message delivery lease is not owned by this worker';
  END IF;

  -- Serialize aggregate refreshes for deliveries in the same job so the last
  -- committer always observes every previously committed terminal transition.
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
    v_failure_code := CASE
      WHEN p_failure_code ~ '^[A-Za-z0-9_.:-]{1,100}$' THEN p_failure_code
      ELSE 'unknown' END;
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
    WHEN p_retryable AND v_delivery.attempt_count < v_max_attempts THEN 'pending'::public.message_delivery_status
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
    WHEN count(*) FILTER (WHERE status = 'unknown') > 0 THEN 'requires_review'::public.message_job_status
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
      count(*) FILTER (WHERE status = 'unknown')::INTEGER AS unknown_count
    FROM public.message_deliveries
    WHERE job_id = v_delivery.job_id
  ) AS a
  WHERE j.id = v_delivery.job_id;

  RETURN v_status;
END
$fn$;

REVOKE ALL ON FUNCTION public.claim_message_job_delivery(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_message_job_delivery(UUID, TEXT, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;

COMMIT;
