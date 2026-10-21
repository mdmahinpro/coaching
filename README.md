# Coaching Center Management System

A full-stack web application for **Techely Learning Academy** with three surfaces:

- **Public website** — landing page, courses, admission form, notices, contact
- **Admin panel** — students, batches, teachers, fees, exams, notices, SMS, reports, settings, backups
- **Student portal** — login, dashboard, fees, exams, results, notices, profile

> **Start here:** the non-technical, day-to-day operating guide lives in
> [`readme/STARTER-GUIDE.md`](readme/STARTER-GUIDE.md) — settings, payments
> approval, exams, go-live checklist, demo-data cleanup.

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
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_your-public-key
```

`.env.local` is git-ignored. Never commit it. `VITE_SUPABASE_ANON_KEY` is embedded in browser JavaScript, so it must be the **public anon JWT** or an `sb_publishable_` key. Never use a `service_role` JWT or `sb_secret_` key in any `VITE_` variable—the app now refuses to start or build if one is detected.

If a privileged key was exposed client-side:

1. Rotate/revoke it in **Supabase Dashboard → Project Settings → API Keys**.
2. Replace local and deployment `VITE_SUPABASE_ANON_KEY` values with the public anon/publishable key.
3. Clear old deployment artifacts, local `dist/` and `.netlify/`, and browser caches.
4. Redeploy only after the build-time key guard passes.

The SMS function also needs these **server-side** variables in Netlify/Vercel:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=sb_publishable_your-public-key
SMS_API_KEY=
SMS_SENDER_ID=CoachMS
```

Keep `SMS_API_KEY` empty during local checks unless you intentionally want to send a real SMS.

## Messaging proxy: Node route **or** Supabase Edge Function

`src/lib/sms.ts` posts to the first endpoint that answers with JSON, in order:

1. `VITE_MSG_ENDPOINT` — pin one explicitly (optional).
2. `/api/send-sms` — the Node/Netlify/Vercel route (`server/sms-core.ts`).
3. `<VITE_SUPABASE_URL>/functions/v1/send-sms` — the Supabase Edge Function.

So the same build works on Render (route 2) **and** on plain static/shared
hosting with no Node process at all (falls through to route 3). Nothing else in
the app needs a server: fee automation runs in Postgres via `pg_cron` and the
PDF invoices are generated in the browser.

### Deploying the Edge Function

Two ways — pick either.

**A. Dashboard (no CLI, browser only)**

1. Supabase → **Edge Functions** → **Deploy a new function** → name it exactly
   `send-sms`.
2. Turn **Verify JWT** *off* (the function does its own admin check).
3. Paste `supabase/functions/send-sms/index.ts` → **Deploy**.

**B. CLI**

```bash
npx supabase functions deploy send-sms --project-ref <your-ref> --no-verify-jwt
```

### Secrets for the Edge Function

Set once (Dashboard → Edge Functions → Manage secrets, or CLI below):

```bash
npx supabase secrets set \
  SMS_API_KEY=…            SMS_SENDER_ID=8809612781000 \
  BREVO_API_KEY=…          BREVO_SENDER_EMAIL=…  BREVO_SENDER_NAME="Techely Learning Academy" \
  --project-ref <your-ref>
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically by Supabase —
do not set them. Keys must never appear in the Vite client bundle.

`VITE_MSG_ENDPOINT` is only needed if you want to skip the same-origin probe
(e.g. static hosting where `/api/send-sms` would return `index.html`).

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

`typecheck` covers the frontend plus the Vercel/Netlify SMS function entrypoints and shared server code.

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
- Profile photo and password change only if the `avatars` bucket/policies are configured
- Logout and confirm protected pages redirect to `/portal/login`
- Exam link: join, autosave/reload, submit, result, review, duplicate-submit prevention

### Admin

With an authorized Supabase admin (`user_metadata.role = "admin"`):

- Dashboard, students, batches, teachers, fees, exams, results
- Notices, admissions, SMS, reports, settings, backup
- CRUD only with disposable records
- Verify PDF/CSV downloads
- Verify Realtime exam updates if `exams` and `mcq_submissions` are in the Supabase publication
- Verify backup restore only against disposable data

### SMS

- `GET /api/send-sms` → JSON `405`
- Unauthenticated `POST /api/send-sms` → JSON `401`
- Authenticated request with no `SMS_API_KEY` → `pending`; no SMS is transmitted
- Configure and test a real provider key only when explicitly intended

## Database

Migrations live in `supabase/migrations/`. The secure student-session, portal RPC, exam RPC, and core-RLS migrations are ordered:

1. `20250818000000_student_sessions.sql`
2. `20250818000001_portal_rpcs.sql`
3. `20250818000002_exam_rpcs.sql`
4. `20250818000003_core_rls.sql`

Do not apply the older permissive `update_rls_policies.sql` after the final core-RLS migration.
