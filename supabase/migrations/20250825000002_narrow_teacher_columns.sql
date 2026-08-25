-- ════════════════════════════════════════════════════════════════
--  H8 — teachers exposed salary, phone and email to anon
-- ════════════════════════════════════════════════════════════════
--
--  FINDING
--   `anon_read_teachers` grants SELECT on all of `teachers` with
--   USING (true), and the anon role holds a table-wide SELECT grant. RLS
--   filters ROWS, never COLUMNS, so every column of every staff row is
--   readable with nothing but the publishable key:
--
--     GET /rest/v1/teachers?select=name,salary,phone,email&order=salary.desc
--     → [{"name":"Dr. Kamal Hossain","salary":35000,
--         "phone":"01711-000003","email":"kamal@example.com"}, … ]
--
--   All 8 staff rows were retrievable, ordered by salary. This is a
--   payroll disclosure plus a staff contact list — the latter useful for
--   phishing the very accounts that hold admin access.
--
--  WHY IT WENT UNNOTICED
--   The policy is correct for its stated intent ("marketing pages read
--   teachers"). The gap is that the public page asks for `select('*')`
--   while rendering only three fields — see src/pages/public/HomePage.tsx,
--   which uses name, subject and qualification and nothing else. The
--   over-broad read was invisible in the UI.
--
--  FIX
--   Column-level GRANT, which is the only mechanism in Postgres that can
--   restrict a projection. anon keeps SELECT on exactly the columns the
--   public teacher card needs; salary, phone, email and created_at are
--   revoked. `authenticated` (the admin screens, TeachersPage CRUD) keeps
--   full table access and is untouched.
--
--   Consequence: `select=*` as anon now fails with 42501 instead of
--   silently over-fetching. HomePage is updated in the same commit to
--   request the six public columns explicitly. Any future public query
--   that reaches for a private column fails loudly at development time
--   rather than leaking quietly in production.
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ── Pre-flight ───────────────────────────────────────────────
DO $pre$
DECLARE
  missing TEXT;
BEGIN
  IF TO_REGCLASS('public.teachers') IS NULL THEN
    RAISE EXCEPTION 'public.teachers does not exist. Nothing was narrowed.';
  END IF;

  -- Grant a column that does not exist and the whole grant statement
  -- fails; assert the public set up front so the error names the column.
  SELECT string_agg(c, ', ') INTO missing
  FROM unnest(ARRAY['id','name','subject','qualification','bio','photo_url','is_active']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teachers' AND column_name = c
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'teachers is missing expected public column(s): %', missing;
  END IF;
END $pre$;

-- ── Narrow anon's projection to the public teacher card ──────
-- Table-wide SELECT must go first: column grants are additive, so leaving
-- the table-level grant in place would keep every column readable.
REVOKE SELECT ON teachers FROM anon;

GRANT SELECT (
  id,             -- React key
  name,           -- card heading
  subject,        -- badge
  qualification,  -- sub-line
  bio,            -- public-facing blurb
  photo_url,      -- avatar
  is_active       -- so inactive staff can be filtered out client-side
) ON teachers TO anon;

-- salary, phone, email and created_at are deliberately absent.

-- The row policy stays as-is; it was never the problem.
DROP POLICY IF EXISTS "anon_read_teachers" ON teachers;
CREATE POLICY "anon_read_teachers" ON teachers FOR SELECT TO anon USING (true);

COMMIT;

-- ════════════════════════════════════════════════════════════════
--  Verification — after COMMIT so a failure reports loudly without
--  rolling back a grant change that already succeeded.
-- ════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  leaked  TEXT;
  dropped TEXT;
BEGIN
  -- 1. No private column may remain readable by anon.
  SELECT string_agg(c, ', ') INTO leaked
  FROM unnest(ARRAY['salary','phone','email','created_at']) AS c
  WHERE HAS_COLUMN_PRIVILEGE('anon', 'public.teachers', c, 'SELECT');

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'anon can still SELECT private teacher column(s): %', leaked;
  END IF;

  -- 2. Every column the public page needs must still be readable, or the
  --    marketing page silently renders an empty teacher section.
  SELECT string_agg(c, ', ') INTO dropped
  FROM unnest(ARRAY['id','name','subject','qualification','bio','photo_url','is_active']) AS c
  WHERE NOT HAS_COLUMN_PRIVILEGE('anon', 'public.teachers', c, 'SELECT');

  IF dropped IS NOT NULL THEN
    RAISE EXCEPTION 'anon LOST SELECT on required public column(s): %', dropped;
  END IF;

  -- 3. The admin screens must be unaffected.
  IF NOT HAS_TABLE_PRIVILEGE('authenticated', 'public.teachers', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated LOST SELECT on teachers — the admin Teachers page would break.';
  END IF;

  RAISE NOTICE 'H8 verified: anon reads only the public teacher card columns.';
END $verify$;

NOTIFY pgrst, 'reload schema';
