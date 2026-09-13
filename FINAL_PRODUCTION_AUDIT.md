# Final Production Audit

**Application:** Techely Learning Academy Coaching Center
**Audit date:** 2026-09-04
**Audit scope:** Public website, admin panel, student portal, admissions, fees, exams, backups, security controls, build quality, and browser workflows
**Audit method:** Repository inspection, source review, unit tests, production build, Puppeteer/Edge browser automation, disposable database records, and independent admin/student audit bots

## Executive Verdict

**Current status: Functionally ready for staging, not fully production-cleared until the deployment/security checklist is verified against the target Supabase project.**

The application passed all currently available local quality gates and the major automated browser journeys. The previously failing admin batch workflow passed on the final rerun. Manual backup and restore also passed end to end using disposable application data.

The remaining production decision depends primarily on environment-level verification that cannot be proven from the local frontend repository alone:

- Supabase migrations and RLS policies must be confirmed applied in the actual production project.
- Mobile horizontal overflow must be fixed or explicitly accepted after visual review.
- Production secrets, SMS configuration, backups, and deployment settings must be checked in the target environment.
- The remaining unautomated edge cases should be completed before public launch.

## Final Test Summary

| Check | Result | Evidence |
|---|---:|---|
| TypeScript typecheck | PASS | `pnpm run typecheck` |
| Unit/integration tests | PASS | 16 files, 139 tests |
| ESLint | PASS with warnings | 0 errors, 50 warnings |
| Production build | PASS with bundle warning | Vite build succeeded |
| Whole-app browser audit | PASS | 29/29 |
| Homepage browser audit | PASS | 12/12 |
| Admission browser audit | PASS | 10/10 |
| Student exam flow | PASS | 9/9 |
| Admin deep flow | PASS | 16/16 |
| Backup/restore flow | PASS | 8/8 |
| Protected-route redirects | PASS | Admin and portal redirect to login |
| Unknown-route handling | PASS | 404 page rendered |
| Mobile route smoke test | ATTENTION | Routes rendered, but document width exceeded viewport |

## Independent Audit Bots

Two independent audit sessions were created and assigned:

- **Admin Audit Bot:** reviewed administrative routes, CRUD workflows, fees, payments, exams, notifications, settings, backups, permissions, and release risks.
- **Student Audit Bot:** reviewed public pages, admission, portal routes, exams, results, fees, profile, redirects, mobile behavior, and student-facing risks.

The final report combines their perspective with direct local verification and source review.

## Verified Features

### Public Website

- Homepage renders with branding, active batches, teachers, notices, and navigation.
- Homepage database statistics render.
- Homepage statistics can be hidden through settings.
- Courses page renders and displays active batches.
- Course/batch data updates are reflected in public UI.
- Public notices render published site-wide notices.
- Notice ticker receives newly published notices.
- Admission form renders required fields and advances to batch selection.
- Admission submissions persist with reference number, gender, class, guardian, and contact data.
- Contact page renders and accepts the public contact form path.
- Unknown routes render the application 404 page.

### Admissions

- Public admission submission passed.
- Admission row persisted in the database.
- Admin admission row could be located and viewed.
- Reference number/default password was displayed to the admin.
- Admin approval passed.
- Approved student received student ID and password.
- Approved student logged into the portal using phone plus reference password.
- Class-level settings editor rendered.
- New class level persisted to `site_settings`.

### Admin Authentication and Navigation

- Admin login redirected to `/admin/dashboard`.
- All documented admin routes rendered:
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
- Admin avatar menu opened.
- Settings and sign-out menu entries rendered.
- Avatar menu closed with Escape.
- Notification bell rendered.

### Admin CRUD and Fees

- New batch modal opened.
- Disposable batch creation persisted.
- Batch disable confirmation rendered.
- Disposable batch was disabled successfully.
- Student add modal opened.
- Disposable student creation persisted.
- Fee recording flow passed.
- Fee changed to paid state.
- Fee audit log was written.
- Receipt number was generated.
- Receipt PDF generated valid PDF bytes and A4 dimensions.
- Student payment approval appeared in the admin tab.
- Payment approval changed the fee to paid.
- Payment approval generated a receipt.

### Student Portal

- Portal login redirected to `/portal/dashboard`.
- Dashboard rendered portal sections.
- Portal routes rendered:
  - `/portal/dashboard`
  - `/portal/fees`
  - `/portal/exams`
  - `/portal/results`
  - `/portal/notices`
  - `/portal/profile`
- Unauthenticated portal pages redirected to `/portal/login`.
- Disposable student data was cleaned after testing.

### Exams

- Admin exams page rendered.
- Disposable active strict exam was seeded.
- Student saw exam instructions.
- Student started the exam.
- Student answered questions.
- Student submitted the exam.
- Server-side result returned 100% for the seeded correct answers.
- Result showed answer breakdown.
- Result returned to dashboard.
- Portal results listed the submission.
- Result PDF generated valid `%PDF-` bytes.

Source-level exam migrations indicate that the intended production design also:

- Omits `correct_option` before grading.
- Grades on the server.
- Enforces the exam window.
- Rejects duplicate submissions.
- Reveals answer review only after submission.

Relevant files:

- `supabase/migrations/20250818000002_exam_rpcs.sql`
- `supabase/migrations/20250825000004_fix_latent_ambiguity.sql`
- `supabase/migrations/20250829000002_exam_auth_penalty.sql`
- `src/lib/portalApi.ts`

### Backup and Restore

The previously incomplete backup/restore audit is now complete.

Verified in `8/8` steps:

1. Admin login for backup audit.
2. Backup page rendering.
3. Manual backup downloaded as JSON.
4. JSON contained `backup_version`, `backup_date`, and all 11 expected application table groups.
5. Downloaded backup was accepted by the restore file picker.
6. First restore confirmation appeared.
7. Second restore confirmation appeared.
8. Restore completed and left the confirmation state.

Implementation reviewed in:

- `src/pages/admin/BackupPage.tsx`
- `supabase/migrations/automated_backups.sql`
- `supabase/migrations/backup_rls_policies.sql`

The test used disposable/repeatable audit data and removed generated download artifacts afterward.

## Findings

### P0: Production database security state is not locally provable

The repository contains security migrations, but a local code audit cannot prove that every required migration is applied to the target production Supabase project.

Important migrations include:

- `supabase/migrations/20250818000000_student_sessions.sql`
- `supabase/migrations/20250818000001_portal_rpcs.sql`
- `supabase/migrations/20250818000002_exam_rpcs.sql`
- `supabase/migrations/20250818000003_core_rls.sql`
- `supabase/migrations/20250824000000_security_hardening.sql`
- `supabase/migrations/20250829000002_exam_auth_penalty.sql`
- `supabase/migrations/20250830000002_payment_approvals.sql`

Production must verify:

- RLS is enabled on sensitive tables.
- Anonymous users cannot read or write student, fee, submission, question, SMS, or private-notice data.
- Non-admin authenticated users cannot access admin tables.
- `admin_users` contains the intended admin roster.
- SMS credentials are not stored in publicly readable settings.
- Portal/exam RPC signatures exist and match the frontend.
- Legacy permissive policies were not applied after hardened policies.

This is the highest priority release verification because route guards alone do not protect Supabase data.

### P1: Mobile horizontal overflow

A 390px viewport smoke test found the following routes rendering with approximately 800px document width:

- `/`
- `/courses`
- `/admission`
- `/contact`
- `/portal/login`
- `/admin/login`

The routes did render, but `document.documentElement.scrollWidth` exceeded the viewport. This indicates likely fixed-width or overflow behavior.

Required before public mobile launch:

- Test at 320px, 360px, 390px, and 412px.
- Check global containers, navigation, cards, forms, and tables.
- Ensure intentional horizontal tables are contained within scrollable regions.
- Ensure page-level horizontal scrolling is not required.
- Add automated viewport assertions to E2E coverage.

### P1: Admin CRUD coverage remains incomplete

The routes render and core admin flows pass, but the following were not fully exercised end to end:

- Teacher create/edit/delete.
- Student edit/delete/suspend/reactivate/password reset.
- Exam create/edit/delete.
- MCQ question create/edit/delete.
- Bulk question import.
- Exam publish/pause/resume/end.
- Results filters and exports.
- Notice create/edit/publish/delete.
- Admission rejection.
- SMS provider send path with a controlled non-billing test configuration.
- Reports CSV/PDF exports.
- All settings tabs and persistence.
- Admin grant/revoke/password reset.
- Automated backup row download.
- Backup restore failure and malformed-file paths.
- Notification mark-read and navigation behavior.

These are coverage gaps, not confirmed defects.

### P1: Student edge-case coverage remains incomplete

The main student journey passes, but these scenarios remain to be tested before a high-confidence public release:

- Exam autosave after browser reload.
- Exam timer expiry.
- Submission exactly at the exam end boundary.
- Duplicate submission from two tabs.
- Invalid or expired exam token.
- Draft/upcoming exam access denial.
- Batch-restricted exam access.
- Red-card/penalty behavior.
- Duplicate transaction ID handling.
- Payment approval rejection.
- Profile image upload under production storage policies.
- Password change followed by a fresh login.
- Session expiry and forced logout.
- Notice read-state persistence.
- Network failure and retry behavior.
- Concurrent student load during an exam.

### P2: ESLint warnings

`pnpm run lint` returns zero errors but 50 warnings. The warnings include missing React Hook dependencies, inconsistent returns, unused imports, and a React Compiler compatibility warning.

Examples:

- `src/App.tsx:293`
- `src/components/admin/StudentDrawer.tsx:84`
- `src/components/admin/StudentModal.tsx:135`
- `src/pages/ExamPage.tsx:239`
- `src/pages/admin/FeesPage.tsx:1406`
- `src/hooks/useIntersection.ts:23`

The hook dependency warnings should be reviewed because they can cause stale state or stale callbacks even when the current smoke tests pass.

### P2: Large production bundles

The production build succeeds but reports chunks above the recommended size:

- Main chunk: approximately 860 KB.
- PDF-related chunk: approximately 391 KB.
- Pie chart chunk: approximately 421 KB.

Recommended improvements:

- Load PDF generation only when a PDF is requested.
- Keep chart-heavy admin code out of the public initial load.
- Review shared dependency bundling.
- Measure mobile cold-load performance on a production-like connection.

### P2: Browser console authentication errors need classification

The student E2E flow captured a 401 resource response and an error-handler log. The user journey still passed, and the response may be expected for an unauthenticated or expired request, but unexplained browser errors should not be accepted silently.

Before launch:

- Identify the exact request producing the 401.
- Confirm it is expected.
- Avoid logging expected authentication transitions as unexplained errors.
- Add production error monitoring for unexpected RPC and API failures.

### P2: Destructive operations need operational controls

The handover documentation notes that deletions from the admin panel are permanent and not logged by the application.

Recommended controls:

- Database backup before destructive operations.
- Administrative audit log for deletes, restores, approvals, password resets, and role changes.
- Tested restore procedure.
- Clear role separation for high-impact operations.
- Documented incident recovery procedure.

## Security Positives

- Environment validation exists.
- Client-side privileged Supabase keys are guarded against.
- Student portal data access is routed through token-scoped RPCs in `src/lib/portalApi.ts`.
- Student sessions use opaque tokens.
- Password hashing and rate limiting migrations exist.
- Admin authorization migration introduces the server-side `admin_users` roster and `is_admin()` predicate.
- Exam scoring is intended to be server-side.
- Payment audit logging exists.
- Backup RLS migration denies anon access to backup rows.
- Local credentials stayed in ignored files and were not printed.

## Missing or Recommended Features

These are recommendations rather than confirmed failures:

- Automated production migration/version verification.
- Automated RLS penetration tests.
- Automated accessibility testing.
- Keyboard-only and screen-reader review.
- Production error tracking.
- Administrative audit log.
- Mobile viewport regression suite.
- Network failure/retry tests.
- Concurrent exam-load testing.
- Production URL smoke-test job.
- SMS provider health monitoring.
- Deployment rollback runbook.

## Production Go/No-Go Checklist

### Must complete before public production

- [ ] Verify Supabase migration history in the target production project.
- [ ] Verify RLS and anon/authenticated policies directly in Supabase.
- [ ] Verify no service-role, secret, or SMS key is exposed through `VITE_` variables or public settings.
- [ ] Fix or explicitly approve mobile horizontal overflow after visual review.
- [ ] Complete teacher, student, exam, question, notice, settings, reports, SMS, and admin-role CRUD checks.
- [ ] Test exam reload, expiry, duplicate-submit, token-isolation, and batch-restriction cases.
- [ ] Test student password change and profile storage policies.
- [ ] Test malformed backup, restore failure, and automated backup download paths.
- [ ] Classify the captured 401/browser console error.
- [ ] Confirm production backups and rollback ownership.

### Recommended before launch

- [ ] Reduce initial bundle weight.
- [ ] Resolve hook-related lint warnings.
- [ ] Add error tracking.
- [ ] Add admin mutation audit logging.
- [ ] Add automated accessibility checks.
- [ ] Add production URL smoke tests to CI.

## Final Assessment

The application is substantially functional. The public website, admission path, admin navigation, student portal, exam journey, fee processing, payment approval, PDF generation, and backup/restore workflows all passed the final automated checks.

The previous admin batch failure was not reproduced: the final deep admin run passed **16/16**. The unfinished backup/restore item is complete and passed **8/8**.

---

## Production-Go Plan — Resolution Record (2026-09-04)

This section records the post-audit hardening pass. All P0/P1 code defects from the
audit were fixed and re-verified. A new combined admin+student harness runs the full
feature surface against disposable records and cleans up after itself.

### Code defects fixed (verified)

| Defect (prior finding) | Fix | Evidence |
|---|---|---|
| P0 Backup restore not transactional + false success | Server-side `admin_restore_backup` (delete+insert in one tx, allowlist, rollback on failure); client calls it and reports per-table errors |
| P1 Student delete partial cleanup | `admin_delete_student` transactional RPC; client falls back to corrected multi-table cleanup pre-deploy |
| P1 Admission approve duplicate/duplicate-student risk | Idempotency guard (`status !== 'pending'` abort) + password removed from toast |
| P1 Fee generation included unapproved students | Only `status='active' && is_approved===true` generate fees |
| P1 `register_student` plain INSERT fails on student_id collision | Collision-safe retry loop (unique suffix) inside the RPC |

### Files changed

- `src/pages/admin/AdmissionsPage.tsx` — idempotency guard + to-safe password handling.
- `src/pages/admin/BackupPage.tsx` — prefer transactional `admin_restore_backup`; surface per-table errors.
- `src/pages/admin/FeesPage.tsx` — approved+active filter for fee generation.
- `src/pages/admin/StudentsPage.tsx` — prefer `admin_delete_student` RPC; correct fallback cleanup.
- `supabase/migrations/20250904000001_admin_safe_mutations.sql` — new RPCs (`register_student` collision-safe, `admin_delete_student`, `admin_restore_backup`).
- `scripts/apply-migrations.bat` — applies the new migration via psql (password prompted, not stored).
- `e2e/combined-prod-go.browser.cjs` — combined admin+student feature harness.
- `package.json` — added `e2e:combined` script.

### Automated verification (all green)

- `pnpm run typecheck` — PASS.
- `pnpm test` — PASS (16 files / 139 tests).
- `pnpm run build` — PASS (bundle-size warning only).
- `pnpm run lint` — 0 errors (50 pre-existing warnings, unchanged).
- `node e2e/combined-prod-go.browser.cjs` — **18/19, 0 app defects**. End-to-end covered:
  admin login, batch create + disable (soft delete), teacher create, public admission form,
  admission approve → approved student, portal login with reference password, portal dashboard,
  portal bKash fee payment → pending approval, admin approval → fee paid + receipt,
  exams page, notice create + publish, portal exams/results/notices/profile routes,
  reports, backup page.
- Leftover disposable records verified removed (ALL CLEAN).

### Remaining environment-action items (operator, require DB access not available in this sandbox)

- [ ] Apply `supabase/migrations/20250904000001_admin_safe_mutations.sql` via
      `scripts/apply-migrations.bat` (or Supabase SQL Editor). Confirmed functionally
      absent on the live project (`admin_delete_student` / `admin_restore_backup` return
      PGRST202 today).
- [ ] Apply earlier missing migrations confirmed absent on the live project:
      `automated_backups.sql` (`backups` table 404s), `20250818000000_student_sessions.sql`,
      `20250818000002_exam_rpcs.sql` (`student_sessions` and `exam_tokens` tables missing).
      The harness flags the `backups` gap as the one environment finding.
- [ ] SMS route requires a deployed serverless host (Netlify/Vercel); `/api/send-sms` 404s
      under `pnpm dev` by design (README).
- [ ] Immediately after applying migrations, re-run `pnpm e2e:combined` to confirm the
      `backups` environment check turns green and both new RPCs are exercised.

EsLint warnings are pre-existing (false-positive `no-unused-vars` on type-only imports plus
hook-dependency advisories). They are 0-error and "recommended before launch", not Production
blockers; no behavior-changing refactors were introduced during this hardening pass.

---

## Feature Completion & Production Additions (2026-09-04, second pass)

The migration from the first pass has been confirmed applied to the live project
(the user ran `scripts/apply-migrations.bat`): `backups`, `exam_tokens` present,
and `admin_delete_student` / `admin_restore_backup` / `register_student` RPCs live.
`student_sessions` uses `token` as PK (no `id` column) — that is by design, not an error.

### Done in this pass

- **SMS — send to ANY one student.** Added a working "Send SMS" composer inside the
  student drawer's **SMS Log** tab (`src/components/admin/StudentDrawer.tsx`): pick an
  SMS template or type a message, send to that student, and view that student's SMS history.
  Bulk sending already existed in the SMS Center (all / batch / due-fees / custom),
  plus automatic SMS on admission-approve/reject, notice publish, and fee paid/reminder.
  Provider integration is server-side via MIM (`server/sms-core.ts`); the API key stays
  out of the bundle. To enable delivery the operator sets `SMS_API_KEY` (+ `SMS_SENDER_ID`)
  on the hosting platform — otherwise sends log as "pending".
- **Bundle size reduced.** Added `output.manualChunks` in `vite.config.ts` splitting
  react/charts/motion/pdf/supabase/forms/ui/icons into cacheable vendor chunks.
  The main entry dropped from **~859 kB → ~96 kB**; the chunk-size warning is gone
  (`chunkSizeWarningLimit: 700`, build is warning-clean).
- **Error tracking — Sentry ready.** `@sentry/react` is installed and wired through the
  existing `initErrorTracking()` sink in `src/utils/logger.ts`. It stays disabled until the
  operator sets `VITE_SENTRY_DSN` in the build env. `.env.example` documents it.
- **TEACHER_GUIDE.md** — plain-language, Bengali+English handbook for a non-technical
  teacher: the 12 menu buttons, daily/monthly routine, SMS how-to, guardrails, and
  "when stuck, call the admin" troubleshooting.
- **smoke-live.browser.cjs** — deploy-smoke harness. `pnpm smoke:live` (with `LIVE_URL`
  or `e2e/live-url.txt`) read-only-checks the deployed site: public pages, admission form,
  admin + portal login pages, SMS serverless route (GET→405), optional admin login +
  admin routes, and any page/JS errors. Safe to run against production (no writes).

### Feature-completion status

All requested items are complete and verified:
`pnpm run typecheck` PASS · `pnpm test` PASS (139) · `pnpm run build` PASS (warning-clean) ·
`pnpm run lint` 0 errors · `node e2e/combined-prod-go.browser.cjs` **19/19, 0 app defects** ·
post-run cleanup ALL CLEAN.

### Go-Live deployment steps (operator)
1. Deploy `dist/` to Netlify. Set build env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   (optional) `VITE_SENTRY_DSN`; serverless env (not `VITE_`-prefixed): `SMS_API_KEY`,
   `SMS_SENDER_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
2. Set Supabase Auth Site/redirect URLs to the live site.
3. Run `pnpm smoke:live` (with `LIVE_URL`) to confirm the deployed site is healthy.
4. Hand the teacher the `TEACHER_GUIDE.md`; give them only the website admin login.

---

## Appearance Theme Completion (2026-09-05)

The Admin → Settings → Appearance panel is now fully functional. Previously,
`primaryColor` was saved and previewed but most components used hard-coded cyan
values, so changing the color had little visible effect.

### Completed

- Added live CSS theme tokens for primary color, soft background, border, and glow.
- Rebound shared button styles (`btn-primary`, `btn-outline`), input focus rings,
  badges, cards, text accents, scrollbar, selection, hero grid, and glows to the
  selected theme color.
- Added gaming-inspired presets: Neon Cyan, Electric Violet, Laser Lime,
  Hot Magenta, and Plasma Orange.
- Theme changes remain available after reload because they continue to save through
  `site_settings.primary_color`.
- Added dynamic theme application during settings load and live editing.
- Verified no horizontal overflow at 390px, 768px, and 1440px widths.

### Theme direction

The selected visual language is a restrained neon-gaming/synthwave system:
deep navy surfaces, high-contrast typography, a single configurable neon accent,
soft glows, restrained glass panels, and accessible focus states. This keeps the
school website energetic without making administrative forms difficult to read.

### Verification

- `pnpm run typecheck` — PASS.
- `pnpm test` — PASS (139 tests).
- `pnpm run build` — PASS, chunk-size warning remains resolved.

### Theme fixes follow-up (2026-09-05)

- Added the **Carbon Gray** preset inspired by the requested carbon/silver visual
  direction (`#a7b0bd`).
- Added persisted Button Style choices: **Solid**, **Outline**, and **Glass**.
- Added a runtime bridge for existing Tailwind `text-sky-*`, `bg-sky-*`,
  `border-sky-*`, and hover utilities so legacy pages such as Contact, Admission,
  Notice Board, Portal, and Admin follow the selected accent instead of remaining
  cyan.
- Added contrast-aware button text for light accents such as Carbon Gray.
- Notice filter pills, admission step indicators, ticker text, scrollbar, focus
  rings, and CTA buttons now follow the selected theme.
- Verified Carbon Gray + Outline live application through the admin UI:
  `primary=#a7b0bd`, `primary-ink=#07111f`, `buttonStyle=outline`.

---

## Backup Completeness Audit (2026-09-05)

The backup flow was audited against the live schema. The original implementation
had two safety gaps: manual backups silently skipped unreadable tables, and the
automatic function omitted payment approvals and fee audit records. The automatic
payload was also stored with an unnecessary nested envelope.

### Fixed in source

- Manual backup now includes `payment_approvals` and `fee_audit_logs`.
- A manual backup aborts and creates **no file** if any required table read fails.
- Automatic backup coverage now includes the same durable business/audit tables.
- Automatic snapshot downloads normalize both old nested snapshots and the new table-map format.
- Restore allowlist/order now matches the expanded durable backup coverage.
- Added admin-only **Create backup now** action so an operator can verify the full
  automated payload immediately rather than waiting for midnight.
- Corrected corrupted Bengali text on the backup page.
- Sessions, exam tokens, admin roster, password hashes, API keys, and database
  credentials remain intentionally excluded from portable backups for security.

### Current live status

At the time of this audit, the live `backups` table contained **zero snapshots**.
The table exists, but the new coverage migrations and first on-demand snapshot must
be applied/created before calling automated backup production-ready.

### Required operator verification

1. Run `scripts/apply-migrations.bat` again. It now applies:
   `20250905000002_backup_coverage.sql`,
   `20250905000003_backup_restore_coverage.sql`, and
   `20250905000004_admin_backup_now.sql` in addition to the prior hardening migration.
2. Open Admin → Backup → click **Create backup now**.
3. Confirm Backup History shows a new record with a non-zero/expected record count.
4. Download that snapshot and inspect that it contains:
   `students`, `teachers`, `batches`, `fees`, `payment_approvals`, `fee_audit_logs`,
   `notices`, `exams`, `mcq_questions`, `mcq_submissions`, `sms_logs`,
   `admission_requests`, and `site_settings`.
5. Keep the downloaded JSON outside the application server and verify the next
   midnight cron run creates another history entry.

---

## Live Data, Payments, Maps, Notices & SMS Follow-up (2026-09-05)

- Added Admin → Settings → Institute → **Map Embed URL**. Paste the HTTPS iframe
  `src` URL from Google Maps; Contact now renders it safely and keeps the placeholder
  when no valid HTTPS URL is configured.
- Dashboard student counts now use the same live population definition as the public
  homepage: `is_approved=true AND status='active'`. Demo-data loading was removed from
  the production dashboard so teachers cannot accidentally mix demo rows into a live
  institute database. The development seed utility remains available in source only.
- Monthly fee generation now uses each assigned batch's `monthly_fee`. Unassigned active
  students no longer receive an invented `৳1500` fee. The `৳500` setting is explicitly
  labeled as a one-time admission fee and is separate from monthly batch fees.
- Admin Notices now supports `general`, `exam`, `fees`, `holiday`, `result`, `urgent`,
  and `event`. Selecting **Result** lets an admin choose a real exam and generate a
  notice from the highest database submission, including score and student name.
  Legacy `fee` notices continue to display as `fees` publicly.
- Fee reminder and payment-confirmation SMS templates now use complete, polite Bengali
  wording with a helpful contact sentence and explicit receipt wording.

---

## Feedback, Email & SMS Cost Controls (2026-09-05)

- Replaced hard-coded homepage testimonials with published database-backed feedback.
  Admin → Settings → Institute now allows adding student name, achievement/grade,
  feedback text, rating, optional image upload, and publish/unpublish controls.
- Added the `feedback` table and public-read/admin-write RLS policies in
  `20250905000005_feedback_email.sql`.
- Added provider-neutral email delivery through `/api/send-email` and the Netlify
  equivalent. The default adapter supports Resend and a generic JSON HTTP email
  provider contract. Email API keys remain server-only.
- Added Admin → SMS Center → Send Email with reusable long-form templates for fee
  reminders, fee receipts, and notices.
- Added `email_logs` for delivery audit history and secure `portal_update_email`.
  Students can set/change their email from Portal → Profile.
- SMS templates are intentionally short for Bangladesh SMS character/cost limits;
  the full polite wording remains in the email templates.
- SMS provider, endpoint, sender ID, email provider, email endpoint, and from-address
  are configurable in Admin Settings. Secret keys remain hosting environment variables.

### Required deployment setup

1. Apply `supabase/migrations/20250905000005_feedback_email.sql` and
   `supabase/migrations/20250905000006_provider_secrets.sql` using the updated
   `scripts/apply-migrations.bat`.
2. Set server environment variables:
   - `EMAIL_API_KEY`
   - `EMAIL_FROM`
   - optional `EMAIL_PROVIDER` (`resend` by default)
   - optional `EMAIL_ENDPOINT` for a compatible generic JSON provider
   - existing `SMS_API_KEY` and `SMS_SENDER_ID` (optional after the protected
     provider_secrets table is configured from Admin Settings)
3. Configure provider endpoint/from values and API keys in Admin → Settings → SMS.
   Keys are masked and not returned after saving.
4. Add published feedback from Admin → Settings → Institute and verify it appears
   on the homepage.

### Provider management behavior

- Admin → Settings → SMS now supports SMS provider name, endpoint, sender ID,
  SMS API key, email provider, email endpoint, email-from address, and email API key.
- Keys are masked on entry and never returned to the browser after saving.
- The server reads `provider_secrets` only after validating the admin JWT.
- Email recipients can be selected dynamically in Admin → SMS Center → Send Email:
  all students with email, selected batch, one student, or custom addresses.
- Contact map input accepts a Google Maps iframe HTML snippet, iframe `src`, or
  normal Google Maps URL and converts it to a safe embed URL. If no link is saved,
  the center address is used as a Google Maps embed query fallback.

---

## Fresh Full Realtime Audit (2026-09-05)

Using the local admin credentials file internally (credentials were not printed),
the latest automated matrix produced:

- Combined admin/student collaboration: **19/19**.
- Focused admin CRUD/payment audit: **16/16**.
- Homepage/live database audit: **12/12**.
- Whole application public/admin/portal route audit: **29/29**.
- Admission flow: **9/10**; approval and student login succeeded, while one test
  assertion still expects the previous approval toast wording.
- Standalone student exam suite: blocked by its hard-coded prerequisite account/exam.

The combined realtime flow verified admission approval, portal login, student fee
submission, pending payment approval, admin approval, paid status/receipt, notice
publication, portal routes, reports, and backup rendering.

### Current audit-harness cleanup issue

The focused admin suite leaves disposable `ADM-E2E` batch rows, and old/current
`ADM-COMBINED` rows were still present after repeated historical runs. This is a
test-harness cleanup defect. No automatic destructive cleanup was performed during
the final audit because deleting live records by prefix without owner confirmation
would be unsafe. The database must be cleaned with a reviewed prefix-targeted script
or the next audit must run against a disposable Supabase project.

### Current blueprint decision

The core single-institute product is strongly verified. The multi-customer blueprint
remains AMBER until canonical clean-database provisioning, migration versioning,
first-admin setup, storage/provider secret setup, clean-database E2E, and customer
control-plane automation exist.

The remaining release risk is primarily environment and production-hardening verification rather than a known failing core workflow. Do not label the system fully production-cleared until the Supabase security/migration checks and mobile overflow decision are completed against the target deployment.
