# Staging Synthetic Auth Setup & Test Plan

Target: disposable project `hjzwbicauyxffrmdhvgy` (repairs from
`20250909000001_postinstall_repairs.sql` / `STAGING_REPAIR.sql` are applied).

Security rules:
- **Never embed passwords** in SQL, code, logs, or docs.
- **Never INSERT directly into Supabase-managed `auth.users`.** Users are created
  only through the Supabase Admin API (service-role) with `email_confirm: true`,
  which avoids the email-invitation flow entirely.
- Privileged credentials may create fixtures but must **not** bypass the
  authorization controls being tested. Every assertion below runs as a
  **non-privileged client** (anon key or the fixture's own JWT / portal token).
- No real messages, no destructive resets, no production deployment. Original
  project `flbvusudwszxdylxevfe` and production remain out of scope.

## 1. Synthetic identities to create

| Identity | Auth type | Purpose |
|---|---|---|
| `admin@staging.test` | Supabase Auth (admin API) | roster administrator |
| `nonadmin@staging.test` | Supabase Auth (admin API) | authenticated **non-admin** for negative tests |
| Student A `stu_a` | application `students` row + opaque portal session | portal student in Batch X |
| Student B `stu_b` | application `students` row + opaque portal session | portal student in Batch Y (distinct) |

- Two test batches X and Y (capacity ≥ 2, `is_active`=true).
- Assign Student A → Batch X, Student B → Batch Y.
- Passwords: generate cryptographically random per identity, hold them in a
  secrets store / env, never commit. `student.password` is a bcrypt hash created
  server-side via the existing `register_student`/`crypt()` path (privileged
  fixture creation only).

## 2. How to create the identities (no-email-invitation)

### 2a. Supabase Auth users (secure, via Admin API — not SQL)
Do **not** insert into `auth.users` directly. Use the GoTrue Admin API with the
service role key (or the Supabase JS admin client on the server):

```
POST {SUPABASE_URL}/auth/v1/admin/users
Authorization: Bearer <SERVICE_ROLE_KEY>
apikey: <SERVICE_ROLE_KEY>
Content-Type: application/json

{ "email": "admin@staging.test", "password": "<random>", "email_confirm": true }
```

Repeat for `nonadmin@staging.test`. `email_confirm:true` skips the invitation
email. Record the returned `user.id` values.

### 2b. Roster entry for the admin (post-creation)
Add only the admin's UUID/email to `public.admin_users` via the **service-role**
SQL path (this is the administrative roster grant endpoint), **not** for the
non-admin:

```sql
-- Run as project owner / service role (privileged). No password involved.
INSERT INTO public.admin_users (user_id, email, created_by)
VALUES ('<admin user id>', 'admin@staging.test', 'synthetic-setup')
ON CONFLICT (user_id) DO NOTHING;
-- or the is_admin()-gated admin_grant(...) RPC if a real admin is already present
```
The `nonadmin@staging.test` must have **no** `admin_users` entry.

### 2c. Two portal students in suitable batches
Using the service-role SQL path, create branches X and Y, then the two students
(matching the student/portal schema: `students`, `batches`). Mark them
`is_approved=true, status='active'` and set `student.password` to a bcrypt hash
of a random value (via `crypt(..., gen_salt('bf'))` server-side). Portal login is
`verify_student_login(phone/password)` → opaque session token for each student.

## 3. Test plan (all non-privileged)

### A. Payment approval authorization (post-repair)
Tested through the actual client path, as a non-privileged caller.

1. **Admin succeeds:** login admin@staging.test (Supabase JWT) → `admin_payment_approvals`,
   `admin_approve_payment`, `admin_reject_payment` return data / mutate only their
   own scope. PASS if the RPCs return normally.
2. **Non-admin denied on direct PostgREST:** as `nonadmin@staging.test` (JWT,
   role=authenticated, no roster entry), call
   `GET /rest/v1/payment_approvals` and a `POST /rest/v1/payment_approvals`.
   Expected: **0 rows / RLS permission denied** (the repaired policy is
   `is_admin()`-gated). FAIL if any row is read or written.
3. **Non-admin denied on gated admin RPCs:** as non-admin, call
   `admin_payment_approvals`, `admin_approve_payment`, `admin_reject_payment`.
   Expected: `Admin authorization required` error.
4. **Student submission still works:** Student A (opaque portal token) →
   `portal_submit_payment` to an unpaid fee they own → returns pending; visible
   in `portal_my_payment_approvals`. Second submission for the same pending fee
   → `PENDING_APPROVAL_EXISTS`. FAIL if a student can submit for another
   student's fee (`FEE_NOT_FOUND`) or read others' approvals.
5. **Intentional public content unchanged:** `batches`/`teachers`/`exams`
   anon reads, `admission_requests`/`contact_messages` anon submit, and approved
   public notices all still work (do NOT regress).

### B. Private avatar (post-repair + server)
1. Bucket `avatars` is `public=false`, `file_size_limit=2097152`,
   `allowed_mime_types=[jpeg,png,webp]`; no avatar storage policy grants
   direct anon/auth read/write.
2. Upload a ≤2 MiB JPEG/PNG/WebP with a valid signature →
   `POST /api/upload-avatar` with Student A's token → 200, stores object path.
   Upload >2 MiB or an SVG/non-allowed type → 400 (server-side content
   validation). Upload with no/expired token → 401.
3. **Ownership:** Student A's signed retrieval returns only A's avatar.
   Student B calling A's `student_id` (admin path without admin role) is denied.
4. **Authorized retrieval:** Student A previews via `/api/retrieve-avatar`
   (own token) → signed URL renders the image. A roster admin retrieves Student
   A's avatar via `student_id` + admin JWT → signed URL renders.
5. **Working display:** portal profile shows the updated avatar; admin
   StudentDrawer/StudentsPage shows the same student's avatar.
6. Non-admin authenticated user CANNOT retrieve a student avatar they don't own.

### C. Exam submission integrity (post-repair)
1. `mcq_submissions` unique `(exam_id, student_id)` index exists (catalog check).
2. **Duplicate:** Student A joins an exam, submits, then re-submits the same
   token → `ALREADY_SUBMITTED` (not a raw 23505).
3. **Concurrent:** two parallel `exam_submit` calls for the same (exam, student)
   → exactly **one** row is written (unique index wins; the other returns
   `ALREADY_SUBMITTED`). Assert the row count for (exam, student) is 1.
4. **Recovery/reload:** reloading exam_get_review / exam_get_my_submission after
   submit works; leaderboard reflects the single submission.
5. **Student ID alone cannot enter an exam:** `exam_join` with no token or with
   a student ID (no portal token) → `AUTHENTICATION_REQUIRED`. No `exam_join`
   3-arg overload exists.
6. **Logout revocation:** Student A logs out (`logout_student_session`) → the ex
   token is invalid for `exam_get_questions`/`portal_*` → session-expired error.

### D. Data isolation between students
- Student A cannot read Student B's fees, payment approvals, submissions, or
  avatar (each `portal_*` is token-scoped; verify B's rows absent from A's
  results).
- Admin can see both (roster only).

## 4. Execution order
1. Apply `STAGING_REPAIR.sql` in the Dashboard (project owner) → expect
   ledger count 41 and the focused post-checks to pass.
2. Re-run STAGING_VERIFY (consolidated) → the 41-ledger / avatar-bucket /
   payment-policy sections must reflect the repair.
3. Create Auth users (Admin API) + roster + students (service-role).
4. Deploy/run server functions (`api/retrieve-avatar`, upload-avatar) with the
   correct env (SUPABASE_URL, ANON, SERVICE_ROLE, 2 MiB), then run the
   non-privileged tests above.
5. Report results split by:
   - SQL installation recorded (ledger 41).
   - Installed schema/security verified (STAGING_VERIFY).
   - Storage/Auth setup complete (avatar private + synthetic identities).
   - Authenticated S1/S2 workflows tested (this plan).
