-- Seed non-secret messaging defaults and require channel-scoped delivery claims.

BEGIN;

-- Tolerate both schema states. On a fresh install provider_config does not
-- exist yet (added later by 20250915000008). On a re-apply that column is
-- NOT NULL, so a fresh row must be seeded with a non-null provider_config
-- (and config_revision), and an existing row keeps its reviewed values.
DO $seed$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messaging_configuration'
      AND column_name = 'provider_config'
  ) THEN
    INSERT INTO public.messaging_configuration (channel, provider_name, enabled, provider_config, config_revision)
    VALUES
      ('sms'::public.message_channel, 'mim', true,
       jsonb_build_object('providerName','mim','userName','configure-me','senderName','MIM'), gen_random_uuid()),
      ('email'::public.message_channel, 'resend', true,
       jsonb_build_object('providerName','resend','from','configure@example.invalid'), gen_random_uuid())
    ON CONFLICT (channel) DO UPDATE
    SET provider_name = EXCLUDED.provider_name,
        enabled = EXCLUDED.enabled,
        provider_config = COALESCE(messaging_configuration.provider_config, EXCLUDED.provider_config),
        config_revision = COALESCE(messaging_configuration.config_revision, EXCLUDED.config_revision),
        updated_at = now();
  ELSE
    INSERT INTO public.messaging_configuration (channel, provider_name, enabled)
    VALUES
      ('sms'::public.message_channel, 'mim', true),
      ('email'::public.message_channel, 'resend', true)
    ON CONFLICT (channel) DO UPDATE
    SET provider_name = EXCLUDED.provider_name,
        enabled = EXCLUDED.enabled,
        updated_at = now();
  END IF;
END $seed$;

REVOKE ALL ON FUNCTION public.claim_message_deliveries(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.claim_message_deliveries(TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.claim_message_deliveries(
  p_worker_id TEXT,
  p_channel public.message_channel,
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
  IF p_channel IS NULL THEN
    RAISE EXCEPTION 'Message channel is required';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 15 AND 3600 THEN
    RAISE EXCEPTION 'Invalid claim limits';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT d.id
    FROM public.message_deliveries AS d
    JOIN public.message_jobs AS j ON j.id = d.job_id
    JOIN public.messaging_configuration AS c ON c.channel = j.channel
    WHERE j.channel = p_channel
      AND j.status IN ('queued', 'processing')
      AND j.available_at <= now()
      AND c.enabled
      AND d.attempt_count < c.max_attempts
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

REVOKE ALL ON FUNCTION public.claim_message_deliveries(TEXT, public.message_channel, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_message_deliveries(TEXT, public.message_channel, INTEGER, INTEGER) TO service_role;

COMMIT;
