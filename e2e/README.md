# Browser E2E harness (puppeteer-core + Edge headless)

Automated feature checks for the student portal and admin panel. These drive
real UI flows in a headless Chromium (Edge) against the local dev server on
`http://127.0.0.1:5173` and the live Supabase project — so they catch exactly
what a manual walkthrough would.

## Prerequisites

- Dev server running: `pnpm dev` (binds `127.0.0.1:5173`).
- `puppeteer-core` is already a devDependency in the repo — just run
  `pnpm install` once. The harness does not download a browser.
- Edge or Chrome present. The scripts point at
  `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`; change
  `EXE` at the top of each file if needed.

## Student flow — `student.browser.cjs`

Seeds a **disposable** student + strict active exam (via `seed.exams.sql`),
runs the full journey, then cleans up (`cleanup.exams.sql`):

- public home renders
- portal login → dashboard (**regression: the old 42804 / "structure of query
  does not match function result type"**)
- strict-mode exam: instructions → start → answer 2 → submit
- result screen: 100%/rank, breakdown, back-to-dashboard button
- portal results lists the submission
- PDF generation emits a valid `%PDF` file (the `generateResultCard` path)

Seed with the live DB connection from the backup script (`pg17tools` psql /
pooler), then run:

```bash
EXAM_ID=<uuid-from-seed> node e2e/student.browser.cjs
```

`seed.exams.sql` prints the new exam id via a final `SELECT`.

```bash
EXAM_ID=<uuid-from-seed> pnpm e2e:student
```

## Admin flow — `admin.browser.cjs`

Covers (with disposable `ADM-E2E …` records, cleaned up by the caller):

- admin login → dashboard
- Batches: create a batch → **disable confirm → Inactive** (soft-delete)
- Students: add a student (RPC path)
- Exams: admin page renders
- Admin avatar dropdown: opens with Settings/Sign Out, closes on Esc

Credentials are read from a LOCAL file that is git-ignored:
`e2e/admin-creds.json` (`{"email":"…","password":"…"}`). It is never
committed, never printed. Keep it temporary and rotate the password after.

```bash
pnpm e2e:admin
```

Cleans up the disposable `ADM-E2E …` records when done (`e2e/cleanup.admin.sql`).

## Notes & safety

- All mutations use disposable records; clean up after (`cleanup.exams.sql`
  for the student flow; the admin script's records are prefixed `ADM-E2E`).
- The suite reads the admin credential only from the local file — do not
  paste it into chat or commits.
- Admin flows that would mutate real curriculum data (publish your exams,
  write real notices) are intentionally left out of the suite.
