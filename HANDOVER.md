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

Some things need a Supabase SQL editor run once (no code, but DB-level).
Current pending migrations to apply in the **Supabase SQL Editor**:

1. `supabase/migrations/20250831000001_fix_default_password_login.sql`
   — fixes student default-password login.
2. `supabase/migrations/20250831000002_batch_end_time.sql`
   — adds batch "end time".

Apply them in order. After each, refresh the app.

---

## 6. Run / deploy / test

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

Browser E2E harnesses live in `e2e/` and are documented in `e2e/README.md`
(require the dev server on `http://127.0.0.1:5173`).

---

## 7. Data & security notes

- Admin accounts are defined server-side (`admin_users`), not by the app UI
  alone — the "Admins" settings tab uses that roster.
- Student portal auth uses per-student opaque session tokens; the browser
  never holds a privileged Supabase key.
- Use disposable records when testing create/edit/delete (the E2E harnesses
  already do this).
