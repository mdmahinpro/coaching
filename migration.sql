-- ============================================================
-- Techely Learning Academy — Full Schema Migration
-- Run this ONCE in Supabase → SQL Editor before using the app
-- ============================================================

-- ── students: add missing columns ────────────────────────────
ALTER TABLE students ADD COLUMN IF NOT EXISTS student_id   TEXT UNIQUE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS class_level  TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS status       TEXT DEFAULT 'active';
ALTER TABLE students ADD COLUMN IF NOT EXISTS is_approved  BOOLEAN DEFAULT false;
ALTER TABLE students ADD COLUMN IF NOT EXISTS password     TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url    TEXT;

-- ── teachers: add missing columns ────────────────────────────
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS bio       TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- ── batches: add missing columns ─────────────────────────────
ALTER TABLE batches ADD COLUMN IF NOT EXISTS teacher_id    UUID REFERENCES teachers(id);
ALTER TABLE batches ADD COLUMN IF NOT EXISTS class_level   TEXT;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS schedule_days TEXT[];
ALTER TABLE batches ADD COLUMN IF NOT EXISTS start_time    TEXT;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS monthly_fee   INTEGER;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS max_seats     INTEGER;
ALTER TABLE batches ADD COLUMN IF NOT EXISTS description   TEXT;

-- ── fees: add missing columns ────────────────────────────────
ALTER TABLE fees ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batches(id);
ALTER TABLE fees ADD COLUMN IF NOT EXISTS due_date  DATE;

-- ── exams: add missing columns ───────────────────────────────
ALTER TABLE exams ADD COLUMN IF NOT EXISTS status                   TEXT DEFAULT 'upcoming';
ALTER TABLE exams ADD COLUMN IF NOT EXISTS start_time               TIMESTAMPTZ;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS end_time                 TIMESTAMPTZ;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS timer_enabled            BOOLEAN DEFAULT true;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS paused_remaining_seconds INTEGER;

-- ── notices: add missing columns ─────────────────────────────
ALTER TABLE notices ADD COLUMN IF NOT EXISTS type     TEXT;
ALTER TABLE notices ADD COLUMN IF NOT EXISTS target   TEXT DEFAULT 'all';
ALTER TABLE notices ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batches(id);

-- ── mcq_questions table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcq_questions (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id        UUID REFERENCES exams(id) ON DELETE CASCADE,
  question_text  TEXT NOT NULL,
  option_a       TEXT NOT NULL,
  option_b       TEXT NOT NULL,
  option_c       TEXT NOT NULL,
  option_d       TEXT NOT NULL,
  correct_option TEXT NOT NULL CHECK (correct_option IN ('a','b','c','d')),
  marks          INTEGER DEFAULT 1,
  order_num      INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── mcq_submissions table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcq_submissions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id       UUID REFERENCES exams(id) ON DELETE CASCADE,
  student_id    UUID REFERENCES students(id) ON DELETE CASCADE,
  answers       JSONB DEFAULT '{}',
  score         INTEGER DEFAULT 0,
  correct_count INTEGER DEFAULT 0,
  wrong_count   INTEGER DEFAULT 0,
  time_taken    INTEGER DEFAULT 0,
  rank          INTEGER,
  submitted_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── site_settings table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_settings (
  id         SERIAL PRIMARY KEY,
  key        TEXT UNIQUE NOT NULL,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── admission_requests: add missing columns ──────────────────
ALTER TABLE admission_requests ADD COLUMN IF NOT EXISTS name          TEXT;
ALTER TABLE admission_requests ADD COLUMN IF NOT EXISTS phone         TEXT;
ALTER TABLE admission_requests ADD COLUMN IF NOT EXISTS guardian_name TEXT;
ALTER TABLE admission_requests ADD COLUMN IF NOT EXISTS class_level   TEXT;
ALTER TABLE admission_requests ADD COLUMN IF NOT EXISTS email         TEXT;
ALTER TABLE admission_requests ADD COLUMN IF NOT EXISTS batch_id      UUID REFERENCES batches(id);
ALTER TABLE admission_requests ADD COLUMN IF NOT EXISTS address       TEXT;
ALTER TABLE admission_requests ADD COLUMN IF NOT EXISTS status        TEXT DEFAULT 'pending';
ALTER TABLE admission_requests ADD COLUMN IF NOT EXISTS note          TEXT;

-- ── Enable Row Level Security + policies ─────────────────────
ALTER TABLE mcq_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcq_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings   ENABLE ROW LEVEL SECURITY;

-- Allow all reads (public data)
DROP POLICY IF EXISTS "Allow public read mcq_questions" ON mcq_questions;
  CREATE POLICY "Allow public read mcq_questions"
  ON mcq_questions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read mcq_submissions" ON mcq_submissions;
  CREATE POLICY "Allow public read mcq_submissions"
  ON mcq_submissions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read site_settings" ON site_settings;
  CREATE POLICY "Allow public read site_settings"
  ON site_settings FOR SELECT USING (true);

-- Allow authenticated (admin) full access
DROP POLICY IF EXISTS "Allow auth all mcq_questions" ON mcq_questions;
  CREATE POLICY "Allow auth all mcq_questions"
  ON mcq_questions FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow auth all mcq_submissions" ON mcq_submissions;
  CREATE POLICY "Allow auth all mcq_submissions"
  ON mcq_submissions FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow auth all site_settings" ON site_settings;
  CREATE POLICY "Allow auth all site_settings"
  ON site_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── fee_audit_logs: payment change history ───────────────────
CREATE TABLE IF NOT EXISTS fee_audit_logs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fee_id        UUID REFERENCES fees(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  admin_email   TEXT,
  student_name  TEXT,
  student_code  TEXT,
  month         TEXT,
  old_data      JSONB,
  new_data      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE fee_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow auth all fee_audit_logs" ON fee_audit_logs;
  CREATE POLICY "Allow auth all fee_audit_logs"
  ON fee_audit_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── fees: fix status CHECK constraint (include waived) ───────
-- Drop old constraint (only had pending/paid/overdue) and re-add with waived
ALTER TABLE fees DROP CONSTRAINT IF EXISTS fees_status_check;
ALTER TABLE fees ADD CONSTRAINT fees_status_check
  CHECK (status IN ('pending','paid','overdue','waived'));

-- ── students: remove blocking status CHECK (allow suspended) ─
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_status_check;

-- ── Done ─────────────────────────────────────────────────────
-- After running this migration, the full system will work including:
-- • Student portal login (students.password + is_approved)
-- • MCQ exams with live timer + pause/resume (paused_remaining_seconds)
-- • Exam result submissions and leaderboard
-- • Settings saved to database (site_settings)
-- • Fee payment audit log (fee_audit_logs)
-- • Fee waiver support (waived status in fees.status CHECK)
