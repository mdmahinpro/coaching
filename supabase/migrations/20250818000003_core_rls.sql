-- ============================================================
-- Row Level Security — core tables lockdown
-- Run this ONCE in Supabase → SQL Editor AFTER the 20250818*
-- session / portal / exam RPC migrations (they create the
-- SECURITY DEFINER functions the portal now relies on).
-- ============================================================
--
-- MODEL
--   authenticated (admin via Supabase Auth) → full CRUD on everything.
--   anon (public bundle key) → ONLY the minimal public-page surface:
--       • SELECT batches / teachers            (public marketing pages)
--       • SELECT exams                         (public exam links + realtime)
--       • SELECT notices WHERE target='all'    (public notice board)
--       • SELECT site_settings EXCEPT secrets  (branding load on mount)
--       • INSERT admission_requests / contact_messages (public forms)
--   Everything per-student (students, fees, mcq_questions, mcq_submissions,
--   batch-targeted notices) is DENIED to anon and reached only through the
--   SECURITY DEFINER RPCs, which resolve identity from a session token.
--
-- This closes the core defect: holding the anon key no longer grants
-- read access to any student's data, and the MCQ answer key
-- (correct_option) is no longer selectable by the client.
-- ============================================================

-- ── Drop the old permissive policies from earlier migrations ─
-- (migration.sql shipped public-read on mcq_*/site_settings;
--  update_rls_policies.sql added anon read/insert on mcq_*.)
DROP POLICY IF EXISTS "Allow public read mcq_questions"    ON mcq_questions;
DROP POLICY IF EXISTS "Allow anon read mcq_questions"       ON mcq_questions;
DROP POLICY IF EXISTS "Allow public read mcq_submissions"  ON mcq_submissions;
DROP POLICY IF EXISTS "Allow anon insert mcq_submissions"   ON mcq_submissions;
DROP POLICY IF EXISTS "Allow anon read mcq_submissions"     ON mcq_submissions;
DROP POLICY IF EXISTS "Allow public read site_settings"    ON site_settings;

-- ── Enable RLS on every core table ───────────────────────────
ALTER TABLE students            ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fees                ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams               ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices             ENABLE ROW LEVEL SECURITY;
ALTER TABLE admission_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcq_questions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcq_submissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings       ENABLE ROW LEVEL SECURITY;

-- ── authenticated (admin) → full CRUD everywhere ─────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'students','teachers','batches','fees','exams','notices',
    'admission_requests','contact_messages','sms_logs',
    'mcq_questions','mcq_submissions','site_settings'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "admin_all_%1$s" ON %1$I;', t);
    EXECUTE format(
      'CREATE POLICY "admin_all_%1$s" ON %1$I FOR ALL TO authenticated USING (true) WITH CHECK (true);',
      t
    );
  END LOOP;
END $$;

-- ── anon: minimal public-page read surface ───────────────────
-- Marketing / public pages read batches + teachers.
DROP POLICY IF EXISTS "anon_read_batches" ON batches;
CREATE POLICY "anon_read_batches"  ON batches  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon_read_teachers" ON teachers;
CREATE POLICY "anon_read_teachers" ON teachers FOR SELECT TO anon USING (true);

-- Public exam links + realtime status watch need to read exams.
-- (exams carries no answer key; questions/answers are RPC-gated.)
DROP POLICY IF EXISTS "anon_read_exams" ON exams;
CREATE POLICY "anon_read_exams" ON exams FOR SELECT TO anon USING (true);

-- Public notice board: only site-wide ('all') published notices.
DROP POLICY IF EXISTS "anon_read_public_notices" ON notices;
CREATE POLICY "anon_read_public_notices"
  ON notices FOR SELECT TO anon
  USING (is_published = true AND target = 'all');

-- Branding load on app mount: allow anon to read all site_settings
-- rows EXCEPT the SMS credentials (moved server-side).
DROP POLICY IF EXISTS "anon_read_site_settings" ON site_settings;
CREATE POLICY "anon_read_site_settings"
  ON site_settings FOR SELECT TO anon
  USING (key NOT IN ('sms_api_key', 'sms_sender_id'));

-- Purge any SMS credentials that earlier builds persisted into
-- site_settings. The key now lives ONLY in the SMS_API_KEY server env
-- var (api/_sms-core.ts); nothing sensitive should remain in this table.
DELETE FROM site_settings WHERE key IN ('sms_api_key', 'sms_sender_id');

-- ── anon: minimal public-form insert surface ─────────────────
DROP POLICY IF EXISTS "anon_insert_admission_requests" ON admission_requests;
CREATE POLICY "anon_insert_admission_requests"
  ON admission_requests FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "anon_insert_contact_messages" ON contact_messages;
CREATE POLICY "anon_insert_contact_messages"
  ON contact_messages FOR INSERT TO anon WITH CHECK (true);

-- ── Everything else for anon is implicitly DENIED ────────────
-- students, fees, mcq_questions, mcq_submissions, sms_logs, and
-- batch-targeted notices have NO anon policy, so RLS blocks direct
-- anon access. The portal/exam SECURITY DEFINER RPCs (owner rights)
-- are the only path in, and each resolves identity from a token.
--
-- NOTE: verify the anon role has no leftover table GRANTs that would
-- bypass intent. RLS still applies even with GRANTs, but revoke the
-- broad ones for defence in depth:
REVOKE SELECT, INSERT, UPDATE, DELETE ON students        FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON fees            FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON sms_logs        FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON mcq_questions   FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON mcq_submissions FROM anon;
-- (keep anon SELECT on batches/teachers/exams/notices/site_settings and
--  INSERT on admission_requests/contact_messages — governed by policies above)
