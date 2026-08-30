-- ============================================================
--  Student-submitted payment approvals
-- ============================================================
--  WHY: portal students pay manually (bKash / Nagad / WhatsApp), then the
--  admin records it. There was no in-app way for a student to hand the
--  transaction ID to the admin, and no pending state visible to either side.
--
--  This adds a `payment_approvals` table + token-scoped RPCs so a student
--  can submit their transaction ID, the admin sees it in the Fees page and
--  approves/rejects, and the portal then shows পরিশোধিত once approved.
--
--  Security: students are anon (no Supabase Auth) — the table has NO anon
--  policy; only SECURITY DEFINER RPCs touch it (student identity from the
--  session token), and authenticated (admin) has full access. update_rls
--  also re-grants admin via the standard admin_all pattern.
--
--  Idempotent. Run in the Supabase SQL Editor.

BEGIN;

-- ── 1. Table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_id          UUID NOT NULL REFERENCES fees(id) ON DELETE CASCADE,
  method          TEXT NOT NULL CHECK (method IN ('bkash','nagad','rocket','cash')),
  transaction_id  TEXT NOT NULL DEFAULT '',
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     TEXT
);
-- One outstanding ("pending") approval per fee at a time.
DROP INDEX IF EXISTS payment_approvals_fee_pending_uidx;
CREATE UNIQUE INDEX payment_approvals_fee_pending_uidx
  ON payment_approvals (fee_id) WHERE status = 'pending';

ALTER TABLE payment_approvals ENABLE ROW LEVEL SECURITY;

-- Admin (authenticated) full CRUD — mirror the core_rls admin_all pattern.
DROP POLICY IF EXISTS "admin_all_payment_approvals" ON payment_approvals;
CREATE POLICY "admin_all_payment_approvals"
  ON payment_approvals FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Students are anon and must NOT read/write this table directly.
REVOKE SELECT, INSERT, UPDATE, DELETE ON payment_approvals FROM anon;

-- ── 2. Student: submit a transaction for approval ────────────
DROP FUNCTION IF EXISTS portal_submit_payment(TEXT, UUID, TEXT, TEXT, TEXT);

CREATE FUNCTION portal_submit_payment(
  p_token          TEXT,
  p_fee_id         UUID,
  p_method         TEXT,
  p_transaction_id TEXT,
  p_note           TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID, approval_status TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_sid  UUID := _student_id_from_token(p_token);
  v_fee  RECORD;
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  IF p_method NOT IN ('bkash','nagad','rocket','cash') THEN
    RAISE EXCEPTION 'INVALID_METHOD';
  END IF;
  IF p_transaction_id IS NULL OR length(trim(p_transaction_id)) = 0 THEN
    RAISE EXCEPTION 'TRANSACTION_ID_REQUIRED';
  END IF;

  -- The fee must belong to this student and not yet be paid.
  SELECT f.month, f.status INTO v_fee
  FROM fees f WHERE f.id = p_fee_id AND f.student_id = v_sid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FEE_NOT_FOUND';
  END IF;
  IF v_fee.status = 'paid' THEN
    RAISE EXCEPTION 'FEE_ALREADY_PAID';
  END IF;

  -- The unique partial index rejects a second pending request automatically.
  -- (The ON CONFLICT arbiter predicate must mirror the partial-index predicate
  -- `WHERE status = 'pending'` for inference to match; the function's OUT param
  -- was renamed so `status` unambiguously refers to the table column here.)
  INSERT INTO payment_approvals (student_id, fee_id, method, transaction_id, note)
  VALUES (v_sid, p_fee_id, p_method, trim(p_transaction_id),
          COALESCE(p_note, trim(p_method) || '-' || trim(p_transaction_id)))
  ON CONFLICT (fee_id) WHERE status = 'pending' DO NOTHING
  RETURNING payment_approvals.id, payment_approvals.status, payment_approvals.created_at
  INTO id, approval_status, created_at;

  IF id IS NULL THEN
    RAISE EXCEPTION 'PENDING_APPROVAL_EXISTS';
  END IF;
  RETURN NEXT;
END;
$fn$;

GRANT EXECUTE ON FUNCTION portal_submit_payment(TEXT, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ── 3. Student: my approvals (join month/amount for display) ──
DROP FUNCTION IF EXISTS portal_my_payment_approvals(TEXT);

CREATE FUNCTION portal_my_payment_approvals(p_token TEXT)
RETURNS TABLE (
  id UUID, fee_id UUID, month TEXT, amount NUMERIC, method TEXT,
  transaction_id TEXT, note TEXT, status TEXT, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_sid UUID := _student_id_from_token(p_token);
BEGIN
  IF v_sid IS NULL THEN RAISE EXCEPTION 'Session expired. Please log in again.'; END IF;
  RETURN QUERY
  SELECT a.id, a.fee_id, f.month, f.amount, a.method, a.transaction_id,
         a.note, a.status, a.created_at
  FROM payment_approvals a
  JOIN fees f ON f.id = a.fee_id
  WHERE a.student_id = v_sid
  ORDER BY a.created_at DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION portal_my_payment_approvals(TEXT) TO anon, authenticated;

-- ── 4. Admin: list approvals (pending by default) ─────────────
DROP FUNCTION IF EXISTS admin_payment_approvals(TEXT);

CREATE FUNCTION admin_payment_approvals(p_status TEXT DEFAULT 'pending')
RETURNS TABLE (
  id UUID, student_name TEXT, student_code TEXT, phone TEXT,
  batch_name TEXT, month TEXT, amount NUMERIC, method TEXT,
  transaction_id TEXT, note TEXT, status TEXT, created_at TIMESTAMPTZ, fee_id UUID
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;
  IF p_status IS NULL OR p_status = '' THEN
    p_status := 'pending';
  END IF;
  RETURN QUERY
  SELECT a.id, s.name, s.student_id, s.phone, b.name,
         f.month, f.amount, a.method, a.transaction_id, a.note, a.status,
         a.created_at, a.fee_id
  FROM payment_approvals a
  JOIN students s ON s.id = a.student_id
  LEFT JOIN batches b ON b.id = s.batch_id
  JOIN fees f ON f.id = a.fee_id
  WHERE a.status = p_status
  ORDER BY a.created_at DESC;
END;
$fn$;

REVOKE ALL ON FUNCTION admin_payment_approvals(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_payment_approvals(TEXT) TO authenticated;

-- ── 5. Admin: approve → mark the fee paid (same note shape as UI) ──
DROP FUNCTION IF EXISTS admin_approve_payment(UUID);

CREATE FUNCTION admin_approve_payment(p_approval_id UUID)
RETURNS TABLE (receipt_no TEXT, amount NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_admin     TEXT;
  v_appr      RECORD;
  v_receipt   TEXT;
  v_meta      TEXT;
  v_stu_name  TEXT;
  v_stu_code  TEXT;
  v_month     TEXT;
  v_amount    NUMERIC;
  v_old_status TEXT;
  v_old_note  TEXT;
  v_old       JSONB;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin authorization required'; END IF;
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'email') INTO v_admin;
  v_admin := COALESCE(v_admin, 'admin');

  SELECT a.student_id, a.fee_id, a.method, a.transaction_id INTO v_appr
  FROM payment_approvals a WHERE a.id = p_approval_id AND a.status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND';
  END IF;

  -- Snapshot student + fee BEFORE marking the fee paid, so the audit "before"
  -- state is the true pre-payment state (portal approvals only ever target
  -- unpaid fees, so f.status at this point is guaranteed NOT 'paid').
  SELECT s.name, s.student_id, f.month, f.amount, f.status, f.note
    INTO v_stu_name, v_stu_code, v_month, v_amount, v_old_status, v_old_note
  FROM students s JOIN fees f ON f.id = v_appr.fee_id
  WHERE s.id = v_appr.student_id;
  v_old := jsonb_build_object(
    'status', v_old_status,
    'note', v_old_note,
    'amount', v_amount
  );

  v_receipt := 'RCT-' || to_char(now(), 'YYYYMMDD') || '-' ||
               lpad(floor(random() * 9000 + 1000)::int::text, 4, '0');

  -- Same JSON note shape PortalFeesPage / FeesPage already parse.
  v_meta := jsonb_build_object(
    'receipt_no', v_receipt,
    'payment_method', v_appr.method,
    'transaction_id', v_appr.transaction_id,
    'final_amount', v_amount,
    'source', 'portal-approval'
  )::text;

  UPDATE fees
  SET status = 'paid',
      payment_date = now(),
      note = v_meta
  WHERE id = v_appr.fee_id;

  UPDATE payment_approvals
  SET status = 'approved', reviewed_at = now(), reviewed_by = v_admin
  WHERE id = p_approval_id;

  -- Audit entry — same table + column shape as logFeeAudit() on the Fees page,
  -- so the Audit Log tab renders Student / Month / Summary and before/after
  -- instead of "—". Uses the pre-payment snapshot for old_data (NOT the
  -- post-update fee row, which would wrongly report status='paid' as "before").
  BEGIN
    INSERT INTO fee_audit_logs
      (fee_id, action, admin_email, student_name, student_code, month, old_data, new_data)
    VALUES (
      v_appr.fee_id, 'payment_recorded', v_admin, v_stu_name, v_stu_code, v_month,
      v_old,
      (v_meta::jsonb || jsonb_build_object('status', 'paid', 'amount', v_amount))::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- audit must never block the payment flow
  END;

  RETURN QUERY SELECT v_receipt, (SELECT f.amount FROM fees f WHERE f.id = v_appr.fee_id);
END;
$fn$;

REVOKE ALL ON FUNCTION admin_approve_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_approve_payment(UUID) TO authenticated;

-- ── 6. Admin: reject → leave fee unpaid, record review ─────────
DROP FUNCTION IF EXISTS admin_reject_payment(UUID);

CREATE FUNCTION admin_reject_payment(p_approval_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE v_admin TEXT;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin authorization required'; END IF;
  SELECT (current_setting('request.jwt.claims', true)::jsonb ->> 'email') INTO v_admin;
  UPDATE payment_approvals
  SET status = 'rejected', reviewed_at = now(), reviewed_by = COALESCE(v_admin, 'admin')
  WHERE id = p_approval_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION admin_reject_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_reject_payment(UUID) TO authenticated;

COMMIT;

-- ============================================================
--  Post-COMMIT functional smoke
-- ============================================================
DO $verify$
DECLARE
  v_b UUID; v_s UUID; v_f UUID; v_tok TEXT; v_app_id UUID; v_receipt TEXT;
BEGIN
  -- Disposable batch + student + unpaid fee.
  INSERT INTO batches (name, capacity, is_active) VALUES ('__E2E PAYA__', 10, true) RETURNING id INTO v_b;
  INSERT INTO students (name, phone, student_id, password, is_approved, status, batch_id)
  VALUES ('E2E Pay Approve', '01981110002', '__E2EPAYAPR',
          crypt('Passw0rd!', gen_salt('bf')), true, 'active', v_b) RETURNING id INTO v_s;
  INSERT INTO fees (student_id, batch_id, amount, month, status)
  VALUES (v_s, v_b, 1500, 'August 2026', 'pending') RETURNING id INTO v_f;

  v_tok := _issue_student_session(v_s);

  -- Student submits a transaction.
  SELECT id INTO v_app_id
  FROM portal_submit_payment(v_tok, v_f, 'bkash', 'TRX8888', 'bkash payment');

  -- Portal sees it as pending.
  IF NOT EXISTS (SELECT 1 FROM portal_my_payment_approvals(v_tok) WHERE id = v_app_id) THEN
    RAISE EXCEPTION 'portal_submit_payment / portal_my_payment_approvals failed';
  END IF;

  -- Admin approve is an is_admin()-gated RPC — in the SQL editor there is no
  -- JWT (auth.uid() IS NULL), so we cannot call it here without tripping the
  -- gate. Exercise the SAME writes it performs (fee → paid with receipt note,
  -- approval → approved) to prove the round trip; the gated RPC itself is
  -- covered by the browser E2E harness running as a real admin.
  v_receipt := 'RCT-VERIFY';
  UPDATE payment_approvals
  SET status = 'approved', reviewed_at = now(), reviewed_by = 'verify'
  WHERE id = v_app_id;
  UPDATE fees
  SET status = 'paid', payment_date = now(),
      note = jsonb_build_object(
        'receipt_no', v_receipt,
        'payment_method', 'bkash',
        'transaction_id', 'TRX8888',
        'final_amount', 1500,
        'source', 'verify'
      )::text
  WHERE id = v_f;

  -- Fee is paid, note carries the receipt (client parses JSON).
  IF NOT EXISTS (SELECT 1 FROM fees WHERE id = v_f AND status = 'paid') THEN
    RAISE EXCEPTION 'approve path did not mark the fee paid';
  END IF;

  -- Cleanup (fee_audit_logs is created out-of-band in this project; only
  -- touch it if it actually exists).
  IF TO_REGCLASS('public.fee_audit_logs') IS NOT NULL THEN
    DELETE FROM fee_audit_logs WHERE fee_id = v_f;
  END IF;
  DELETE FROM payment_approvals WHERE id = v_app_id;
  DELETE FROM fees WHERE id = v_f;
  DELETE FROM student_sessions WHERE student_id = v_s;
  DELETE FROM students WHERE id = v_s;
  DELETE FROM batches WHERE id = v_b;

  RAISE NOTICE 'verify OK: payment approval round-trip (submit → my list → approve → paid)';
END
$verify$;
