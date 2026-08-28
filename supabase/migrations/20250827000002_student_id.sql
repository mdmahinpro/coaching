-- ============================================================
--  P2. Configurable student IDs + batch code column
-- ============================================================
--  The student ID was hardcoded as CF<year><4-digit-seq> (client-side, in
--  AdmissionsPage and StudentModal). The requirement is a configurable
--  `Short + Code + Year + Seq` scheme, e.g. TLY + Q + 26 + 001 -> "TLYQ26001",
--  where:
--    Short    = coaching short name (site_settings.coaching_short_name, admin editable)
--    Code     = a per-batch short token (new batches.code column, admin editable)
--    Year     = 2-digit current year (client-computed)
--    Seq      = 3-digit per-prefix counter (client-computed, unique-checked)
--
--  This migration provisions the two DB halves the scheme needs. The client
--  logic (shared generator src/lib/studentId.ts) is committed alongside.
--
--  Idempotent. Run in the Supabase SQL Editor.

BEGIN;

-- ── Pre-flight ───────────────────────────────────────────────
DO $pre$
BEGIN
  IF TO_REGCLASS('public.batches') IS NULL THEN
    RAISE EXCEPTION 'public.batches missing — run P1 (20250827000001) first.';
  END IF;

  IF TO_REGCLASS('public.students') IS NULL THEN
    RAISE EXCEPTION 'public.students missing — cannot verify ID generation.';
  END IF;

  IF TO_REGCLASS('public.site_settings') IS NULL THEN
    RAISE EXCEPTION 'public.site_settings missing — run the core migration first.';
  END IF;
END $pre$;

-- ── Batch short code (used inside student IDs) ──────────────
ALTER TABLE batches ADD COLUMN IF NOT EXISTS code TEXT;

-- ── Coaching short name (ID prefix), with a sane default ─────
INSERT INTO site_settings (key, value)
VALUES ('coaching_short_name', 'TLY')
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- ============================================================
--  Verification (post-COMMIT)
-- ============================================================
DO $verify$
DECLARE
  v_code_exists BOOLEAN;
  v_val TEXT;
  v_dup INT;
BEGIN
  SELECT COUNT(*) > 0 INTO v_code_exists
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='batches' AND column_name='code';
  IF NOT v_code_exists THEN
    RAISE EXCEPTION 'batches.code was not added — the ID scheme cannot use batch codes.';
  END IF;

  SELECT value INTO v_val FROM site_settings WHERE key = 'coaching_short_name' LIMIT 1;
  IF v_val IS NULL OR v_val = '' THEN
    RAISE EXCEPTION 'coaching_short_name missing after insert.';
  END IF;
  RAISE NOTICE 'coaching_short_name = %', v_val;

  -- Existing student IDs must remain UNIQUE after the scheme change (the
  -- client checks uniqueness by exact match; a duplicate prefix is fine, a
  -- duplicate full ID would break exam_join identity resolution).
  SELECT COUNT(*) INTO v_dup
  FROM (SELECT student_id FROM students WHERE student_id IS NOT NULL GROUP BY student_id HAVING COUNT(*) > 1) d;
  IF v_dup > 0 THEN
    RAISE EXCEPTION 'Encountered % duplicate student_id(s) — resolve before adopting the new scheme.', v_dup;
  END IF;

  RAISE NOTICE 'P2 verified: batches.code present, short name set, no duplicate student IDs.';
END $verify$;

NOTIFY pgrst, 'reload schema';
