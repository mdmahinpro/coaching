-- Public admission/contact submissions: service-role-only atomic insert + durable rate limits.
CREATE TABLE IF NOT EXISTS public.public_form_rate_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  form_type TEXT NOT NULL CHECK (form_type IN ('admission', 'contact')),
  ip_hash BYTEA NOT NULL,
  phone_hash BYTEA,
  email_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS public_form_rate_events_ip_idx
  ON public.public_form_rate_events (form_type, ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS public_form_rate_events_phone_idx
  ON public.public_form_rate_events (form_type, phone_hash, created_at DESC)
  WHERE phone_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS public_form_rate_events_email_idx
  ON public.public_form_rate_events (form_type, email_hash, created_at DESC);

ALTER TABLE public.public_form_rate_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.public_form_rate_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.public_form_rate_events_id_seq FROM PUBLIC, anon, authenticated;

-- Direct anonymous inserts are replaced by the serverless endpoints and this RPC.
DROP POLICY IF EXISTS "anon_insert_admission_requests" ON public.admission_requests;
DROP POLICY IF EXISTS "anon_insert_contact_messages" ON public.contact_messages;
REVOKE INSERT ON public.admission_requests FROM anon;
REVOKE INSERT ON public.contact_messages FROM anon;

CREATE UNIQUE INDEX IF NOT EXISTS admission_requests_reference_no_unique
  ON public.admission_requests (reference_no) WHERE reference_no IS NOT NULL;

-- Database-side limits remain authoritative even if a handler validation regression occurs.
ALTER TABLE public.admission_requests DROP CONSTRAINT IF EXISTS admission_requests_public_lengths;
ALTER TABLE public.admission_requests
  ADD CONSTRAINT admission_requests_public_lengths CHECK (
    char_length(name) BETWEEN 2 AND 120
    AND email IS NOT NULL AND char_length(email) BETWEEN 3 AND 254
    AND phone IS NOT NULL AND char_length(phone) BETWEEN 8 AND 32
    AND guardian_name IS NOT NULL AND char_length(guardian_name) BETWEEN 2 AND 120
    AND guardian_phone IS NOT NULL AND char_length(guardian_phone) BETWEEN 8 AND 32
    AND (address IS NULL OR char_length(address) <= 500)
    AND (class_level IS NULL OR char_length(class_level) <= 80)
    AND (gender IS NULL OR gender IN ('male', 'female', 'other'))
    AND (message IS NULL OR char_length(message) <= 2000)
    AND status IN ('pending', 'approved', 'rejected')
    AND reference_no ~ '^APP-[A-Z0-9_-]{12}$'
  ) NOT VALID;

ALTER TABLE public.contact_messages DROP CONSTRAINT IF EXISTS contact_messages_public_lengths;
ALTER TABLE public.contact_messages
  ADD CONSTRAINT contact_messages_public_lengths CHECK (
    char_length(name) BETWEEN 2 AND 120
    AND char_length(email) BETWEEN 3 AND 254
    AND char_length(phone) <= 32
    AND message IS NOT NULL AND char_length(message) BETWEEN 10 AND 2000
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.submit_public_form(
  p_form_type TEXT,
  p_client_ip INET,
  p_payload JSONB,
  p_reference_no TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_ip_hash BYTEA;
  v_phone_hash BYTEA;
  v_email_hash BYTEA;
  v_phone TEXT;
  v_email TEXT;
  v_id UUID;
  v_ip_limit INTEGER;
  v_identity_limit INTEGER;
BEGIN
  IF p_form_type NOT IN ('admission', 'contact') OR p_client_ip IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_public_form';
  END IF;

  v_phone := regexp_replace(coalesce(p_payload->>'phone', ''), '[^0-9+]', '', 'g');
  v_email := lower(btrim(coalesce(p_payload->>'email', '')));
  IF v_email = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_public_form';
  END IF;

  v_ip_hash := digest(host(p_client_ip), 'sha256');
  v_phone_hash := CASE WHEN v_phone = '' THEN NULL ELSE digest(v_phone, 'sha256') END;
  v_email_hash := digest(v_email, 'sha256');
  v_ip_limit := CASE p_form_type WHEN 'admission' THEN 5 ELSE 10 END;
  v_identity_limit := CASE p_form_type WHEN 'admission' THEN 3 ELSE 5 END;

  -- Serialize contenders for all three counters before counting and inserting.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_form_type || ':ip:' || encode(v_ip_hash, 'hex'), 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_form_type || ':email:' || encode(v_email_hash, 'hex'), 0));
  IF v_phone_hash IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_form_type || ':phone:' || encode(v_phone_hash, 'hex'), 0));
  END IF;

  IF (SELECT count(*) FROM public.public_form_rate_events
      WHERE form_type = p_form_type AND ip_hash = v_ip_hash AND created_at > v_now - interval '1 hour') >= v_ip_limit
    OR (SELECT count(*) FROM public.public_form_rate_events
      WHERE form_type = p_form_type AND email_hash = v_email_hash AND created_at > v_now - interval '24 hours') >= v_identity_limit
    OR (v_phone_hash IS NOT NULL AND (SELECT count(*) FROM public.public_form_rate_events
      WHERE form_type = p_form_type AND phone_hash = v_phone_hash AND created_at > v_now - interval '24 hours') >= v_identity_limit)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rate_limited';
  END IF;

  IF p_form_type = 'admission' THEN
    IF p_reference_no IS NULL OR p_reference_no !~ '^APP-[A-Z0-9_-]{12}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_public_form';
    END IF;
    INSERT INTO public.admission_requests (
      name, email, phone, guardian_name, guardian_phone, address,
      class_level, gender, batch_id, message, reference_no
    ) VALUES (
      p_payload->>'name', v_email, p_payload->>'phone', p_payload->>'guardian_name',
      p_payload->>'guardian_phone', nullif(p_payload->>'address', ''),
      nullif(p_payload->>'class_level', ''), nullif(p_payload->>'gender', ''),
      (p_payload->>'batch_id')::uuid, nullif(p_payload->>'message', ''), p_reference_no
    ) RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.contact_messages (name, email, phone, message)
    VALUES (p_payload->>'name', v_email, coalesce(p_payload->>'phone', ''), p_payload->>'message')
    RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.public_form_rate_events (form_type, ip_hash, phone_hash, email_hash, created_at)
  VALUES (p_form_type, v_ip_hash, v_phone_hash, v_email_hash, v_now);

  -- Opportunistic bounded-retention cleanup; rate events contain hashes only.
  DELETE FROM public.public_form_rate_events WHERE created_at < v_now - interval '2 days';
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$function$;

REVOKE ALL ON FUNCTION public.submit_public_form(TEXT, INET, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_form(TEXT, INET, JSONB, TEXT) TO service_role;
