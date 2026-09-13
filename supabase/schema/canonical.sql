-- Canonical fresh-install baseline, recovered from the authorized source
-- project flbvusudwszxdylxevfe on 2026-09-08.
-- This file contains application tables only. Supabase Auth/storage internals,
-- customer rows, secrets, and source-project policies are intentionally absent.
-- Follow-on migrations create support tables, RPCs, hardened policies, and
-- storage configuration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  subject TEXT,
  qualification TEXT,
  salary NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  bio TEXT,
  is_active BOOLEAN DEFAULT true,
  photo_url TEXT
);

CREATE TABLE public.batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT,
  schedule TEXT,
  capacity INTEGER DEFAULT 30,
  enrolled INTEGER DEFAULT 0,
  fee NUMERIC DEFAULT 0,
  teacher TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  teacher_id UUID REFERENCES public.teachers(id),
  class_level TEXT,
  schedule_days TEXT[],
  start_time TEXT,
  monthly_fee INTEGER,
  max_seats INTEGER,
  description TEXT,
  code TEXT,
  end_time TEXT
);

CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  gender TEXT CHECK (gender IN ('male', 'female', 'other')),
  guardian_name TEXT,
  guardian_phone TEXT,
  date_of_birth DATE,
  batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  student_id TEXT UNIQUE,
  class_level TEXT,
  status TEXT DEFAULT 'active',
  is_approved BOOLEAN DEFAULT false,
  password TEXT,
  photo_url TEXT,
  suspension_reason TEXT
);

CREATE TABLE public.fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 0,
  month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'waived')),
  payment_date TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  batch_id UUID REFERENCES public.batches(id),
  due_date DATE
);

CREATE TABLE public.exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  subject TEXT,
  batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
  exam_date DATE,
  duration_minutes INTEGER,
  total_marks INTEGER,
  pass_marks INTEGER,
  type TEXT,
  instructions TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'upcoming',
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  timer_enabled BOOLEAN DEFAULT true,
  paused_remaining_seconds INTEGER,
  batch_ids UUID[],
  strict_mode BOOLEAN DEFAULT false
);

CREATE TABLE public.notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT,
  category TEXT DEFAULT 'general',
  is_pinned BOOLEAN DEFAULT false,
  is_published BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  type TEXT,
  target TEXT DEFAULT 'all',
  batch_id UUID REFERENCES public.batches(id)
);

CREATE TABLE public.admission_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
  address TEXT,
  message TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT now(),
  class_level TEXT,
  note TEXT,
  gender TEXT,
  reference_no TEXT
);

CREATE TABLE public.contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- sms_logs: outgoing SMS delivery log.
-- NOTE: This definition is reconstructed from the application usage sites
-- (src/lib/sms.ts, src/pages/admin/SMSPage.tsx, src/components/admin/
-- StudentDrawer.tsx) because the read-only catalog recovery that produced the
-- rest of canonical.sql omitted it, and no migration defines it. The table is
-- required as a first-class core table by 20250818000003_core_rls.sql and by the
-- included backup migrations. Columns below are exactly those the application
-- inserts, filters, orders, and lists; constraints follow the same defensive
-- convention as the other baseline tables. Confirm against the source project
-- catalog before applying to a production baseline.
CREATE TABLE public.sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'custom',
  status TEXT NOT NULL DEFAULT 'failed' CHECK (status IN ('sent', 'failed', 'pending')),
  response JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX sms_logs_phone_created_at_idx ON public.sms_logs (phone, created_at DESC);
