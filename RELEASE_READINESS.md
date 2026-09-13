# Release Readiness

**Product:** Techely Learning Center / Coaching Center
**Assessment date:** 2026-09-06
**Current Git revision:** `3df7c31`
**Branch:** `fix/portal-rpc-verification`
**Working tree:** dirty; uncommitted remediation/source/docs/migration changes are present.
**Assigned staging Supabase project:** **Not assigned yet** (dedicated new project required).
**Assigned production Supabase project:** **Not provided in this run**.
**Hosting provider/domain:** **Netlify; host-assigned staging URL initially; no custom domain**.
**SMS/email launch requirement:** **Deferred for initial staging**.

**Batch A checkpoint (2026-09-06):** Preparation complete; deployment and database
application remain blocked pending assignment of the dedicated staging Supabase project.
No deployment, migration application, paid resource creation, DNS change, or live
provider test was performed.

## Batch S1 security gate (2026-09-07)

Student security and exam-integrity remediation is source-only. No production or
staging student access is approved.

### Identity reconciliation

- Student Audit Report revision: `3df7c31b41192172476e7869071316347e1ec764`, branch
  `fix/portal-rpc-verification`, local app URL `http://127.0.0.1:5173`.
- Current worktree: dirty, with uncommitted source/docs/migrations/tests. The report's
  `139 tests / 50 warnings` is earlier revision evidence. Current report evidence says
  `143 tests / 85 warnings`; `FULL_APPLICATION_AUDIT.md` records `139 / 81` and older
  session-revalidation state. None of these counts proves production authorization.
- Assigned Supabase project: none. Historical redacted provisioning URLs are not targets.
- Migration execution evidence: local dry-run/checksums only; no S1 migration was applied.

### S1 findings

- **Confirmed source defect fixed:** Student ID-only `exam_join` branch removed from the
  client contract and replaced by a forward session-only migration.
- **Confirmed source defect fixed:** anonymous bucket-wide avatar writes removed from the
  forward migration; upload moved behind a token-validated server endpoint.
- **Unconfirmed:** deployed overloads/policies, old-token invalidation, legitimate exam
  entry, avatar replacement, cross-student isolation, and duplicate/concurrent submission.

Local S1 regression result: `pnpm typecheck` PASS; focused S1 tests PASS (2 files / 5
tests). No disposable positive authorization matrix was run because no disposable
Supabase project was assigned.

### Release gate

The release remains **BLOCKED**. Required before any student access approval:

1. Assign a disposable/staging Supabase project and verify the final migration ledger,
   function signatures/grants, RLS/storage policies, and opaque-session behavior.
2. Run the disposable negative/positive S1 matrix without privileged credentials for the
   authorization assertions.
3. Review and approve the targeted old-exam-token invalidation or expiry plan.
4. Verify server-only `SUPABASE_SERVICE_ROLE_KEY` configuration for the avatar endpoint;
   never expose it through `VITE_` variables.

## Batch S2 exam recovery and authenticated-testing gate (2026-09-07)

### Source-only changes

- Exam drafts now use a versioned exam UUID + student UUID envelope, validate age,
  question IDs, and option values, and clear on account login, logout, successful submit,
  and malformed/stale state.
- Dashboard and notices use the same server-side notice-read receipts.
- Portal icon controls have accessible names and portal effect dependencies use stable
  session fields.
- Student and combined harnesses use deterministic DOM/path/control readiness and refuse
  to run without explicitly supplied disposable Supabase credentials.

### Evidence

- TypeScript: PASS.
- Focused S2/S1 tests: PASS, 4 files / 15 tests.
- Student browser harness: BLOCKED by missing disposable credentials, as required.
- Combined browser harness: BLOCKED by missing disposable credentials, as required.
- No authenticated workflow pass is claimed. Reload recovery, timer expiry,
  duplicate/concurrent submit, server grading/review/PDF, fees/approval, profile/photo/
  password, notices, session expiry, and logout remain unverified against an actual
  disposable database.

### Remaining release blockers

1. Assign an explicitly disposable Supabase project and provide its URL/public key through
   `E2E_DISPOSABLE_SUPABASE_URL` and `E2E_DISPOSABLE_SUPABASE_ANON_KEY`.
2. Verify the full migration chain, including S1, in that database before any writes.
3. Finish converting historical harnesses that still contain `networkidle2`; no such
   harness is acceptable as authenticated evidence.
4. Run positive and negative authenticated tests using non-privileged synthetic students,
   including reload recovery, timer/expiry, duplicate/concurrent submit, payment/profile/
   notices/logout, and token revocation.

S2 does not approve staging or production student access.

### S2 disposable target result (2026-09-07)

- Target: owner-supplied project reference `hjzwbicauyxffrmdhvgy`.
- Read-only probes found all required application tables and RPCs absent (`404`).
- Disposable exam edge harness stopped before seed/write because the available local
  admin credential was invalid for this project.
- No migration, remote write, alternate-project query, or production operation was
  performed. This target is not yet a runnable disposable application environment.
- S2 authenticated coverage remains **BLOCKED** pending schema provisioning and an
  approved disposable admin/synthetic setup credential. The anon key alone is not an
  authorized migration or admin-bootstrap mechanism.

### Authorized setup preflight result

- `supabase projects list` lists only the unrelated linked project `flbvusudwszxdylxevfe`;
  the CLI is not authenticated/linked to `hjzwbicauyxffrmdhvgy`.
- The existing `scripts/apply-migrations.bat` is hard-coded to the unrelated project and
  was not run.
- `psql` is installed locally, but no authorized disposable Postgres connection/password
  is configured.
- `supabase/schema/canonical.sql` is still missing. The provisioning dry-run generated
  the migration manifest/checksums and stopped safely.
- No installation, Auth admin creation, storage setup, fixture creation, or remote write
  was performed.

The next safe operation requires a secure connection to the authorized project and an
approved canonical schema source. Alternatively, the owner can execute a reviewed SQL
setup bundle directly in that project's Supabase SQL Editor. Do not use the anon key or
the unrelated linked project for setup.

### Foundational schema recovery result

- Repository/Git/worktree/history search recovered only secondary/security table DDL.
- No authoritative definitions were found for `students`, `teachers`, `batches`, `fees`,
  `exams`, `notices`, `admission_requests`, or `contact_messages`.
- Exact keys, defaults, constraints, triggers, foundational functions, and storage mode/
  policies remain unknown. Frontend queries and generated/application evidence are not
  sufficient to define them safely.
- Added `scripts/migrate-disposable.mjs`, a target-locked preflight-first runner. It was
  not executed in apply mode and refuses to continue while `canonical.sql` is missing.

The baseline is **not ready for review or installation**. No browser tests should be run
until an authorized working-project schema source is provided and the synthetic admin
setup is complete.

### Source schema recovery update (2026-09-08)

- Authorized source project `flbvusudwszxdylxevfe` was inspected read-only through the
  CLI-issued temporary database role. The disposable destination was not accessed.
- Catalog evidence recovered the eight foundational tables and their columns/defaults,
  primary keys, foreign keys, checks, and indexes. No business rows or secret-bearing
  values were exported.
- Added `supabase/schema/canonical.sql`, `supabase/schema/migration-manifest.json`, and
  `docs/source-schema-evidence.md`.
- The source policy inventory showed broad/public policies and anonymous avatar writes;
  those are not copied into the fresh baseline. S1 token/session and server-upload
  security changes remain explicit follow-ons.
- `storage.buckets` metadata was not readable by the source role. Bucket mode, limits,
  MIME restrictions, and final ownership policy remain explicit destination setup steps.
- `supabase db dump` itself was blocked by source-role table-lock permission, but catalog
  inspection succeeded. This is sufficient for the reviewed foundational DDL, not a claim
  of a complete portable source dump.

The baseline is now **ready for review**, not applied. The next authorized operation is a
destination-only preflight/apply review against `hjzwbicauyxffrmdhvgy`; no source writes
are permitted.

### Destination installation stop (2026-09-08)

Installation did not begin. The CLI remained linked to source project
`flbvusudwszxdylxevfe`; its `db dump --linked --dry-run` generated source connection
metadata after the attempted destination link. The management API also returned an
account-privilege error for destination status. No source connection was used for
destination work and no remote write occurred.

The destination install requires verified CLI access or a secure Postgres connection for
`hjzwbicauyxffrmdhvgy`. The target-locked runner now rejects connections whose exact
parsed host or pooler username does not identify that project.

### R-045 resolved connection evidence (owner-run)

The owner verified the destination in the configured PowerShell process without exposing
credentials:

- Project: `hjzwbicauyxffrmdhvgy`
- Login username: `postgres.hjzwbicauyxffrmdhvgy`
- `current_user`: `postgres`
- `session_user`: `postgres`
- `transaction_read_only`: `on`
- Result: authenticated read-only; writes performed: false

The runner was corrected to treat the pooler username and SQL role separately. It now
uses TLS certificate/hostname verification, performs an empty-object read-only preflight,
applies only the canonical baseline and manifest, strips embedded transaction wrappers so
one outer transaction controls installation, records checksums/outcomes, and fails closed
on errors. No remote apply has been performed by this tool process.

### Disposable install retry status

- The first attempt rolled back on a missing `mcq_questions` relation; the root cause was omitted support-table DDL, fixed by `20250817000000_support_tables.sql`.
- Manifest now has 36 migrations; direct loading of `canonical.sql` and every migration passes; the support-table migration is ordered before dependent exam functions.
- Transaction boundaries keep baseline, migrations, and ledger writes in one rollbackable transaction; embedded `BEGIN/COMMIT` are stripped.
- A read-only destination-state check (`scripts/check-disposable-state.mjs`) now inspects application objects, ledger versions/checksums, and unexpected data before retry. Run it before any apply and stop if unexpected state is reported.
- Corrected runner without secret-value exposure is ready to retry; this tool process did not reconnect.
- Release candidate SHAs: runner `c5ba237e`, canonical `95fda814`, manifest `b491b66f`, support tables `da051335`.

## Batch B1 canonical baseline result (historical, superseded by 2026-09-08 recovery)

### Completed preparation

- Inspected repository migrations, legacy schema SQL, Git history, frontend
  queries/RPC calls, storage usage, Auth/admin requirements, sessions, backups,
  cron jobs, and provisioning scripts.
- Added `CANONICAL_BASELINE_INVENTORY.md` with proven definitions, missing objects,
  policy intent, storage/Auth/jobs requirements, and exact evidence needed.
- Added four provisioning safety tests; all pass.
- Confirmed `scripts/provision-customer.mjs` remains dry-run by default and fails
  closed when the canonical baseline is missing.

### Historical exact blocker

At that time, no authoritative clean definitions were available for:

```text
students, teachers, batches, fees, exams, notices,
admission_requests, contact_messages
```

The legacy `migration.sql` only alters pre-existing tables and contains permissive
`USING (true)` policies. It is not safe to copy into a new canonical baseline.
No `supabase/schema/canonical.sql` was created in that earlier state because inventing
these definitions would have changed data meaning/authorization.

### B1 verdict

```text
Canonical baseline ready for disposable staging installation: NO / BLOCKED (2026-09-06)
```

That source evidence was subsequently obtained and is recorded in
`docs/source-schema-evidence.md`; the current baseline is ready for review but has
not been remotely applied.

### Current reconciliation (2026-09-08)

- The recovered baseline/evidence/manifest files are present in this same worktree,
  uncommitted; no alternate worktree or deletion/revert was found.
- The manifest contains **36** follow-on migrations, including
  `20250817000000_support_tables.sql` before dependent exam RPCs.
- The earlier `mcq_questions` failure is attributed to the prior installation path
  omitting that support migration. It is distinct from the later runner `fs.readFile`
  path bug, which is now fixed locally.
- New local manifest tests exercise canonical and all 36 follow-on file loads and
  assert the support-table dependency/order.

## Scope of this release candidate

This document covers Section 1 only: establish the current release candidate and
record the next safe batch. No deployment, migration application, paid resource
creation, DNS change, live provider message, or production write was performed in
this section.

## Current launch features

Source features currently enabled in the release candidate include:

- Public homepage, courses, admissions, notices, contact/map, and social links.
- Admin authentication, dashboard, students, batches, teachers, fees, exams/results,
  notices, admissions, SMS, reports, settings, and backups.
- Student portal login, dashboard, fees, exams, results, notices, and profile.
- Admin-to-student admission approval.
- Student-to-admin payment approval.
- Dynamic feedback/testimonials.
- SMS provider settings and single/bulk SMS UI.
- Email templates, dynamic recipient selection, and server email adapter.
- Runtime-seeded student exam E2E.
- Separate-project customer provisioning dry-run CLI, currently fail-closed.

## Current evidence

| Check | Current result | Evidence |
|---|---:|---|
| TypeScript | PASS | `pnpm run typecheck` |
| Unit tests | PASS, 143 tests | `pnpm test` |
| Production build | PASS | `pnpm run build`; circular vendor chunk warnings remain |
| Lint | PASS exit code, 0 errors, 85 warnings | `pnpm run lint` |
| Admission | PASS, 10/10 | `node e2e/admission.browser.cjs` |
| Runtime exam | PASS, 9/9 | `node e2e/student.browser.cjs` |
| Combined collaboration | PASS, 19/19 | `node e2e/combined-prod-go.browser.cjs` |
| Provider URL tests | PASS, 2/2 | `pnpm test -- server/safe-url.test.ts` |
| Provisioning safety tests | PASS, 2/2 | `pnpm test -- scripts/provision-customer.test.mjs` |
| Audit cleanup | PASS, 0 final candidates | Phase 5 residue manifest after owner-approved exact-ID cleanup |
| Deployed smoke | BLOCKED | No `LIVE_URL` or `e2e/live-url.txt` configured |
| Backup recovery | BLOCKED | Current `backups` metadata query returned zero rows; no restore drill |
| Clean customer provisioning | READY-FOR-REVIEW | Baseline, evidence, and 36-entry manifest exist; destination apply remains unverified |

Historical audit counts in older report sections are not current proof. The latest
results above are authoritative for this release candidate.

## Reconciled remediation state

### Fixed and verified

- Current Settings lint error fixed.
- Admission assertion updated; admission suite 10/10.
- Runtime-created student/exam fixture; exam suite 9/9.
- Portal session validation source added.
- Provider HTTPS/private-address/redirect protections source added.
- Student delete browser fallback now fails closed.
- Provider URL safety tests 2/2.
- Provisioning safety tests 2/2.
- Owner-approved exact-ID audit cleanup completed; final candidate count 0.

### Implemented but unverified in target deployment

- Phase 2 session validation migration.
- Atomic admission approval migration; current UI has not yet switched to it.
- Atomic payment approval/audit migration.
- Provider secrets migration and dashboard configuration.
- Feedback/email migrations and deployed email provider.
- Backup coverage/restore migrations.
- Serverless SMS/email runtime behavior.
- Storage policies/buckets and production Auth redirect configuration.

### Partially fixed

- Lint warnings remain at 85, including hook-dependency/compiler warnings.
- Build circular vendor chunk warnings remain.
- Backup coverage source exists, but no current backup snapshot/recovery evidence exists.
- Exam journey core passes, but advanced edge cases remain open.
- Test cleanup is improved for combined/runtime suites, but all focused suites still
  need isolated-project enforcement.

### Blocked

- Single-institution staging certification: no approved staging URL/project supplied.
- Single-institution production certification: no hosting/domain/project supplied.
- Automated customer provisioning: destination apply/verification and storage/Auth setup remain unverified.
- Two-customer isolation certification: no two disposable customer projects supplied.
- Real SMS/email sandbox/deployed integration verification: no approved runtime/recipients.
- Backup restore certification: no disposable recovery target/snapshot.

### Not started or still open

- External customer/project/subscription control plane.
- Canonical clean database schema.
- Automated Supabase project/storage/Auth/domain setup.
- RLS negative matrix against clean database.
- Full reports/export/timezone test matrix.
- Full upload/storage authorization matrix.
- Keyboard accessibility/axe matrix.
- Timer/duplicate/concurrent/pause/penalty/import/recalculation exam matrix.

## Blocking acceptance criteria

### Staging

- Named staging host and Supabase project supplied.
- `LIVE_URL` configured.
- All required migrations applied and version/checksum verified.
- Admin/student/Auth redirects verified.
- Deployed SMS/email routes tested with stubs/sandbox.
- Clean staging database has zero business/demo data before seed.
- Full browser suites run against staging and clean up.

### Single-institution production

- Staging gates complete.
- Production Supabase project and domain explicitly assigned.
- Deployment variables verified; no privileged browser secrets.
- Provider launch decision recorded: enabled or explicitly deferred.
- Backup snapshot exists and disposable restore drill passes.
- Recovery contacts and handover instructions recorded.
- Final production approval obtained before DNS/data/onboarding.

### Automated provisioning

- `supabase/schema/canonical.sql` approved and present.
- Canonical migration baseline plus incremental manifest works from empty DB.
- Storage/Auth/RLS/RPC/grants verification passes.
- First-admin setup is secure and idempotent.
- Project/domain/secret binding prevents wrong-project deployment.
- Two disposable customer projects pass isolation and clean-handover checks.

## Unresolved launch decisions required from owner

1. Hosting provider: Vercel or Netlify?
2. Intended staging URL/domain?
3. Intended production URL/domain?
4. Which Supabase project is staging?
5. Which Supabase project is production?
6. Must SMS be enabled at launch, or explicitly deferred?
7. Must email be enabled at launch, or explicitly deferred?
8. If enabled, which provider/sandbox is approved?
9. Which region should new customer Supabase projects use?
10. Which secret storage/control-plane approach is approved?
11. Is subscription activation initially manual, or should billing integration be built now?

No secrets are requested in chat.

## Exact next batch

**Next batch: approve the target staging environment, then apply and verify migrations there.**

Required owner inputs:

```text
staging_host/domain
staging_supabase_project_ref/url
hosting_provider: Vercel or Netlify
sms_launch: enabled/deferred
email_launch: enabled/deferred
```

After those decisions, the next implementation batch will:

1. Apply the canonical/approved migration path to staging only.
2. Verify schema, RPCs, grants, RLS, storage, provider secrets, and Auth redirects.
3. Wire the admin admission UI to the atomic approval RPC after verification.
4. Run the complete staging browser/release matrix.
5. Stop before production deployment and request final production approval.

## Batch A preparation completed (2026-09-06)

### Netlify local preparation

- Existing `netlify.toml` is configured for `pnpm run build`, `dist`, and
  `netlify/functions` with Node 24.15.0 / pnpm 11.10.0.
- SPA catch-all route exists.
- `/api/send-sms` route exists.
- Added the missing `/api/send-email` route to the Netlify function.
- Staging SMS/email delivery remains disabled by decision; no provider values
  are required for the first staging deployment.

### Staging variables

Public build variables (browser-safe):

```text
VITE_SUPABASE_URL              # assigned staging project URL
VITE_SUPABASE_ANON_KEY         # staging anon/publishable key only
VITE_SITE_URL                  # Netlify host-assigned staging URL
VITE_SENTRY_DSN                # optional; may remain empty
```

Server-only variables (Netlify function environment; not VITE-prefixed):

```text
SUPABASE_URL                   # same staging project URL
SUPABASE_ANON_KEY              # same staging anon/publishable key
SMS_API_KEY                    # omit while SMS is deferred
SMS_SENDER_ID                  # omit while SMS is deferred
EMAIL_API_KEY                  # omit while email is deferred
EMAIL_FROM                     # omit while email is deferred
EMAIL_PROVIDER                 # optional, omit while email is deferred
EMAIL_ENDPOINT                 # optional, omit while email is deferred
```

### Exact setup actions awaiting approval/project assignment

1. Create a dedicated Supabase staging project through the Supabase dashboard.
2. Choose the project region deliberately; region affects latency, data location,
   and any paid-plan cost. No region was selected by this batch.
3. Do not create production projects, custom domains, DNS records, billing plans,
   or provider accounts in this batch.
4. Assign the new staging project URL/reference to this release record.
5. Create/import the staging Netlify site from the repository and use the host-assigned
   Netlify URL. Netlify hosting plan/cost is governed by the selected account plan;
   no paid resource was created or priced here.
6. Set only the public staging variables above initially. Keep SMS/email server values
   unset because launch delivery is deferred.
7. Before any SQL write, resolve the canonical baseline blocker:
   `supabase/schema/canonical.sql` is still missing. Do not run legacy `migration.sql`
   or permissive `update_rls_policies.sql` as a substitute.

### Batch A stop condition

Batch B may begin only after the dedicated staging Supabase project is assigned and
the canonical schema baseline is reviewed/approved. No deployment or migration write
was performed by Batch A.

## Release-plan correction and local test-readiness (2026-09-10)

This section supersedes any earlier statement that the disposable project does not
exist, and corrects the migration/avatar plan.

### Corrected facts

- Disposable project **`hjzwbicauyxffrmdhvgy` EXISTS** and has an installed
  application schema (previously verified: 24 tables, 40 ledger entries). Unset
  environment variables mean this process lacked configuration; they are not
  evidence about the project.
- Original project **`flbvusudwszxdylxevfe` already has
  `portal_validate_session(text)`** with the matching argument/return contract.
  No session-RPC migration is justified by missing-object evidence. The local
  `20250906000001_phase2_session_validation.sql` file remains uncommitted source
  only and must not be prescribed as a required original-project migration.
- The private-avatar repair bundle (`20250909000001_postinstall_repairs.sql`,
  which sets `avatars` public=false and creates `portal_get_avatar_path` /
  `admin_get_avatar_path`) stays **outside** the original release. The original
  project keeps a **public** `avatars` bucket and neither retrieval RPC.
- Exam impersonation (`exam_join` with a student-ID-only overload) or
  unauthorized writes are **not** optional hardening and cannot be waived. Any
  genuinely required forward migration for them must be compatible with the
  original schema and must be applied **before** dependent frontend deployment.

### Local test-readiness completed (no DB writes, no deployment)

- Fixed the TypeScript casts inside the two `.cjs` harnesses; `node --check`
  passes for every browser harness.
- Added `e2e/disposable-guard.cjs`: a shared guard that refuses missing config,
  the original project, or any project other than `hjzwbicauyxffrmdhvgy`, and
  that asserts both the app frontend and the server endpoints target it.
- Added `vite.isolated.config.ts`, `e2e/isolated-api-plugin.ts` (Netlify-compatible
  `/api/*` runtime + `/api/__e2e/health`), and `e2e/run-isolated.cjs`. The isolated
  config uses an empty `envDir` and never reads `.env.local`.
- `.env.local` unchanged. `e2e/isolated-creds.json` is git-ignored.

### Confirmed remaining blocker

No approved disposable **admin credential** exists in this process. Without it the
authenticated workflows (login, admission, fees, exam, denial) cannot run. The anon
key alone is not an admin/bootstrap mechanism.
