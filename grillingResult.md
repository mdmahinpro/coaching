# 🔥 Grilling Result — Techely Learning Academy (Coaching Center)

> **Method:** Matt Pocock's `grilling` skill — a relentless interview that maps every decision
> as a **design tree**. Facts were gathered from the codebase (my job); the **decisions** are
> yours (the user's). Each question gives my recommended answer (➡️). Nothing here is acted on
> until you confirm shared understanding.
>
> **Date:** 2026-08-18
> **Verdict up front:** Feature-complete and well-built, but **NOT production-safe**. The root
> defect is the data-access model: the whole database is reachable with a public key.

---

## Grounding facts (verified from the repo, not assumed)

| Check | Result |
|---|---|
| `pnpm typecheck` | ✅ passes clean |
| `pnpm test` | ✅ 62 tests / 5 files pass |
| `pnpm build` | ✅ builds; main chunk **812 KB**, pdf chunk **617 KB**, PieChart **420 KB** |
| `pnpm lint` | ⚠️ 0 errors, **64 warnings** (unused vars/imports) |
| Password hashing | ✅ bcrypt via pgcrypto RPC (`register_student` / `verify_student_login`) |
| Login rate limiting | ✅ 5 fails / 15 min, DB-enforced |
| RLS enabled on | `mcq_questions`, `mcq_submissions`, `site_settings`, `fee_audit_logs`, `backups` **only** |
| RLS **missing** on | `students`, `fees`, `exams`, `notices`, `admission_requests`, `batches`, `teachers`, `sms_logs` |
| Student auth | Custom (RPC + `sessionStorage`), **not** Supabase Auth |
| Admin auth | Supabase Auth (`user_metadata.role === 'admin'`) |
| SMS API key | Stored in `site_settings` — which has a **public-read** RLS policy |
| DOMPurify | Installed, but imported via CommonJS `require()` → **falls back to weaker sanitizer in the browser build** |

---

## THE ROOT OF THE TREE 🌳

Everything below hangs off one decision. State it clearly:

> **The frontend reads `students`, `fees`, `exams`, `notices`, etc. directly using the Supabase
> _anon_ key. That key is embedded in the JS bundle every visitor downloads. Because students
> don't use Supabase Auth, RLS cannot tell a student from any anonymous attacker — so the tables
> that have no RLS are fully readable/writable by anyone who opens DevTools.**

This is not a theoretical risk. It is the single biggest blocker to production.

---

## ROUND 1 — Root decisions

### ❓ Q1 — Auth architecture *(the decision everything depends on)*
Students authenticate outside Supabase Auth, so RLS can't identify them. You must pick a foundation:

- **(A)** Migrate students to **real Supabase Auth** (phone/email identity). RLS can then key off
  `auth.uid()` and client reads become genuinely safe. ~1–2 weeks; correct long-term foundation.
- **(B)** Keep custom auth, enable RLS to **deny anon direct table access**, and route every
  student read/write through `SECURITY DEFINER` RPCs (like `verify_student_login` already is).
  ~3–5 days; but you maintain two auth systems and hand-write an RPC per query forever.

➡️ **Recommended: (A)** for a real product. **(B)** only if you must launch within days.

---

### ❓ Q2 — Launch scope
Is v1 a **controlled soft launch** (one center, ~50–200 known students you onboard) or a
**fully public launch** (open signup, unknown volume)? This decides what is *gating* vs
*nice-to-have*.

➡️ **Recommended: controlled soft launch first.** Ship security fixes, validate with real users,
then harden.

---

### ❓ Q3 — SMS API key exposure
The MIM SMS key lives in `site_settings`, which has a public-read policy. Anyone can read it and
drain your paid balance.

- **(a)** Move sending to a **Supabase Edge Function** with the key as a server secret.
- **(b)** **Defer SMS** entirely for v1.
- **(c)** Accept the risk. ← not viable.

➡️ **Recommended: (a).** If the timeline is brutal, **(b)**. Never **(c)**.

---

### ❓ Q4 — Database ownership / access
Do **you** have full Supabase project access (SQL editor, run migrations, set secrets, configure
Auth)? Every fix below assumes you can execute it.

➡️ **Recommended: confirm you own the project.** If someone else does, the plan changes.

---

### ❓ Q5 — Expected scale
Total students, and **peak concurrent** users (e.g., everyone hitting the MCQ engine at once
during an exam)? This decides whether "no caching / no React Query" is a real bottleneck now.

➡️ **Recommended:** if it's **hundreds, not thousands**, performance is *not* a launch blocker —
defer React Query.

---

## ROUND 2 — Unlocked by Q1 *(security specifics)*

*These questions only fully resolve after Q1 is answered, but you can pre-decide them.*

### ❓ Q6 — RLS policy per table
For `students`, `fees`, `exams`, `notices`, `admission_requests`, `batches`, `teachers`,
`sms_logs`: what can each role do?

➡️ **Recommended baseline:**
- `authenticated` (admins): full CRUD.
- Students: **no direct table access** — go through RPCs (path B) or `auth.uid() = student_id`
  ownership policies (path A).
- `anon` (truly public): read-only on `batches`/`notices`/`site_settings` non-sensitive fields
  *only*; everything else denied.

### ❓ Q7 — MCQ exam integrity
`mcq_questions` is anon-readable with `USING (true)` — students can fetch **all answers before the
exam** via DevTools, and `mcq_submissions` insert is unrestricted (scores can be forged). Do you
need real exam integrity?

➡️ **Recommended:** route exam start/fetch/submit through `SECURITY DEFINER` RPCs that check exam
window + student identity, and never ship correct-answer flags to the client before grading.

### ❓ Q8 — Sensitive settings split
`site_settings` mixes public config (site name, colors) with secrets (SMS key). Split it?

➡️ **Recommended: yes** — move secrets to an admin-only table or server secret; keep only
non-sensitive keys under the public-read policy.

### ❓ Q9 — Confirm plaintext migration ran
The hashing function exists, but has the one-time `UPDATE students SET password = crypt(...)`
actually run in production?

➡️ **Recommended:** verify with
`SELECT count(*) FROM students WHERE password NOT LIKE '$2%';` — must return **0**.

---

## ROUND 3 — Correctness & reliability

### ❓ Q10 — DOMPurify is silently inactive
`src/utils/sanitize.ts:169` uses `require('dompurify')`, which throws in the ESM/browser bundle,
so it **silently falls back** to the weaker hand-rolled sanitizer. Fix to a static
`import DOMPurify from 'dompurify'`?

➡️ **Recommended: yes.** 5-minute fix, real XSS-hardening impact.

### ❓ Q11 — Auth subscription cleanup bug
`useAuthStore.ts:63-68` adds a `beforeunload` listener then removes it on `setTimeout(…, 0)`, so
cleanup never runs; the unsubscribe is stashed via `as any`. Rework the lifecycle?

➡️ **Recommended: yes** — move subscription management into a proper store lifecycle, drop the
self-defeating timeout.

### ❓ Q12 — Error handling consistency
Supabase calls are inconsistently wrapped: some `try/catch`, some check `error`, some silently
fail. Standardize on `handleSupabaseError` everywhere?

➡️ **Recommended: yes**, but this is polish — do it after the security gate.

### ❓ Q13 — Observability
`src/utils/logger.ts` is a console wrapper with a Sentry TODO. Wire a real error tracker before
launch so you see production crashes?

➡️ **Recommended: yes** — even a free Sentry tier. You cannot operate blind.

---

## ROUND 4 — Performance & hygiene *(post-gate)*

### ❓ Q14 — Bundle weight
`jspdf`+`html2canvas` (617 KB) and Recharts PieChart (420 KB) are heavy. Lazy-load PDF only when a
receipt is requested; confirm charts live only in lazy admin chunks?

➡️ **Recommended: yes**, but only matters after security. Not a launch blocker at hundreds of users.

### ❓ Q15 — React Query
`@tanstack/react-query` is installed but there's **no `QueryClientProvider`** — every page
hand-rolls fetching. Adopt it?

➡️ **Recommended: defer** unless Q5 says thousands of concurrent users.

### ❓ Q16 — Repo hygiene
Committed scratch files exist: `eslint-output.txt`, `stats.html`, `src/components/admin/test_jsx.tsx`,
`cc_home.png`, `cc_home2.png`. Remove from tracking?

➡️ **Recommended: yes** — `git rm --cached` them and rely on `.gitignore`.

### ❓ Q17 — Replit coupling
`vite.config.ts:8-16` uses top-level `await import()` for Replit-only plugins. Since you deploy on
Netlify/Vercel, remove them?

➡️ **Recommended: yes** — removes a fragile top-level await and dead deps.

---

## Priority ladder (my synthesis, pending your answers)

| Tier | Item | Q |
|---|---|---|
| 🔴 GATE | RLS on all core tables + fix student data-access model | Q1, Q6 |
| 🔴 GATE | SMS key off the client (Edge Function or defer) | Q3, Q8 |
| 🔴 GATE | Confirm plaintext-password migration ran | Q9 |
| 🟠 HIGH | Fix DOMPurify import (silently inactive today) | Q10 |
| 🟠 HIGH | Lock down MCQ exam RLS / integrity | Q7 |
| 🟠 HIGH | Fix auth subscription cleanup | Q11 |
| 🟠 HIGH | Add error tracking before launch | Q13 |
| 🟡 MED | Standardize error handling | Q12 |
| 🟡 MED | Bundle: lazy-load PDF | Q14 |
| 🟢 LOW | React Query (only if scale demands) | Q15 |
| 🟢 LOW | Repo hygiene, remove Replit plugins, lint cleanup | Q16, Q17 |

---

## What's genuinely good (don't regress these)

- Clean, well-organized component architecture with clear separation of concerns.
- Lazy-loaded admin/portal routes (good code splitting).
- Password hashing (bcrypt) + login rate limiting already implemented at the DB layer.
- Env validation via Zod at boot (`src/lib/env.ts`).
- Bilingual (Bengali/English) support with proper fonts.
- Fee audit logging, CSV export, MCQ exam engine with timer.
- CI pipeline (typecheck → test → build) exists and is green.

---

## Open frontier — awaiting your decisions

The interview is **not complete**. Answer **Q1–Q5** (root round) and the tree recomputes: Q1
especially unlocks the concrete migration shape in Q6–Q9. I will not modify code or run any
migration until you confirm we share the same picture.

**Reply format is fine as:** `Q1: A, Q2: soft launch, Q3: a, Q4: yes, Q5: ~300 students / ~80 concurrent`
