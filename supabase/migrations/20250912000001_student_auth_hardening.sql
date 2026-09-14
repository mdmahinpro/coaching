-- Serialize student login attempts, remove legacy plaintext authentication, and
-- retain the existing opaque-session RPC contract. This migration is data-only
-- plus a CREATE OR REPLACE of public.verify_student_login(text, text).

-- pgcrypto may be installed in public (fresh installs) or extensions (managed
-- Supabase projects); cover both without hard-coding its deployment schema.
SET search_path = public, extensions;

-- Hash every non-empty legacy password before removing plaintext comparison.
-- Already-valid bcrypt values are left untouched.
UPDATE public.students AS s
SET password = crypt(s.password, gen_salt('bf'))
WHERE s.password IS NOT NULL
  AND btrim(s.password) <> ''
  AND s.password !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$';

-- Store historical attempt keys in the same canonical form used by the RPC so
-- attempts made with cosmetic phone formatting cannot evade the shared budget.
UPDATE public.login_attempts AS la
SET phone_number = regexp_replace(btrim(la.phone_number), '[^0-9]', '', 'g')
WHERE la.phone_number IS DISTINCT FROM
      regexp_replace(btrim(la.phone_number), '[^0-9]', '', 'g');

CREATE OR REPLACE FUNCTION public.verify_student_login(
  p_phone    TEXT,
  p_password TEXT
)
RETURNS TABLE (
  id             UUID,
  name           TEXT,
  student_id     TEXT,
  phone          TEXT,
  email          TEXT,
  guardian_name  TEXT,
  guardian_phone TEXT,
  address        TEXT,
  class_level    TEXT,
  gender         TEXT,
  batch_id       UUID,
  status         TEXT,
  is_approved    BOOLEAN,
  photo_url      TEXT,
  created_at     TIMESTAMPTZ,
  session_token  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_phone        TEXT := regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9]', '', 'g');
  v_failed_count INTEGER;
  v_id           UUID;
  v_token        TEXT;
BEGIN
  -- Serialize the complete check/authenticate/record sequence for one normalized
  -- phone. The transaction-scoped lock is released on either commit or failure.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_phone, 0)
  );

  -- Deliberately allow catalog/table errors to propagate: inability to evaluate
  -- the budget must never degrade into an authentication bypass (fail closed).
  SELECT count(*) INTO v_failed_count
  FROM public.login_attempts AS la
  WHERE la.phone_number = v_phone
    AND la.success = false
    AND la.attempt_time > clock_timestamp() - interval '15 minutes';

  IF v_failed_count >= 5 THEN
    RAISE EXCEPTION 'Too many failed attempts. Please try again later.';
  END IF;

  SELECT s.id INTO v_id
  FROM public.students AS s
  WHERE regexp_replace(btrim(s.phone), '[^0-9]', '', 'g') = v_phone
    AND s.password ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'
    AND s.password = crypt(p_password, s.password)
  ORDER BY s.id
  LIMIT 1;

  IF v_id IS NULL THEN
    -- Return an empty result instead of raising after this insert: an exception
    -- would roll the attempt back with the surrounding RPC transaction.
    INSERT INTO public.login_attempts (phone_number, attempt_time, success)
    VALUES (v_phone, clock_timestamp(), false);
    RETURN;
  END IF;

  INSERT INTO public.login_attempts (phone_number, attempt_time, success)
  VALUES (v_phone, clock_timestamp(), true);

  -- Preserve opaque-session behavior: only _issue_student_session creates the
  -- token, and only that token is returned to the caller.
  v_token := public._issue_student_session(v_id);

  RETURN QUERY
  SELECT
    s.id, s.name, s.student_id, s.phone,
    s.email, s.guardian_name, s.guardian_phone, s.address,
    s.class_level, s.gender, s.batch_id,
    s.status, s.is_approved, s.photo_url, s.created_at,
    v_token
  FROM public.students AS s
  WHERE s.id = v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.verify_student_login(TEXT, TEXT) TO anon, authenticated;

RESET search_path;
