# coaching-center — Implementation Plan for DeepSeek Flash
# Hand this file to a cheaper model. Every step is mechanical.

## PROJECT STATE (read only — do NOT redo any of this)

- Stack: React 19 + TS + Vite + Tailwind 4 + Supabase + shadcn/ui + Zustand
- 77 components, 29 pages, 67 tests (all pass), typecheck passes
- 3 surfaces: Public site, Admin panel, Student portal
- Security: RLS on all 12 tables. Students access via token-scoped SECURITY DEFINER RPCs.
  MCQ answers are graded server-side. SMS keys are server-side env vars.
- Auth: Admin = Supabase Auth. Students = custom phone+password via pgcrypto RPCs.
- Data: Direct supabase calls in components. React Query installed but no provider.
- PDF: jsPDF + html2canvas (617 KB), loaded eagerly in main bundle.

## HOW TO VERIFY BEFORE STARTING

```bash
# from /opt/data/projects/coaching
PNPM=/opt/data/home/.local/share/pnpm/bin/pnpm
$PNPM run typecheck       # must pass
$PNPM test                # must show 67+ passed
$PNPM run build           # needs .env.local with Supabase keys
```

The user has .env.local values. Ask for them if build fails.

## LANE 1: React Query — wire the data layer (2-3 hours)

### Step 1.1 — Add QueryClientProvider

File: `src/main.tsx`
- Read the file first
- Import `{ QueryClient, QueryClientProvider }` from `@tanstack/react-query`
- Create `const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })`
- Wrap the app in `<QueryClientProvider client={queryClient}>...</QueryClientProvider>`

### Step 1.2 — Refactor one page as the pattern

Pick `src/pages/admin/DashboardPage.tsx` (or whatever the admin dashboard is called — findAdminDashboardPage first).

BEFORE (hand-rolled pattern):
```ts
const [data, setData] = useState([]);
useEffect(() => { supabase.from('...').select('...').then(setData); }, []);
```

AFTER (React Query pattern):
```ts
import { useQuery } from '@tanstack/react-query';
const { data, isLoading, error } = useQuery({
  queryKey: ['dashboard-stats'],
  queryFn: () => supabase.from('...').select('...').then(r => r.data),
});
```

### Step 1.3 — Apply the pattern to ALL admin pages that fetch data

Search for `useEffect` + `supabase.from(` or `supabase.rpc(` in:
- `src/pages/admin/*.tsx`
- `src/components/admin/*.tsx`

Replace each with `useQuery`/`useMutation`. Keep the same query logic. Only change the wrapper.

### Step 1.4 — Portal pages (lower priority)

Apply the same pattern to `src/pages/portal/*.tsx`. The portal API module (`src/lib/portalApi.ts`) already has typed functions — just wrap them in `useQuery`:
```ts
const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: fetchProfile });
```

### Step 1.5 — Verify

```
$PNPM run typecheck   # must pass
$PNPM test            # must still pass (67+)
```

## LANE 2: PDF lazy loading — one file change (30 min)

File: find where `html2canvas` or `jspdf` is imported.

Search: `grep -rn "html2canvas\|jspdf\|from 'jspdf'" src/`

These are ONLY used for PDF generation (fee receipts, result cards). They should never be in the main bundle.

### Step 2.1 — Convert to dynamic import

Replace:
```ts
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
```

With:
```ts
// Only load PDF libs when the user actually requests a download
async function getPdfLibs() {
  const [html2canvas, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  return { html2canvas: html2canvas.default, jsPDF };
}
```

Then in the download handler:
```ts
const { html2canvas, jsPDF } = await getPdfLibs();
// ... rest of PDF generation unchanged
```

### Step 2.2 — Verify

```
$PNPM run build
# Main chunk should drop by ~600 KB
ls -la dist/assets/*.js  # check sizes
```

## LANE 3: RLS migration — apply if not already applied (15 min)

File: `supabase/migrations/20250818000003_core_rls.sql`

This migration:
- ENABLES RLS on all 12 core tables
- Gives authenticated (admin) full CRUD everywhere
- Gives anon SELECT on batches, teachers, exams, public notices only
- Gives anon INSERT on admission_requests, contact_messages
- REVOKES anon access to students, fees, sms_logs, mcq_questions, mcq_submissions
- DELETES SMS credentials from site_settings

### Step 3.1 — Check if already applied

Ask the user: "Has this SQL been run in your Supabase SQL Editor?"
Or verify by querying: `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('students','fees','exams');`

If ALL return `rowsecurity = true`, skip this lane.

### Step 3.2 — If NOT applied

The user must run it in Supabase Dashboard → SQL Editor. Copy the entire file content and paste it. Run once. Verify nothing errors.

## LANE 4: Features — ask the user what they want

This is open-ended. Common requests for a coaching center SaaS:
- Parent viewing portal (linked to student)
- QR code check-in for attendance
- Online payment gateway (bKash/Nagad)
- Mobile PWA with offline exam support
- Automated fee reminders via SMS cron
- Report card generation (PDF with grades + attendance)
- Multi-branch support

Ask the user which ONE feature they want first. Only build one at a time.

## VERIFICATION CHECKLIST (after all lanes)

```bash
PNPM=/opt/data/home/.local/share/pnpm/bin/pnpm
cd /opt/data/projects/coaching

$PNPM run typecheck              # MUST pass
$PNPM test                       # MUST show 67+ passed
$PNPM run lint                   # SHOULD show 0 errors (warnings OK)
$PNPM run build                  # MUST succeed (needs .env.local)
```

If any check fails, fix it before moving to the next lane. Do NOT leave regressions.

## SAFETY RULES

1. NEVER delete a file you don't understand. Read it first.
2. NEVER change supabase RPC signatures — they match the DB migrations.
3. NEVER remove error handling or sanitize() calls.
4. ALWAYS run typecheck + test after every file change.
5. If a test fails, read the test to understand the contract before fixing.
6. DO NOT change router structure, auth guards, or environment validation.