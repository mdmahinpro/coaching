-- Published student feedback, email delivery logs, and student email updates.

BEGIN;

CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  grade TEXT,
  content TEXT NOT NULL,
  image_url TEXT,
  rating SMALLINT NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  is_published BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_public_read ON public.feedback;
CREATE POLICY feedback_public_read ON public.feedback
  FOR SELECT TO anon, authenticated USING (is_published = true);
DROP POLICY IF EXISTS feedback_admin_all ON public.feedback;
CREATE POLICY feedback_admin_all ON public.feedback
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE INDEX IF NOT EXISTS feedback_public_order_idx
  ON public.feedback (is_published, sort_order, created_at DESC);

CREATE TABLE IF NOT EXISTS public.email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  template_type TEXT NOT NULL DEFAULT 'custom',
  status TEXT NOT NULL DEFAULT 'pending',
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_logs_admin_all ON public.email_logs;
CREATE POLICY email_logs_admin_all ON public.email_logs
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Portal students may update only their own email through this session-gated RPC.
CREATE OR REPLACE FUNCTION portal_update_email(p_token TEXT, p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_student UUID;
BEGIN
  SELECT student_id INTO v_student
  FROM student_sessions
  WHERE token = p_token AND expires_at > now();
  IF v_student IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  IF p_email IS NULL OR p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'A valid email address is required';
  END IF;
  UPDATE students SET email = lower(trim(p_email)) WHERE id = v_student;
  RETURN lower(trim(p_email));
END;
$$;

GRANT EXECUTE ON FUNCTION portal_update_email(TEXT, TEXT) TO anon, authenticated;

COMMIT;
