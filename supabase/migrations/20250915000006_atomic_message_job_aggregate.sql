-- Replace stale read-then-write aggregate refreshes with one serialized database operation.

BEGIN;

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

  -- Every aggregate writer for a job serializes on this row. Counts are read only
  -- after the lock is held, so an older snapshot can never overwrite newer totals.
  SELECT j.* INTO v_job
  FROM public.message_jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message job not found'; END IF;

  SELECT
    count(*)::INTEGER,
    count(*) FILTER (WHERE d.status = 'accepted')::INTEGER,
    count(*) FILTER (WHERE d.status = 'delivered')::INTEGER,
    count(*) FILTER (WHERE d.status = 'failed')::INTEGER,
    count(*) FILTER (WHERE d.status = 'bounced')::INTEGER,
    count(*) FILTER (WHERE d.status IN ('pending', 'processing'))::INTEGER,
    count(*) FILTER (WHERE d.status = 'unknown')::INTEGER
  INTO
    v_recipient_count,
    v_accepted_count,
    v_delivered_count,
    v_failed_count,
    v_bounced_count,
    v_pending_count,
    v_unknown_count
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
  SET status = v_job_status,
      recipient_count = v_recipient_count,
      accepted_count = v_accepted_count,
      delivered_count = v_delivered_count,
      failed_count = v_failed_count,
      bounced_count = v_bounced_count,
      unknown_count = v_unknown_count,
      completed_at = CASE
        WHEN v_job_status IN ('completed', 'partially_failed', 'failed', 'requires_review', 'cancelled')
          THEN COALESCE(j.completed_at, now())
        ELSE NULL
      END,
      updated_at = now()
  WHERE j.id = p_job_id;

  RETURN QUERY SELECT
    p_job_id,
    CASE
      WHEN v_job.source_type = 'api_dry_run' THEN 'dry_run'
      WHEN v_job_status = 'partially_failed' THEN 'partial'
      ELSE v_job_status::TEXT
    END,
    v_recipient_count,
    v_accepted_count + v_delivered_count,
    v_failed_count + v_bounced_count,
    v_pending_count,
    v_unknown_count,
    v_unknown_count > 0,
    v_job.source_type = 'api_dry_run';
END
$fn$;

REVOKE ALL ON FUNCTION public.refresh_message_job_aggregate(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_message_job_aggregate(UUID) TO service_role;

COMMIT;
