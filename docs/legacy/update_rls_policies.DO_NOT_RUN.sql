-- ============================================================
-- RLS Policy Update for MCQ Tables
-- Run this ONCE in Supabase → SQL Editor
--
-- Security model:
--   Admins:    authenticated role (Supabase Auth) → full CRUD
--   Students:  anon role (custom auth via anon key) → read questions, insert/read own submissions
--   Public:    No Supabase key → DENIED (previously allowed via USING (true))
--
-- NOTE: Since students use custom auth (not Supabase Auth), RLS cannot
-- distinguish between students and any holder of the anon key. The
-- anon key is embedded in the frontend bundle and is publicly discoverable
-- via browser dev tools. Application-level route guards (ProtectedRoute)
-- are the primary security boundary for student data.
-- ============================================================

-- ── mcq_questions ──────────────────────────────────────────────

-- Remove public read (was: USING (true) — allowed any request, even without a key)
DROP POLICY IF EXISTS "Allow public read mcq_questions" ON mcq_questions;

-- Admins (authenticated via Supabase Auth): full CRUD
DROP POLICY IF EXISTS "Allow auth all mcq_questions" ON mcq_questions;
  CREATE POLICY "Allow auth all mcq_questions"
  ON mcq_questions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Students (anon role): read questions for their exams
-- Frontend gates which exam a student can access via route params.
-- RLS cannot enforce per-student restrictions without Supabase Auth.
DROP POLICY IF EXISTS "Allow anon read mcq_questions" ON mcq_questions;
  CREATE POLICY "Allow anon read mcq_questions"
  ON mcq_questions FOR SELECT TO anon USING (true);

-- ── mcq_submissions ────────────────────────────────────────────

-- Remove public read (was: USING (true) — allowed any request, even without a key)
DROP POLICY IF EXISTS "Allow public read mcq_submissions" ON mcq_submissions;

-- Admins (authenticated via Supabase Auth): full CRUD (read all, update ranks, delete)
DROP POLICY IF EXISTS "Allow auth all mcq_submissions" ON mcq_submissions;
  CREATE POLICY "Allow auth all mcq_submissions"
  ON mcq_submissions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Students (anon role): insert submissions (taking exams) and read submissions (viewing results)
-- Frontend filters by student_id — RLS cannot verify ownership without Supabase Auth session.
DROP POLICY IF EXISTS "Allow anon insert mcq_submissions" ON mcq_submissions;
  CREATE POLICY "Allow anon insert mcq_submissions"
  ON mcq_submissions FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon read mcq_submissions" ON mcq_submissions;
  CREATE POLICY "Allow anon read mcq_submissions"
  ON mcq_submissions FOR SELECT TO anon USING (true);

-- ── site_settings (keep existing public read — this is non-sensitive config) ──
-- No changes needed; site_settings already has a public read policy.

-- ============================================================
-- Summary of changes:
--   BEFORE: mcq_questions  — public read via USING (true) (no key needed)
--           mcq_submissions — public read via USING (true) (no key needed)
--
--   AFTER:  mcq_questions  — anon role: SELECT only (need anon key)
--                               authenticated role: full CRUD
--           mcq_submissions — anon role: SELECT + INSERT (need anon key)
--                               authenticated role: full CRUD
--
-- Impact: Unauthenticated requests (no Supabase key at all) are now
--         blocked. The anon key is required, which is the same key
--         embedded in the frontend — application-level route guards
--         remain the primary access control for student data.
-- ============================================================
