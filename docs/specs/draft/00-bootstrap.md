# Spec 00: Bootstrap — Project Setup & Authentication

> **Status:** Draft (eng reviewed)
> **Implements:** [docs/design.md](../../design.md) — Architecture, Auth, Tech Stack
> **Priority:** First — nothing else can be built without this
> **Eng Review:** PASSED — 8 issues resolved, 0 critical gaps

---

## Goal

Get the app running end-to-end: frontend ↔ backend ↔ database ↔ auth. A user can sign in with Google, see an empty job list, and the infrastructure is ready for feature specs to build on.

---

## Architecture (from eng review)

```
AUTH FLOW:
  Browser → Supabase Auth (Google OAuth) → JWT token

DATA FLOW (everything else):
  Browser → FastAPI (JWT in Authorization header) → Supabase DB
  Browser ← FastAPI ← Supabase DB

ONBOARDING:
  Google sign-in → check user has company?
  ├── NO  → "Create your workspace" screen (name + phone)
  │         → creates company + links user → job list
  └── YES → straight to job list
```

**Key decisions:**
- Google OAuth only (no email/password) — simpler for contractors, no password reset flows
- All data access through FastAPI — frontend never touches Supabase directly (except auth)
- Private storage bucket + signed URLs from day one — client property photos are sensitive
- Upsert + unique constraint on user→company to prevent duplicate creation

---

## Checklist

### 1. Supabase Setup
- [ ] Create Supabase project
- [ ] Create V1 database tables (present each to user for approval before creation):
  - `companies` — full schema from design.md (id, name, slug, phone, email, logo_url, settings, subscription_tier, timestamps)
  - `jobs` — full schema from design.md (company_id, job_number, address fields, insurance/adjuster fields, loss details, status, customer info, timestamps)
  - `photos` — full schema (job_id, company_id, room_name, storage_url, filename, caption, photo_type, selected_for_ai, timestamps)
  - `line_items` — full schema (job_id, company_id, xactimate_code, description, quantity, unit, justifications, is_non_obvious, source, sort_order, timestamps)
  - `scope_runs` — full schema (job_id, company_id, photo_count, accuracy tracking fields, duration_ms, ai_cost_cents, timestamps)
  - Add unique constraint: one company per user (prevents race condition)
- [ ] Enable Supabase Auth with Google OAuth provider
- [ ] Create a PRIVATE storage bucket for photos (signed URLs for access)
- [ ] Set up environment variables locally (.env.local for web, .env for backend)

### 2. Google Cloud Setup
- [ ] Create Google Cloud project (or use existing)
- [ ] Configure OAuth consent screen (start in "testing" mode)
- [ ] Add Brett's email as a test user
- [ ] Create OAuth 2.0 client ID (web application)
- [ ] Add authorized redirect URIs: localhost + Vercel staging URL
- [ ] Submit for verification in parallel (non-blocking)

### 3. Backend (FastAPI on Railway)
- [ ] Add JWT secret and Supabase service role key to config
- [ ] Create auth middleware (validate Supabase JWT — use JWKS or shared secret per Supabase docs)
- [ ] Create auth dependency that extracts user_id and company_id from JWT
- [ ] Add CORS for Vercel staging domain
- [ ] Create endpoints:
  - `POST /v1/company` — create company (upsert, linked to authenticated user)
  - `GET /v1/company` — get current user's company
  - `GET /v1/jobs` — list jobs for company (returns empty list initially)
- [ ] Deploy to Railway with environment variables
- [ ] Verify health check + auth on Railway URL

### 4. Frontend (Next.js on Vercel)
- [ ] Install Supabase client (`@supabase/supabase-js`, `@supabase/ssr`)
- [ ] Set up Supabase auth client with Google OAuth
- [ ] Create `/login` page with "Sign in with Google" button (match crewmatic.ai design)
- [ ] Create auth callback route (`/auth/callback`)
- [ ] Create protected layout that redirects unauthenticated users to /login
- [ ] Create API client for FastAPI communication (fetch with JWT in Authorization header)
- [ ] Create company onboarding page: "Create your workspace" (name + phone)
- [ ] Create empty Job List page (Screen 1 from design.md) with "No jobs yet" empty state
- [ ] Deploy to Vercel with environment variables

### 5. Navigation & Layout
- [ ] App shell: top nav with Crewmatic logo, company name, logout button
- [ ] Mobile-responsive nav
- [ ] Protected routes: everything except /login, /research, /product requires auth

### 6. Backend Tests (pytest)
- [ ] Auth middleware: valid JWT passes, returns user_id + company_id
- [ ] Auth middleware: missing JWT returns 401
- [ ] Auth middleware: expired/invalid JWT returns 401
- [ ] Company creation: creates company linked to user (upsert)
- [ ] Company creation: second call with same user returns existing company (no duplicate)
- [ ] Jobs list: returns empty list for new company

### 7. Verification
- [ ] Can sign in with Google on staging URL (Brett added as test user)
- [ ] First login shows "Create your workspace" onboarding
- [ ] Can create a company
- [ ] Subsequent logins go straight to job list
- [ ] See empty job list after onboarding
- [ ] Can sign out and sign back in (goes to job list, not onboarding)
- [ ] Backend health check responds on Railway
- [ ] All pytest tests pass
- [ ] Frontend deploys successfully on Vercel

---

## Out of Scope

- Job creation (spec 01 or 02)
- Photo upload
- AI Photo Scope
- Onboarding wizard (logo upload, team invites, preferences) — V2
- Email/password auth
- RLS policies (application-level WHERE is sufficient for single-user V1)
- Frontend E2E tests (defer to spec 01)
- Google OAuth domain verification (runs in parallel, non-blocking)

---

## Technical Notes

- **Auth strategy:** Supabase Auth with Google OAuth. JWT validated by FastAPI middleware. Application-level `WHERE company_id = :user_company_id` on all queries.
- **Storage:** Private Supabase Storage bucket. FastAPI generates signed URLs (15-min expiry) for photo access.
- **API communication:** Frontend → FastAPI → Supabase. Frontend never queries Supabase directly (except auth).
- **Onboarding race condition:** Upsert pattern + unique constraint prevents duplicate company creation.
- **Google OAuth:** Start in testing mode (add Brett's email). Submit for verification in parallel.
- **Environment variables:**
  - Frontend: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`
  - Backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `CORS_ORIGINS`
