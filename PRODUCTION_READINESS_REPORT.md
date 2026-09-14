# Production Readiness Audit and Repair Report

Date: 2026-09-13
Scope: public website, admin panel, student portal, exams, serverless endpoints, Supabase schema/migrations, provisioning, showcase data, deployment, responsive behavior, accessibility, tests, and handover packaging.

## Executive verdict

The supplied archive was not safe for a production customer handover. The immediate code-level blockers listed below have been repaired in this package. No temporary or original database was connected to or modified during this repair.

Production deployment is still conditional on applying the authoritative migration manifest to the intended Supabase project and completing the environment-specific checks in the final section. A populated showcase database and a new empty customer database must use separate workflows.

## Immediate blockers found and repaired

### 1. Fresh customer provisioning could not install an empty database

Status: Fixed.

The provisioner checked for the canonical baseline but never executed it, then ran migrations that assumed existing tables. Fresh provisioning now executes the canonical baseline and every required migration body from the single authoritative manifest.

### 2. Provisioning could leave a partially installed and temporarily insecure database

Status: Fixed.

Historical migration files contain internal transaction boundaries and post-commit probes. The old runner could commit early, then fail later. Fresh provisioning now strips reviewed wrappers, excludes post-commit fixture probes, and applies the baseline, all required migration bodies, and all ledger rows in one PostgreSQL transaction. Any failure rolls back the complete install. Final verification is read-only.

### 3. Migration order differed between install tools

Status: Fixed.

The hard-coded provisioner and JSON manifest had different migration counts and omitted the fee-audit authorization repair on some paths. All fresh, disposable, and staging tooling now consumes supabase/schema/migration-manifest.json. The final security migrations are included.

### 4. No safe path existed for a populated showcase database

Status: Fixed at tooling level.

A separate dry-run-first upgrade-existing workflow now inventories the target, requires exact project/environment identity, requires immutable backup evidence for apply, detects schema/row/ledger drift, and requires reviewed adoption evidence when a legacy database has no ledger. It never applies the fresh baseline to a populated database.

### 5. Demo data could contaminate a customer database

Status: Fixed.

Browser-side demo seeding was disabled. Showcase fixtures are now operator-only, dry-run-first, restricted to the exact showcase environment/project, and tagged with run ownership. A clean customer install verifies all classified business tables are empty.

### 6. Portable and automated backups exposed credentials and sensitive fields

Status: Fixed in code and forward migration.

Student password hashes, admission default credentials, provider responses, tokens, provider secrets, admin rosters, and secret-like settings are removed from portable backup payloads. Uploaded backups have strict version, table, JSON, size, per-table row, and total-row validation. A forward operational migration redefines automated backup creation and scrubs sensitive fields from existing in-database backup rows.

### 7. Backup restore could partially overwrite production data

Status: Fixed.

The non-transactional browser fallback was removed. Restore now fails closed unless the supported transactional admin_restore_backup RPC is installed, and it accepts only a validated supported backup envelope.

### 8. Admission approval was a multi-step partial-write flow

Status: Fixed.

Student creation, enrollment changes, and application approval now use the atomic admin_approve_admission RPC. Failures do not create half-approved records, and idempotent retries do not resend incorrect credentials.

### 9. Exam deletion could destroy related records only partially

Status: Fixed.

The client now calls the admin-gated transactional admin_delete_exam RPC. Questions, submissions, tokens, and the exam are removed atomically, with no sequential browser fallback.

### 10. Student login throttling was raceable and plaintext passwords remained accepted

Status: Fixed by forward migration.

Login attempts are serialized per normalized phone using a transaction-scoped advisory lock. Legacy non-empty plaintext passwords are migrated to bcrypt, plaintext comparison is removed, and rate-limit evaluation fails closed. Admission references and fallback secrets now use cryptographically secure randomness.

### 11. Private avatar policy conflicted with application uploads and display

Status: Fixed.

Student photos remain in a private avatars bucket and use authenticated server uploads plus short-lived signed retrieval URLs. Public logos, banners, teacher photos, feedback images, and admin assets use a separate public-assets bucket through an admin-authenticated server route. Direct browser writes and private-bucket public URL assumptions were removed.

### 12. Public admission and contact forms were anonymously writable at the database boundary

Status: Fixed.

The browser no longer inserts directly. Strict serverless endpoints enforce JSON/body/field limits, unknown-field rejection, honeypots, trusted platform client-IP extraction, and database-backed atomic rate limiting by IP and phone or email. Admission references are generated server-side. Anonymous insert policies and grants are removed by the required migration.

### 13. Provider URLs had a DNS-rebinding and SSRF gap

Status: Fixed.

SMS and email provider requests now require exact server-side hostname allowlisting on the initial request and every redirect. Wildcards, IP literals, credentials, non-default HTTPS ports, suffix matching, and private/reserved IPv4 and IPv6 destinations are rejected. Each permitted URL is resolved once, every DNS answer is validated, and the HTTPS socket is pinned to one validated public IP while the original hostname remains authoritative for Host, TLS SNI, and certificate verification; same-origin redirects repeat that resolve/validate/pin sequence.

### 14. SMS and email requests had no practical cost or payload ceiling

Status: Fixed.

Server handlers now cap body size, recipient count, recipient length, subject/message size, and HTML size before provider calls.

### 15. Browser and server deployments could point to different Supabase projects

Status: Fixed.

Production builds and serverless handlers require an explicit environment kind and exact 20-character expected project reference. Browser and server Supabase URLs must match that reference, and client variables reject privileged keys.

### 16. Deployment lacked standard browser security headers

Status: Fixed.

Netlify and Vercel configurations now include a content security policy, HSTS, nosniff, restrictive referrer policy, permissions policy, and anti-framing protection.

### 17. Responsive navigation and controls were clipped or off-screen

Status: Fixed.

Repairs include the 768px public-navbar collision, narrow admin search, notification dropdown sizing, student drawer tabs, public drawer width, admin tab-strip reachability, short-viewport dialogs, sticky notice form offset, safe-area-aware portal navigation, mobile target sizing, responsive metric grids, and full answer wrapping.

### 18. Dialogs, loading states, icon buttons, and motion preferences had accessibility defects

Status: Fixed for the audited critical paths.

Audited overlays now have dialog semantics, labels, Escape behavior, viewport-safe scrolling, and accessible close controls. Loading skeletons announce status. Reduced-motion preferences disable nonessential animation. Hidden table actions are keyboard reachable. Form and control labeling was improved on repaired surfaces.

### 19. Public database failures appeared as valid empty states

Status: Fixed.

Course and notice pages now distinguish loading, request failure, and a successful zero-row result.

### 20. The automated quality gate was broken

Status: Fixed.

The missing Vitest setup and staging verification artifacts were restored, stale migration-count assertions were corrected, hook and lint warnings were resolved, and the manual chunking strategy no longer creates circular chunks.

### 21. Sensitive and dangerous local artifacts were included in the handover archive

Status: Fixed.

Linked-project metadata, pooler details, local isolated credentials, migration logs, and generated process files were removed. Superseded permissive SQL was moved into docs/legacy with an explicit do-not-run warning.

## Responsive verification

The repaired production build was exercised in headless Chromium with mocked upstream responses and no live database writes.

- Public and authentication routes: 36 route/viewport checks, 0 failures.
- Authenticated admin and student routes: 57 route/viewport checks, 0 failures.
- Widths covered: 320px phone, 375px phone, 768px tablet, and 1366px laptop where applicable.
- Checks included horizontal document overflow, interactive controls outside the viewport, route protection, visible rendering, mobile navigation bounds, and unexpected console/runtime errors.

Reports:

- production-readiness-viewport-report.json
- authenticated-viewport-report.json

## Automated verification

- TypeScript frontend and server typecheck: passed.
- ESLint: passed with zero warnings and zero errors.
- Vitest: 73 files and 564 tests passed.
- Production build: passed.
- Production dependency audit: no known vulnerabilities.
- Bundle: no circular-chunk warnings; largest main JavaScript chunk remained below the configured 700 kB warning threshold.

The expanded offline suite now covers messaging validation and host safety, durable outbox and channel-scoped claims, worker heartbeat, atomic attempt and aggregate accounting, non-reclaimable MIM dispatch fencing, stable per-delivery Resend idempotency, ambiguous provider outcomes, DLR and webhook transitions, safe test sends, recipient privacy, and onboarding/provisioning evidence gates. Provider HTTPS connections use validated DNS results through IP-pinned TLS while preserving certificate validation for the approved hostname. These tests use fixtures, mocked upstreams, and dry-run/read-only paths; they do not make live provider calls and do not prove that an SMS or email was delivered. Credentialed staging delivery evidence remains a separate handover requirement.

## Provider-neutral messaging completion

SMS and email are no longer locked to one vendor. MIM and Resend remain backward-compatible built-ins, while an administrator can select a secure custom HTTPS JSON provider for either channel. Custom configuration is restricted to canonical field mappings, declared authentication and idempotency placement, accepted HTTP statuses, an optional scalar success condition, and a provider-message-ID path. Arbitrary scripts, static secret headers or bodies, endpoint credentials, query strings, redirects, unsafe paths, and non-allowlisted destinations are rejected.

Provider API keys are submitted through write-only admin controls, encrypted with AES-256-GCM, versioned by channel/provider/configuration revision, inaccessible to browser roles, and excluded from backups. Queued jobs retain immutable provider/configuration snapshots and exact credential revisions, so changing providers does not reroute existing work. Non-idempotent providers use at-most-once dispatch fencing; idempotent providers reuse stable delivery keys. Provider responses are limited to 1 MiB, DNS is validated and pinned to the TLS connection, and no credential is returned through configuration/readiness APIs.

## Required environment-specific work before a real launch

These checks cannot be completed against an archive without access to the intended Supabase and hosting projects. They are mandatory before handover:

1. Use Node 24.15.0 or newer within Node 24. The repair environment was Node 24.14.1, so pnpm emitted an engine warning even though all checks passed.
2. Set matching browser and server project identity variables exactly as documented in .env.example.
3. For a new customer, run the customer provisioner dry-run, review its report, and apply only to a confirmed empty assigned project.
4. For the populated showcase, run the separate upgrade dry-run; take an independently recoverable backup; review adoption evidence; then apply only if the target signature is unchanged.
5. Apply all required manifest migrations before deploying matching frontend code, including atomic exam deletion, student authentication hardening, private-avatar/public-assets storage, and public-form abuse prevention.
6. Configure Supabase Auth, create the first admin roster entry, and verify is_admin returns true only for that account.
7. Configure the private avatars and public-assets storage migration. Copy legacy non-student Storage objects to public-assets or re-upload them; SQL cannot move object bytes.
8. Set server-only SUPABASE_SERVICE_ROLE_KEY. Never use it in a VITE_ variable.
9. Configure Realtime publications only for the tables that require live updates.
10. Configure MIM SMS_USERNAME, SMS_API_KEY, and the approved 1–11 character SMS_SENDER_NAME; configure Resend RESEND_API_KEY, verified RESEND_FROM, and RESEND_WEBHOOK_SECRET; then set MESSAGING_WORKER_SECRET, CRON_SECRET, and the single-recipient MESSAGING_TEST_RECIPIENT_ALLOWLIST only on the server. Complete MIM API activation and IP/domain whitelisting, and add every non-default provider host to the exact PROVIDER_HOST_ALLOWLIST.
11. Enable optional backup/cron migrations only when the Supabase plan and extensions support them. Store encrypted backups outside the source project/account, separate encryption keys, define retention, and perform a real restore drill.
12. Run authenticated end-to-end tests with disposable records against the actual target deployment, including admission, payment approval, exam submission, avatar upload, backup/restore, SMS, and email.
13. Verify CSP connections against the actual analytics, Sentry, font, map, Supabase, SMS, and email domains before launch.
14. Rotate any credential that may previously have been used in the removed local credential file or distributed backup exports.

## Handover modes

### Showcase

Keep the populated showcase project separate. Use upgrade-existing for schema changes and seed-showcase only for run-owned synthetic fixtures. Never give a customer the showcase database or its credentials.

### New coaching center

Create a separate Supabase project, run the fresh customer provisioner against the empty target, create the first authorized admin, configure branding/providers/domain, and confirm the business tables are empty before the center begins entering real data.
