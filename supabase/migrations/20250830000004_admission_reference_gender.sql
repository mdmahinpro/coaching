-- ============================================================
--  Admission: reference number (default portal password) + gender
-- ============================================================
--  WHY:
--    • Students sign up through the admission form. We want them to receive a
--      "reference number" (APP-XXXXXX) that becomes their DEFAULT portal
--      password once the admin approves the admission. That requires a column
--      to carry the reference from the form to the approval step.
--    • The admission form should collect everything a student record needs
--      (except Status + profile photo, which the student can update later on
--      the portal), and `gender` was an accepted signup input that had no
--      column to land in.
--    • Class level (শ্রেণী) is a managed list: default options are seeded into
--      site_settings so every form can render a <select> of existing classes,
--      and the admin can add/edit them in Settings.
--
--  Idempotent. Run in the Supabase SQL Editor.

-- ── 1. New columns ─────────────────────────────────────────────
ALTER TABLE admission_requests ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE admission_requests ADD COLUMN IF NOT EXISTS reference_no TEXT;

-- ── 2. Default class-level options (existing ones; admin editable) ──
INSERT INTO site_settings (key, value)
VALUES ('class_levels', 'Class 6,Class 7,Class 8,JSC,Class 9,Class 10,SSC,Class 11,Class 12,HSC,IELTS,Admission Test')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
--  Post-COMMIT smoke
-- ============================================================
DO $verify$
DECLARE v_col BOOLEAN; v_val TEXT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='admission_requests'
      AND column_name='reference_no') INTO v_col;
  IF NOT v_col THEN RAISE EXCEPTION 'admission_requests.reference_no missing'; END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='admission_requests'
      AND column_name='gender') INTO v_col;
  IF NOT v_col THEN RAISE EXCEPTION 'admission_requests.gender missing'; END IF;
  SELECT value INTO v_val FROM site_settings WHERE key='class_levels';
  IF v_val IS NULL OR length(v_val) = 0 THEN
    RAISE EXCEPTION 'site_settings.class_levels not seeded';
  END IF;
  RAISE NOTICE 'verify OK: admission reference_no/gender + class_levels seed present.';
END
$verify$;
