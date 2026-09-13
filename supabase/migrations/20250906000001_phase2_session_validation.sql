-- Phase 2: explicit session validation endpoint for client initialization.

CREATE OR REPLACE FUNCTION portal_validate_session(p_token TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  student_id TEXT,
  phone TEXT,
  email TEXT,
  class_level TEXT,
  batch_id UUID,
  photo_url TEXT,
  status TEXT,
  is_approved BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_student UUID;
BEGIN
  SELECT ss.student_id INTO v_student
  FROM student_sessions ss
  JOIN students s ON s.id = ss.student_id
  WHERE ss.token = p_token
    AND ss.expires_at > now()
    AND s.is_approved = true
    AND s.status <> 'suspended';

  IF v_student IS NULL THEN
    RETURN;
  END IF;

  UPDATE student_sessions SET last_seen = now() WHERE token = p_token;

  RETURN QUERY
  SELECT s.id, s.name, s.student_id, s.phone, s.email, s.class_level,
         s.batch_id, s.photo_url, s.status, s.is_approved
  FROM students s
  WHERE s.id = v_student;
END;
$$;

REVOKE ALL ON FUNCTION portal_validate_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION portal_validate_session(TEXT) TO anon, authenticated;
