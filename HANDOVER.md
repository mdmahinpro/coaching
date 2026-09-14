# Coaching Center App — Operator Handover

This app is a ready-to-run **coaching center management system** with three
surfaces: a public website, an admin panel, and a student portal. It is built
so that a training center can run and customize it **without writing code** —
almost everything is edited from the admin panel.

This document is the "blueprint": what can be changed without code, what must
be done once by a developer/Supabase admin, and how to run everything.

---

## 1. What the operator can change without code (Admin → Settings)

Open the admin panel, go to **Settings**. Every tab edits one part of the site:

| Tab | What you can change |
|---|---|
| Institute | Center name, tagline, address, phone, email, WhatsApp, hero title/subtitle, admission open/closed, class levels (শ্রেণী) |
| Payment | bKash/Nagad numbers, admission fee, payment instructions, per-gateway enable |
| SMS | SMS sender + settings (needs your SMS provider key) |
| Stats | Homepage counters (auto from DB or manual), show/hide the hero stats row |
| Social | Facebook / YouTube / Instagram URLs (shown in the footer) |
| Appearance | Logo (also the favicon), banner, primary color |
| Admins | Add/remove admin accounts, reset passwords |

Everything here saves to the database and applies immediately site-wide.

### Everyday tasks that need no code
- **Batches**: add/edit class batches, their **schedule days**, **start time and
  end time**.
- **Students**: add, approve, assign a batch, profile photo.
- **Teachers**: add teacher profiles (name, subject, photo, bio, salary).
- **Fees**: record payments, approve student-submitted bKash/Nagad
  transactions, download receipts.
- **Exams**: create MCQ exams, add/import questions (see §4), publish, review
  results, export CSV.
- **Notices**: publish announcements to the website notice board.

---

## 2. Student portal

Students log in by **phone + password**. Their default password is the
**reference number** (APP-XXXXXX) they received when their admission was
approved. They can change it from the portal profile page.

The portal shows: dashboard, fees (+ paying by bKash/Nagad), exams, results,
notices, and their profile.

---

## 3. Notifications (admin bell)

New admission applications and student-submitted payments raise a **toast**
(top-right) plus an entry in the **bell** next to the admin avatar.

- A notification **stays until it is opened** (clicked) — it does not time out.
- Clicking a toast or bell item marks it read and opens the relevant page.

---

## 4. Exam questions & the answer review

- Each question has text, options **A–D**, the **correct option**, and marks.
- The **bulk import** box accepts pasted text (see below).
- After a student finishes an exam, the **result breakdown** shows, for every
  question: the student's selected option **with its text** and the **correct
  option with its text**, so a re-visiting student/admin can understand the
  answer.

### Bulk question import format

Paste lines like these (one question block; blank line separates questions):

```text
Q: What is 2+2?
A: 3
B: 4
C: 5
D: 6
ANS: B
MARKS: 5

Q: Capital of France?
A: London
B: Paris
C: Rome
D: Berlin
ANS: B
```

---

## 5. One-time setup (needs Supabase / a developer)

Do not paste an ad-hoc subset of migrations into the SQL editor. The sole ordered source is `supabase/schema/migration-manifest.json`; every required entry has an explicit phase/classification and optional operational migrations are separate.

- **Empty customer project:** run `pnpm provision:customer` first (offline dry-run). Apply only with the exact customer/project/environment variables documented in `README.md`. The tool verifies an empty target, applies `canonical.sql`, every required migration body, and all ledger rows in one atomic transaction, then verifies all business tables remain empty.
- **Populated showcase project:** run `pnpm upgrade:showcase` to produce a read-only dry-run report. Apply requires that exact plan, immutable backup evidence, an unchanged schema signature, and—when no migration ledger exists—reviewed adoption evidence.

Auth users, Storage buckets/policies, domains, billing, provider credentials, and optional cron/backup operations remain explicit control-plane/operator steps. Apply the final atomic exam deletion, student-authentication hardening, and private-avatar/public-assets migrations before deploying the matching frontend. Copy legacy public branding and teacher image objects from the old `avatars` paths to `public-assets`, or re-upload them from Admin Settings; SQL cannot move Storage object bytes.

---

## 6. Empty-customer onboarding completion

Use this sequence only after the required fresh schema chain has been provisioned:

1. Disable public Auth signup in **Supabase Authentication → Providers → Email** for the bootstrap window. Create the owner in **Authentication → Users**, confirm the email, and record the exact Auth UUID and lowercase email. Set or invite the password there; never give a password to repository scripts.
2. Run `pnpm onboard:first-admin` with explicit `BOOTSTRAP_ADMIN_USER_ID` and `BOOTSTRAP_ADMIN_EMAIL` (and only set `BOOTSTRAP_ADMIN_ALLOWED_PROVIDER` when an approved provider other than the default `email` is intentional). It defaults to dry-run and requires exact UUID/email equality, `email_confirmed_at`, a matching approved identity/provider, and no pending email change.
3. Apply only after review with `BOOTSTRAP_ADMIN_APPLY=1` and the exact `BOOTSTRAP_ADMIN_CONFIRM` shown by dry-run (`ADD <uuid> <email> TO <project-ref>/<environment>`). The script only inserts that verified Auth user into `admin_users`; it does not create a user, accept a password, or perform other writes.
4. Run `pnpm onboard:preflight` with that same UUID/email pair, exact `ONBOARD_SUPABASE_URL`, 20-character `ONBOARD_PROJECT_REF`, matching `ONBOARD_ENVIRONMENT` / `ONBOARD_ALLOWED_ENVIRONMENT`, and a temporary server-side `SUPABASE_SERVICE_ROLE_KEY`. This is read-only and reports no secret values.
5. Review `coreReady` separately from `handoverReady`. `coreReady` requires the required migration checksums, zero rows only in real business/transaction tables, safe expected seeded `site_settings`, exactly the supported `sms`/`mim` and `email`/`resend` configuration rows, Storage, and the first admin in Auth plus `admin_users`.
6. Treat only `handoverReady: true` as a passing handover. It additionally requires both provider credential-presence checks, worker/cron configuration, reviewed Resend verification and MIM approval evidence, independent backup evidence, and separate explicit live SMS/email delivery evidence files. With either provider absent, the command exits nonzero even when `coreReady` is true.
7. Remove the service-role key from the local shell/session when finished and retain only the non-secret reports and reviewed evidence.

Both tools require the exact project/environment identity, the canonical `https://<ref>.supabase.co/` origin, normal certificate verification, and refuse `NODE_TLS_REJECT_UNAUTHORIZED=0`.

### External provider and evidence gates

- **MIM:** API activation by MIM, the exact approved sender ID, username, key, and MIM domain/IP whitelisting are all mandatory. A configured UI is not evidence that MIM has activated or delivered messages. Supply reviewed sender/IP-domain approval evidence through `ONBOARD_MIM_APPROVAL_EVIDENCE_FILE`.
- **Resend:** API key, verified sending domain and matching from address, and webhook signing secret are mandatory. Supply reviewed sender/domain/webhook verification evidence through `ONBOARD_RESEND_VERIFICATION_EVIDENCE_FILE`.
- **Operations:** server-side `MESSAGING_WORKER_SECRET` and `CRON_SECRET` must both be configured. Supply off-project backup/restore evidence through `ONBOARD_INDEPENDENT_BACKUP_EVIDENCE_FILE`.
- **Live delivery:** complete credentialed staging sends only to approved test recipients. Retain separate nonempty records and provide them as `ONBOARD_SMS_LIVE_DELIVERY_EVIDENCE_FILE` and `ONBOARD_EMAIL_LIVE_DELIVERY_EVIDENCE_FILE`. File presence is a gate for operator review, not cryptographic proof of its contents.

Run the offline-only script tests with `pnpm test:onboarding-offline`. Consult `HANDOVER_FEATURE_MATRIX.md` for verified, externally gated, and optional classifications.

---

## 7. Run / deploy / test

See `README.md` for the full technical runbook (install, env vars, deploy to
Netlify/Vercel). Quick start:

```bash
pnpm install --frozen-lockfile
pnpm dev          # http://localhost:5173
```

Quality gates (run after any change):

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

`pnpm run build` and both hosting deploy configurations always delete the old `dist`, perform a production-mode build, and run `release:check`. The release gate fails on test markers, synthetic project refs/keys, or bundle-analysis output in `dist`; it also rejects the legacy root `stats.html` and local credential, temp, or log residue. Do not package a previously generated `dist`.

Bundle visualization is opt-in: `ANALYZE_BUNDLE=1 pnpm run build:production` writes `analysis/bundle/stats.html`. That ignored analysis directory is outside `dist` and must not be included in release packaging; ordinary production builds create no analysis report.

Browser E2E harnesses live in `e2e/` and are documented in `e2e/README.md`
(require the dev server on `http://127.0.0.1:5173`).

---

## 8. Showcase existing data & demo data (showcase only)

This section applies only to the populated **showcase project**. It does not describe a customer database and must not be used to turn a populated project into a fresh customer installation. At showcase handover, that database may contain retained presentation records (batches, teachers, students, fees, exams, notices) plus synthetic demo/seed rows. Decide what the showcase should retain before presenting it.

### Existing showcase data — keep as-is
- Retained showcase batches, teachers, students, fees, exams, notices, and settings can stay exactly as they are. Do not infer that the same records exist in any customer project.
- Never assume which migrations are missing from a populated showcase database. Use the read-only `pnpm upgrade:showcase` dry-run and reconcile its ledger/adoption evidence before applying anything.

### Showcase demo/seed data — cleanup when no longer needed
Rows may look like this and can be removed from the **ADMIN PANEL** (no SQL needed for most of them):

| Kind | What to look for | How to remove |
|---|---|---|
| Students | student IDs starting `CF25…` or names like "আরিফ হোসেন", phone `01811…` | Admin → Students → delete |
| Teachers | email ending `@demo.com` (e.g. `rafiq@demo.com`) | Admin → Teachers → delete |
| Batches | names `SSC-2025 গণিত`, `HSC-2025 ইংরেজি`, `Class 8 বিজ্ঞান` | Admin → Batches → delete |
| Exams | titles containing `Demo`, or pasted mock exams | Admin → Exams → delete |
| Fees / payments | rows tied to the demo students above | remove together with the student |
| Notices | Demo announcement posts | Admin → Notices → delete |

> Browser demo seeding has been removed. Synthetic fixtures are available only to an operator through `pnpm fixture:showcase`, require the declared environment to be exactly `showcase`, default to dry-run, and record the owning run for every inserted row. Never run that tool for a customer/production environment.

### Empty customer projects — use the onboarding flow instead
Do not delete showcase rows to manufacture an "empty" customer database and do not run showcase cleanup or fixture commands against a customer project. For a new customer, start with a genuinely empty Supabase project, follow **§5 One-time setup** with `pnpm provision:customer`, then complete **§6 Empty-customer onboarding completion**. Add the customer's real contact and branding in **Admin → Settings → Institute** only after provisioning and first-admin setup are complete.

### Backups
Before making any changes (even admin-panel deletes), take a Supabase
**Project → Database → Backups** snapshot so anything removed can be restored.
Deletions from the admin panel are permanent and are not logged by the app.

If the optional in-database backup feature is enabled, apply its manifest entries
in order through `20250905000007_backup_payload_redaction.sql`. That final step
removes credentials/tokens/provider internals from new payloads and scrubs old
`public.backups` rows; backup access remains admin-only. Still treat the retained
student, fee, exam, and audit data as sensitive.

Maintain a second, **encrypted backup outside the Supabase project** in a managed
vault or access-controlled object store. Keep the encryption key separately in
KMS/secrets management, require MFA and named-operator access, enable
immutability/versioning where available, record checksums, and test restores only
in a disposable restricted environment. A backup stored only in `public.backups`,
the source project, a laptop, or a browser download folder is not independent.

Approve a written retention schedule and enforce deletion automatically. A
starting point is daily copies for 7 days, weekly copies for 5 weeks, and monthly
copies for 12 months, adjusted for applicable business/legal requirements. Apply
the schedule to both `public.backups` and off-project copies; log creation,
restore tests, failures, expiry/deletion, and any explicit time-bounded legal hold.

---

## 9. Data & security notes

- Messaging configuration is provider-neutral and safe-only. The server-admin GET/PUT/DELETE API is authoritative; never write provider credentials or custom static headers/body templates into `provider_config`. Credential rows are AES-256-GCM canonical-base64 text, keyed by channel/provider/UUID revision, and service-role only. Queued jobs keep immutable provider snapshots and old credential versions until terminal.
- Custom endpoints must be exact-allowlisted HTTPS POST URLs without credentials, query, fragment, or port. Only canonical recipient/message/subject/html/text/sender fields can be mapped. Non-idempotent dispatch is fenced; idempotent retries derive keys from delivery IDs.
- Onboarding evaluates only enabled providers. Built-in environment credentials are fallback and custom credentials must be encrypted; reports expose booleans and safe fingerprint/hint metadata only.
- Admin accounts are defined server-side (`admin_users`), not by the app UI
  alone — the "Admins" settings tab uses that roster.
- Student portal auth uses per-student opaque session tokens; the browser
  never holds a privileged Supabase key.
- Use disposable records when testing create/edit/delete (the E2E harnesses
  already do this).
