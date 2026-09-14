# Handover Feature Matrix

Status meanings:

- **Verified** — implemented and covered by repository/offline checks; customer data remains empty until the operator enters it.
- **Externally gated** — implemented, but completion depends on customer credentials, provider/control-plane setup, or staging evidence not available in the repository.
- **Optional** — not required for core launch and enabled only after explicit operator review.

No live database or provider was contacted to produce this matrix. “Verified” does not mean live production behavior was exercised.

| Feature | Status | Handover evidence / remaining gate |
|---|---|---|
| Public site routes and content surfaces | Verified | App implementation and existing automated checks; enter customer branding/content in Admin Settings. |
| Admission and contact forms | Externally gated | Requires deployed server functions, exact Supabase identity, service-role secret, required migration chain, and staging submission evidence. |
| Admin authentication and roster authorization | Verified | `admin_users`/`is_admin` migration chain exists; first-admin script validates exact identity and an existing Auth user. Live login is still a customer staging check. |
| First-admin bootstrap | Verified | Dry-run by default; exact email/project/environment apply confirmation; strict HTTPS/TLS; no password accepted or stored; narrowly inserts into `admin_users`. |
| Students, batches, teachers, fees, exams, results, notices | Verified | Schema/features and offline tests exist. Preflight checks only real business/transaction tables for zero rows; seeded configuration is validated separately. |
| Student portal and session-based student authentication | Verified | Required portal/auth migrations are in the authoritative chain; exercise a disposable approved student in staging. |
| Exam join, autosave, submit, review, leaderboard | Verified | Required RPC/security migrations are in the manifest; live Realtime behavior remains a staging check. |
| PDF/CSV reports and receipts | Verified | Implemented; operator should confirm representative downloads in staging. |
| Admin notifications / Realtime updates | Externally gated | Requires Supabase Realtime publication/configuration and authenticated staging evidence. |
| Private student avatars | Externally gated | Requires `avatars` bucket to exist and be private, service-role server configuration, and signed upload/retrieval staging evidence. |
| Public logos, banners, teacher/admin assets | Externally gated | Requires `public-assets` bucket to exist and be public plus authenticated server upload route configuration. |
| Seeded site/messaging configuration | Verified | Offline fixture requires the exact safe `site_settings` defaults and exactly two supported messaging rows: `sms`/`mim` and `email`/`resend`; secret-shaped columns or values fail preflight. |
| MIM SMS | Externally gated | **MIM API activation, exact approved sender ID, username, key, and domain/IP whitelisting are mandatory.** `ONBOARD_MIM_APPROVAL_EVIDENCE_FILE` and explicit SMS live-delivery evidence are required. |
| Resend email | Externally gated | **Resend API key, verified sending domain/from address, and webhook secret are mandatory.** `ONBOARD_RESEND_VERIFICATION_EVIDENCE_FILE` and explicit email live-delivery evidence are required. |
| Durable messaging outbox / workers | Externally gated | Required migration exists; handover requires both `MESSAGING_WORKER_SECRET` and `CRON_SECRET`, deployed scheduling, provider credentials, approved recipients, and staging processing evidence. |
| Provider host/DNS egress controls | Verified | Server implementation uses HTTPS exact-host allowlisting and private/reserved-address rejection; customer additions require explicit hostname review. |
| Sentry monitoring | Optional | Set a customer DSN to enable; leave empty to disable. |
| Automated in-database backups and keepalive cron | Optional | Operational migrations are deliberately outside the required chain; require extension availability and explicit operator approval. |
| Independent encrypted backups | Externally gated | Customer must configure an off-project encrypted/versioned store, retention, named MFA access, checksums, and disposable restore tests. |
| Custom domain, DNS, TLS, billing | Externally gated | Hosting/Supabase control-plane ownership and customer billing are required. |
| Showcase/demo fixtures | Optional | Operator-only, dry-run-first, `showcase` environment only; never use for an empty customer/production project. |
| Error-free live delivery and end-to-end production readiness | Externally gated | Requires credentialed staging, disposable records, route checks, provider delivery/webhook evidence, and operator sign-off. |

## Empty-customer acceptance gate

Before entering customer data or declaring handover complete:

1. Create the intended owner in Supabase Auth outside these scripts; dry-run `pnpm onboard:first-admin`, review the target, then explicitly apply with the exact confirmation string.
2. Run `pnpm onboard:preflight` with the same `BOOTSTRAP_ADMIN_EMAIL`. Require exact identity/TLS, the checksum-matching migration ledger, zero real business/transaction rows, exact safe seeded configuration, required Storage access, and first-admin readiness for `coreReady: true`.
3. Require `handoverReady: true` before handover. This adds MIM and Resend credential-presence booleans, worker and cron configuration, Resend sender/domain/webhook evidence, MIM sender/IP-domain approval evidence, independent backup evidence, and separate explicit live SMS/email delivery evidence files.
4. With either provider unconfigured, report `coreReady` honestly but keep `handoverReady: false`; never describe the run as successful.
5. Store no passwords or provider/service-role secrets in reports, evidence committed to the repository, command history, or client-side `VITE_` variables.
