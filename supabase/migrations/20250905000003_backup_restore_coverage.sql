-- Extend the transactional restore allowlist/order to match
-- 20250905000002_backup_coverage.sql and manual BackupPage coverage.

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
  v_delete_order TEXT[] := ARRAY[
    'payment_approvals','fee_audit_logs','admission_requests',
    'mcq_submissions','mcq_questions','sms_logs','notices','exams',
    'fees','students','teachers','batches','site_settings'
  ];
  v_insert_order TEXT[] := ARRAY[
    'site_settings','batches','teachers','students','fees',
    'fee_audit_logs','notices','exams','mcq_questions','mcq_submissions',
    'sms_logs','admission_requests','payment_approvals'
  ];
  v_count INTEGER;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;
  IF p_tables IS NULL OR jsonb_typeof(p_tables) <> 'object' THEN
    RAISE EXCEPTION 'no tables supplied' USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_tables) LOOP
    IF NOT (v_key = ANY(v_insert_order)) THEN
      RAISE EXCEPTION 'disallowed table in restore: %', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_tables -> v_key) <> 'array' THEN
      RAISE EXCEPTION 'malformed rows for table: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY v_delete_order LOOP
    IF p_tables ? v_key THEN
      EXECUTE format('DELETE FROM %I', v_key);
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY v_insert_order LOOP
    IF NOT p_tables ? v_key THEN CONTINUE; END IF;
    v_rows := p_tables -> v_key;
    v_count := jsonb_array_length(v_rows);
    IF v_count = 0 THEN CONTINUE; END IF;
    v_sample := v_rows -> 0;

    SELECT array_agg(c.column_name ORDER BY c.ordinal_position) INTO v_cols
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = v_key
      AND c.column_name IN (SELECT jsonb_object_keys(v_sample));
    IF v_cols IS NULL OR array_length(v_cols, 1) IS NULL THEN CONTINUE; END IF;

    SELECT array_agg(
      c.column_name || ' ' ||
      CASE
        WHEN c.data_type = 'ARRAY' THEN c.udt_name
        WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name
        ELSE c.data_type
      END
      ORDER BY c.ordinal_position
    ) INTO v_defs
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = v_key
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
