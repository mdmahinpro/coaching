-- ============================================================
--  Batches: add end_time (class finish time)
--  Run ONCE in Supabase → SQL Editor.
-- ============================================================
--
--  WHY:
--  Batch cards must show "start AND end time" (e.g. 9:30 AM – 11:00 AM),
--  but the batches table only holds `start_time`. The `schedule_days` +
--  `start_time` structured fields are what admins edit in the batch form;
--  `schedule` is a legacy free-text column that predates them.
--
--  This adds `end_time` as optional TEXT (HH:MM, matching start_time).
--  Idempotent. No existing data is touched.

ALTER TABLE batches ADD COLUMN IF NOT EXISTS end_time TEXT;

-- ── Post-COMMIT smoke ────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'batches' AND column_name = 'end_time'
  ) THEN
    RAISE EXCEPTION 'batches.end_time was not created';
  END IF;
  RAISE NOTICE 'verify OK: batches.end_time present';
END
$verify$;