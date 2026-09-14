-- Restore provider-aware fencing for non-idempotent dispatches.
-- Built-in MIM snapshots predate the generalized idempotency descriptor and are
-- intrinsically non-idempotent. Custom providers must opt in explicitly with
-- idempotency.placement = "none"; all other providers fail closed.

BEGIN;

CREATE OR REPLACE FUNCTION public.begin_non_idempotent_dispatch(
  p_delivery_id UUID,
  p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_delivery public.message_deliveries%ROWTYPE;
  v_provider_name TEXT;
  v_idempotency_placement TEXT;
  v_lease_seconds INTEGER;
BEGIN
  IF p_delivery_id IS NULL THEN RAISE EXCEPTION 'Message delivery is required'; END IF;
  IF btrim(COALESCE(p_worker_id, '')) = '' OR char_length(p_worker_id) > 100 THEN
    RAISE EXCEPTION 'Invalid worker id';
  END IF;

  -- A %ROWTYPE (record) variable cannot appear in a multiple-item INTO list,
  -- so lock the delivery row first, then fetch the scalar job/lease fields.
  SELECT *
    INTO v_delivery
  FROM public.message_deliveries AS d
  WHERE d.id = p_delivery_id
  FOR UPDATE OF d;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message delivery not found'; END IF;

  SELECT j.provider_name, j.provider_config_snapshot #>> '{idempotency,placement}',
         COALESCE(c.lease_seconds, 120)
    INTO v_provider_name, v_idempotency_placement, v_lease_seconds
  FROM public.message_jobs AS j
  LEFT JOIN public.messaging_configuration AS c ON c.channel = j.channel
  WHERE j.id = v_delivery.job_id;

  -- MIM has no idempotency descriptor in its real frozen snapshots, but the
  -- provider itself is non-idempotent. Only explicitly non-idempotent custom
  -- snapshots share this at-most-once path. Resend and custom header/body
  -- idempotency must never enter dispatching/requires_review pre-send state.
  IF v_provider_name = 'mim' THEN
    NULL;
  ELSIF v_provider_name = 'custom' AND v_idempotency_placement = 'none' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Provider snapshot is not non-idempotent';
  END IF;

  IF v_delivery.status <> 'processing'::public.message_delivery_status
     OR v_delivery.locked_by IS DISTINCT FROM p_worker_id
     OR v_delivery.locked_at IS NULL
     OR v_delivery.locked_at < now() - make_interval(secs => v_lease_seconds) THEN
    RAISE EXCEPTION 'Message delivery lease is not owned by this worker';
  END IF;

  -- Once committed, claim RPCs cannot reclaim this row: they only select pending
  -- or expired processing rows. A crash after this point therefore requires review.
  UPDATE public.message_deliveries AS d
  SET status = 'dispatching'::public.message_delivery_status,
      updated_at = now()
  WHERE d.id = v_delivery.id;

  -- Serialize aggregate writers and derive every counter from delivery state.
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

REVOKE ALL ON FUNCTION public.begin_non_idempotent_dispatch(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_non_idempotent_dispatch(UUID, TEXT) TO service_role;

COMMIT;
