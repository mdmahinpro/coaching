-- Make ambiguous provider outcomes explicit and terminal until an operator reviews them.

BEGIN;

ALTER TYPE public.message_delivery_status ADD VALUE IF NOT EXISTS 'unknown';
ALTER TYPE public.message_job_status ADD VALUE IF NOT EXISTS 'requires_review';

ALTER TABLE public.message_jobs
  ADD COLUMN IF NOT EXISTS unknown_count INTEGER NOT NULL DEFAULT 0 CHECK (unknown_count >= 0);

ALTER TABLE public.message_jobs DROP CONSTRAINT IF EXISTS message_jobs_count_check;
ALTER TABLE public.message_jobs
  ADD CONSTRAINT message_jobs_count_check
  CHECK (accepted_count + delivered_count + failed_count + bounced_count + unknown_count <= recipient_count);

COMMENT ON COLUMN public.message_jobs.unknown_count IS
  'Deliveries with an ambiguous provider outcome that require operator review and must not be retried automatically.';

-- PostgreSQL cannot resolve a newly-added enum label until this transaction commits.
-- Defer PL/pgSQL body validation; the function is compiled on first use after commit.
SET LOCAL check_function_bodies = off;

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
  SELECT d.* INTO v_delivery
  FROM public.message_deliveries AS d
  WHERE d.id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message delivery not found'; END IF;

  SELECT COALESCE(c.max_attempts, 5) INTO v_max_attempts
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
    WHEN p_failure_category = 'unknown' THEN 'unknown'::public.message_delivery_status
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
      completed_at = CASE WHEN v_job_status IN ('completed', 'partially_failed', 'failed', 'requires_review') THEN COALESCE(j.completed_at, now()) ELSE NULL END,
      updated_at = now()
  FROM (
    SELECT
      count(*)::INTEGER AS recipient_count,
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

REVOKE ALL ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_message_attempt(UUID, TEXT, public.message_attempt_outcome, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;

COMMIT;
