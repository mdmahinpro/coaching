# Remediation Report

**Date:** 2026-09-05
**Application:** Techely Learning Center / Coaching Center
**Customer model:** one separate Supabase project/database per educational institution
**Reference:** `FULL_APPLICATION_AUDIT.md`, `FINAL_PRODUCTION_AUDIT.md`, Fresh Realtime Admin Credential Audit Appendix

## Current decision

The application has a strong single-institute feature baseline. It is not yet cleared as a repeatable SaaS provisioning blueprint.

This report records what was actually fixed/verified and what remains open. It does not replace the full audit; it tracks remediation.

## Batch S1 — student security and exam-integrity remediation (2026-09-07)

### Release identity and environment reconciliation

- The Student Audit Report was run against repository commit `3df7c31b41192172476e7869071316347e1ec764` on branch `fix/portal-rpc-verification`, using local `http://127.0.0.1:5173` and the local Vite server. Its browser scripts timed out on `networkidle2` in that run before authenticated assertions; it is not evidence for the later dirty worktree.
- The current worktree is dirty and includes later uncommitted source, migration, test, and documentation files. The current release report records `143 tests / 85 warnings`; the earlier Student Audit Report recorded `139 tests / 50 warnings`; the older `FULL_APPLICATION_AUDIT.md` records `139 tests / 81 warnings` and incomplete session revalidation. These are revision/environment-labelled evidence, not interchangeable totals.
- No staging or production Supabase project is explicitly assigned. No remote query, migration, token invalidation, deployment, or customer-database write was performed in Batch S1. Historical provisioning artifacts contain a redacted URL, but it is not an assigned target and was not queried.
- The migration runner dry-run includes the new S1 migration, but clean provisioning remains blocked because `supabase/schema/canonical.sql` is absent.

### Confirmed findings and source fixes

1. **Confirmed:** the tracked final exam migration chain still exposed `exam_join(uuid,text,text)` with a Student ID branch. `src/lib/examApi.ts` and `src/pages/ExamPage.tsx` now use portal-session-only entry and no longer expose the Student ID verification form.
2. **Confirmed:** the tracked storage migration allowed anonymous bucket-wide avatar INSERT/UPDATE. Browser direct storage upload was replaced by `/api/upload-avatar` and the Netlify equivalent. The server validates the opaque session through `portal_get_profile`, validates image type/signature/size, and writes only the resolved student's object path.
3. **Unconfirmed:** effective remote function overloads, storage policies, old-token usability, legitimate exam entry, avatar replacement, and cross-student negative behavior require an explicitly assigned disposable/staging database. They were not tested against real students or a substitute project.
4. **Correction to the previous Student Audit Report:** its autosave-key finding is not confirmed by current source. `ExamJoinResult.student_id` is the UUID used by both `ExamPage.tsx` autosave paths; `student_code` is the public code. No autosave code change was made for that item.

### Forward migration and containment

- Added `supabase/migrations/20250907000001_exam_session_only_and_avatar_storage.sql`.
- It drops the old three-argument `exam_join` overload, creates the two-argument portal-session version, preserves anon execution for the opaque-session RPC, and drops anonymous avatar write policies.
- Existing exam tokens minted through the old path may remain valid until expiry. Before any deployment, perform an approved maintenance review and either wait six hours for expiry or explicitly invalidate only affected exam tokens. No tokens or submissions were deleted in this batch.
- If vulnerable functionality is publicly deployed, the urgent containment option is to disable exam entry and avatar writes at the server boundary until the migration and endpoint are verified. Deployment was not performed here.

### S1 status

Source-only: **FIXED-SOURCE**, not staging-verified and not deployed. Production student access remains blocked.

## Batch S2 — exam recovery and reliable authenticated testing (2026-09-07)

### Source changes

- Added `src/lib/examRecovery.ts` and focused tests. Drafts use a versioned key containing the exam UUID and student UUID, are filtered to current question IDs and `A/B/C/D` values, expire after 24 hours, and are cleared on malformed data, submit, logout, and account login.
- `ExamPage.tsx` now saves on answer selection, interval, and unload; timer/grading remain server-authoritative. The join result contract documents `student_id` as the database UUID and `student_code` as display identity.
- Dashboard unread notices now use the same server `fetchNoticeReads()` source as the notices page. Portal effects use stable identity/token/batch dependencies.
- Profile/logout controls now have accessible names.
- Added `e2e/readiness.cjs` and converted `student.browser.cjs` plus the beginning of `combined-prod-go.browser.cjs` from `networkidle2` to `domcontentloaded` plus path/marker/control readiness. Both harnesses explicitly refuse `.env.local` or any shared database unless `E2E_DISPOSABLE_SUPABASE_URL` and `E2E_DISPOSABLE_SUPABASE_ANON_KEY` are set.

### Verification

- `pnpm typecheck`: PASS.
- Focused S2/S1 tests: PASS, 4 files / 15 tests.
- `node e2e/student.browser.cjs`: BLOCKED as intended because no disposable Supabase credentials were supplied.
- `node e2e/combined-prod-go.browser.cjs`: BLOCKED as intended for the same reason.
- No authenticated browser workflow was counted as passed. Reload recovery, timer expiry, duplicate/concurrent submit, server grading, PDF, fees, profile, password/photo, notices, session expiry, and logout remain unverified against a real disposable database.
- Historical scripts still containing `networkidle2` were not run or treated as proof. Full harness conversion remains R-039.
- The converted harnesses also compare the browser bundle's configured Supabase URL with the explicit disposable target before seeding, preventing a disposable seed/client from being paired with a shared `.env.local` browser backend.

### S2 status

Source-only: **PARTIALLY FIXED-SOURCE**, not disposable/staging-verified and not deployed. Remaining release blockers are an explicitly assigned disposable Supabase project, full deterministic harness conversion, and authenticated negative/positive workflow evidence.

### S2 disposable-project verification update (2026-09-07)

- Assigned target used: `hjzwbicauyxffrmdhvgy.supabase.co` from the owner-supplied URL. The key was passed only through the process environment and was not printed.
- Read-only PostgREST probes returned `404` for the required application tables (`students`, `student_sessions`, `exams`, `mcq_questions`, `mcq_submissions`, `batches`, `fees`, `notices`, `notice_reads`) and `404` for the required RPCs (`portal_validate_session`, `exam_join`, `exam_get_questions`, `exam_submit`, `exam_get_review`, `exam_get_leaderboard`, `portal_get_exams`, `portal_get_fees`, `portal_get_notice_reads`).
- `node e2e/phase3-exam-edge.browser.cjs` stopped before seeding with `Invalid login credentials`; no disposable rows were created by this attempt.
- This is a **database provisioning/authentication blocker**, not a pass or a product workflow failure. No migration was applied, no remote write was attempted, and no alternate project was queried.
- Required next action: provision the approved disposable schema through the owner-controlled migration process and provide a disposable admin/Auth credential or approved non-privileged synthetic setup path. The supplied anon key cannot apply migrations or create the required admin identity.

### Authorized setup preflight (2026-09-07)

- Target identity supplied: `hjzwbicauyxffrmdhvgy`; public URL matched that reference.
- Catalog access through the supplied anon key was not available: required tables/RPCs were absent from PostgREST, and no privileged catalog connection was configured locally.
- `supabase projects list` showed only the unrelated linked project `flbvusudwszxdylxevfe`; the CLI is not linked/authenticated to `hjzwbicauyxffrmdhvgy`.
- `scripts/apply-migrations.bat` is hard-coded to the unrelated `flbvusudwszxdylxevfe` pooler and was not run.
- `psql` is available at `C:\Users\mdmah\pg17tools\pgsql\bin\psql.exe`, but no authorized disposable database connection/password was configured. No secret was requested or printed.
- `supabase/schema/canonical.sql` remains absent. `scripts/provision-customer.mjs` dry-run generated the ordered migration checksum manifest and correctly stopped on the missing canonical baseline.
- Local checks after preflight: TypeScript PASS; setup/S2 safety tests PASS, 4 files / 12 tests; diff check PASS.

**Stop condition:** no safe installation path exists in this workspace. The exact required setup is either (a) an authorized schema-only dump/foundational DDL for the disposable project plus a reviewed canonical baseline, followed by a secure Postgres connection configured locally, or (b) an owner-executed reviewed SQL setup bundle in the Supabase SQL Editor. Do not use the anon key, the unrelated pooler, `migration.sql`, or `update_rls_policies.sql` for installation.

### Foundational definition recovery (2026-09-07)

Search scope included current repository SQL, `migration.sql`, all local Git branches/tags/remotes, local worktrees, Git history filenames/content, provisioning/setup documentation, generated database-type candidates, E2E SQL, and provisioning reports.

Recovered authoritative repository DDL:

- `student_sessions`, `exam_tokens`, `login_attempts`, `mcq_questions`, `mcq_submissions`, `site_settings`, `fee_audit_logs`, `payment_approvals`, `notice_reads`, `admin_users`, `feedback`, `email_logs`, `provider_secrets`, `backups`, and `database_keepalive`.
- These are secondary/security/supporting objects and do not establish the foundational business schema.

Missing authoritative definitions:

- `students`
- `teachers`
- `batches`
- `fees`
- `exams`
- `notices`
- `admission_requests`
- `contact_messages`

Still unresolved and unsafe to guess: foundational columns/types/nullability/defaults, keys and indexes, foreign-key delete behavior, checks, original triggers/functions, contact-message shape, non-migration columns on exams/notices/admissions, and storage bucket mode/policies. `migration.sql` is ALTER-only and contains permissive policy assumptions; it is not a baseline.

### Parameterized runner

- Added `scripts/migrate-disposable.mjs` and `scripts/migrate-disposable.test.mjs`.
- It requires `TARGET_PROJECT_REF` and `TARGET_DATABASE_PROJECT_REF` to equal `hjzwbicauyxffrmdhvgy`, defaults to preflight-only, requires `MIGRATION_APPLY=1` for writes, requires a separately configured `TARGET_DATABASE_URL`, never prints credentials, and has no fallback to the unrelated project.
- It was not executed in apply mode. It currently fails closed because `supabase/schema/canonical.sql` is absent.

**Baseline status:** not ready for review as an installable baseline. A working-database schema source is required. No browser tests or remote installation were attempted in this batch.

### Working schema source recovered (2026-09-08)

- Authorized read-only source: `flbvusudwszxdylxevfe`.
- Source identity verified through the Supabase CLI-linked project and PostgreSQL catalog metadata (`current_database=postgres`, temporary CLI inspection role, PostgreSQL 17.6).
- No source rows, Auth users, password hashes, sessions, exam tokens, provider values, storage objects, or customer files were exported.
- The supported `supabase db dump --linked --schema public` path could not complete because its temporary role lacked table-lock permission. Read-only `information_schema`/`pg_catalog` queries succeeded and recovered columns, defaults, keys, foreign keys, checks, indexes, and policy metadata. The source role could not inspect `storage.buckets`; storage policy evidence is recorded separately.
- Added `supabase/schema/canonical.sql` with the eight recovered application tables only. It intentionally excludes source broad/public policies, Supabase-managed Auth/Storage internals, rows, secrets, and support RPCs.
- Added `supabase/schema/migration-manifest.json`, separating baseline-represented historical changes from 26 explicit follow-ons. S1 remains an explicit final follow-on.
- Added `docs/source-schema-evidence.md` with source identity, recovered definitions, security differences, dump limitation, and storage ambiguity.

**Baseline status:** ready for review as a source-derived fresh-install baseline, not yet remotely applied. Storage bucket mode/limits/MIME policy and initial settings remain explicit operational steps.

### Destination installation preflight update (2026-09-08)

- Destination-only installation was **not started**.
- The attempted destination CLI link did not establish a usable destination link; subsequent `supabase db dump --linked --dry-run` still produced connection metadata for source project `flbvusudwszxdylxevfe`.
- The Supabase management API returned an account-privilege error while retrieving destination project status. The source connection was not used for destination work.
- No destination catalog inspection, baseline write, follow-on migration, storage configuration, Auth admin creation, fixture creation, or test write occurred.
- Before installation, an authorized secure destination database connection is required whose parsed host/user identity can be verified as `hjzwbicauyxffrmdhvgy`, or the CLI profile must be granted access to that project and linked successfully.
- Preflight correction: the manifest now orders `20250830000001_exam_batch_backfill.sql` before `20250830000002_payment_approvals.sql`. S1 now removes `avatars_anon_upload`, `avatars_auth_insert`, and `avatars_auth_update` in addition to the previously handled policy names.

### R-045 connection evidence (owner-run, 2026-09-08)

- Project reference: `hjzwbicauyxffrmdhvgy`.
- Parsed login username: `postgres.hjzwbicauyxffrmdhvgy`.
- SQL `current_user`: `postgres`.
- SQL `session_user`: `postgres`.
- SQL `transaction_read_only`: `on`.
- Result: `authenticated-read-only`, writes performed: false.
- This evidence was produced in the owner's PowerShell process; this tool process did not inherit or inspect the secret connection variable and did not reconnect.

R-045 is resolved for connection access. The apply command remains owner-run only.

### Runner safety review (2026-09-08)

- Correctly distinguishes pooler login username from SQL roles.
- Uses `ssl: { rejectUnauthorized: true }`; the owner-provided `NODE_EXTRA_CA_CERTS` trusted CA is honored by Node TLS.
- Exact approved host, port, database, login username, project variables, and URL are required; no source fallback exists.
- Performs a read-only destination object preflight and stops on any existing application object before writes.
- Applies only `canonical.sql` and the manifest follow-ons; transaction wrappers are stripped so the runner owns one atomic transaction.
- Records `canonical-baseline` and each successful migration checksum; reports committed or rolled-back outcomes.
- Keeps private table grants revoked during the transaction and commits security changes atomically, preventing a partially visible permissive setup.
- Local runner tests: PASS, 4 tests; typecheck: PASS. No remote apply was performed by this tool process.

### Disposable install failure root cause (2026-09-08)

- The first approved apply produced `migration-rolled-back` because `relation "mcq_questions" does not exist`.
- Root cause: the 35-file manifest omitted the authoritative support-table definitions. `mcq_questions`, `mcq_submissions`, `site_settings`, and `fee_audit_logs` existed only in the legacy `migration.sql`, which is intentionally excluded from the reviewed install.
- The first dependent reference is `20250818000002_exam_rpcs.sql`, which defines exam token/submission functions over those tables.
- Added `supabase/migrations/20250817000000_support_tables.sql`, which creates all four authoritative tables without copying legacy permissive policies. It is inserted before `20250818000000_student_sessions.sql` and the exam RPCs.
- The later `fs.readFile(..., 'utf8')` argument in the runner is a separate loading concern, not the earlier SQL failure; the exact argument was corrected in `scripts/migrate-disposable.mjs`.
- Manifest count is now 36 and ordering was verified by direct file loading of `canonical.sql` plus every migration, and by an explicit dependency-order check.
- Transaction handling: `BEGIN READ ONLY` identity verification, then one outer transaction for baseline + all migrations + `provisioning_migrations` ledger records; embedded transaction wrappers are stripped, so no partial commit occurs. Any failure triggers a single rollback.
- Added `scripts/check-disposable-state.mjs` and its test as a genuine read-only destination-state check covering application objects, the migration ledger, and unexpected data.

Release candidate SHA-256 (short):

- `scripts/migrate-disposable.mjs`: `c5ba237e`
- `supabase/schema/canonical.sql`: `95fda814`
- `supabase/schema/migration-manifest.json`: `b491b66f`
- `supabase/migrations/20250817000000_support_tables.sql`: `da051335`

### S1 local regression results

- `pnpm typecheck`: PASS after the avatar server-body type correction.
- `pnpm test -- server/avatar-core.test.ts supabase/migrations/20250907000001_exam_session_only_and_avatar_storage.test.ts`: PASS, 2 files / 5 tests.
- Static source search: no remaining client Student ID verification handler or three-argument `joinExam` call.
- The disposable positive authorization matrix was **not run** because no disposable Supabase project was assigned. No privileged credential was used for authorization assertions.

## Reconciled current facts

- Later combined collaboration suite passed **19/19**. Treat that as current collaboration evidence.
- Admin focused suite passed **16/16**.
- Whole app route suite passed **29/29**.
- Homepage suite passed **12/12**.
- Admission product flow worked, including approval and student login. The 9/10 result is a stale toast assertion, not an approval failure.
- Standalone exam flow was blocked by fixed prerequisites; it was not proven broken and is not current proof that it works.
- `provider_secrets` exists in source and was present in the later live schema check, but provider rows are empty and earlier target checks showed migration drift. It must be applied/verified per customer.
- `/api/send-sms` returning 404 under plain Vite is an expected local limitation; deployed function behavior remains unverified.
- Backup creation and avatar backfill are writes. They must never be described as read-only probes.
- Current focused audit runs left disposable prefix rows in the live database. Do not hand that database to a school until reviewed cleanup is complete.

## Implemented source changes during remediation

### Batch A — Audit tracking and baseline

- Created `REMEDIATION_TRACKER.md` with all actionable findings, priorities, evidence, acceptance criteria, dependencies, and statuses.
- Created this `REMEDIATION_REPORT.md`.
- Preserved `FULL_APPLICATION_AUDIT.md` and appended fresh evidence there rather than replacing it.

### Batch B — Delete RPC result correctness

**Finding:** `admin_delete_student` could return `student_removed=true` for a nonexistent UUID because it computed `EXISTS(...)=false` rather than the actual DELETE row count.

**Fix:** `supabase/migrations/20250904000001_admin_safe_mutations.sql` now captures `FOUND` after `DELETE FROM students` and returns the actual result.

**Deployment status:** `FIXED-SOURCE`; reapply migration and run a targeted nonexistent-ID test in each customer DB.

### Batch C — Current lint/test accuracy

- Fixed the current `react/no-unescaped-entities` lint error in `SettingsPage.tsx`.
- Updated the admission E2E assertion to match the current safe approval message and
  the actual workflow: the reference appears in the drawer and is verified by the
  following student portal login.
- Admission browser suite now passes **10/10**.
- `pnpm run lint` now has **0 errors**; warning debt remains separately tracked.

### Batch D — Runtime-seeded student exam audit

- Reworked `e2e/student.browser.cjs` to seed a unique disposable batch, approved
  student, strict active exam, and questions at runtime using the local admin
  credential file internally.
- The script now cleans sessions, submissions, tokens, questions, exam, student,
  and batch in its cleanup path.
- Verified **9/9**: portal login, strict exam instructions, start, answer, submit,
  100% result, answer breakdown, dashboard return, portal results, and valid PDF.
- A background 401/error log was captured from a non-authorized request, but no
  assertion failed. This remains a session-expiry/error-observability hardening item.

### Batch E — Session/provider safety and atomic approval source

- Added `portal_validate_session(TEXT)` migration and portal initialization
  revalidation. Expired/revoked/suspended sessions clear persisted student state.
- Added HTTPS/private-address provider URL validation for server SMS/email fetches.
  This blocks HTTP, credentials-in-URL, and DNS-resolved private destinations.
- Removed the unsafe browser-side student-delete fallback: missing/failed
  transactional RPCs now fail closed instead of partially deleting dependents.
- Added `admin_approve_admission(UUID,TEXT,TEXT)` migration source with row locking,
  pending-status protection, duplicate detection, and one-transaction student,
  batch-counter, and admission-status writes. It remains source-only until the
  target database applies and verifies the migration, so the existing UI is not
  silently switched to an unavailable function.
- Replaced the payment approval function in `20250906000003_phase2_payment_audit_atomic.sql`:
  approval and fee locking are transactionally consistent, duplicate/already-paid
  approvals reject, and a failed required `fee_audit_logs` insert rolls the payment
  update back instead of being swallowed.

### Phase 2 verification

- `pnpm run typecheck`: PASS.
- `pnpm test`: PASS, 139/139.
- `pnpm run build`: PASS; circular vendor chunk warnings remain.
- `pnpm run lint`: PASS exit code, 0 errors; warning count is now 83 because the
  new safe-url implementation adds three `curly` warnings. These are style warnings,
  not suppressed errors, and remain tracked under R-018.
- Phase 2 migrations are source-only until the target database runs the updated
  migration runner. Admission UI remains on the existing path until the atomic RPC
  is applied and verified in the target environment.

### Existing verified source capabilities

These were implemented before this remediation pass and are recorded here because they affect release status:

- Admin/student collaboration harness: `e2e/combined-prod-go.browser.cjs`.
- Live smoke harness: `e2e/smoke-live.browser.cjs`.
- Backup coverage/restore migrations.
- Feedback/email/provider-secret migrations.
- Dynamic email recipients/templates.
- Provider settings UI.
- Teacher guide.
- Appearance/theme system.
- Map normalization.
- Dashboard approved-active data definition.
- Fee unassigned-student fallback removal.
- Result notice generator.

## Verification performed

### Current baseline from fresh run

| Command | Result |
|---|---|
| `pnpm run typecheck` | PASS |
| `pnpm test` | PASS, 139 tests |
| `pnpm run build` | PASS, circular vendor chunk warnings |
| `pnpm run lint` | FAIL: 1 error, 81 warnings |

The lint error is in `src/pages/admin/SettingsPage.tsx` and must be fixed before CI is considered green.

### Current browser runs

| Flow | Result |
|---|---|
| Admin CRUD/payment | 16/16 |
| Public/homepage | 12/12 |
| Whole app routes | 29/29 |
| Combined admin/student/payment/notice | 19/19 |
| Admission | 9/10 due stale toast assertion |
| Standalone student exam | blocked by fixed prerequisite |

## Blueprint blockers

### B-1 — Canonical provisioning does not exist

A new paid customer currently requires manual actions across Supabase, hosting, storage, Auth, migrations, settings, and provider keys. There is no one-command/idempotent provisioning system that produces an auditable result.

**Acceptance:** A disposable customer project can be created from an empty state; migrations, storage policies, settings, first admin, domain config, scheduled jobs, provider config schema, and smoke tests complete; a report is produced.

### B-2 — Migration path is ambiguous

The repo contains legacy `migration.sql` with permissive policies and a later hardened ordered migration chain. A customer operator must not be able to accidentally choose the permissive path.

**Acceptance:** One canonical migration bundle/runner exists; legacy unsafe migration is removed from normal onboarding; migration ledger and expected object checks fail closed.

### B-3 — Project configuration can be wrong

Separate Supabase projects reduce row cross-tenant risk, but wrong `VITE_SUPABASE_URL`, server secrets, storage bucket, cron target, or domain redirect can connect a customer deployment to the wrong project.

**Acceptance:** Startup/deployment health check verifies project reference, expected schema version, institute key, and domain; provider endpoints/secrets are bound to the same project.

### B-4 — Test data can leak into customer databases

Fresh audit runs left `ADM-E2E`/`ADM-COMBINED` rows. The audit harness does not yet guarantee zero residue in all scripts.

**Acceptance:** All E2E uses a dedicated disposable project or `finally` cleanup with verified zero prefixes. No production/shared live DB use.

### B-5 — Full exam evidence is not reproducible

The student exam harness depends on fixed IDs/account data.

**Acceptance:** It creates a disposable batch/student/exam/questions at runtime, runs the complete journey, and cleans every row/storage object.

### B-6 — Provider delivery is not verified

SMS/email source exists, but real deployed endpoint/provider behavior is not verified. Do not send real messages without explicit approval.

**Acceptance:** Staging provider/test recipient run returns expected provider response, logs status, redacts secrets, handles failure/retry, and enforces rate limits.

## Recommended implementation order

1. Fix the lint error and update stale admission assertion.
2. Fix audit cleanup/isolation; stop using customer/live DB as the default audit database.
3. Replace standalone exam fixture with runtime seed/cleanup.
4. Build canonical migration/provisioning command and object/version verifier.
5. Add project-binding health check and customer handover report.
6. Add negative security matrix against a clean DB.
7. Complete backup/restore DR and retention drill.
8. Verify deployed SMS/email in staging only with explicit approval.
9. Add customer control-plane/subscription lifecycle.
10. Run final clean-customer go-live audit.

## Explicit non-go items

Do not market the product as “automatically provisioned SaaS-ready” until B-1 through B-5 are closed. The product can be manually deployed to a single institute after environment/security/cleanup verification, but manual deployment is not the same as a repeatable subscription blueprint.

## Latest verification snapshot

- `pnpm run typecheck`: PASS.
- `pnpm test`: PASS, 139/139.
- `pnpm run build`: PASS; circular vendor chunks remain as warnings.
- `pnpm run lint`: PASS exit code, 0 errors, 81 warnings.
- `node e2e/admission.browser.cjs`: PASS, 10/10.
- `node e2e/student.browser.cjs`: PASS, 9/9 with runtime-seeded fixture.
- `node e2e/combined-prod-go.browser.cjs`: PASS, 19/19.

The runtime exam fixture is now blueprint-safe at the test level, but it still needs
the isolated disposable-project execution policy tracked by R-015 before it is run
against customer databases.

## Phase 4 provisioning implementation

Added:

- `scripts/provision-customer.mjs`
- `CUSTOMER_PROVISIONING_CONTRACT.md`
- `scripts/provision-customer.test.mjs`
- `provisioning-reports/` output path

The new entry point is dry-run by default and generates migration SHA-256 checksums,
redacted customer/run metadata, warnings, and blockers. Apply requires explicit
`PROVISION_APPLY=1`, `CUSTOMER_ID`, `CUSTOMER_NAME`, and `CUSTOMER_DATABASE_URL`.
It never selects `migration.sql` or `update_rls_policies.sql`.

### Phase 4 historical blocker

The dry-run previously blocked clean-customer apply because the repository did not
have `supabase/schema/canonical.sql`. That historical state is superseded by the
2026-09-08 source-schema recovery.

The current remaining blocker is destination installation/storage/Auth setup, not
source schema recovery.

### Phase 4 verification

- `CUSTOMER_ID`/`CUSTOMER_NAME` dry-run generated a redacted provisioning report.
- The report includes ordered migration filenames and SHA-256 checksums.
- Apply mode requires explicit `PROVISION_APPLY=1` plus an explicitly assigned
  `CUSTOMER_DATABASE_URL`.
- The canonical manifest excludes `migration.sql` and `update_rls_policies.sql`.
- The command fails closed when `supabase/schema/canonical.sql` is missing.
- Provisioning safety tests pass 2/2.
- No Supabase project, customer database, administrator, billing subscription,
  domain, or paid infrastructure was created.

### Source-schema recovery (2026-09-08)

- `supabase/schema/canonical.sql` exists with eight source-derived foundational
  application tables only.
- `supabase/schema/migration-manifest.json` lists 35 follow-on migrations.
- `docs/source-schema-evidence.md` records authorized read-only catalog evidence,
  recovered columns/constraints/indexes, policy hazards, and storage limitations.
- Source project: `flbvusudwszxdylxevfe`; intended disposable destination:
  `hjzwbicauyxffrmdhvgy`.
- A separate destination apply attempt rolled back because `mcq_questions` was not
  available when a follow-on migration referenced it. This is a fresh-install
  dependency/order blocker, not evidence that source recovery failed.
 - The manifest currently contains 36 follow-on migrations, including
  `20250817000000_support_tables.sql` before exam RPC migrations. The disposable
  runner now validates that dependency pair and the payment/support dependency pairs
   before any apply. It also fixes the follow-on file-read path used during execution.

The prior installation error is therefore separated into two findings:

1. **Earlier manifest/dependency omission:** the old 35-file path omitted
   `20250817000000_support_tables.sql`, so `mcq_questions` was unavailable to a
   dependent exam migration.
2. **Additional runner defect:** the local runner used an incorrect `fs.readFile`
   path argument. This was independent of the historical SQL error and is now fixed.

The current local manifest/file-load test loads `canonical.sql` plus all 36 files and
asserts that the support-table SQL contains `CREATE TABLE IF NOT EXISTS public.mcq_questions`.

## Batch B1 canonical baseline preparation (2026-09-06)

- Added `CANONICAL_BASELINE_INVENTORY.md`.
- Inspected migration DDL, RPCs, RLS, storage/Auth/job references, frontend queries,
  demo data, provisioning code, and Git history.
- Found no authoritative foundational `CREATE TABLE` definitions for students,
  teachers, batches, fees, exams, notices, admission_requests, or contact_messages.
- Confirmed `migration.sql` is ALTER-only against pre-existing tables and contains
  permissive `USING (true)` policies; it is not suitable as a clean baseline.
- Added four provisioning safety tests; all pass.
- Did not create a fake/empty canonical SQL file and did not apply remote SQL.

**B1 result: BLOCKED.** An authorized schema-only dump or approved historical
foundational schema source is required before `supabase/schema/canonical.sql` can be
created faithfully. This is a concrete schema-source blocker, not a generic request
for approval.

## Phase 3 coverage status

### Verified

- Runtime-created exam/student/batch/questions fixture.
- Strict active exam start.
- Correct answers and server result.
- Result breakdown and portal result listing.
- Result PDF bytes.
- Admission workflow 10/10.
- Combined collaboration 19/19.

### Phase 3 disposable edge-suite execution

Added `e2e/phase3-exam-edge.browser.cjs`. It refuses to run unless both
`E2E_DISPOSABLE_SUPABASE_URL` and `E2E_DISPOSABLE_SUPABASE_ANON_KEY` are explicitly
provided, preventing accidental writes to the current customer database. Running it
without those variables produced the expected `BLOCKED` result and touched no data.

The suite records these statuses explicitly:

- Invalid-token check: available when a disposable DB is configured.
- Duplicate/concurrent submit: blocked until the disposable database's exact
  `exam_join` token contract is verified.
- Timer expiry/strict penalty: blocked until the disposable exam token contract is verified.
- Pause/resume/import/recalculation: not covered by the current verified contract;
  no implementation claim is made.

### Still open, not silently marked complete

- Timer expiry with a controlled short-duration fixture.
- Duplicate submission and concurrent submit requests.
- Unauthorized exam token/question/submission access.
- Pause/resume behavior if supported by the product rules.
- Penalty/red-card behavior with controlled visibility events.
- Admin question import.
- Admin result recalculation.
- Full student/teacher/batch edit/suspend/reassignment lifecycle.
- Batch capacity race/concurrency.
- Notice CRUD, targeting, and unsafe-content assertions.
- Profile photo/password/email complete lifecycle.
- Reports totals, exports, filters, timezone boundaries.
- Upload MIME/content/storage authorization tests.
- Keyboard accessibility and long Bengali/English mobile content.

## Phase 5 operations/release verification

### A. Live audit residue

- Added `scripts/phase5-residue-manifest.cjs`.
- Latest run generated `provisioning-reports/phase5-residue-2026-09-06T13-28-26-028Z.json`.
- It found 21 candidate rows with exact IDs, marker fields, timestamps/status, and
  dependent counts where applicable.
- No deletion was performed. Prefix matching is not treated as owner approval.

### B. Deployed integrations

- `LIVE_URL` and `e2e/live-url.txt` are not configured.
- Deployed Auth redirects, serverless SMS/email routes, production secrets, and
  monitoring cannot be certified in this environment.
- No real SMS/email was sent.

### C. Recovery

- Read-only backup metadata query returned zero rows from `backups`.
- No backup payload was inspected and no restore was run.
- Business JSON export is not full Supabase Auth/storage/secrets disaster recovery.
- Retention, encryption, off-site storage, PITR, Auth recovery, and storage recovery
  remain unselected operational policies.

### D. Release verdicts

| Target | Verdict | Evidence/blockers |
|---|---|---|
| Single-institution staging | **AMBER** | Core checks pass; residue and zero-backup state require cleanup/setup |
| Single-institution production | **BLOCKED** | No deployed URL evidence, no backup snapshot, no deployed provider/Auth/monitoring verification |
| Automated customer provisioning | **BLOCKED** | Missing canonical baseline; dry-run correctly refuses apply; no project/control-plane/storage/Auth automation |

## Manual operator actions completed (2026-09-06)

- User confirmed all residue candidates were demo/testing data.
- Generated read-only manifest with 21 exact-ID candidates.
- Deleted only approved exact IDs in dependent-first order.
- Final old `ADM-E2E Batch` had a dependent test notice not surfaced by the first
  simple count; inspected that exact notice (`Result is working now.`), deleted the
  exact dependent notice, then deleted the exact batch.
- Final read-only manifest returned `candidate_count: 0`.
- No prefix-only delete was used.
- No real school records were deleted according to the user-provided ownership confirmation.

### Final Phase 5 checks

- Final residue manifest: `provisioning-reports/phase5-residue-2026-09-06T16-32-07-118Z.json`.
- Final candidate count: **0**.
- SMS module after clean Vite restart: HTTP 200; Admin → SMS rendered.
- `pnpm run typecheck`: PASS.
- `pnpm test -- scripts/provision-customer.test.mjs server/safe-url.test.ts`: PASS, 4/4.
- `pnpm run lint`: PASS exit code, 0 errors, 85 warnings.
- No deployed URL configured.
- Backup metadata rows: 0; recovery drill not run.

### Final release verdicts

| Target | Verdict | Reason |
|---|---|---|
| Single-institution staging | **AMBER** | Core product and cleanup are verified; deployed integration and backup evidence remain absent |
| Single-institution production | **BLOCKED** | No deployed smoke, no backup snapshot/recovery drill, no provider/Auth/monitoring verification |
| Automated customer provisioning | **BLOCKED** | Canonical clean schema baseline missing; provisioning CLI correctly fails closed |

Sentry is optional. It may remain disabled if the operator accepts hosting/Supabase
logs as the monitoring strategy; if enabled, one approved staging test event is required.

## Release candidate Section 2 checkpoint

Section 2 cannot start safely yet. The release plan requires an explicitly assigned
staging environment and hosting decisions, but none were supplied in this run.
No migration, deployment, DNS, paid resource, provider message, or live write was
performed. The exact required inputs are recorded in `RELEASE_READINESS.md`:

```text
staging_host/domain
staging_supabase_project_ref/url
hosting_provider: Vercel or Netlify
sms_launch: enabled/deferred
email_launch: enabled/deferred
```

## Batch A staging preparation (2026-09-06)

- Hosting decision recorded: **Netlify**.
- Staging domain decision recorded: use the Netlify host-assigned URL initially;
  no custom domain/DNS/prod deployment in this batch.
- SMS/email decision recorded: deferred for initial staging.
- Added Netlify routing for `/api/send-email`; existing `/api/send-sms` route remains.
- Documented public versus server-only staging variables in `RELEASE_READINESS.md`.
- Confirmed no staging project has been assigned yet.
- Confirmed canonical clean schema baseline is still missing; no legacy permissive
  SQL was used and no database writes were performed.
- Batch A is complete; Batch B is blocked pending dedicated staging project assignment,
  baseline approval, and explicit approval to create/deploy the staging resources.

## SMS dynamic-import incident

The browser error `Failed to fetch dynamically imported module: /src/pages/admin/SMSPage.tsx`
was reproduced as a stale/failed Vite HMR session. After restarting the local Vite
server, the module returned HTTP 200 and `/admin/sms` rendered successfully. No source
compile error existed in `SMSPage.tsx`; ESLint reported only three style warnings there.

## Sentry decision

Sentry is optional, not a functional release gate. The integration remains disabled
when `VITE_SENTRY_DSN` is empty. If no external monitoring service is desired, the
operator may leave it disabled and use hosting/Supabase logs plus the existing error
logger. If Sentry is enabled, verify one approved staging test event before production.
