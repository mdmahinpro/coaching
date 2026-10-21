# Starter Guide — Coaching Center App

A plain-language guide for running the app day to day. No coding needed for
almost everything. The full technical runbook (install, env vars, deploy) is in
[`../README.md`](../README.md).

The app has three surfaces:

- **Public website** — admission form, notice board, teachers, contact.
- **Admin panel** — `/admin` (login: admin email + password).
- **Student portal** — `/portal` (login: phone + password).

---

## 1. Daily work — Admin panel

Open **Admin → Settings**. Each tab edits one part of the site and saves to the
database instantly:

| Tab | What you can change |
|---|---|
| Institute | Center name, tagline, address, phone, email, WhatsApp, hero text, admission open/closed, class levels (শ্রেণী) |
| Payment | bKash / Nagad numbers, admission fee, payment instructions |
| SMS | SMS gateway settings (provider key) |
| Stats | Homepage counters (auto from DB or manual) |
| Social | Facebook / YouTube / Instagram links (footer) |
| Appearance | Logo (also the favicon), banner, primary color |
| Admins | Add or remove admin accounts, change password |

### Everyday tasks (also in the admin panel)
- **Batches** — create classes/batches with schedule days, start & end time.
- **Students** — add, approve, assign to a batch, profile photo.
- **Teachers** — profiles with name, subject, photo, bio.
- **Fees** — see monthly fees, record payments, **approve payment requests**
  from students, download receipts (PDF / 80 mm POS).
- **Exams** — create MCQ exams, add or bulk-import questions, publish, results
  with leaderboard and per-question review, CSV export.
- **Notices** — publish announcements to the site and to students.

### Student payments ( Fees → Payment Requests tab )
Students open their portal, pick a fee month and choose:

- **bKash / Nagad** — they send money to your number and submit the **last 3
  digits** of the number they paid from.
- **ক্যাশ (অফিসে)** — they paid cash at the office; no digits needed.

Every submission appears in the **Payment Requests** tab as "অপেক্ষমাণ"
(waiting). Press **নিশ্চিত** (approve) to mark the fee paid and generate a
receipt, or **বাতিল** (reject). New requests also ring the **notification
bell** next to your avatar.

### Notifications (bell icon)
New admission applications and new payment requests raise a toast plus a bell
entry. Items stay until clicked; clicking opens the relevant page.

---

## 2. Student portal

Students log in with **phone + password**. The default password is the
**reference number (APP-XXXXXX)** they received when their admission was
approved; they can change it in the portal profile.

From the portal students can:

- See the dashboard (fees due, upcoming exams, latest notices).
- **Pay fees** via bKash / Nagad / cash report (see above) and wait for admin
  confirmation.
- Take **exams** — the timer is server-enforced: when the time set on the exam
  runs out, the exam auto-submits, even if the student closes the tab. If they
  log out and back in, the clock resumes where it stopped (fresh time is not
  granted).
- Check **results** with the full per-question answer review.
- Read **notices** and class materials (YouTube classes).

---

## 3. Exams — creating and importing questions

1. Admin → Exams → create an exam: title, subject, batch, **duration in
   minutes**, total/pass marks.
2. Add questions one by one, or paste them into the **bulk import** box:

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

3. **Publish** the exam. "Publish now" also starts the countdown immediately.
4. After students finish, open the exam to see the leaderboard, export CSV, or
   review who answered what.

**Timing rules**
- `duration_minutes` = each student's own clock.
- If you set a start/end window, the window caps the personal clock — nobody
  can answer after the window closes even with time left.
- Pausing an exam freezes everyone's remaining time.

---

## 4. Go-live checklist (one-time)

These need a Supabase SQL-Editor run once (order matters, each file is safe to
re-run):

1. `supabase/RUN_THIS_IN_SQL_EDITOR.sql` — base RPC/RLS pack.
2. `supabase/payment_confirmation.sql` — student payment requests + cash.
3. `supabase/exam_integrity.sql` — server-enforced exam timing.
4. `supabase/keep_alive.sql` — cron heartbeat so the free tiers stay awake.

Then in the admin panel:

5. Settings → Institute — real name, address, phone, branding.
6. Settings → Payment — real bKash/Nagad numbers.
7. Admins tab — create your real admin accounts (delete QA accounts such as
   `qa-admin@example.test`).
8. If you ran `supabase/qa_cleanup.sql` earlier or used demo data, delete the
   demo rows (next section).

**Live site** — deploys automatically from `main` to Render
(`https://coaching-bs06.onrender.com/`); a push goes live in ~15–25 minutes.

---

## 5. Demo / QA data cleanup (before real use)

The database may still contain test records. Remove them from the **admin
panel** (no SQL needed):

| Kind | What to look for | Remove in |
|---|---|---|
| Students | IDs like `CF25…`, phones `01811…`, names such as "আরিফ হোসেন" | Admin → Students |
| Teachers | `@demo.com` emails | Admin → Teachers |
| Batches | "SSC-2025 গণিত", "HSC-2025 ইংরেজি", "Class 8 বিজ্ঞান" | Admin → Batches |
| Exams | titles containing "Demo"/"Test" | Admin → Exams |
| Fees/notices | rows tied to the demo students above | Go with the student |

The "Load demo data" button is disabled in production, but do not press it if
you ever run a dev build against the live DB.

**Backups:** before bulk deletes, take a snapshot in Supabase →
Database → Backups. Admin-panel deletions are permanent.

---

## 6. Security notes

- Admin accounts live server-side (`admin_users`); adding one from the Admins
  tab writes both the login and the roster atomically.
- Student sessions use per-student opaque tokens; the browser never holds a
  privileged Supabase key.
- The SMS gateway API key is stored only in a database row that students
  cannot read — never put it in frontend code.
- Test SMS to **your own number only**; SMS costs money per message.
