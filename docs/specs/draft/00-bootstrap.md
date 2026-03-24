# Spec 00: Bootstrap — Project Setup & Authentication

> **Status:** Draft
> **Implements:** [docs/design.md](../../design.md) — Architecture, Auth, Tech Stack
> **Priority:** First — nothing else can be built without this

---

## Goal

Get the app running end-to-end: frontend ↔ backend ↔ database ↔ auth. A user can sign in with Google, see an empty job list, and the infrastructure is ready for feature specs to build on.

---

## Checklist

### 1. Supabase Setup
- [ ] Create Supabase project
- [ ] Create V1 database tables (from design.md schema):
  - `companies` — id, name, phone, logo_url, created_at
  - `jobs` — id, company_id, address, homeowner_name, insurance_carrier, claim_number, category, loss_cause, status, room_count, created_at, updated_at
  - `photos` — id, job_id, room_name, storage_url, filename, caption, photo_type, selected_for_ai, uploaded_at
  - `line_items` — id, job_id, xactimate_code, description, quantity, unit, justification, is_non_obvious, source, created_at
  - `scope_runs` — id, job_id, photo_count, ai_items_generated, items_kept, items_edited, items_deleted, items_added_manually, duration_ms, created_at
- [ ] Enable Supabase Auth with Google OAuth provider
- [ ] Create a storage bucket for photos (public for V1)
- [ ] Set up environment variables locally (.env.local for web, .env for backend)

### 2. Backend (FastAPI on Railway)
- [ ] Connect FastAPI to Supabase (using supabase-py client)
- [ ] Add CORS configuration for local dev and Vercel domain
- [ ] Create health check endpoint: `GET /api/health`
- [ ] Create auth middleware (validate Supabase JWT from request headers)
- [ ] Deploy to Railway with environment variables
- [ ] Verify health check works on Railway URL

### 3. Frontend (Next.js on Vercel)
- [ ] Install Supabase client (`@supabase/supabase-js`, `@supabase/ssr`)
- [ ] Set up Supabase auth client with Google OAuth
- [ ] Create `/login` page with "Sign in with Google" button
- [ ] Create auth callback route (`/auth/callback`)
- [ ] Create protected layout that redirects unauthenticated users to /login
- [ ] Create company onboarding flow (first login → create company name)
- [ ] Create empty Job List page (Screen 1 from design.md) with "No jobs yet" empty state
- [ ] Set up API client for backend communication (fetch with auth headers)
- [ ] Deploy to Vercel with environment variables

### 4. Auth Flow
- [ ] User clicks "Sign in with Google" → Supabase OAuth flow → redirect back
- [ ] On first login: prompt for company name → create `companies` row → store company_id
- [ ] On subsequent logins: look up company by user → show job list
- [ ] Logout button in nav → clear session → redirect to /login

### 5. Navigation & Layout
- [ ] App shell: top nav with Crewmatic logo, company name, logout button
- [ ] Mobile-responsive nav (hamburger menu on small screens)
- [ ] Protected routes: everything except /login requires auth
- [ ] /research and /product pages remain public (no auth required)

### 6. Verification
- [ ] Can sign in with Google on staging URL
- [ ] Can create a company on first login
- [ ] See empty job list after login
- [ ] Can sign out and sign back in
- [ ] Backend health check responds on Railway
- [ ] Frontend deploys successfully on Vercel

---

## Out of Scope

- Job creation (that's spec 01 or 02)
- Photo upload
- AI Photo Scope
- Any feature beyond "sign in and see empty job list"

---

## Technical Notes

- **Auth strategy:** Supabase Auth with Google OAuth. V1 uses application-level `WHERE company_id = :user_company_id` on all queries. No database-level RLS until V2.
- **API communication:** Frontend calls FastAPI backend directly (not through Supabase). Supabase is used for auth + database + storage, but business logic lives in FastAPI.
- **Environment variables needed:**
  - Frontend: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`
  - Backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
