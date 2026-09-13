-- ============================================================
--  Production-go hardening: admin safe mutations
--  Run ONCE in Supabase → SQL Editor (after all earlier
--  migrations, e.g. 20250831000002_batch_end_time.sql).
--  (1) transactional student deletion (P1)
--  (2) transactional backup restore with accurate reporting (P0)
-- ============================================================

BEGIN;

-- ════════════════════════════════════════════════════════════
-- (0) register_student — collision-safe
--     Approval passes the client-generated student_id. On a
--     UNIQUE collision (students.student_id), retry the INSERT
--     with a numeric suffix instead of failing the whole
--     approval (P1). Keeps the same return shape & signature,
--     so the app works before and after this migration.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION register_student(
  p_name           TEXT,
  p_phone          TEXT,
  p_student_id     TEXT,
  p_password       TEXT,
  p_email          TEXT DEFAULT NULL,
  p_guardian_name  TEXT DEFAULT NULL,
  p_guardian_phone TEXT DEFAULT NULL,
  p_address        TEXT DEFAULT NULL,
  p_class_level    TEXT DEFAULT NULL,
  p_gender         TEXT DEFAULT NULL,
  p_batch_id       UUID DEFAULT NULL,
  p_status         TEXT DEFAULT 'active',
  p_is_approved    BOOLEAN DEFAULT false,
  p_photo_url      TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID, name TEXT, student_id TEXT, phone TEXT, email TEXT,
  guardian_name TEXT, guardian_phone TEXT, address TEXT, class_level TEXT,
  gender TEXT, batch_id UUID, status TEXT, is_approved BOOLEAN, photo_url TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_try  INT := 0;
  v_sid  TEXT := p_student_id;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  LOOP
    BEGIN
      RETURN QUERY
      INSERT INTO students (
        name, phone, student_id, password,
        email, guardian_name, guardian_phone, address,
        class_level, gender, batch_id, status, is_approved, photo_url
      ) VALUES (
        p_name, p_phone, v_sid, crypt(p_password, gen_salt('bf')),
        p_email, p_guardian_name, p_guardian_phone, p_address,
        p_class_level, p_gender, p_batch_id, p_status, p_is_approved, p_photo_url
      )
      RETURNING
        students.id, students.name, students.student_id, students.phone,
        students.email, students.guardian_name, students.guardian_phone,
        students.address, students.class_level, students.gender, students.batch_id,
        students.status, students.is_approved, students.photo_url, students.created_at;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      v_try := v_try + 1;
      IF v_try > 10 THEN
        RAISE;
      END IF;
      -- Reserve distinct suffixes so the retry is very likely unique.
      v_sid := p_student_id || '-' || substr(md5(random()::text), 1, 6);
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION register_student(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,BOOLEAN,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION register_student(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,TEXT,BOOLEAN,TEXT) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- (1) admin_delete_student
--     Single admin-gated transaction: removes every student-owned
--     row (sessions, exam tokens, approvals, submissions, fees and
--     their audit entries) and the student. All-or-nothing.
--     login_attempts keys on phone_number with no FK, so it is
--     deliberately left untouched to avoid deleting another
--     student's rate-limit history.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_delete_student(p_student_id UUID)
RETURNS TABLE (related_removed BIGINT, student_removed BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_related BIGINT := 0;
  v_student_removed BOOLEAN := false;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  -- Each owned table is guarded by TO_REGCLASS so the RPC is safe even if a
  -- supporting table (e.g. exam_tokens / student_sessions) has not been
  -- created yet by an earlier migration on this project.
  IF TO_REGCLASS('public.exam_tokens')       IS NOT NULL THEN v_related := v_related + (SELECT count(*) FROM exam_tokens       WHERE student_id = p_student_id); END IF;
  IF TO_REGCLASS('public.student_sessions')  IS NOT NULL THEN v_related := v_related + (SELECT count(*) FROM student_sessions  WHERE student_id = p_student_id); END IF;
  IF TO_REGCLASS('public.payment_approvals') IS NOT NULL THEN v_related := v_related + (SELECT count(*) FROM payment_approvals WHERE student_id = p_student_id); END IF;
  IF TO_REGCLASS('public.mcq_submissions')   IS NOT NULL THEN v_related := v_related + (SELECT count(*) FROM mcq_submissions   WHERE student_id = p_student_id); END IF;
  IF TO_REGCLASS('public.fee_audit_logs')    IS NOT NULL THEN v_related := v_related + (SELECT count(*) FROM fee_audit_logs    WHERE fee_id IN (SELECT id FROM fees WHERE student_id = p_student_id)); END IF;
  IF TO_REGCLASS('public.fees')              IS NOT NULL THEN v_related := v_related + (SELECT count(*) FROM fees              WHERE student_id = p_student_id); END IF;

  IF TO_REGCLASS('public.exam_tokens')       IS NOT NULL THEN DELETE FROM exam_tokens       WHERE student_id = p_student_id; END IF;
  IF TO_REGCLASS('public.student_sessions')  IS NOT NULL THEN DELETE FROM student_sessions  WHERE student_id = p_student_id; END IF;
  IF TO_REGCLASS('public.payment_approvals') IS NOT NULL THEN DELETE FROM payment_approvals WHERE student_id = p_student_id; END IF;
  IF TO_REGCLASS('public.mcq_submissions')   IS NOT NULL THEN DELETE FROM mcq_submissions   WHERE student_id = p_student_id; END IF;
  IF TO_REGCLASS('public.fee_audit_logs')    IS NOT NULL THEN DELETE FROM fee_audit_logs    WHERE fee_id IN (SELECT id FROM fees WHERE student_id = p_student_id); END IF;
  IF TO_REGCLASS('public.fees')              IS NOT NULL THEN DELETE FROM fees              WHERE student_id = p_student_id; END IF;

  DELETE FROM students WHERE id = p_student_id;
  v_student_removed := FOUND;

  RETURN QUERY SELECT v_related, v_student_removed;
END;
$fn$;

REVOKE ALL ON FUNCTION admin_delete_student(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_delete_student(UUID) TO authenticated;

-- ════════════════════════════════════════════════════════════
-- (2) admin_restore_backup
--     Server-side transactional restore. Every table present in
--     the backup is REPLACED (delete + insert) inside ONE
--     transaction. Tables absent from the backup are untouched.
--     Any failure rolls back the entire restore and raises with
--     the offending table name + underlying error. The function
--     deletes existing rows first, so inserts use a plain INSERT
--     (duplicate ids in a malformed backup trip the primary key
--     and roll back cleanly).
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_restore_backup(p_tables JSONB)
RETURNS TABLE (table_name TEXT, rows_restored INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_key       TEXT;
  v_rows      JSONB;
  v_cols      TEXT[];
  v_defs      TEXT[];
  v_sample    JSONB;
  v_ins       TEXT;
  v_def       TEXT;
  v_fk_map    TEXT[] := ARRAY[
    'payment_approvals','admission_requests','mcq_submissions','mcq_questions',
    'sms_logs','notices','exams','fees','students','teachers','batches','site_settings'
  ];
  v_order     TEXT[] := ARRAY[
    'site_settings','batches','teachers','students','fees',
    'notices','exams','mcq_questions','mcq_submissions',
    'sms_logs','admission_requests','payment_approvals'
  ];
  v_count     INTEGER;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF p_tables IS NULL OR jsonb_typeof(p_tables) <> 'object' THEN
    RAISE EXCEPTION 'no tables supplied' USING ERRCODE = '22023';
  END IF;

  -- Allowlist: only keys the app backs up may be restored.
  FOR v_key IN SELECT jsonb_object_keys(p_tables) LOOP
    IF NOT (v_key = ANY(v_order)) THEN
      RAISE EXCEPTION 'disallowed table in restore: %', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_tables -> v_key) <> 'array' THEN
      RAISE EXCEPTION 'malformed rows for table: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 1) Delete current rows for tables that exist in the backup (children first).
  FOREACH v_key IN ARRAY v_fk_map LOOP
    IF p_tables ? v_key THEN
      EXECUTE format('DELETE FROM %I', v_key);
    END IF;
  END LOOP;

  -- 2) Re-insert the backup rows (parents first).
  FOREACH v_key IN ARRAY v_order LOOP
    IF NOT p_tables ? v_key THEN
      CONTINUE;
    END IF;

    v_rows := p_tables -> v_key;
    v_count := jsonb_array_length(v_rows);
    IF v_count = 0 THEN
      CONTINUE;
    END IF;

    v_sample := v_rows -> 0;

    -- Columns present in the sample row AND in the live table, in table order.
    SELECT array_agg(c.column_name ORDER BY c.ordinal_position) INTO v_cols
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = v_key
      AND c.column_name IN (SELECT jsonb_object_keys(v_sample));

    IF v_cols IS NULL OR array_length(v_cols, 1) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT array_agg(c.column_name || ' ' || c.data_type ORDER BY c.ordinal_position)
    INTO v_defs
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = v_key
      AND c.column_name = ANY(v_cols);

    v_def := array_to_string(v_defs, ', ');
    v_ins := array_to_string(v_cols, ', ');

    BEGIN
      EXECUTE format(
        'INSERT INTO %I (%s) SELECT %s FROM jsonb_to_recordset($1::jsonb) AS x(%s)',
        v_key, v_ins, v_ins, v_def
      ) USING v_rows::text;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'restore failed on table %: %', v_key, SQLERRM;
    END;

    table_name := v_key;
    rows_restored := v_count;
    RETURN NEXT;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION admin_restore_backup(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_restore_backup(JSONB) TO authenticated;

COMMIT;
