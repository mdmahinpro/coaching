# Full Application Audit

**Project:** Coaching-center / Techely Learning Center
**Audit date:** 2026-09-05
**Audit mode:** Source review + static checks + unit tests + real browser automation + read-only live Supabase probes
**Purpose:** Determine whether the application works as a single hosted coaching-center instance and whether it is ready to become a repeatable blueprint for provisioning separate customer databases.

---

## Executive Verdict

### Single-institute hosted deployment

**Status: AMBER / usable after operational cleanup.**

The main application surfaces work well in the current hosted-instance model. The fresh browser evidence is strong:

- Admin browser audit: **16/16 passed**.
- Whole-application route audit: **29/29 passed**.
- Homepage/live-data audit: **12/12 passed**.
- Combined admin → student → admin collaboration audit reached the core payment/admission/notice flows successfully before the local server stopped.
- Unit tests: **139/139 passed**.
- TypeScript: passed.
- Production build: passed, but Rollup reports circular vendor chunks.

### Repeatable SaaS blueprint

**Status: NOT READY for automated customer provisioning.**

The current repository is a strong single-institute application, but it does not yet contain a complete “new customer onboarding” system. It lacks:

- One canonical clean-database migration/provisioning pipeline.
- Automated Supabase project/database/storage/Auth setup.
- Seed/default settings per customer.
- Tenant/customer identity, subscription, plan, or billing model.
- Automated admin invitation/first-admin bootstrap.
- Automated migration verification and rollback.
- Automated per-customer environment/serverless secret setup.
- A clean-database end-to-end certification run.

Your stated model is **one separate database/project per coaching center**. That avoids cross-tenant row leakage, but the provisioning/deployment automation is still missing and is the largest blueprint blocker.

---

## Evidence Summary

| Check | Result | Interpretation |
|---|---:|---|
| `pnpm run typecheck` | PASS | Frontend/server types compile |
| `pnpm test` | PASS, 139 tests | Unit/component tests pass |
| `pnpm run build` | PASS | Production bundle generated; circular chunk warnings remain |
| `pnpm run lint` | FAIL, 1 error + 81 warnings | One current lint error must be fixed; warning debt remains |
| Focused admin browser audit | PASS, 16/16 | Login, batch/student/fee flows, receipt, approval, exam render, avatar menu |
| Whole app route audit | PASS, 29/29 | Public/admin/portal route renders and disposable student login |
| Homepage audit | PASS, 12/12 | Real DB counts, notices, batches, course/admission path, responsive behavior |
| Admission browser audit | 9/10 | Product flow actually approved and student logged in; assertion expects stale toast text |
| Combined collaboration audit | Partial run | Reached admin/student payment loop; one run was interrupted by local server shutdown |
| Standalone student exam audit | BLOCKED | Hard-coded test account/exam prerequisite was unavailable; not proof exam is broken |
| Live smoke harness | BLOCKED | Correctly requires `LIVE_URL` or `e2e/live-url.txt` |
| Live provider secrets table | BLOCKED | `provider_secrets` is not applied to current live database |
| Live automated backup | PARTIAL | `backups` exists and a snapshot was created during audit; scheduled/coverage migration state still needs verification |

### Important audit side effect

A read-only probe called the existing `admin_create_backup_now()` RPC to verify backup state. This created one automated backup snapshot. No student, fee, admission, teacher, batch, notice, or payment records were intentionally created by that probe. Earlier browser audits left disposable rows in the live database; current residue counts were not all zero and must be cleaned by a controlled owner-approved cleanup before production handover.

The `backfill-avatars.cjs` utility was also run in the preceding audit history and reported changing two student avatar references. It is **not read-only** and should not be included in normal smoke testing.

---

# 1. Application Architecture

## 1.1 Public website

Routes verified:

- `/`
- `/courses`
- `/admission`
- `/notices`
- `/contact`

Observed capabilities:

- Dynamic institute branding/settings.
- Dynamic active batches.
- Dynamic active teachers.
- Dynamic published notice ticker.
- Homepage stats using database data.
- Public admission form.
- Public notices with categories/filtering.
- Contact information and map embedding.
- Social links/footer.
- Responsive layout.

Status: **VERIFIED for current hosted instance.**

Risks:

- Public features depend on settings/migrations existing in the target database.
- There are legacy/default/demo-related source utilities; the production dashboard prompt was removed, but clean provisioning must explicitly avoid demo rows.
- Social/map/feedback features require the latest migrations and settings to be applied.

## 1.2 Admin application

Admin authentication uses Supabase Auth plus a server-side `admin_users` roster and `is_admin()` RPC. The route guard requires the authenticated role to resolve as admin.

Verified admin routes:

- `/admin/dashboard`
- `/admin/students`
- `/admin/batches`
- `/admin/teachers`
- `/admin/fees`
- `/admin/exams`
- `/admin/results`
- `/admin/notices`
- `/admin/admissions`
- `/admin/sms`
- `/admin/reports`
- `/admin/settings`
- `/admin/backup`

Status: **VERIFIED for route rendering and key workflows.**

Limitation: the audit does not prove every mutation error path, every export format, every concurrent operation, or every accessibility requirement.

## 1.3 Student portal

Routes verified:

- `/portal/login`
- `/portal/signup`
- `/portal/dashboard`
- `/portal/fees`
- `/portal/exams`
- `/portal/results`
- `/portal/notices`
- `/portal/profile`

The portal session uses an opaque server session token issued by student login and persisted in `sessionStorage` through Zustand.

Status: **PARTIALLY VERIFIED.**

Verified:

- Approved student login.
- Portal dashboard render.
- Fees route render.
- Exams route render.
- Results route render.
- Notices route render.
- Profile route render.
- Fee submission → admin approval collaboration in the combined harness.
- Email profile update code exists but its new migration is not live in the current database.

Not fully verified:

- Standalone strict exam submission could not run because `student.browser.cjs` requires a specific prepared account/exam and failed before the exam journey.
- Realtime exam updates.
- Autosave/reload recovery under network interruption.
- Duplicate-submit prevention under double-click/concurrent requests.
- Full profile photo/password/email update against a clean migrated database.

---

# 2. Admin Feature Audit

## 2.1 Authentication and authorization

**Status: VERIFIED with hardening requirements.**

Working:

- Admin login route.
- Protected-route redirect.
- Admin roster check through `is_admin()`.
- Admin-only RPC gates in hardened migrations.
- Non-admin route protection was source-reviewed.

Risks:

- New customer provisioning must create the first `admin_users` row safely.
- The current student route guard trusts persisted client state before server revalidation; RPC data access is protected, but stale portal UI/session state should be revalidated on app load.
- Clean tenant database authorization needs an automated negative test: anonymous, student, and admin roles separately.

## 2.2 Dashboard

**Status: VERIFIED for live data definition.**

The dashboard now counts approved active students, matching homepage logic. The production demo-data prompt was removed.

Needs verification per new customer:

- Empty new DB displays intentional zero/empty states.
- No demo rows are inserted.
- Stats automatically update after first student/batch/fee/notice.
- Tenant branding/settings are loaded from that customer DB.

## 2.3 Students

**Status: PARTIALLY VERIFIED.**

Verified:

- Add student.
- Student list/drawer.
- Student data display.
- Student password/reset-related code.
- Single-student SMS UI.
- Student deletion now prefers transactional `admin_delete_student`.
- Student photo validation and upload guidance.

Risks/gaps:

- The live function version returned `student_removed=true` for a nonexistent UUID during audit probing; source migration was corrected, but it must be reapplied.
- Fallback deletion is necessarily less safe than the RPC if the migration is missing.
- Student deletion requires careful verification of every dependent table in each clean deployment.
- No complete browser test covered edit, reset password, suspend/reactivate, image upload, and delete together.

## 2.4 Batches

**Status: VERIFIED for basic lifecycle.**

Verified:

- Create batch.
- Disable/soft-delete batch.
- Active batches appear on public/admission/course pages.
- Monthly fee and capacity data are used by fee generation/admission flows.

Needs further hardening:

- Concurrent capacity enforcement should be tested in the database.
- Batch reactivation/edit/schedule edge cases are not fully browser-covered.
- Teacher assignment and batch/student reassignment need clean-database tests.

## 2.5 Teachers

**Status: PARTIALLY VERIFIED.**

Verified:

- Add teacher UI.
- Active teacher data appears on homepage.
- Teacher image validation/upload path exists.

Not fully verified:

- Edit/delete/photo upload complete lifecycle.
- Public empty-state behavior on a new customer.
- Whether all teacher fields are consistently protected by RLS.

## 2.6 Fees and payments

**Status: VERIFIED for primary workflows; financial controls require more testing.**

Verified:

- Monthly fee generation uses assigned batch monthly fees.
- Unassigned students no longer receive an invented fallback monthly amount.
- Cash payment UI flow.
- Payment persisted as paid.
- Fee audit entry.
- Receipt PDF generated and validated as A4.
- Student portal bKash submission → pending approval → admin approval → paid + receipt.
- SMS/email hooks exist.

Risks:

- Payment audit failures are intentionally swallowed in older paths; financial audit durability should be transactionally guaranteed.
- Refund, reversal, duplicate payment, partial payment, overpayment, and concurrent approval paths were not fully tested.
- Provider/email delivery status is not a substitute for reconciliation with actual payment provider statements.
- Student email availability is new and migration-dependent.

## 2.7 Exams, questions, results

**Status: PARTIALLY VERIFIED.**

Verified:

- Admin exam page renders.
- Portal exam route renders.
- Exam/result schema and RPC migrations exist.
- Result PDF generation path passed in the earlier student suite when its prerequisite data existed.

Unverified/blocked:

- Fresh standalone strict exam run was blocked by a hard-coded `EXAM_ID`/account prerequisite.
- Full create exam → add questions → publish → student start → autosave → submit → results → review was not completed in this fresh run.
- Bulk question import, timer expiry, penalty, pause/resume, duplicate submit, concurrent submission, and result recalculation need dedicated disposable E2E.
- A blueprint should seed a disposable exam at runtime rather than rely on a fixed test account and environment-specific exam ID.

## 2.8 Notices

**Status: PARTIALLY VERIFIED.**

Verified:

- Admin notices route renders.
- Public notice board renders published notices.
- Dynamic result notice helper exists and reads top database submission.
- Categories include general, exam, fees, holiday, result, urgent, event.
- Legacy `fee` is normalized publicly as `fees`.

Not fully verified:

- Complete CRUD/publish/unpublish/delete lifecycle.
- Per-batch targeting under clean tenant data.
- Email/SMS notice delivery with provider credentials.
- Sanitization and HTML/content policy under adversarial input.

## 2.9 Admissions

**Status: VERIFIED for core collaboration, test assertion needs maintenance.**

Verified:

- Public form required fields and batch selection.
- Admission row persistence/reference number.
- Admin row lookup/view.
- Approval creates approved active student.
- Student logs in using phone + admission reference password.
- Rejection code path exists.

Fresh admission browser result was 9/10 because the product correctly changed the toast to:

```text
Approved! Student ID: ... — default password is the admission reference.
```

The test still expected the old toast text. This is a test assertion defect, not a failed approval flow.

Risks:

- Admission approval is still a multi-step client workflow around student creation/status updates; the new collision-safe RPC reduces ID collisions but the complete transaction should be centralized server-side.
- Duplicate/retry behavior must be verified with two approvals of the same row.

## 2.10 SMS

**Status: PARTIALLY VERIFIED.**

Verified:

- SMS Center UI.
- Templates and log UI.
- Single-student SMS composer.
- Bulk recipient categories in source.
- Provider-neutral endpoint path and protected provider-secret design in source.
- SMS log delete action.

Blocked/operational:

- Vite does not expose `/api/send-sms`; deployed Netlify/Vercel or Netlify Dev is required.
- Current live DB did not contain `provider_secrets`, so dashboard-managed API-key controls are not operational until migration `20250905000006_provider_secrets.sql` is applied.
- Real SMS delivery was not intentionally sent during audit.
- Generic provider request schemas differ across Bangladesh gateways; a provider-specific adapter may still be required.

## 2.11 Email

**Status: SOURCE-READY, LIVE UNVERIFIED.**

Implemented:

- Email Center.
- Dynamic recipients: all active students with email, batch, one student, custom.
- Fee reminder, receipt, and notice templates.
- Generic server email endpoint plus Resend default.
- Email logs.
- Student portal email update RPC.

Blocked:

- `provider_secrets` migration was not present in live DB during audit.
- No real email provider key was tested.
- SPF, DKIM, DMARC, bounce handling, suppression lists, rate limits, unsubscribe/consent policy, and delivery retries are not implemented as a full email operations system.

## 2.12 Reports

**Status: PARTIALLY VERIFIED.**

Verified:

- Reports route renders.
- Student count definition was aligned with homepage: approved + active.

Unverified:

- Every report tab’s numerical correctness.
- CSV exports under empty/large data.
- Financial totals versus fee/audit rows.
- Date/timezone boundaries and batch filters.

## 2.13 Settings and branding

**Status: PARTIALLY VERIFIED.**

Verified/source-ready:

- Institute settings.
- Payment numbers/instructions.
- Social links.
- Map URL normalization and address fallback.
- Logo/banner/image validation guidance.
- Appearance presets and dynamic theme/button styles.
- Feedback/testimonial management source.
- SMS/email provider controls source.

Live limitation:

- Provider-secret table is not applied in the current live database, so new provider controls cannot save until migration is applied.

## 2.14 Backups

**Status: PARTIALLY VERIFIED / operationally sensitive.**

Verified:

- Backup table exists.
- `admin_create_backup_now()` exists and created a snapshot with 241 records during audit.
- Manual/automatic coverage source includes students, teachers, batches, fees, payment approvals, fee audit logs, notices, exams, questions, submissions, SMS logs, admissions, and site settings.
- Restore is admin-gated and allowlisted in source.

Risks:

- Latest backup metadata probe did not expose a readable row through the subsequent query, so the exact stored payload could not be independently inspected in that same check.
- Sessions, exam tokens, admin roster, password hashes, API keys, and DB credentials are intentionally excluded; this must be explained as a security design, not “complete database backup.”
- Restore is destructive for tables present in a backup. It must only be tested on a disposable database.
- There is no automated off-site retention/restore drill report.
- A database backup does not include all Supabase Auth users/storage objects unless separately configured through Supabase platform backups.

---

# 3. Admin ↔ Student Collaboration Audit

## Verified collaboration flows

### Admission → portal

1. Public applicant submits required data.
2. Admission request persists with reference number.
3. Admin views request.
4. Admin approves.
5. Student record is created/activated.
6. Student logs in using phone + reference password.

Status: **VERIFIED.**

### Student fee payment → admin approval

1. Admin/DB creates a fee for the approved student.
2. Student logs into portal.
3. Student opens Fees.
4. Student submits bKash transaction ID.
5. Pending payment approval is created.
6. Admin opens Payment Approvals.
7. Admin approves.
8. Fee becomes paid and receipt number is recorded.

Status: **VERIFIED in combined audit.**

### Admin notice → public/student visibility

1. Admin publishes notice.
2. Public Notice Board loads published data.
3. Student portal notice route loads published data.

Status: **Route/render verified; complete targeting and delivery channels need more testing.**

### Admin exam → student result

Status: **PARTIAL / standalone exam run blocked by test prerequisite.**

The architecture and routes exist, but the fresh audit did not complete a clean dynamically seeded exam round trip. This must be fixed in the test harness before claiming full exam collaboration certification.

---

# 4. Security and Data Protection

## Positive controls

- Admin authorization uses `admin_users` + `is_admin()` rather than trusting editable client metadata.
- Core RLS migrations exist for students, teachers, batches, fees, exams, notices, admissions, SMS logs, questions, submissions, and settings.
- Student session/token tables are protected from direct public access.
- Provider secret table policy is admin-only in source.
- API keys are intended to stay server-side.
- Student input is sanitized in several display paths.
- Destructive delete/restore operations require admin paths.

## Critical security/blueprint risks

### P0 — No tenant boundary for the SaaS blueprint

There is no `tenant_id`, `organization_id`, subscription, customer, plan, or per-tenant authorization model in the schema/code. Separate Supabase projects per customer can isolate customers, but there is no automated lifecycle for creating those projects, applying migrations, setting secrets, creating the first admin, or rotating providers.

**Impact:** manual provisioning drift, wrong-project configuration, inconsistent migrations, and operational mistakes during customer onboarding.

### P0 — Legacy permissive migration exists

`migration.sql` contains policies using `USING (true)` for authenticated access. The README warns against applying it after hardening, but a blueprint installer must make it impossible to choose the wrong path.

**Required:** remove/rename/archive the legacy migration and provide one canonical provisioning command.

### P1 — Live database migration drift

Live audit found:

- `provider_secrets` missing even though source migration exists.
- New portal email RPC not live.
- Some newer functions/tables were previously absent before manual migration runs.

**Required:** migration runner must record applied versions and fail closed if required migrations are absent.

### P1 — Student portal client guard trusts persisted session state

`StudentProtectedRoute.tsx` checks Zustand/sessionStorage presence only. Server RPCs protect actual data, but a stale session can render protected shells until the API responds.

**Required:** validate/revoke the opaque token during app initialization and clear client state on expiry.

### P1 — Provider endpoint configuration needs SSRF controls

Custom SMS/email endpoints are accepted as admin input and used by server-side `fetch`. Admin-only reduces exposure but does not eliminate SSRF risk.

**Required:** allowlist schemes/hosts or use provider IDs with server-side endpoint mapping. Do not allow arbitrary internal URLs in production.

### P1 — Automated backup is not an all-Supabase disaster recovery plan

Portable JSON excludes Auth users, storage objects, sessions/tokens, and secrets. It is a business-data export, not a full infrastructure backup.

**Required:** document Supabase PITR/platform backup, storage backup, Auth recovery, retention, encryption, and restore drills.

---

# 5. Privacy and Operational Risks

- Student records include phone numbers, guardians, addresses, emails, fee history, results, and possibly photos.
- No formal retention/deletion policy is represented in the app.
- SMS/email consent and opt-out handling are not implemented.
- Bulk email sends need rate limiting and delivery failure handling.
- Admin can delete logs/records; audit retention policy is not defined.
- Backup JSON contains sensitive educational/financial data and requires encrypted storage/access control.
- Generated PDFs and CSV files may contain personal data and need controlled handling.
- Real provider keys are not to be placed in `VITE_` variables.

---

# 6. UI, Accessibility, and Responsive Review

## Verified

- Public/admin/portal routes render at desktop and mobile widths in prior probes.
- No horizontal overflow was observed at 390px, 768px, and 1440px in prior checks.
- Theme/appearance applies across shared components.
- Transparent logos and image upload guidance were implemented.

## Partial / remaining

- `pnpm lint` currently has **1 error and 81 warnings**.
- Warnings include missing hook dependencies, consistent-return, type-only unused imports, and React Hook Form/compiler compatibility.
- No full axe/WCAG audit was run in this fresh pass.
- Some icon-only controls and sortable table headers need a formal keyboard/screen-reader audit.
- Long Bengali/English content and large tables need additional mobile testing.

Current lint error:

```text
src/pages/admin/SettingsPage.tsx:876:51
react/no-unescaped-entities
```

This must be fixed before treating CI as green.

---

# 7. Deployment and Hosting

## Hosting fit

- Vercel/Netlify: appropriate for Vite static frontend + serverless functions.
- Hostinger shared hosting: can serve static files but is not appropriate for the serverless SMS/email functions unless separately adding compatible backend infrastructure.
- Supabase remains the backend/Auth/Storage/database dependency.

## Deployment verified

- Vercel configuration exists.
- Netlify configuration exists.
- Netlify routes `/api/send-sms` to the function.
- Email route exists in source but deploy route/config should be explicitly tested on Netlify/Vercel.
- `smoke-live.browser.cjs` requires `LIVE_URL`; it cannot run without a deployed URL.

## Not verified

- A real deployed custom domain.
- Supabase Auth redirect URLs for that domain.
- Production serverless email/SMS responses.
- Provider secrets on the deployment platform.
- Sentry DSN and event receipt.
- Storage CORS/public bucket behavior.

---

# 8. Blueprint / SaaS Readiness

## What is already reusable

- Supabase-backed schema and RPC structure.
- Admin/student/public route separation.
- Vercel/Netlify deployment shape.
- Migration files and an apply script.
- E2E scripts using disposable prefixes.
- Provider adapters and settings model.
- Teacher guide and smoke harness.

## What must be built before selling subscriptions

### A. Canonical provisioning service

Create a script/service that:

1. Creates a Supabase project/database for a customer.
2. Applies one ordered migration bundle only.
3. Verifies every expected table/function/policy exists.
4. Creates storage buckets and storage policies.
5. Creates/invites the first school admin.
6. Inserts default settings scoped to that customer.
7. Configures site URL/redirect URLs.
8. Configures serverless environment secrets.
9. Runs clean-database seed/smoke tests.
10. Produces a provisioning report and customer handover link.

### B. Remove migration ambiguity

- Archive/delete legacy `migration.sql` from the production path.
- Do not expose permissive `update_rls_policies.sql` as a normal onboarding action.
- Add a migration ledger table/version check.
- Make the installer fail if migrations are out of order.

### C. Tenant/customer control plane

Even with one DB per customer, create an external control plane for:

- Customer/institute registry.
- Supabase project ID.
- Subscription status/plan.
- Domain.
- Provisioning status.
- Migration version.
- Admin owner contact.
- Suspension/offboarding state.

### D. Secrets lifecycle

- Store provider secrets in deployment secret storage or a vault.
- Avoid storing API keys in ordinary database rows unless encrypted and audited.
- Add rotation UI/process.
- Never log raw provider responses if they contain secrets/personal data.

### E. Tenant-specific branding/data

- Default settings must be inserted per customer.
- Feedback, notices, teachers, students, fees, reports, backups, and files must belong to that customer project.
- Add an automated empty-state verification so demo data never enters a paid customer DB.

### F. Support and handover

- Teacher guide exists, but needs customer-specific screenshots/URL/contact.
- Add an owner/admin emergency recovery contact.
- Add data export/delete/offboarding process.
- Add a backup restore drill per customer before handover.

---

# 9. Required Release Gates

## Must fix before claiming production-ready blueprint

1. Fix the one lint error and reduce/triage hook warning debt.
2. Apply and verify `20250905000006_provider_secrets.sql` in the target DB.
3. Correct/reapply `admin_delete_student` so nonexistent IDs return `student_removed=false`.
4. Clean current disposable audit residue through an owner-approved, targeted cleanup.
5. Build a clean database from the canonical migration chain and run all E2E against it.
6. Replace the hard-coded student exam E2E prerequisite with runtime seeding/cleanup.
7. Test real deployed email/SMS serverless endpoints without sending unintended messages.
8. Verify backup payload contents and perform a disposable restore drill.
9. Remove/disable legacy permissive migration paths.
10. Design and implement the customer provisioning/control-plane process.

## Recommended before first school handover

1. Configure custom domain and Supabase redirect URLs.
2. Configure Sentry and verify one test event.
3. Configure SMS provider and send one approved test message.
4. Configure email provider and send one approved test email.
5. Add school branding, map, social links, feedback, payment numbers, and policies.
6. Create first admin through the approved roster flow.
7. Create one disposable student, batch, fee, notice, and exam.
8. Run `pnpm smoke:live` against the deployed domain.
9. Download and securely store a backup.
10. Hand over `TEACHER_GUIDE.md` and never give the teacher database/provider credentials.

---

# 10. Final Status by Surface

| Surface | Status | Explanation |
|---|---|---|
| Public homepage | **Verified** | Live counts, batches, teachers, notices, responsive checks passed |
| Public courses | **Verified** | Route/content/filter smoke passed |
| Public admissions | **Verified** | Required fields, persistence, admin approval, portal login passed; one stale test assertion |
| Public notices | **Verified/Partial** | Published display/filter works; complete targeting/delivery needs more tests |
| Contact/map | **Source-ready** | URL normalization/fallback implemented; deployed map provider behavior not verified |
| Admin auth | **Verified** | Supabase Auth + admin roster/is_admin |
| Admin dashboard | **Verified** | Uses live approved-active data; clean DB onboarding not proven |
| Students | **Partial** | Basic add/list/delete flows; full lifecycle/error/concurrency incomplete |
| Batches | **Partial** | Create/disable/active public use; capacity/concurrency/edit edge cases incomplete |
| Teachers | **Partial** | Add/live public cards; full CRUD/photo lifecycle incomplete |
| Fees | **Verified primary** | Generate/record/approve/receipt/collaboration passed; financial edge cases incomplete |
| Exams | **Partial** | Routes/schema exist; standalone full exam journey blocked by test prerequisite |
| Results | **Partial** | Result route/PDF path exists; full recalculation/export/exam journey incomplete |
| Notices/admin | **Partial** | Dynamic categories/result helper; full CRUD/targeting/delivery incomplete |
| SMS | **Partial** | UI/provider adapter/logs; live provider and protected secrets migration pending |
| Email | **Source-ready** | UI/API/templates/recipient selection; provider/live migration/delivery unverified |
| Reports | **Partial** | Route/count alignment; all report/export correctness incomplete |
| Settings/branding | **Partial** | Broad settings/theme/uploads; clean-customer persistence audit incomplete |
| Backups | **Partial** | Snapshot RPC/table/source coverage; restore drill/retention/full Supabase DR incomplete |
| Student portal | **Partial** | Login/routes/fee collaboration pass; full exam/profile/session revalidation incomplete |
| Admin-student collaboration | **Verified core** | Admission and fee approval loop passed; exam collaboration incomplete |
| Monitoring/Sentry | **Source-ready** | SDK wiring exists; deployed DSN/event receipt unverified |
| Customer provisioning | **Not ready** | No canonical SaaS onboarding/control plane |

---

## Bottom Line

The application is a strong **single-coaching-center product candidate** after migration cleanup, lint correction, clean-database verification, and deployed-provider testing.

It is **not yet a complete SaaS blueprint** for automatically selling/provisioning separate coaching-center subscriptions. The next major engineering milestone is not another UI page; it is the canonical provisioning/control-plane system that guarantees every purchased institute receives the same secure schema, storage, settings, first admin, secrets, domain configuration, empty data state, backup policy, and smoke-test evidence.

---

# Fresh Realtime Admin Credential Audit Appendix

**Run date:** 2026-09-05
**Credential source:** `e2e/admin-creds.json` (read locally; no credentials printed)
**Data policy:** disposable records only; no real SMS/email sent; no restore executed.

## Fresh run results

| Suite | Result | Notes |
|---|---:|---|
| `node e2e/combined-prod-go.browser.cjs` | **19/19** | Admin login, batch, teacher, admission approval, student portal login, bKash submission, admin approval, paid fee, receipt state, notice, portal routes, reports, backup route |
| `pnpm e2e:admin` | **16/16** | Batch create/disable, student create, fee cash payment, receipt PDF, payment approval, exam render, avatar menu |
| `node e2e/homepage.browser.cjs` | **12/12** | Real DB counts, live notice ticker, active batch propagation, public course/admission behavior, stat toggle |
| `node e2e/audit-all.browser.cjs` | **29/29** | Public routes, admin routes, portal routes, disposable approved student login |
| `node e2e/admission.browser.cjs` | **9/10** | Product approval and student login succeeded; one assertion still expects the older approval toast wording |
| `node e2e/student.browser.cjs` | **BLOCKED** | Hard-coded student/exam prerequisite was not available; this is a harness defect/gap, not a feature pass |

## Fresh collaboration evidence

The combined suite verified this realtime chain:

1. Admin authenticates.
2. Public admission form submits a reference number.
3. A disposable admission is approved through the admin UI.
4. The approved student is found in the database.
5. The student logs into the portal with phone + reference password.
6. A pending fee is visible in the student portal.
7. Student submits a bKash transaction ID.
8. A pending payment approval is created in the database.
9. Admin sees and approves the pending approval.
10. The fee becomes paid and a receipt marker is recorded.
11. Admin publishes a disposable notice.
12. Portal exams/results/notices/profile routes remain accessible.

**Result:** this core admin↔student collaboration path is verified.

## Fresh data hygiene finding

The current focused admin suite does not clean every disposable batch it creates.
After the fresh run, read-only prefix counts included old/current disposable rows:

- `ADM-COMBINED` batches: 2
- `ADM-COMBINED` students: 1
- `ADM-COMBINED` admissions: 2
- `ADM-COMBINED` notices: 1
- `ADM-COMBINED` teachers: 1
- `ADM-E2E` batches: 13

This is a **test-harness/data-hygiene defect**, not a feature failure. Do not hand this
database to a school while these test rows remain. The cleanup must be owner-approved
and prefix-targeted, or the next audit harness must use a disposable database/project.

## Fresh live migration evidence

Read-only live probes showed:

- `feedback`: available.
- `email_logs`: available.
- `backups`: available.
- `provider_secrets`: available as a table after the latest state check, but provider
  rows are empty; provider configuration has not been proven operational.
- `payment_approvals`, `fee_audit_logs`, `student_sessions`, `exam_tokens`: available.
- `admin_create_backup_now`: callable and produced a snapshot with `record_count=241`
  during an earlier audit probe.

The latest browser collaboration run had no app defects. Local console output still
includes `/api/send-sms` 404 under Vite; this is expected because serverless functions
require Netlify/Vercel or Netlify Dev.

---

# Phase 5 Operations Verification Appendix (2026-09-06)

- User confirmed all residue candidates were demo/testing data.
- Read-only manifest contained 21 exact-ID candidates.
- Cleanup used exact IDs and dependent-first ordering only; no prefix-only deletion.
- One final old `ADM-E2E Batch` had a dependent test notice. The exact notice was
  inspected and deleted, then the exact batch was deleted.
- Final read-only manifest returned `candidate_count: 0`.
- The SMS dynamic-import incident was caused by stale/failed Vite HMR state. After
  restarting Vite, the module returned HTTP 200 and `/admin/sms` rendered successfully.
- No real SMS/email was sent.
- No deployed URL was configured, so deployed integrations remain blocked.
- Backup metadata returned zero rows; no payload was inspected and no restore was run.

## Fresh release conclusion

The current single-institute feature set is strongly verified for the core workflows,
but the blueprint remains **AMBER** until:

1. Test rows are removed or the audit runs against a disposable customer database.
2. `provider_secrets` is confirmed applied in every provisioned database and a test
   provider is configured without transmitting unintended messages.
3. The standalone exam suite is changed to runtime seed its disposable exam/account.
4. The one lint error is fixed and warning debt is triaged.
5. The canonical clean-database provisioning/control plane is implemented.

---

# Remediation Verification Appendix (2026-09-05)

## Completed in this remediation pass

- Fixed the current lint error in `SettingsPage.tsx`.
- Updated the admission E2E assertion for the current safe approval toast.
- Admission browser suite now passes **10/10**.
- Reworked `e2e/student.browser.cjs` to seed a unique disposable batch, student,
  strict active exam, and questions at runtime using the local admin credentials
  internally. It now cleans exam, questions, submissions, tokens, sessions,
  student, and batch records after execution.
- Runtime-seeded student exam suite now passes **9/9**: portal login, dashboard,
  exam instructions, start, correct answers, submit, 100% result, breakdown,
  results listing, and valid PDF generation.

## Verification after remediation

| Check | Result |
|---|---:|
| TypeScript | PASS |
| Unit tests | PASS, 139/139 |
| Production build | PASS; circular vendor chunk warnings remain |
| Lint | PASS exit code, 0 errors, 81 warnings |
| Admission flow | PASS, 10/10 |
| Student exam flow | PASS, 9/9 |
| Combined collaboration | PASS, 19/19 |

The student exam run still captured one background 401/error log from a non-authorized
request, but no product assertion failed. Session-expiry error observability remains
an open hardening item.

---

# Phase 2 Remediation Appendix (2026-09-06)

## Implemented source fixes

- `portal_validate_session(TEXT)` was added and `StudentProtectedRoute` now
  revalidates the opaque token through a server-side RPC when a protected portal
  session initializes. Expired, revoked, suspended, or unapproved sessions clear
  persisted state.
- Student deletion now fails closed when `admin_delete_student` is missing or fails;
  the browser no longer performs unsafe partial cleanup after arbitrary RPC errors.
- Provider SMS/email endpoints now require HTTPS, reject credentials in URLs, resolve
  DNS, and reject private/link-local/loopback destinations before server fetch.
- `admin_delete_student` source now returns the actual DELETE result, so a nonexistent
  student returns `student_removed=false`.
- Added atomic admission approval migration source with a row lock, pending-status
  guard, duplicate protection, and one-transaction student/batch/status writes.
- Payment approval source now locks the pending approval/fee and makes the financial
  audit insert mandatory; an audit failure rolls back the payment mutation.

## Phase 2 verification

- TypeScript: PASS.
- Unit tests: PASS, 139/139.
- Production build: PASS; circular vendor chunk warnings remain.
- Lint: PASS exit code, 0 errors; 83 warnings remain for dependency/style/compiler
  review.
- Runtime-seeded student exam: PASS, 9/9.
- Admission flow: PASS, 10/10 after assertion update.
- Combined collaboration: PASS, 19/19.

## Deployment dependency

The Phase 2 migrations are source-only until applied to each customer database:

- `20250906000001_phase2_session_validation.sql`
- `20250906000002_atomic_admission_approval.sql`
- `20250906000003_phase2_payment_audit_atomic.sql`

The migration runner was updated to include them. The atomic admission RPC is not
silently wired into the UI before deployment verification; this avoids breaking a
database that has not applied the new function.
