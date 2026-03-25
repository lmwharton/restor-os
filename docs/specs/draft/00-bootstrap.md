# Bootstrap — Auth, Database, Company Setup

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/4 phases) |
| **State** | ❌ Not Started |
| **Blocker** | None |
| **Branch** | TBD |
| **Issue** | TBD |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-03-24 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] User can sign in with Google on crewmaticai.vercel.app
- [ ] First-time user sees "Create your workspace" onboarding (company name + phone)
- [ ] Returning user goes straight to empty job list
- [ ] User can sign out and sign back in
- [ ] FastAPI backend deployed on Railway, health check responding
- [ ] All backend pytest tests passing (auth middleware + company creation)
- [ ] Code review approved

## Overview

**Problem:** No infrastructure exists. Can't authenticate, can't store data, can't deploy.

**Solution:** Set up Supabase (auth + DB + storage), FastAPI backend on Railway, Next.js frontend on Vercel. User signs in with Google, creates a company workspace, sees an empty job list. All data flows through FastAPI — frontend never touches Supabase directly (except auth).

**Scope:**
- IN: Google OAuth, company creation, empty job list, app shell, backend deploy, DB tables, private storage bucket
- OUT: Job creation, photo upload, AI scope, PDF export, team invites, any feature beyond "sign in and see empty app"

## Phases & Checklist

### Phase 1: Supabase + Google Cloud Setup — ❌
- [ ] Create Supabase project
- [ ] Create V1 database tables (present each to user for approval):
  - `companies` (id, name, slug, phone, email, logo_url, settings, subscription_tier, timestamps)
  - `jobs` (company_id, job_number, address fields, insurance/adjuster fields, loss details, status, customer info, timestamps)
  - `photos` (job_id, company_id, room_name, storage_url, filename, caption, photo_type, selected_for_ai, timestamps)
  - `line_items` (job_id, company_id, xactimate_code, description, quantity, unit, justifications, is_non_obvious, source, sort_order, timestamps)
  - `scope_runs` (job_id, company_id, photo_count, accuracy tracking fields, duration_ms, ai_cost_cents, timestamps)
- [ ] Add unique constraint: one company per user (prevents race condition on onboarding)
- [ ] Create PRIVATE storage bucket for photos (signed URLs for access)
- [ ] Create Google Cloud project, configure OAuth consent screen (testing mode)
- [ ] Add Brett's email + team emails as test users in Google Cloud Console
- [ ] Create OAuth 2.0 client ID with redirect URIs (localhost + Vercel staging)
- [ ] Set up .env files locally (web/.env.local, backend/.env)

### Phase 2: Backend (FastAPI on Railway) — ❌
- [ ] Add Supabase JWT secret and service role key to config.py
- [ ] Create auth middleware: validate Supabase JWT, extract user_id and company_id
- [ ] Create auth dependency for route injection
- [ ] Add CORS for Vercel staging domain + localhost
- [ ] Create `POST /v1/company` — create company (upsert, linked to authenticated user)
- [ ] Create `GET /v1/company` — get current user's company
- [ ] Create `GET /v1/jobs` — list jobs for company (returns empty list initially)
- [ ] Deploy to Railway with environment variables
- [ ] Verify health check + authenticated endpoints on Railway URL

### Phase 3: Frontend (Next.js on Vercel) — ❌
- [ ] Install `@supabase/supabase-js` and `@supabase/ssr`
- [ ] Create Supabase auth client configured for Google OAuth
- [ ] Create `/login` page with "Sign in with Google" button (crewmatic.ai brand: Geist font, burnt orange #e85d26, warm grays)
- [ ] Create `/auth/callback` route handler for OAuth redirect
- [ ] Create protected layout: unauthenticated → redirect to /login
- [ ] Create API client module (fetch wrapper with JWT in Authorization header)
- [ ] Create onboarding page: "Create your workspace" — company name (required) + phone (optional)
- [ ] Create empty Job List page: "No jobs yet. Create your first job to start scoping." with CTA
- [ ] App shell: top nav with "crewmatic" logo, company name, sign out button
- [ ] Mobile-responsive nav (48px touch targets for field use with gloves)
- [ ] /research and /product pages remain public (no auth required)
- [ ] Deploy to Vercel with environment variables

### Phase 4: Tests + Verification — ❌
- [ ] pytest: health check returns 200
- [ ] pytest: auth middleware rejects missing JWT (401)
- [ ] pytest: auth middleware rejects invalid/expired JWT (401)
- [ ] pytest: auth middleware passes valid JWT, returns user_id + company_id
- [ ] pytest: company creation (upsert) creates company linked to user
- [ ] pytest: duplicate company creation returns existing company (no duplicate)
- [ ] pytest: jobs list returns empty array for new company
- [ ] Manual: sign in with Google on staging URL
- [ ] Manual: first login shows onboarding screen
- [ ] Manual: create company → see empty job list
- [ ] Manual: sign out → sign back in → goes to job list (not onboarding)

## Technical Approach

**Auth flow:**
```
Browser → Supabase Auth (Google OAuth) → JWT token
Browser → FastAPI (JWT in Authorization header) → Supabase DB
```

**Key patterns:**
- Supabase Auth handles Google OAuth flow client-side. JWT issued to browser.
- FastAPI validates JWT via JWKS endpoint or shared secret (per Supabase docs).
- `company_id` extracted from JWT claims or looked up from user→company mapping.
- Application-level `WHERE company_id = :user_company_id` on all queries (no RLS in V1).
- Onboarding uses upsert: `INSERT ON CONFLICT DO NOTHING` prevents duplicate companies.
- Google OAuth in "testing" mode initially — add specific emails as test users. Submit for verification in parallel (non-blocking).
- Private storage bucket — FastAPI generates signed URLs (15-min expiry) for photo access.

**Key Files:**
- `backend/api/auth/middleware.py` — JWT validation + user/company extraction
- `backend/api/auth/router.py` — company creation endpoint
- `backend/api/config.py` — add JWT secret, service role key
- `web/src/lib/supabase.ts` — Supabase client for auth
- `web/src/lib/api-client.ts` — fetch wrapper with auth headers
- `web/src/app/(auth)/login/page.tsx` — sign in page
- `web/src/app/(auth)/callback/route.ts` — OAuth callback
- `web/src/app/(protected)/layout.tsx` — auth-gated layout
- `web/src/app/(protected)/jobs/page.tsx` — empty job list
- `web/src/app/(protected)/onboarding/page.tsx` — create workspace

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
- **Eng review:** PASSED — 8 issues found, all resolved. Review date: 2026-03-24.
