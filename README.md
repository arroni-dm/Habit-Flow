# HabitFlow — Multi-User Full-Stack Habit Tracker

HabitFlow is a multi-user habit tracking, spreadsheet-compatible calendar review, and consistency analytics web application built with React 19, TypeScript, Tailwind CSS v4, Express, PostgreSQL, and Drizzle ORM.

## Core Capabilities

- **Multi-User Authentication & Session Security**: Account registration, `bcryptjs` password hashing, PostgreSQL-backed `user_sessions` with `HttpOnly` cookies, `x-csrf-token` validation on all mutating endpoints, rate limiting on authentication routes, single-use hashed password reset tokens, and full cascading account deletion.
- **Strict Per-User Isolation**: Every query, mutation, analytics calculation, reminder sweep, and CSV export is scoped on the server to `req.authUser.id` resolved from the verified session cookie.
- **Flexible Habit & Target Engine**:
  - **Boolean (`yes/no`)**, **Numeric Count** (e.g., `8 glasses`, `10 pages`), and **Duration** (`minutes` or `hours`) habits.
  - **Schedules**: `daily`, `weekdays`, `weekends`, and `custom_days` (`0=Sun .. 6=Sat`), with start/end dates, reminder times, optional completion deadlines, priority levels, and history-preserving archiving.
- **Spreadsheet Compatibility (`Habit Tracker.xlsx` Workflow)**:
  - **Month Calendar Matrix**: Split explicitly into **Week #1 through Week #5+** (marking partial boundary weeks clearly) aligned to each user's configured week start (`Monday`, `Sunday`, or `Saturday`), with leap-year-accurate month lengths (`28`, `29`, `30`, `31` days).
  - **Workbook Import**: Upload `.xlsx`, `.xls`, or `.csv` files with dry-run preview and duplicate-safe transactional commit, or select from the optional 10 starter habits during onboarding.
  - **RFC 4180 CSV Exports**: Export habits, date-bounded daily logs, and period summary reports with proper quote/comma/newline escaping.
- **Centralized Schedule- & Timezone-Aware Calculation Engine (`src/shared/calculations.ts`)**:
  - Evaluates local dates and deadlines in each user's configured IANA timezone (`UTC`, `Asia/Dhaka`, `America/New_York`, etc.).
  - Unscheduled rest days never break streaks.
  - Incomplete habits on the user's current local day remain `pending` (preserving active streaks) until their optional `completionDeadline` passes; future dates are classified as `upcoming` and excluded from missed counts.
  - Overall Consistency Streak tracks consecutive scheduled days achieving `>= 80%` completion alongside Perfect Day (`100%`) streaks.
- **Optional Server-Side AI Insights**: When `GEMINI_API_KEY` is configured on the server, users can request structured coaching insights computed strictly from their verified database metrics. Core tracking and analytics work identically when AI is unconfigured.

---

## Project Architecture

```text
├── drizzle/
│   └── 0000_initial_schema.sql      # Versioned PostgreSQL DDL schema migration
├── src/
│   ├── db/
│   │   ├── schema.ts                # Normalized Drizzle PostgreSQL tables, indexes & cascades
│   │   ├── migrate.ts               # Idempotent SQL migration runner (__habitflow_migrations)
│   │   └── index.ts                 # pg.Pool (DATABASE_URL) or persistent PGlite (PGDATA_DIR)
│   ├── shared/
│   │   ├── config.ts                # Brand config, categories, timezones, starter templates
│   │   ├── dates.ts                 # Pure UTC & IANA timezone calendar / Week #1-#5 utilities
│   │   ├── types.ts                 # Shared domain contracts
│   │   ├── validation.ts            # Shared Zod schemas
│   │   └── calculations.ts          # Single source of truth for streaks, rates, rankings & goals
│   ├── server/
│   │   ├── app.ts                   # Express REST API (/api/*)
│   │   ├── security.ts              # Password hashing, HttpOnly sessions, CSRF, rate limiter
│   │   ├── spreadsheetImport.ts     # .xlsx / .csv parser & preview builder
│   │   ├── csv.ts                   # RFC 4180 CSV serializer
│   │   ├── reminders.ts             # Timezone-aware in-app reminder & quiet-hours evaluator
│   │   └── aiInsights.ts            # Optional server-side Gemini insights generator
│   ├── components/                  # Layout, ProgressRing, HabitFormModal, Import & Onboarding modals
│   ├── pages/                       # Auth + 10 workspace views (Dashboard, Daily, Calendar, Analytics, etc.)
│   └── test/                        # Vitest unit, API/PostgreSQL integration, and jsdom UI tests
└── server.ts                        # Unified Express + Vite (dev) / static SPA (prod) server on port 3000
```

---

## Environment Variables

Copy `.env.example` to `.env` for local configuration:

| Variable | Required | Description |
| :--- | :---: | :--- |
| `DATABASE_URL` | Optional | Standard PostgreSQL connection URI (`postgresql://user:pass@host:5432/dbname`). When omitted, HabitFlow automatically persists to a local embedded PostgreSQL data directory (`PGDATA_DIR`). |
| `PGDATA_DIR` | Optional | Directory path for local embedded PostgreSQL persistence when `DATABASE_URL` is not set (defaults to `./data/pgdata`). |
| `SESSION_SECRET` | Recommended | Secret key used for HMAC-SHA256 hashing of opaque session cookies and password reset tokens. |
| `VITE_APP_NAME` | Optional | Customizes the application brand name across client and server (defaults to `HabitFlow`). |
| `GEMINI_API_KEY` | Optional | Enables the optional server-side AI Insights card on the Analytics page. |
| `PASSWORD_RESET_WEBHOOK_URL` | Optional | Outbound webhook endpoint for delivering password reset links via an external email provider. When unset, the UI transparently reports that external email delivery is not configured. |

---

## Local Setup, Migrations & Running

1. **Install dependencies**:
   Use Node.js 22.12 or newer. In PowerShell, run:
   ```bash
   npm install
   ```

   Optionally copy the local configuration before starting (PowerShell):
   ```powershell
   Copy-Item .env.example .env
   ```
   Core tracking works without API keys or an external database. Open
   http://localhost:3000 after starting the server. Stop it with Ctrl+C.

2. **Database migrations**:
   Versioned SQL migrations live in `./drizzle/` and are automatically and idempotently applied on server startup via `ensureDatabaseReady()` (`__habitflow_migrations` tracking table). To generate new migrations after editing `src/db/schema.ts`:
   ```bash
   npx drizzle-kit generate
   ```

3. **Start development server (Port 3000)**:
   ```bash
   npm run dev
   ```

4. **Typecheck, test & production build**:
   ```bash
   npm run lint
   npm test
   npm run build
   npm start
   ```
