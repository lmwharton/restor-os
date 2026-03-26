# Bootstrap — Auth, Database, Company Setup

## Status
| Field | Value |
|-------|-------|
| **Progress** | ████████████████████ 100% (4/4 phases) |
| **State** | ✅ Complete |
| **Blocker** | None |
| **Branch** | main |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-03-24 |
| Started | 2026-03-25 |
| Completed | 2026-03-26 |
| Sessions | 1 |
| Files Changed | 30+ |
| Tests Written | 13 |

## Done When
- [x] User can sign in with Google on crewmaticai.vercel.app
- [x] First-time user sees "Create your workspace" onboarding (company name + phone)
- [x] Returning user goes straight to empty job list
- [x] User can sign out and sign back in
- [x] FastAPI backend deployed on Railway, health check responding
- [x] All backend pytest tests passing (auth middleware + company creation)
- [x] Expert review approved (2 rounds: backend architect + CTO mentor + data architect + security auditor + Supabase expert)

## Overview

**Problem:** No infrastructure exists. Can't authenticate, can't store data, can't deploy.

**Solution:** Set up Supabase (auth + DB + storage), FastAPI backend on Railway, Next.js frontend on Vercel. User signs in with Google, creates a company workspace, sees an empty job list. All data flows through FastAPI — frontend never touches Supabase directly (except auth).

**Scope:**
- IN: Google OAuth, company creation, empty job list, app shell, backend deploy, DB tables, private storage bucket
- OUT: Job creation, photo upload, AI scope, PDF export, team invites, any feature beyond "sign in and see empty app"

## Phases & Checklist

### Phase 1: Supabase + Google Cloud Setup — ✅
- [x] Create Supabase project (wejohmzfbkaackhmbfed)
- [x] Create Google Cloud project, configure OAuth consent screen (testing mode)
- [x] Create OAuth 2.0 client ID with redirect URIs (localhost + Vercel staging)
- [x] Add Brett's email + team emails as test users in Google Cloud Console
- [x] Set up .env files locally (web/.env.local, backend/.env)
- [x] Create bootstrap database tables (3 tables via Alembic migration)
- [x] Create shared `update_updated_at()` trigger function + per-table triggers
- [x] Enable RLS on all 3 tables with per-operation tenant isolation policies
- [x] Create PRIVATE storage bucket for photos + PUBLIC logos bucket
- [x] Add unique constraint: partial unique indexes for soft-delete compatibility

**Tables NOT in bootstrap** (come with their own specs):
- `photos`, `line_items`, `scope_runs` → AI Photo Scope spec
- `company_invitations` → Team Management spec
- `job_rooms`, `moisture_readings`, `equipment_*` → V2 Field Ops
- `voice_notes`, `room_sketches`, `reports` → V2

### Phase 2: Backend (FastAPI on Railway) — ✅
- [x] Add Supabase JWT secret and service role key to config.py (SecretStr)
- [x] Create auth middleware: validate Supabase JWT (HS256 + ES256), extract user_id and company_id
- [x] Create auth dependency for route injection (get_auth_user_id + get_auth_context)
- [x] Add CORS for Vercel staging domain + localhost
- [x] Create `POST /v1/company` — create company + user during onboarding
- [x] Create `GET /v1/company` — get current user's company
- [x] Create `GET /v1/jobs` — list jobs for company
- [x] Create `PATCH /v1/company` — update company fields
- [x] Create `POST /v1/company/logo` — upload company logo
- [x] Create `GET /v1/me` + `PATCH /v1/me` — user profile CRUD
- [x] Set up Alembic for database migrations (Railway pre-deploy: alembic upgrade head)
- [x] Deploy to Railway with environment variables
- [x] Verify health check + authenticated endpoints on Railway URL

### Phase 3: Frontend (Next.js on Vercel) — ✅
- [x] Install `@supabase/supabase-js` and `@supabase/ssr`
- [x] Create Supabase auth client configured for Google OAuth
- [x] Create `/login` page with "Sign in with Google" button
- [x] Create `/auth/callback` route handler — checks company, routes to onboarding or jobs
- [x] Create protected layout: unauthenticated → redirect to /login
- [x] Create API client module (fetch wrapper with JWT in Authorization header)
- [x] Create onboarding page: wired to POST /v1/company
- [x] Create empty Job List page with CTA
- [x] App shell: company logo + name (left), nav (center), user avatar dropdown (right), footer with version
- [x] Settings page: tabbed (Organization, My Profile, Team) with full CRUD + dirty state tracking
- [x] Mobile-responsive nav (48px touch targets)
- [x] /research and /product pages remain public
- [x] Deploy to Vercel with environment variables

### Phase 4: Tests + Verification — ✅
- [x] pytest: health check returns 200 (2 tests)
- [x] pytest: auth middleware rejects missing JWT (401)
- [x] pytest: auth middleware rejects invalid/expired JWT (401)
- [x] pytest: auth middleware passes valid JWT, returns user_id + company_id
- [x] pytest: company creation creates company linked to user
- [x] pytest: missing name returns 422
- [x] pytest: jobs list returns empty array for new company
- [x] Manual: sign in with Google locally ✅
- [x] Manual: first login shows onboarding screen ✅
- [x] Manual: create company → see empty job list ✅
- [x] Manual: settings CRUD — org update, profile update, logo upload, dirty state ✅
- [x] Manual: sign out → sign back in → goes to job list ✅
- [x] Staging: Railway healthy, DB connected, all endpoints responding ✅

## Technical Approach

**Auth flow:**
```
Browser → Supabase Auth (Google OAuth) → JWT token
Browser → FastAPI (JWT in Authorization header) → Supabase DB (service_role key)
```

**Key patterns:**
- Supabase Auth handles Google OAuth flow client-side. JWT issued to browser.
- FastAPI validates JWT via JWKS endpoint or shared secret (per Supabase docs).
- `company_id` looked up from `users` table via `auth_user_id` from JWT.
- RLS enabled on all tables — tenant isolation at DB level. FastAPI uses service_role key (bypasses RLS) for backend operations.
- Onboarding uses upsert: `INSERT ON CONFLICT DO NOTHING` prevents duplicate companies.
- Google OAuth in "testing" mode initially — add specific emails as test users.
- Private storage bucket — FastAPI generates signed URLs (15-min expiry) for photo access.
- Job numbers use random suffix to avoid race conditions: `JOB-YYYYMMDD-A7K`

**Key Files:**
- `backend/api/auth/middleware.py` — JWT validation + user/company extraction
- `backend/api/auth/router.py` — company creation endpoint
- `backend/api/auth/schemas.py` — Pydantic models for company/job
- `backend/api/config.py` — add JWT secret, service role key
- `web/src/lib/supabase/client.ts` — Supabase browser client for auth
- `web/src/lib/supabase/server.ts` — Supabase server client for SSR
- `web/src/lib/api-client.ts` — fetch wrapper with auth headers
- `web/src/app/(auth)/login/page.tsx` — sign in page
- `web/src/app/(auth)/callback/route.ts` — OAuth callback
- `web/src/app/(protected)/layout.tsx` — auth-gated layout
- `web/src/app/(protected)/jobs/page.tsx` — empty job list
- `web/src/app/(protected)/onboarding/page.tsx` — create workspace
- `web/src/middleware.ts` — session refresh middleware

---

## Database Schema

### Design Principles
- **TEXT over ENUM** — avoid ALTER TYPE migrations. CHECK constraints for validation.
- **TEXT over VARCHAR** — no arbitrary length limits. App validates max lengths via Pydantic.
- **TIMESTAMPTZ always** — timezone-aware. Contractors work across time zones.
- **Soft delete (`deleted_at`)** — on all tables. NULL = active, timestamp = deleted.
- **Partial unique indexes** — all UNIQUE constraints use `WHERE deleted_at IS NULL` so soft-deleted records don't block re-creation.
- **Partial query indexes** — `WHERE deleted_at IS NULL` on frequently-queried indexes.
- **Multi-tenancy** — `company_id` FK on every data table. RLS enforces isolation.
- **Per-operation RLS** — separate SELECT/INSERT/UPDATE/DELETE policies (not `FOR ALL`). Prevents cross-tenant mutations and privilege escalation.

### ERD

```
┌─────────────────┐
│   auth.users    │  (Supabase-managed)
│   id (UUID)     │
└────────┬────────┘
         │ auth_user_id (1:1, ON DELETE SET NULL)
         ▼
┌─────────────────┐       ┌─────────────────┐
│     users       │──────▶│   companies     │
│   id            │  N:1  │   id            │
│   auth_user_id  │  ON   │   name, slug    │
│   company_id ───┘DELETE │   phone, email   │
│   email, name   │RESTRICT│  address fields │
│   role          │       │   settings {}   │
│   is_platform_  │       │   subscription  │
│     admin       │       └─────────────────┘
└────────┬────────┘
         │ created_by / assigned_to / updated_by
         │ (ON DELETE SET NULL)
         ▼
┌──────────────────────────────────────────┐
│                  jobs                     │
│   id, company_id, job_number             │
│   address, customer, insurance fields    │
│   loss_type/category/class/cause/date    │
│   status, assigned_to, notes             │
│   created_by, updated_by                 │
│   created_at, updated_at, deleted_at     │
└──────┬──────┬──────┬──────┬──────────────┘
       │      │      │      │  Future child tables
       ▼      ▼      ▼      ▼  (each spec adds its own)
    photos  line_   scope  voice_
            items   _runs  notes ...
```

### Table 1: `companies`

```sql
CREATE TABLE companies (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    slug              TEXT NOT NULL,  -- uniqueness via partial index below
    phone             TEXT,
    email             TEXT,
    logo_url          TEXT,
    address           TEXT,
    city              TEXT,
    state             TEXT,
    zip               TEXT,
    settings          JSONB NOT NULL DEFAULT '{}',
    subscription_tier TEXT NOT NULL DEFAULT 'free'
                      CHECK (subscription_tier IN ('free', 'solo', 'team', 'pro')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

-- Partial unique: soft-deleted company slug can be reused
CREATE UNIQUE INDEX idx_companies_slug_active ON companies(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_companies_created_at ON companies(created_at);
```

### Table 2: `users`

```sql
CREATE TABLE users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- SET NULL preserves audit trail
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    email             TEXT NOT NULL,  -- uniqueness via partial index below
    name              TEXT NOT NULL,
    first_name        TEXT,
    last_name         TEXT,
    phone             TEXT,
    avatar_url        TEXT,
    title             TEXT,
    role              TEXT NOT NULL DEFAULT 'owner'
                      CHECK (role IN ('owner', 'employee')),
    is_platform_admin BOOLEAN NOT NULL DEFAULT false,
    last_login_at     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ
);

-- Partial uniques: soft-deleted users don't block re-signup
CREATE UNIQUE INDEX idx_users_auth_active ON users(auth_user_id) WHERE deleted_at IS NULL AND auth_user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_users_email_active ON users(email) WHERE deleted_at IS NULL;
-- Query indexes
CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_users_company_role ON users(company_id, role) WHERE deleted_at IS NULL;
```

### Table 3: `jobs`

```sql
CREATE TABLE jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    job_number      TEXT NOT NULL,
    -- Property
    address_line1   TEXT NOT NULL,
    city            TEXT NOT NULL,
    state           TEXT NOT NULL,
    zip             TEXT NOT NULL,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    -- Customer
    customer_name   TEXT,
    customer_phone  TEXT,
    customer_email  TEXT,
    -- Insurance
    claim_number    TEXT,
    carrier         TEXT,
    adjuster_name   TEXT,
    adjuster_phone  TEXT,
    adjuster_email  TEXT,
    -- Damage
    loss_type       TEXT NOT NULL DEFAULT 'water'
                    CHECK (loss_type IN ('water', 'fire', 'mold', 'storm', 'other')),
    loss_category   TEXT CHECK (loss_category IN ('1', '2', '3')),
    loss_class      TEXT CHECK (loss_class IN ('1', '2', '3', '4')),
    loss_cause      TEXT,
    loss_date       DATE,
    -- Status
    status          TEXT NOT NULL DEFAULT 'needs_scope'
                    CHECK (status IN ('needs_scope', 'scoped', 'submitted')),
    assigned_to     UUID REFERENCES users(id) ON DELETE SET NULL,
    notes           TEXT,
    -- Audit
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- Partial unique: soft-deleted job numbers can be reused within a company
CREATE UNIQUE INDEX idx_jobs_company_job_number_active ON jobs(company_id, job_number) WHERE deleted_at IS NULL;
-- Query indexes
CREATE INDEX idx_jobs_company_status ON jobs(company_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_company_created_by ON jobs(company_id, created_by) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_company_assigned ON jobs(company_id, assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_company_created_at ON jobs(company_id, created_at) WHERE deleted_at IS NULL;
```

### Shared: Helper function + Triggers

```sql
-- Helper: resolve current user's company_id (used by RLS policies)
-- SECURITY DEFINER avoids self-referential RLS recursion on users table
CREATE OR REPLACE FUNCTION get_my_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT company_id FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL LIMIT 1;
$$;

-- Trigger: auto-update updated_at on row changes (skips soft-delete-only changes)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND
       NEW IS NOT DISTINCT FROM OLD THEN
        RETURN NEW;  -- skip updated_at on soft-delete-only change
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_jobs_updated_at BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger: prevent is_platform_admin self-escalation
CREATE OR REPLACE FUNCTION prevent_admin_self_escalation()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_platform_admin = true AND OLD.is_platform_admin = false THEN
        -- Only service_role (bypasses RLS) can set this flag.
        -- If this trigger fires from an anon/authenticated context, block it.
        IF current_setting('request.jwt.claims', true)::jsonb->>'role' != 'service_role' THEN
            RAISE EXCEPTION 'Cannot self-escalate to platform admin';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_admin_escalation BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION prevent_admin_self_escalation();
```

### RLS Policies

Per-operation policies prevent cross-tenant mutations, privilege escalation, and soft-delete visibility.

```sql
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- COMPANIES
-- ============================================================

-- SELECT: users can only see their own company (active records only)
CREATE POLICY "companies_select" ON companies
    FOR SELECT USING (
        deleted_at IS NULL
        AND id = get_my_company_id()
    );

-- INSERT: only service_role creates companies (onboarding flow)
CREATE POLICY "companies_insert" ON companies
    FOR INSERT WITH CHECK (false);  -- blocked for anon/authenticated; service_role bypasses

-- UPDATE: only owner can update their own company
CREATE POLICY "companies_update" ON companies
    FOR UPDATE USING (
        deleted_at IS NULL
        AND id = get_my_company_id()
    ) WITH CHECK (
        id = get_my_company_id()  -- can't change company to a different ID
    );

-- DELETE: only via service_role (soft delete in practice)
CREATE POLICY "companies_delete" ON companies
    FOR DELETE USING (false);

-- ============================================================
-- USERS
-- ============================================================

-- SELECT: can see own row + active teammates in same company
CREATE POLICY "users_select_own" ON users
    FOR SELECT USING (auth_user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "users_select_company" ON users
    FOR SELECT USING (
        deleted_at IS NULL
        AND company_id = get_my_company_id()
    );

-- INSERT: only service_role creates users (signup/invite flow)
CREATE POLICY "users_insert" ON users
    FOR INSERT WITH CHECK (false);

-- UPDATE: can only update own row, cannot escalate privileges
CREATE POLICY "users_update" ON users
    FOR UPDATE USING (
        auth_user_id = auth.uid() AND deleted_at IS NULL
    ) WITH CHECK (
        company_id = get_my_company_id()          -- can't switch companies
        AND is_platform_admin = (SELECT is_platform_admin FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)  -- can't self-escalate
        AND role = (SELECT role FROM users WHERE auth_user_id = auth.uid() AND deleted_at IS NULL)  -- can't change own role
    );

-- DELETE: only via service_role
CREATE POLICY "users_delete" ON users
    FOR DELETE USING (false);

-- ============================================================
-- JOBS
-- ============================================================

-- SELECT: can see active jobs in own company
CREATE POLICY "jobs_select" ON jobs
    FOR SELECT USING (
        deleted_at IS NULL
        AND company_id = get_my_company_id()
    );

-- INSERT: can create jobs in own company only
CREATE POLICY "jobs_insert" ON jobs
    FOR INSERT WITH CHECK (
        company_id = get_my_company_id()
    );

-- UPDATE: can update jobs in own company, can't change company_id
CREATE POLICY "jobs_update" ON jobs
    FOR UPDATE USING (
        deleted_at IS NULL
        AND company_id = get_my_company_id()
    ) WITH CHECK (
        company_id = get_my_company_id()  -- prevent cross-tenant mutation
    );

-- DELETE: only via service_role (soft delete in practice)
CREATE POLICY "jobs_delete" ON jobs
    FOR DELETE USING (false);
```

**RLS notes:**
- `service_role` key ALWAYS bypasses RLS (confirmed by Supabase). All backend operations use this key.
- `get_my_company_id()` is SECURITY DEFINER — avoids infinite recursion when querying users table from its own policy.
- INSERT on companies and users is blocked for anon/authenticated roles. Onboarding goes through FastAPI (service_role).
- `deleted_at IS NULL` in all SELECT policies ensures soft-deleted records are invisible via anon key.
- Platform admins (`is_platform_admin = true`) access other companies via the backend service_role key — never via client-side policies.

### Private storage bucket

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'photos',
    'photos',
    false,
    10485760,  -- 10MB per file
    ARRAY['image/jpeg', 'image/png', 'image/webp']
);
```

Access via signed URLs generated by FastAPI (120-second expiry for UI display, up to 5 minutes for PDF generation).

### FK ON DELETE behavior

| FK | ON DELETE | Rationale |
|----|-----------|-----------|
| users.auth_user_id → auth.users | **SET NULL** | Auth user deleted → user row preserved (soft-delete audit trail intact). Changed from CASCADE per security review — CASCADE would hard-delete the user row, orphaning job audit references. |
| users.company_id → companies | RESTRICT | Can't delete company with active users |
| jobs.company_id → companies | RESTRICT | Can't delete company with jobs |
| jobs.assigned_to → users | SET NULL | Unassign if user deleted |
| jobs.created_by → users | SET NULL | Audit degrades gracefully |
| jobs.updated_by → users | SET NULL | Same |

### Review Findings Resolved

| Finding | Severity | Resolution |
|---------|----------|-----------|
| Soft delete breaks UNIQUE constraints (email, slug, auth_user_id, job_number) | CRITICAL | All UNIQUE constraints replaced with partial unique indexes: `WHERE deleted_at IS NULL` |
| RLS `FOR ALL` blocks INSERT during onboarding | CRITICAL | Split into per-operation policies. INSERT on companies/users blocked for anon (goes through service_role backend) |
| `is_platform_admin` self-escalation via anon key UPDATE | CRITICAL | Added trigger `prevent_admin_self_escalation()` + WITH CHECK on users_update policy prevents role/admin changes |
| RLS doesn't filter soft-deleted records | CRITICAL | Added `deleted_at IS NULL` to all SELECT policies |
| `ON DELETE CASCADE` on auth_user_id hard-deletes users | CRITICAL | Changed to `ON DELETE SET NULL` — preserves user row and audit trail |
| Self-referential RLS on users table | WARNING | Created `get_my_company_id()` SECURITY DEFINER function — avoids recursion |
| No WITH CHECK prevents company_id mutation | WARNING | Added explicit WITH CHECK on all UPDATE policies |
| `updated_at` trigger fires on soft-delete | WARNING | Added guard: skips `updated_at` update when only `deleted_at` changes |
| Storage bucket lacks file size/type limits | INFO | Added 10MB limit and JPEG/PNG/WebP MIME types |

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1, Supabase project creation
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Auth:** Supabase Auth with Google OAuth only. No Clerk. No email/password. (User decision: own all data, no external dependency)
- **Data access:** All through FastAPI. Frontend never queries Supabase directly (except auth). Clean FE/BE separation.
- **Storage:** Private bucket + signed URLs from day one. Client property photos are sensitive.
- **Onboarding:** Upsert + unique constraint prevents duplicate company creation (race condition fix from outside voice review).
- **Google OAuth:** Start in testing mode, verify domain in parallel (non-blocking).
- **Touch targets:** 48px minimum for field use with gloves (UX review finding).
- **Multi-tenancy:** Direct FK — one user belongs to one company. `company_id` on every data table. (2026-03-25)
- **Table naming:** `companies` (not `organizations`) — matches contractor domain language. (2026-03-25)
- **Roles:** `owner` (full admin) + `employee` (field worker, office staff). No separate `admin` role for V1. (2026-03-25)
- **Platform admin:** `is_platform_admin` boolean on users. Bypasses RLS via service_role key. For platform support/debugging. (2026-03-25)
- **RLS:** Enabled on all tables from day one. Backend uses service_role key (bypasses RLS). Defense-in-depth. (2026-03-25)
- **Types:** TEXT over ENUM (avoid ALTER TYPE migrations), TEXT over VARCHAR (no arbitrary limits), CHECK constraints for validation. (2026-03-25)
- **Soft delete:** `deleted_at TIMESTAMPTZ` on all 3 tables. NULL = active. Preserves audit trail and insurance records. (2026-03-25)
- **Jobs is the hub:** Photos, line items, scope runs, reports all hang off jobs via `job_id`. Each gets its own table (not JSON blobs). (2026-03-25)
- **Bootstrap tables:** Only `companies`, `users`, `jobs`. Other tables (photos, line_items, scope_runs, etc.) come with their respective specs. (2026-03-25)
- **Expert review round 1:** Schema reviewed by backend architect + CTO mentor. 3 critical, 7 warning findings — all resolved. (2026-03-25)
- **Expert review round 2:** Schema reviewed by data architect + security auditor + Supabase expert. 5 critical, 3 warning findings — all resolved. Key fixes: partial unique indexes for soft delete, per-operation RLS policies, SET NULL on auth_user_id (not CASCADE), anti-escalation trigger, deleted_at filter in RLS. (2026-03-25)
- **Eng review:** PASSED — 8 issues found, all resolved. Review date: 2026-03-24.
