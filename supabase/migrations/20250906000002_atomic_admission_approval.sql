-- Phase 2: atomic/idempotent admission approval.
-- The caller supplies the existing UI-generated student ID/password so business
-- rules remain unchanged. The lock + conditional status update prevents double
-- approval; all writes run in one transaction.

CREATE OR REPLACE FUNCTION admin_approve_admission(
  p_admission_id UUID,
  p_student_id TEXT,
  p_password TEXT
)
RETURNS TABLE (student_id TEXT, student_uuid UUID, status TEXT, created BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  a admission_requests%ROWTYPE;
  s students%ROWTYPE;
  v_created BOOLEAN := false;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin authorization required'; END IF;

  SELECT * INTO a FROM admission_requests WHERE id = p_admission_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Admission not found'; END IF;

  IF a.status <> 'pending' THEN
    SELECT * INTO s FROM students WHERE phone = a.phone ORDER BY created_at DESC LIMIT 1;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Admission is already processed but student is missing'; END IF;
    RETURN QUERY SELECT s.student_id, s.id, a.status, false;
    RETURN;
  END IF;

  INSERT INTO students (
    name, phone, student_id, password, email, guardian_name, guardian_phone,
    address, class_level, gender, batch_id, status, is_approved, photo_url
  ) VALUES (
    a.name, a.phone, p_student_id, crypt(p_password, gen_salt('bf')), a.email,
    a.guardian_name, a.guardian_phone, a.address, a.class_level, a.gender,
    a.batch_id, 'active', true, a.photo_url
  )
  RETURNING * INTO s;
  v_created := true;

  IF a.batch_id IS NOT NULL THEN
    PERFORM increment_enrolled(a.batch_id);
  END IF;

  UPDATE admission_requests SET status = 'approved' WHERE id = a.id;

  RETURN QUERY SELECT s.student_id, s.id, 'approved'::TEXT, v_created;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Student already exists or generated student ID is already used';
END;
$$;

REVOKE ALL ON FUNCTION admin_approve_admission(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_approve_admission(UUID, TEXT, TEXT) TO authenticated;
