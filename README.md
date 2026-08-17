# Coaching Center Management System

A full-stack web application for **Techely Learning Academy** — a coaching center management system with three surfaces:

- **Public website** — landing page, courses, admission form, notices, contact
- **Admin panel** — manage students, batches, teachers, fees, exams, notices, SMS, reports, settings, backups
- **Student portal** — login, dashboard, fees, exams, results, notices, profile

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript (strict) |
| Build tool | Vite |
| Styling | Tailwind CSS v4 + shadcn/ui (Radix UI primitives) |
| Animations / charts | Framer Motion / Recharts |
| State | Zustand (persist for sessions) |
| Forms | react-hook-form + Zod |
| Backend | Supabase (PostgreSQL + Auth + Storage) |
| Auth | Supabase Auth (admin) + phone/password (students) |
| Deployment | Netlify & Vercel |

## Scripts

```bash
pnpm install          # install dependencies (pnpm required)
pnpm dev              # start dev server
pnpm build            # production build
pnpm typecheck        # TypeScript type checking (no emit)
pnpm test             # run unit tests (vitest)
pnpm lint             # ESLint over .js/.jsx/.ts/.tsx
pnpm lint:fix         # ESLint with autofix
pnpm format           # Prettier write
pnpm format:check     # Prettier check
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push / PR to `main`:

```
pnpm install --frozen-lockfile → pnpm run typecheck → pnpm test → pnpm run build
```

## Environment

Copy `.env.example` to `.env.local` and fill in your Supabase credentials. `.env.local` is git-ignored — never commit it.

## Database

Schema and migrations live in `supabase/migrations/`, including automated daily backups via pg_cron (`automated_backups.sql`).
