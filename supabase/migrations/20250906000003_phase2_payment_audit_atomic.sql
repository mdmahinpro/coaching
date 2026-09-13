-- Phase 2: replace payment approval with transactionally required audit.
-- Existing customer databases may already have 20250830000002 applied, so this
-- follow-up contains the actual function body rather than only a marker.

CREATE OR REPLACE FUNCTION admin_approve_payment(p_approval_id UUID)
RETURNS TABLE (receipt_no TEXT, amount NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_admin TEXT;
  v_appr RECORD;
  v_receipt TEXT;
  v_meta TEXT;
  v_stu_name TEXT;
  v_stu_code TEXT;
  v_month TEXT;
  v_amount NUMERIC;
  v_old_status TEXT;
  v_old_note TEXT;
  v_old JSONB;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin authorization required'; END IF;
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'email') INTO v_admin;
  v_admin := COALESCE(v_admin, 'admin');

  SELECT a.student_id, a.fee_id, a.method, a.transaction_id INTO v_appr
  FROM payment_approvals a
  WHERE a.id = p_approval_id AND a.status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPROVAL_NOT_FOUND'; END IF;

  SELECT s.name, s.student_id, f.month, f.amount, f.status, f.note
  INTO v_stu_name, v_stu_code, v_month, v_amount, v_old_status, v_old_note
  FROM students s JOIN fees f ON f.id = v_appr.fee_id
  WHERE s.id = v_appr.student_id
  FOR UPDATE OF f;
  IF NOT FOUND THEN RAISE EXCEPTION 'FEE_OR_STUDENT_NOT_FOUND'; END IF;
  IF v_old_status = 'paid' THEN RAISE EXCEPTION 'FEE_ALREADY_PAID'; END IF;

  v_old := jsonb_build_object('status', v_old_status, 'note', v_old_note, 'amount', v_amount);
  v_receipt := 'RCT-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(floor(random() * 9000 + 1000)::int::text, 4, '0');
  v_meta := jsonb_build_object(
    'receipt_no', v_receipt,
    'payment_method', v_appr.method,
    'transaction_id', v_appr.transaction_id,
    'final_amount', v_amount,
    'source', 'portal-approval'
  )::text;

  UPDATE fees SET status = 'paid', payment_date = now(), note = v_meta WHERE id = v_appr.fee_id;
  UPDATE payment_approvals SET status = 'approved', reviewed_at = now(), reviewed_by = v_admin WHERE id = p_approval_id;

  -- Required financial audit: failure aborts the entire transaction.
  INSERT INTO fee_audit_logs
    (fee_id, action, admin_email, student_name, student_code, month, old_data, new_data)
  VALUES (
    v_appr.fee_id, 'payment_recorded', v_admin, v_stu_name, v_stu_code, v_month,
    v_old,
    (v_meta::jsonb || jsonb_build_object('status', 'paid', 'amount', v_amount))::jsonb
  );

  RETURN QUERY SELECT v_receipt, v_amount;
END;
$fn$;

REVOKE ALL ON FUNCTION admin_approve_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_approve_payment(UUID) TO authenticated;
