# Coaching Center Management System

A full-stack web application for **Techely Learning Academy** with three surfaces:

- **Public website** — landing page, courses, admission form, notices, contact
- **Admin panel** — students, batches, teachers, fees, exams, notices, SMS, reports, settings, backups
- **Student portal** — login, dashboard, fees, exams, results, notices, profile

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript |
| Build | Vite + Tailwind CSS v4 |
| State | Zustand |
| Backend | Supabase (PostgreSQL, Auth, Storage, Realtime) |
| Functions | Netlify / Vercel serverless functions |
| Deployment | Netlify and Vercel |

## Prerequisites

Use the same versions as CI and deployment:

- **Node.js 24.15.0** (`.nvmrc`)
- **pnpm 11.10.0** (`packageManager` in `package.json`)
- Access to the existing Supabase project

Check versions:

```bash
node --version
pnpm --version
```

Expected:

```text
v24.15.0
11.10.0
```

## Environment setup

Copy `.env.example` to `.env.local`. At minimum, set:

```dotenv
VITE_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_your-public-key
VITE_EXPECTED_SUPABASE_PROJECT_REF=abcdefghijklmnopqrst
VITE_ENVIRONMENT_KIND=development
```

`.env.local` is git-ignored. Never commit it. Use the exact 20-character Supabase project ref from the hostname and choose one supported environment kind: `development`, `test`, `staging`, or `production`. The browser URL must be exactly `https://<ref>.supabase.co` (no path, query, port, trailing slash, or alternate host). Production builds require all four declarations and fail closed on a missing or mismatched identity.

`VITE_SUPABASE_ANON_KEY` is embedded in browser JavaScript, so it must be the **public anon JWT** or an `sb_publishable_` key. Never use a `service_role` JWT or `sb_secret_` key in any `VITE_` variable—the app refuses to start or build if one is detected. Unit tests use explicit synthetic `test` values in `vite.config.ts`; they are not production bypasses.

If a privileged key was exposed client-side:

1. Rotate/revoke it in **Supabase Dashboard → Project Settings → API Keys**.
2. Replace local and deployment `VITE_SUPABASE_ANON_KEY` values with the public anon/publishable key.
3. Clear old deployment artifacts, local `dist/` and `.netlify/`, and browser caches.
4. Redeploy only after the build-time key guard passes.

The SMS function also needs these **server-side** variables in Netlify/Vercel:

```dotenv
SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co
SUPABASE_ANON_KEY=sb_publishable_your-public-key
EXPECTED_SUPABASE_PROJECT_REF=abcdefghijklmnopqrst
ENVIRONMENT_KIND=development
SMS_API_KEY=
SMS_SENDER_ID=CoachMS
SMS_ENDPOINT=https://api.mimsms.com/smsapi
EMAIL_API_KEY=
EMAIL_FROM=
EMAIL_PROVIDER=resend
EMAIL_ENDPOINT=https://api.resend.com/emails
PROVIDER_HOST_ALLOWLIST=
```

Keep provider API keys empty during local checks unless you intentionally want to send a real message. Outbound provider fetches default to an exact-host allowlist containing only `api.mimsms.com` and `api.resend.com`, and validate the host again on every redirect. To use another provider, add each trusted DNS hostname explicitly to the comma-separated, server-only `PROVIDER_HOST_ALLOWLIST`. Entries are hostnames only: wildcards, IP literals, credentials, URLs, ports, and suffix/subdomain matching are rejected. An endpoint must use HTTPS on its default port, and every DNS result must remain outside private and reserved IPv4/IPv6 ranges. The request socket is pinned to one validated public answer without a second hostname resolution while retaining the configured hostname for Host, TLS SNI, and certificate verification; each allowed same-origin redirect is independently resolved, validated, and pinned.

Configure the same server identity variables for every SMS, email, avatar, public-asset, and home-stats function. Each endpoint returns `503` before authentication, database, storage, or provider I/O if required identity configuration is absent, the kind is unsupported, the anon key is secret/invalid, or `SUPABASE_URL` is not the exact origin for `EXPECTED_SUPABASE_PROJECT_REF`. Set both environment kinds to `production` in production and verify the browser and server refs are identical before deployment.

## Run on your laptop

From the repository directory:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:5173>.

This starts the Vite frontend only. All normal Supabase-backed pages work, but `/api/send-sms` is not available because Vite does not emulate serverless functions.

### Run the complete app with the SMS route

Use Netlify Dev:

```bash
pnpm dlx netlify-cli dev
```

Open <http://localhost:8888>. Netlify Dev proxies Vite on port 5173 and exposes `/api/send-sms` through the local function emulator.

Expected route-health behavior without authentication:

```bash
curl -i -X POST http://localhost:8888/api/send-sms \
  -H "Content-Type: application/json" \
  --data '{"phones":["01700000000"],"message":"route health check"}'
```

The correct response is JSON with HTTP `401 Unauthorized`. HTML means the SPA fallback intercepted the API route.

## Quality checks

GitHub Actions runs the same fail-fast sequence on pushes and pull requests to `main`:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

`typecheck` covers the frontend plus the Vercel/Netlify SMS function entrypoints and shared server code. `pnpm run build` is the production packaging gate: it removes the existing `dist`, builds in production mode, then runs `release:check`. The gate rejects test-environment markers, synthetic project refs/keys in `dist`, bundle-analysis output in `dist` or the legacy root `stats.html`, and local credential, temporary, or log artifacts. Netlify and Vercel invoke this same clean production build; never upload or package a pre-existing `dist` directly.

Bundle visualization is disabled for normal builds. Run `ANALYZE_BUNDLE=1 pnpm run build:production` only when analysis is needed; it writes `analysis/bundle/stats.html`, outside the packaged `dist` directory. The ignored `analysis/` directory is local tooling output and must not be released.

## Manual smoke-test checklist

Use disposable records for create/edit/delete, password, restore, and SMS checks.

### Public and routing

- `/` — branding, active batches, teachers, notice ticker, navigation
- `/courses` — search and filters
- `/admission` — validation and admission request submission
- `/notices` — published public notices only
- `/contact` — contact information and message form
- `/admin/login` and `/portal/login` — direct navigation and hard refresh
- `/admin/dashboard` and `/portal/dashboard` — unauthenticated redirect behavior
- Unknown path — application 404 page

### Student portal

With an approved disposable student:

- Login by phone/password and confirm `/portal/dashboard` loads
- `/portal/fees`, `/portal/exams`, `/portal/results`, `/portal/notices`, `/portal/profile`
- Profile photo and password change only after the private `avatars` bucket, signed retrieval route, and server-only service-role environment are configured
- Logout and confirm protected pages redirect to `/portal/login`
- Exam link: join, autosave/reload, submit, result, review, duplicate-submit prevention

### Admin

With a Supabase Auth user whose email is present in the server-authoritative `admin_users` roster:

- Dashboard, students, batches, teachers, fees, exams, results
- Notices, admissions, SMS, reports, settings, backup
- CRUD only with disposable records
- Verify PDF/CSV downloads
- Verify Realtime exam updates if `exams` and `mcq_submissions` are in the Supabase publication
- Verify backup restore only against disposable data

### SMS

- `GET /api/send-sms` → JSON `405`
- Unauthenticated `POST /api/send-sms` → JSON `401`
- Authenticated request with no `SMS_API_KEY` → JSON `503` (`SMS service unavailable`); no SMS is transmitted
- Configure and test a real provider key only when explicitly intended

## Database provisioning and showcase upgrades

`supabase/schema/migration-manifest.json` is the only authoritative order. It classifies the fresh baseline, every required migration (including fee-audit RLS), and optional operational migrations. Legacy `migration.sql` and `update_rls_policies.sql` are not provisioning inputs.

### Fresh customer (empty database only)

First run offline dry-run (it hashes files and makes no network connection):

```bash
CUSTOMER_ID=customer-slug CUSTOMER_NAME="Customer" pnpm provision:customer
```

A real apply additionally requires `PROVISION_APPLY=1`, `CUSTOMER_DATABASE_URL` with `sslmode=verify-full`, the exact `CUSTOMER_PROJECT_REF`, `CUSTOMER_ENVIRONMENT`, and matching `PROVISION_ALLOWED_ENVIRONMENT`. The URL host/pooler user must encode that exact project ref. The tool refuses any existing business table or provisioning ledger, applies `canonical.sql` plus every required migration body and ledger row in one atomic transaction, excludes post-commit fixture checks, and then performs read-only verification that required objects exist and all business tables are empty. Any failure rolls back the complete install. Optional cron/in-database backup migrations are never auto-applied.

### Empty-customer handover completion

After schema provisioning and first-admin bootstrap, run the **read-only** handover preflight. It verifies the exact HTTPS Supabase project/environment identity, matches every required migration and checksum against `provisioning_migrations`, confirms only real business/transaction tables have exactly zero rows, validates the expected seeded `site_settings` defaults and exactly the `sms`/`mim` and `email`/`resend` `messaging_configuration` rows with no secret-shaped columns or values, checks Storage, and confirms the declared first admin exists in both Auth and `admin_users`. It never prints credential values.

The report has two independent gates:

- `coreReady`: migration files/checksums, empty business data, safe seeded configuration, required Storage buckets/access, and first-admin readiness all pass.
- `handoverReady`: `coreReady` plus both MIM and Resend credential-presence booleans, worker and cron secrets, provider verification/approval evidence, independent backup evidence, and explicit SMS and email live-delivery evidence files all pass. Missing providers may still leave `coreReady: true`, but always produce `handoverReady: false` and a nonzero exit status.

```bash
ONBOARD_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co/ \
ONBOARD_PROJECT_REF=abcdefghijklmnopqrst \
ONBOARD_ENVIRONMENT=production ONBOARD_ALLOWED_ENVIRONMENT=production \
BOOTSTRAP_ADMIN_USER_ID=123e4567-e89b-42d3-a456-426614174000 \
BOOTSTRAP_ADMIN_EMAIL=owner@example.com \
SUPABASE_SERVICE_ROLE_KEY='set-in-shell-or-secret-manager' \
pnpm onboard:preflight
```

Before bootstrap, disable public Auth signup in **Supabase Dashboard → Authentication → Providers → Email** (turn off new-user signup) and keep it disabled until the first admin is verified. Create the intended administrator in **Authentication → Users**, confirm the email, and record the exact Auth UUID and lowercase email. The user must have the approved `email` identity/provider and no pending email change. The bootstrap never accepts a password, defaults to a no-write dry-run, and requires both identifiers.

```bash
BOOTSTRAP_ADMIN_USER_ID=123e4567-e89b-42d3-a456-426614174000 \
BOOTSTRAP_ADMIN_EMAIL=owner@example.com \
ONBOARD_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co/ \
ONBOARD_PROJECT_REF=abcdefghijklmnopqrst \
ONBOARD_ENVIRONMENT=production ONBOARD_ALLOWED_ENVIRONMENT=production \
SUPABASE_SERVICE_ROLE_KEY='set-in-shell-or-secret-manager' \
pnpm onboard:first-admin
```

To apply, review the dry-run output and rerun with `BOOTSTRAP_ADMIN_APPLY=1` plus the exact confirmation bound to UUID, email, project, and environment:

```text
BOOTSTRAP_ADMIN_CONFIRM=ADD 123e4567-e89b-42d3-a456-426614174000 owner@example.com TO abcdefghijklmnopqrst/production
```

The tools reject alternate hosts, non-HTTPS URLs, project/environment mismatches, and `NODE_TLS_REJECT_UNAUTHORIZED=0`. Keep the service-role key in the operator shell/hosting secret store; do not put it in a command transcript, report, `VITE_` variable, or repository file. The bootstrap does not create Auth users and never accepts or stores a password.

Provider and operational completion gates:

### Provider-neutral messaging contract

`messaging_configuration` is the safe source of truth per channel: `provider_name`, `enabled`, complete non-secret `provider_config`, UUID `config_revision`, and retry/lease settings. MIM metadata is `{providerName:'mim',userName,senderName}`; Resend metadata is `{providerName:'resend',from}`. Custom providers are exact-allowlisted HTTPS POST endpoints with restricted canonical field mappings, declared auth/idempotency placement, accepted statuses, optional scalar success condition, provider ID path, and optional sender identity. Static request headers/bodies, scripts, credentials, query strings, fragments, ports, sensitive paths/headers, and secret-shaped literals are rejected.

Credentials are AES-256-GCM encrypted server-side and versioned by channel, provider, and UUID configuration revision. Jobs atomically snapshot safe configuration at enqueue and workers resolve the exact credential revision. Preserve causes server re-encryption into the new revision; replace stores new material; remove is blocked while nonterminal jobs reference the provider. Admin configuration responses expose only safe metadata, credential presence, fingerprint, and hint. Built-in environment credentials remain fallback only; custom providers require an encrypted credential version.

- **MIM SMS:** MIM must activate the API; configure the exact approved sender ID, username, key, and complete MIM domain/IP whitelisting. For preflight declarations use `MIM_API_ACTIVATED=1`, `MIM_EXPECTED_SENDER_ID` matching `SMS_SENDER_NAME`, and `MIM_WHITELIST_CONFIRMED=1`; point `ONBOARD_MIM_APPROVAL_EVIDENCE_FILE` to the reviewed sender/IP-domain approval record.
- **Resend email:** configure a Resend API key, a verified sending domain and matching `RESEND_FROM` address, and `RESEND_WEBHOOK_SECRET`. Set `RESEND_DOMAIN_VERIFIED=1` only after verification is complete, and point `ONBOARD_RESEND_VERIFICATION_EVIDENCE_FILE` to the reviewed sender/domain/webhook record.
- **Workers/backups:** set server-only `MESSAGING_WORKER_SECRET` and `CRON_SECRET`, and point `ONBOARD_INDEPENDENT_BACKUP_EVIDENCE_FILE` to reviewed off-project backup/restore evidence.
- **Live evidence:** `ONBOARD_SMS_LIVE_DELIVERY_EVIDENCE_FILE` and `ONBOARD_EMAIL_LIVE_DELIVERY_EVIDENCE_FILE` must each name a nonempty reviewed evidence file from credentialed staging delivery to approved recipients. Declarations alone never prove delivery.
- **Result rule:** only `handoverReady: true` is a passing handover. `coreReady: true` is useful partial readiness, never a claim of complete handover.

Run the script safety suite entirely offline:

```bash
pnpm test:onboarding-offline
```

See `HANDOVER_FEATURE_MATRIX.md` for the status of every customer-facing feature.

### Existing populated showcase database

Use the distinct read-only planner:

```bash
CUSTOMER_ID=showcase CUSTOMER_PROJECT_REF=... CUSTOMER_ENVIRONMENT=showcase \
UPGRADE_ALLOWED_ENVIRONMENT=showcase CUSTOMER_DATABASE_URL='...?sslmode=verify-full' \
pnpm upgrade:showcase
```

Apply is blocked unless `UPGRADE_APPLY=1`, `UPGRADE_PLAN_FILE` points to that reviewed dry-run report, and `UPGRADE_BACKUP_EVIDENCE_FILE` contains matching `projectRef`, `createdAt`, `verifiedAt`, an immutable backup location, and a SHA-256. The live schema/row-count/ledger signature must still match. A populated database without `provisioning_migrations` also needs `UPGRADE_ADOPTION_FILE`: an operator-reviewed, project/signature-bound list of every required migration and exact checksum. Never infer migration adoption from object names alone.

### Showcase fixtures

Browser seeding is disabled and absent from browser data access. `pnpm fixture:showcase` is an operator-only, dry-run-first server tool. Apply requires `SHOWCASE_FIXTURE_APPLY=1`, strict project/TLS identity, and `CUSTOMER_ENVIRONMENT=showcase`; inserted rows receive a run record plus per-row ownership markers. It refuses production/customer environments.

### Required final hardening migrations

The authoritative manifest includes the final production blockers: atomic exam deletion, serialized/bcrypt-only student authentication, and private student avatars with a separate public-assets bucket (`20250911000001`, `20250912000001`, and `20250913000001`). Never deploy frontend code that calls these RPCs or upload routes before the matching migration chain is applied.

Student photos remain private and are displayed through short-lived signed URLs. Logos, banners, teacher photos, feedback images, and admin avatars use the `public-assets` bucket through the admin-authenticated `/api/upload-public-asset` server route. Existing non-student files under the old `avatars` paths must be copied to `public-assets` and their stored URLs updated, or re-uploaded from Admin Settings. The migration cannot copy Storage object bytes.

Auth/Storage resources, domains, billing, provider credentials, and optional operational migrations are separate reviewed control-plane steps.

### Backup security, independent copies, and retention

The optional backup chain must be applied in manifest order through `20250905000007_backup_payload_redaction.sql`. The final migration redefines automated snapshots, scrubs existing `public.backups` rows, and keeps access behind the admin RLS policy. Portable/manual exports pass through the same application redaction boundary. Neither format may contain student password hashes, admission reference/default credentials, provider responses, session or exam tokens, provider secrets, or secret-like `site_settings` rows. Treat every retained backup as sensitive because it still contains intended student, financial, exam, and audit data.

In-database `public.backups` rows are operational conveniences, not disaster recovery: a project compromise, deletion, billing event, or regional incident can affect both the live data and those rows. On a documented schedule, create an **independent encrypted copy outside the Supabase project** in access-controlled object storage or a managed backup vault. Use encryption in transit and at rest, keep encryption keys in a separate secrets/KMS account, restrict restore/download access to named operators with MFA, enable immutable/versioned retention where available, and verify checksums plus a disposable restore without exposing production data.

Define and record retention by business/legal need rather than keeping snapshots forever. A reasonable starting policy is daily copies for 7 days, weekly copies for 5 weeks, and monthly copies for 12 months, adjusted for local requirements. Automatically expire both `public.backups` rows and off-project copies at the approved deadline; record backup creation, restore tests, failures, and deletion evidence. Legal holds must be explicit, time-bounded, and reviewed. Never use repository files, developer laptops, browser download folders, or the source Supabase project as the only backup location.
