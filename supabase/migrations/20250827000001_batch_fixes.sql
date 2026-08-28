-- ============================================================
--  P1. Batch fixes — phantom column, broken delete, stale seat count
-- ============================================================
--  THREE unrelated defects from the manual UI pass:

--  1. Editing/creating a batch failed in the UI with:
--       Could not find the 'schedule time' column of 'batches' in the schema cache
--     ROOT CAUSE (client): the form sent `schedule_time`, but the real column
--     is `start_time` (see migration.sql). No DB change required for that —
--     the client fix (BatchesPage.tsx) is committed alongside this file. This
--     migration guarantees the columns the fixed client writes to actually
--     exist, so the repaired payload cannot hit a missing column.

--  2. Deleting a batch errored with:
--       update or delete on table "batches" violates foreign key constraint
--       "fees_batch_id_fkey" on table "fees"
--     The client used to null students/exams references then hard-delete;
--     `fees.batch_id` references batches with no cascade, so the delete blew
--     up. The client now SOFT-DISABLES (is_active = false) instead — no DB
--     change needed, this migration only guarantees is_active is never NULL
--     so every batch is renderable and toggleable.

--  3. A batch with zero enrolled students displayed "2 enrolled". The public
--     BatchCard reads the denormalized `enrolled` column, which had drifted
--     from the real student set. Reconcile it against the source of truth —
--     students who are approved, active, and assigned to the batch. The
--     admin page's live count now matches this exact definition.
--
--  Idempotent. Run in the Supabase SQL Editor.

BEGIN;

-- ── Pre-flight ───────────────────────────────────────────────
DO $pre$
BEGIN
  IF TO_REGCLASS('public.batches') IS NULL THEN
    RAISE EXCEPTION 'public.batches does not exist. Nothing to repair.';
  END IF;

  IF TO_REGCLASS('public.students') IS NULL THEN
    RAISE EXCEPTION 'public.students missing — cannot reconcile enrolled counts.';
  END IF;

  -- Every column the tightened client writes must exist or the whole payload
  -- fails with 42703. Assert them so a drifted schema names itself here.
  DO $cols$
  DECLARE
    missing TEXT;
    c TEXT;
  BEGIN
    SELECT string_agg(m, ', ') INTO missing
    FROM (
      SELECT unnest(ARRAY['name','subject','class_level','teacher_id','teacher',
                          'schedule_days','start_time','capacity','max_seats',
                          'monthly_fee','fee','description','is_active']) m
    ) t
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='batches' AND column_name=t.m
    );
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION 'batches is missing expected column(s): %', missing;
    END IF;
  END $cols$;
END $pre$;

-- ── Fix 2: no NULL is_active — soft-disable needs a strict boolean ──
-- Seed rows may have NULL; normalise so the client toggle and the
-- public `is_active = true` filters behave.
UPDATE batches SET is_active = true WHERE is_active IS NULL;

-- ── Fix 3: reconcile enrolled against approved + active students ──
-- Only students who are approved, active, and assigned to the batch count.
-- This matches the admin page's live counter and the increment/decrement
-- RPC behaviour, so public card, admin card and seat counters all agree.
UPDATE batches b
SET enrolled = (
  SELECT COUNT(*)
  FROM students s
  WHERE s.batch_id = b.id
    AND s.is_approved = true
    AND s.status = 'active'
)
WHERE EXISTS (
  SELECT 1 FROM students s2 WHERE s2.batch_id = b.id
);
-- Batches with no students at all are left at whatever they had (seeded 0);
-- zero them explicitly so a stale seed like 2 never survives:
UPDATE batches SET enrolled = 0
WHERE NOT EXISTS (
  SELECT 1 FROM students s WHERE s.batch_id = batches.id
);

COMMIT;

-- ============================================================
--  Verification (post-COMMIT — a failure reports loudly without
--  rolling back repairs that already succeeded)
-- ============================================================
DO $verify$
DECLARE
  v_null INT;
  v_mismatch INT;
BEGIN
  -- All batches have a non-null is_active.
  SELECT COUNT(*) INTO v_null FROM batches WHERE is_active IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION '% batch(es) still have NULL is_active — soft-disable would break.', v_null;
  END IF;

  -- enrolled matches the appointed definition everywhere.
  SELECT COUNT(*) INTO v_mismatch
  FROM batches b
  WHERE b.enrolled <> (
    SELECT COUNT(*) FROM students s
    WHERE s.batch_id = b.id AND s.is_approved = true AND s.status = 'active'
  );
  IF v_mismatch > 0 THEN
    RAISE NOTICE 'WARNING: % batch(es) still disagree with live student counts.', v_mismatch;
  ELSE
    RAISE NOTICE 'All batches reconcile: enrolled == approved+active students.';
  END IF;

  RAISE NOTICE 'P1 verified: batches ready for the corrected client payload.';
END $verify$;

NOTIFY pgrst, 'reload schema';
