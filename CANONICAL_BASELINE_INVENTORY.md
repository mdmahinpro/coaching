# Canonical Baseline Inventory

**Batch:** Phase 4 / Batch B1
**Status:** Not ready for clean installation
**Reason:** foundational business table definitions are not present in repository SQL, Git history, or generated database types.

## Evidence sources inspected

- `supabase/migrations/*.sql`
- legacy `migration.sql`
- `supabase/migrations/20250818000003_core_rls.sql`
- portal/exam/payment/security migrations
- frontend Supabase queries/RPC calls
- Git history search for foundational `CREATE TABLE` statements
- generated database type search
- `scripts/provision-customer.mjs`
- `CUSTOMER_PROVISIONING_CONTRACT.md`

## Proven table definitions

These tables have explicit `CREATE TABLE` definitions in repository SQL:

- `student_sessions` — token primary key, student FK, expiry/last_seen.
- `exam_tokens` — token primary key, exam/student FKs, expiry.
- `login_attempts` — rate-limit records.
- `mcq_questions`.
- `mcq_submissions`.
- `site_settings`.
- `fee_audit_logs`.
- `payment_approvals`.
- `notice_reads`.
- `admin_users`.
- `feedback`.
- `email_logs`.
- `provider_secrets`.
- `backups` through `automated_backups.sql`.
- `database_keepalive` through `keep_alive_cron.sql`.

## Missing foundational definitions

No authoritative clean `CREATE TABLE` definitions were found in the repository or Git history for:

- `students`
- `teachers`
- `batches`
- `fees`
- `exams`
- `notices`
- `admission_requests`
- `contact_messages`

The legacy `migration.sql` only alters these tables and assumes they already exist. It also installs permissive policies such as `USING (true)`, so it cannot be copied into a hardened clean baseline.

## Definitions that cannot be safely guessed

The following must be recovered from an authorized schema-only export or an approved historical source before creating `canonical.sql`:

- Foundational primary keys/defaults.
- Exact column types/nullability/defaults for all business tables.
- Existing unique constraints/indexes.
- Existing foreign keys and `ON DELETE` behavior.
- Existing check constraints, especially fees/status/exam fields.
- Original storage bucket names and object policies.
- `contact_messages` exact shape.
- Existing `exams`/`notices`/`admission_requests` columns not declared in later ALTER files.
- Any triggers/functions owned by the initial schema.

## Proven policy intent

From the hardened RLS migrations:

- Public: published public content/settings where explicitly intended.
- Public insert: admission requests/contact messages where explicitly intended.
- Student: token-scoped RPC access; no direct private table access should be assumed.
- Admin: `is_admin()`-gated administrative reads/writes.
- Provider secrets: admin-only RLS; server-only consumption.
- Backups: admin-only access.
- Sessions/tokens: no public table reads; token RPCs only.

The exact final policy set still requires a clean schema baseline because policies cannot be safely created against unknown columns/constraints.

## Storage/Auth/jobs requirements

### Auth

- Supabase Auth users.
- `admin_users` roster linked to Auth user IDs.
- First admin invitation/activation must be performed through a secure control-plane operation.
- No default password may be embedded in provisioning.

### Storage

- `avatars` bucket is used by source code for logo/profile/teacher/student/feedback images.
- Exact bucket creation/public/private mode and storage policies are not defined in a canonical provisioning migration in this repository.
- This is a clean-install blocker until an authorized schema/storage inventory is supplied.

### Scheduled jobs

- `daily-automated-backup` uses pg_cron.
- `daily-heartbeat` uses pg_cron.
- Cron extension/job ownership and idempotent job replacement must be verified in the assigned project.

## Canonical baseline decision

Do not create `supabase/schema/canonical.sql` from frontend usage or the legacy ALTER-only file. The next required evidence is one of:

1. An authorized schema-only `pg_dump --schema-only --no-owner --no-privileges` from the current approved source project, reviewed for RLS/policy hardening; or
2. An approved historical schema migration from the original project owner containing the foundational tables and storage definitions.

No customer rows, credentials, or secrets are required for that evidence.
