# Source Schema Evidence

**Source project:** `flbvusudwszxdylxevfe`  
**Inspection date:** 2026-09-08  
**Method:** read-only `information_schema` and `pg_catalog` queries through a CLI-issued temporary database role. No business rows, Auth users, hashes, tokens, provider values, storage objects, or files were exported.

## Foundational Objects

The source catalog verified these tables and columns:

- `students`: `id uuid default gen_random_uuid()`, `name text not null`, `email text`, `phone text`, `gender text`, `guardian_name text`, `guardian_phone text`, `date_of_birth date`, `batch_id uuid`, `address text`, `created_at timestamptz default now()`, `student_id text`, `class_level text`, `status text default 'active'`, `is_approved boolean default false`, `password text`, `photo_url text`, `suspension_reason text`.
- `teachers`: `id uuid default gen_random_uuid()`, `name text not null`, `email text`, `phone text`, `subject text`, `qualification text`, `salary numeric`, `created_at timestamptz default now()`, `bio text`, `is_active boolean default true`, `photo_url text`.
- `batches`: `id uuid default gen_random_uuid()`, `name text not null`, `subject text`, `schedule text`, `capacity integer default 30`, `enrolled integer default 0`, `fee numeric default 0`, `teacher text`, `is_active boolean default true`, `created_at timestamptz default now()`, `teacher_id uuid`, `class_level text`, `schedule_days text[]`, `start_time text`, `monthly_fee integer`, `max_seats integer`, `description text`, `code text`, `end_time text`.
- `fees`: `id uuid default gen_random_uuid()`, `student_id uuid`, `amount numeric not null default 0`, `month text not null`, `status text not null default 'pending'`, `payment_date timestamptz`, `note text`, `created_at timestamptz default now()`, `batch_id uuid`, `due_date date`.
- `exams`: `id uuid default gen_random_uuid()`, `title text not null`, `subject text`, `batch_id uuid`, `exam_date date`, `duration_minutes integer`, `total_marks integer`, `pass_marks integer`, `type text`, `instructions text`, `created_at timestamptz default now()`, `status text default 'upcoming'`, `start_time timestamptz`, `end_time timestamptz`, `timer_enabled boolean default true`, `paused_remaining_seconds integer`, `batch_ids uuid[]`, `strict_mode boolean default false`.
- `notices`: `id uuid default gen_random_uuid()`, `title text not null`, `content text`, `category text default 'general'`, `is_pinned boolean default false`, `is_published boolean default true`, `created_at timestamptz default now()`, `type text`, `target text default 'all'`, `batch_id uuid`.
- `admission_requests`: `id uuid default gen_random_uuid()`, `name text not null`, `email text`, `phone text`, `guardian_name text`, `guardian_phone text`, `batch_id uuid`, `address text`, `message text`, `status text default 'pending'`, `created_at timestamptz default now()`, `class_level text`, `note text`, `gender text`, `reference_no text`.
- `contact_messages`: `id uuid default gen_random_uuid()`, `name text not null`, `email text`, `phone text`, `message text`, `created_at timestamptz default now()`.

## Constraints and Indexes

The source catalog verified primary keys on all eight tables, unique `students.student_id`, foreign keys from batches to teachers, students/fees/exams/notices/admissions to batches, fees to students, and checks on student gender, fee status, and admission status. The baseline reproduces those constraints with hardened checks and no source data.

## Security Reconciliation

The source policy inventory contained broad/public policies on several business tables and is not copied into the baseline. Hardened token-scoped RPC policies and S1 session-only exam/avatar changes remain follow-on security work. Supabase-managed Auth and Storage schemas are not recreated by `canonical.sql`.

Observed source policy hazards included public/anon direct reads on students, fees,
exams, notices, teachers, and batches; unrestricted MCQ question reads and submission
insert/update; and anonymous avatar insert/update policies. These are source evidence only
and are explicitly excluded from the reviewed fresh-install security state.

## Storage

The source role could inspect `storage.objects` policies but lacked permission to inspect
`storage.buckets`. Observed source policies included an `avatars` public-read policy and
anonymous/authenticated bucket-wide writes. Bucket mode, size limit, and MIME list remain
an operational setup decision and are not copied into the baseline. The destination must
use the S1 server upload path and no anonymous avatar write policies.

## Dump limitation

The supported CLI dump generated a temporary connection but `pg_dump` could not acquire `ACCESS SHARE` locks for the dump role. Catalog metadata queries succeeded and were used instead. Trigger inventory was empty for the inspected public application tables; functions/policies remain represented by migration review and are not treated as a complete portable dump.
