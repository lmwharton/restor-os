# Spec 01I: Onboarding Flow — Signup, Company Profile, Pricing, Welcome

## Status
| Field | Value |
|-------|-------|
| **Progress** | ████████████████████ 100% — shipped to `main` |
| **State** | ✅ **Implemented & Merged** |
| **Blocker** | None |
| **Branch** | `lm-dev` (merged) |
| **Issue** | [CREW-57](https://linear.app/crewmatic/issue/CREW-57/v1-onboarding-build-first-run-setup-wizard-spec-01i) — closed |
| **PR** | [#17](https://github.com/lmwharton/restor-os/pull/17) — merged 2026-04-28 (commit `938eaa8c`) |
| **Source of truth** | Brett's PRD v1.0 (`docs/research/onboarding-spec-v1.pdf`, April 13, 2026) |
| **Out of scope** | Team invites + acceptance — moved to separate project after eng review caught missing accept flow |
| **QA** | `/qa` ran in-loop during build; bugs found + fixed (page titles, login alert clearing, Quick Add row cap, owner name capture). Browser-verified on staging post-merge. |
| **Depends on** | Spec 00 (Bootstrap — complete), Spec 01F (Create Job v2 — endpoint live) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-15 |
| Started | 2026-04-27 |
| Last revised | 2026-04-28 (post-merge — AI positioning + logo asset replacement) |
| Completed | 2026-04-27 (code complete) |
| Merged | 2026-04-28 (PR #17 → `main`, commit `938eaa8c`) |
| Sessions | 1 |
| Commits on `lm-dev` | 22 (since spec rewrite at `c0f15b1`) |
| Files Changed | ~50 (backend + frontend + 1 PNG asset) |
| Tests Written | 35 pytest + 50 Vitest (all green) |

## Reference
- **Brett's PRD:** [`docs/research/onboarding-spec-v1.pdf`](../../research/onboarding-spec-v1.pdf) — "Onboarding UI Flow — Product Specification v1.0" (April 13, 2026)
- **Current implementation:** Spec 00 (Bootstrap — complete) — Google OAuth, basic onboarding (company name + phone only)
- **Current frontend:** `web/src/app/(onboarding)/onboarding/page.tsx`
- **Current onboarding RPC:** `rpc_onboard_user` in `backend/alembic/versions/b3f1a2c4d5e6_add_rpc_functions_for_atomic_operations.py:140` — atomic with advisory lock

## Done When
- [x] Email/password signup works alongside existing Google OAuth (`/signup` page)
- [x] Step 1 collects owner name + company name, phone, and business address with Google Places autocomplete that auto-fills city/state/ZIP
- [x] Step 1 atomic POST /v1/company creates `companies` + `users` rows via extended `rpc_onboard_user` (advisory lock preserved)
- [x] Quick Add Active Jobs imports up to 10 jobs in a batch (optional modal, atomic via `rpc_create_jobs_batch`)
- [x] Pricing upload accepts Xactimate Excel file with row-level validation and tenant-scoped error reports (optional, "Coming soon" badge — Spec 02A is the consumer)
- [x] Welcome screen personalizes with company name + brand water-droplet, two CTAs ([Go to Dashboard], [Create Your First Job →] /jobs/new)
- [x] First job creation happens from the dashboard, NOT in the wizard (rewrite during build — see Decision Log #13)
- [x] Progress bar shows "Step X of 2" at top of every step screen (sticky, mobile-friendly)
- [x] Onboarding state persists per-user — closing browser resumes at the right step; Welcome screen idempotently stamps `'complete'` on mount
- [x] Dashboard shows "Complete your setup" banner if pricing was skipped (server-derived `has_pricing`, dismissible per user)
- [x] Total time target: signup to dashboard in under 5 minutes — well below Brett's 10-min bar
- [x] Mobile-first: vertical stacking, correct keyboards (`inputMode="email"/"tel"/"numeric"`), `autoComplete="street-address"`, ≥44px tap targets
- [x] Settings recovery surfaces live: `/settings/jobs/import`, `/settings/pricing`
- [x] Role rename: `'employee'` → `'tech'` migration applied + backfill for existing users
- [x] Protected layout `(protected)/layout.tsx` enforces onboarding completion server-side (no flicker)
- [x] QA checklist § Onboarding all green — `/qa` ran in-loop during build (3 rounds: post-implementation review, full email/password sweep, mobile responsiveness). All 9 of Brett's success criteria validated; 4 bugs found + fixed inside the same PR (page titles, stacked login alerts, Quick Add row-cap closure leak, owner-name capture for email signups).
- [x] AI positioning removed from auth + onboarding journey, replaced with "your restoration partner" language (post-merge: extended across `/product`, dashboard, jobs, notifications — see Decision Log #23)
- [x] Brand wordmark across `/login`, `/signup`, onboarding shell, and Welcome hero replaced with the official `crewmatic-logo.png` asset (post-merge: image cropped from 2576² square down to 2110×519 to remove ~60% whitespace padding — see Decision Log #24)

## What Changes from Current Implementation

Current (Spec 00 Bootstrap):
- Google OAuth only — no email/password
- Onboarding collects company name + phone only (calls `POST /v1/company` → `rpc_onboard_user`)
- No business address, no service area
- No job import, no pricing upload
- No progress tracking, no resume logic, no completion screen
- User roles: `('owner', 'employee')`

This spec (v1):
- **Email/password signup** added alongside Google OAuth
- **Company profile expanded** — `rpc_onboard_user` extended to accept full profile atomically (street, city, state, zip + service area)
- **3 optional steps** — job import, pricing upload, guided first job (all skippable)
- **Onboarding state machine** — per-user, server-derived from data (not client-asserted)
- **Settings recovery surfaces** — `/settings/jobs/import`, `/settings/pricing` (`/settings/team` not in scope here)
- **Role rename** — `'employee'` → `'tech'` to match contractor terminology
- **Protected-layout completion gate** — incomplete onboarding redirects back

**Out of scope (moved to separate project):**
- Team invites + acceptance flow. Codex eng review surfaced that the original spec defined invite creation but no token-redemption/accept route or auth-redirect logic to attach an invited user to the existing company. That's its own design problem.

---

## Decision Log (top of spec — read first)

| # | Decision | Reasoning |
|---|----------|-----------|
| 1 | Email/password alongside Google, not replacing it | Brett's spec adds email/password. Google OAuth is already built. Support both. |
| 2 | Screen 2 (Company Profile) is the **CREATE** step, not UPDATE | Eng review (codex) caught that PATCH /v1/company requires an existing company. Use POST + extend rpc_onboard_user signature to take full profile atomically. Preserves the advisory-lock atomicity that fixed the prior race. |
| 3 | Address columns already exist on `companies` | Spec 00 already added `address, city, state, zip`. Migration only needs to add `service_area text[]`. |
| 4 | Onboarding state lives on `users` (not `companies`) | Eng review (codex) caught that company-scoped state would trap invited team members in owner setup. Per-user state is the right boundary. |
| 5 | State is server-derived from data, not client-asserted | Eng review (codex) caught that `PATCH /v1/company/onboarding-step` lets a client claim `first_job_created=true` without creating a job. Server derives from `EXISTS` queries on real tables. Only `setup_banner_dismissed_at` is a real flag. |
| 6 | Job statuses use the live 7-stage pipeline enum, not Brett's PRD wording (Lead/Scheduled/In Progress/Completed) | The DB CHECK lives at migration `49e2a91b6ebb`: `('new', 'contracted', 'mitigation', 'drying', 'job_complete', 'submitted', 'collected')`. Brett's three Quick-Add dropdown labels map: Lead→`new`, Scoped→`mitigation`, Submitted→`submitted`. Mapping in `_normalize_batch_status`. No new enum. |
| 7 | Role rename `'employee'` → `'tech'` | DB CHECK is `'employee'`. Brett's PRD uses `'tech'`. Pre-launch zero data — cheap migration. Avoids ongoing app-layer aliasing. |
| 8 | Pricing upload kept in onboarding with **minimal** `scope_codes` table here | Codex called out that dropping pricing cascades through state machine, copy, and banner. Cheaper to ship the minimal table now and let Spec 01D extend it later than to rewrite the wizard twice. |
| 9 | Banner dismiss state per-user, server-side | Survives device switches. Trivial cost. |
| 10 | Onboarding completion gate at `(protected)/layout.tsx`, server-side | Single layer enforces it for every protected route. No client check (avoids flicker). |
| 11 | Skip Playwright; use `/qa` skill against `docs/specs/qa-checklist.md` | Vitest already exists for component logic. Playwright would add real value at scale, but pre-launch with 1-2 devs the manual `/qa` gate via Claude-in-Chrome is sufficient. Innovation tokens saved. |
| 12 | Team invites moved to separate project | Codex caught missing acceptance flow design (token redemption, auth-redirect, JOIN-not-CREATE). That's its own architecture problem. |
| 13 | First-job step **removed** from the wizard (build-time) | UX feedback during testing: "Create your first job" right after company creation is redundant. Skipping it landed on an empty dashboard with the same prompt anyway. The natural place is the dashboard's own [Create Job] CTA. Wizard collapsed to **2 visible steps** (Company Profile, Pricing). The legacy `first_job` step on `users.onboarding_step` is kept as a valid enum value; Welcome treats it as complete. |
| 14 | Service area dropped from the wizard (build-time) | No code path reads `companies.service_area` today. Brett's PRD called it out for "future lead-gen features" that aren't shipped. Field will return as a proper county picker tied to the actual lead-gen consumer when that feature lands. The DB column stays. |
| 15 | Pricing upload kept with **"Coming soon" badge** (build-time) | Pricing's only live consumer today is the dashboard banner's `has_pricing` existence check; AI Photo Scope (Spec 02A) is the real consumer. UI is honest about the gap so contractors know why it's there. |
| 16 | Owner name captured at Step 1 (build-time) | Email/password signups carry no name from the auth provider; backend was falling back to email-prefix and the avatar showed `"??"`. Added "Your Name" as the first field on Step 1, threaded through `rpc_onboard_user` → `users.name`. Google OAuth path still uses `auth_user_metadata.full_name` when no override is provided. |
| 17 | Google Places autocomplete on every address field (build-time) | Existing `<AddressAutocomplete>` component (uses `use-places-autocomplete`) was wired into Step 1, Quick Add Jobs (per-row), and the now-removed First Job. Picking a suggestion auto-fills city/state/ZIP. `(onboarding)/layout.tsx` wraps in `GoogleMapsProvider`. |
| 18 | Welcome stamps `'complete'` on mount (build-time) | A user mid-onboarding when the wizard rewrite shipped had server-side step `'first_job'`; clicking [Go to Dashboard] then bounced through the layout gate back to `/onboarding`. Welcome now idempotently PATCHes `step → 'complete'` on mount. Forward-only state machine guarantees this is safe whether arriving via legitimate `pricing → complete`, legacy `first_job → complete`, or refresh `complete → complete` (no-op). |
| 19 | Onboarding gets a personality (build-time) | UX feedback: "are these screens exciting enough?" — they were operationally good but emotionally cold. Three small wins: (1) value-prop subtitles on `/signup`, Step 1, Step 2; (2) drop "Coming soon" pill from Pricing — replace with anticipatory copy; (3) per-screen tilted feature badges on the card edges (matches login's "Field Sync"/"AI Moisture Analysis" pattern). `/signup` previews **AI Photo Scope · 12 line items · S500 cited** (dark). Step 1 previews **Every line item S500-cited · S500 / OSHA / EPA tags** (white). Step 2 previews **Smart Code Match · WTR DRYOUT matched · 147 of 147** (teal). Bigger Welcome redesign with real product screenshots filed as CREW-58 — blocked on Spec 02A capture assets. |
| 20 | Page-title metadata on every route (build-time, /qa) | Tab titles were inheriting parent layout default — `/signup` showed "Sign In — Crewmatic", `/settings/pricing` and `/settings/jobs/import` showed bare "Crewmatic". Added route-level layouts (and one direct metadata export on `/login` since it's a server component) so each page renders a sensible title. |
| 21 | Login form clears stale alerts across actions (build-time, /qa) | Clicking Forgot Password after a failed login left "Invalid email or password" stacked above "we've sent a reset link" — looked like both happened. `handleForgotPassword` and `handleGoogle` now clear all three alert states (submitError + resetMessage + resetError) at the start. |
| 22 | Quick Add row-cap closure leak (build-time, /qa) | `addRow` checked `rows.length >= MAX_ROWS` from render-time closure; rapid clicks read stale length and skipped the guard. Moved the check inside the functional setState so each call sees freshest length. Real users can't physically click that fast — fix was free. |
| 23 | "AI" dropped as a brand prefix (post-merge polish, commit `8edcd8b` + `d551eae`) | UX feedback after merge: "AI estimating partner doesn't make sense. We don't have AI in anything. The app is basically your chief of staff or your partner." Removed "AI" from auth + onboarding copy and reframed across `/product`, dashboard, jobs, notifications. Feature names lose the prefix (`AI Photo Scope` → `Photo Scope`, `AI Hazmat Scanner` → `Hazmat Scanner`, `AI Engine` → `Scope Engine`); the "powered by AI" framing lives once in the `/product` subhead and on the existing per-feature `AI-Powered` pill. `/terms` and `/privacy` intentionally untouched — those are compliance disclosures that need explicit "AI" language to describe the actual ML processing. |
| 24 | Inline-SVG droplet wordmark replaced with PNG logo asset (post-merge polish, commit `8edcd8b`) | User uploaded the official lowercase "crewmatic" wordmark (peach/orange neon, droplet over the i). Replaced the hand-rolled SVG droplet + text combo on `/login`, `/signup`, the onboarding `BrandHeader`, and the Welcome hero with `<Image src="/crewmatic-logo.png" />`. Source asset was 2576² with heavy whitespace padding — cropped via PIL to 2110×519 (~4:1 ratio) so `w-[160px] h-auto` renders cleanly without a giant white halo around the wordmark. Dead `WaterDropIcon` components removed from auth pages. |

---

## Phase 1: Email/Password Signup (Screen 1 — pre-step)

### Account Creation

Extends Spec 00's Google-only auth to support email/password via Supabase Auth.

**Screen layout:**
```
┌─────────────────────────────────────────┐
│         🏗 Crewmatic                    │
│                                         │
│    Restoration Documentation            │
│    Built for Contractors                │
├─────────────────────────────────────────┤
│                                         │
│  Create Your Account                    │
│                                         │
│  Email                                  │
│  [________________________________]     │
│                                         │
│  Password                               │
│  [________________________________]     │
│  Must be at least 8 characters          │
│                                         │
│  Confirm Password                       │
│  [________________________________]     │
│                                         │
│  ☐ I agree to Terms of Service and      │
│    Privacy Policy                       │
│                                         │
│         [Create Account]                │
│                                         │
│  Already have an account? [Sign In]     │
│                                         │
│  ────── or ──────                       │
│                                         │
│  [Continue with Google]                 │
│                                         │
└─────────────────────────────────────────┘
```

**Field validation (real-time, inline):**
- Email: valid format (`name@domain.com`)
- Password: minimum 8 characters
- Confirm password: must match password field
- Terms checkbox: must be checked to proceed

**On submit:**
- Calls `supabase.auth.signUp({ email, password })`
- Sends verification email (non-blocking — user can verify later)
- Auth user is created but **no `users` or `companies` row yet** — that happens on Screen 2 submit
- Redirects to `/onboarding` (Screen 2: Company Profile)

**Error handling:**
- Email already exists → "This email is already registered." with [Sign In] link + [Use Different Email] option
- Password mismatch → inline real-time
- Weak password → "Password must be at least 8 characters" inline

### Login Page Update

Add email/password fields to existing `web/src/app/(auth)/login/page.tsx`:
- Email + password fields above "Sign in with Google" button
- "Forgot password?" link → Supabase password reset flow
- "Create an account" link → navigates to `/signup`

### Checklist
- [ ] Signup page at `/signup` with email, password, confirm password, terms checkbox
- [ ] `supabase.auth.signUp()` integration for email/password
- [ ] Verification email sent (non-blocking)
- [ ] Field validation: email format, password 8+ chars, passwords match, terms checked
- [ ] Error: email exists → "Already registered" with Sign In link
- [ ] Error: password mismatch → inline real-time feedback
- [ ] Login page updated with email/password fields + "Forgot password?" link
- [ ] "Create an account" link on login → `/signup`
- [ ] Google OAuth still works (unchanged from Spec 00)
- [ ] After signup → redirect to `/onboarding` (NOT `/jobs` — onboarding gate)
- [ ] Mobile: `inputMode="email"` on email field

---

## Phase 2: Company Profile + Quick Add Active Jobs (Screen 2 + 3A)

### Company Profile (Screen 2 — Required, **CREATES** the company atomically)

This screen is where `companies` and `users` rows are created. Brett's PRD has this as `Step 1 of 3` in the visible progress bar (Screen 1 / signup is the pre-step).

**Progress bar at top:** `Step 1 of 3: Company Profile`

**Fields:**

| Field | Required | Type | Notes |
|---|---|---|---|
| Company Name | Yes | text | |
| Phone Number | Yes | tel | `inputMode="tel"` |
| Business Address (street) | Yes | text | `autoComplete="street-address"` |
| City | Yes | text | |
| State | Yes | select (2-letter) | |
| ZIP Code | Yes | text | `inputMode="numeric"` |
| Service Area | No | checkbox group | predefined county options + "Other" free text |

**Service area checkboxes:**
- MVP options (configurable per region): Warren/Macomb, Oakland, Wayne
- "Other" with free text field

**On continue:**
- Single API call: `POST /v1/company` with full profile (no separate PATCH)
- Server calls extended `rpc_onboard_user` (atomic, advisory-lock)
- Sets `users.onboarding_step = 'jobs_import'`
- Advances to Screen 3 (Pricing — Quick Add Jobs is reachable from Screen 2 via link)

**Cannot skip this screen** — company profile is required.

**Optional action (bottom of screen):** "Have active jobs in progress? [Add them now]" link → opens Screen 3A: Quick Add Active Jobs. If ignored → proceeds to Pricing.

### Backend — Extend `rpc_onboard_user`

Spec 00's RPC currently accepts: `p_auth_user_id, p_email, p_name, p_first_name, p_last_name, p_avatar_url, p_company_name, p_company_phone, p_company_slug`. Extend to accept the full profile in one atomic call.

```sql
-- New migration: backend/alembic/versions/XXXX_extend_rpc_onboard_user.py

CREATE OR REPLACE FUNCTION rpc_onboard_user(
    p_auth_user_id UUID,
    p_email TEXT,
    p_name TEXT,
    p_first_name TEXT,
    p_last_name TEXT,
    p_avatar_url TEXT,
    p_company_name TEXT,
    p_company_phone TEXT,
    p_company_slug TEXT,
    -- NEW fields:
    p_company_address TEXT,
    p_company_city TEXT,
    p_company_state TEXT,
    p_company_zip TEXT,
    p_service_area TEXT[]
) RETURNS JSONB AS $$
-- ... same advisory lock + idempotent semantics ...
-- INSERT INTO companies (name, slug, phone, email, address, city, state, zip, service_area)
-- VALUES (... full profile ...)
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Migration also adds:**
```sql
-- service_area is the only new column (address/city/state/zip already exist)
ALTER TABLE companies ADD COLUMN service_area TEXT[];
```

`POST /v1/company` and `PATCH /v1/company` continue to exist; only the create payload widens.

### Quick Add Active Jobs (Screen 3A — Optional, accessed via link)

Accessed via link on Company Profile screen. Not a required step. Same as Brett's PRD layout (10 jobs max, batch).

**Fields per job:**
- Address (street, city, state, ZIP)
- Customer name, phone
- Job Type dropdown: Water Damage / Fire Damage / Mold Remediation / Reconstruction
- Status dropdown: maps to existing pipeline values

**Job status mapping (no new enum):**

Brett's PRD UI labels use friendly terms; the backend uses the live 7-stage CHECK constraint (set in migration `49e2a91b6ebb`: `('new', 'contracted', 'mitigation', 'drying', 'job_complete', 'submitted', 'collected')`). The Quick Add dropdown only exposes the three states a contractor uses when migrating from another tool — the rest of the pipeline gets touched in normal job flow, not at import time. Implementation lives in `_normalize_batch_status` in `backend/api/jobs/service.py`.

| UI label | Backend value |
|---|---|
| Lead | `new` (default) |
| Scoped | `mitigation` |
| Submitted | `submitted` |

**Re-accessible later:** `/settings/jobs/import` (built as part of this spec)

### Backend — Batch Job Import

```
POST /v1/jobs/batch
```

Wraps the existing `POST /v1/jobs` create logic in a single transaction (atomic — all succeed or all fail). Max 10 jobs per request, validated server-side.

### Checklist
- [ ] Company profile screen with expanded fields (address, service area)
- [ ] Progress bar `Step 1 of 3` at top
- [ ] Migration: extend `rpc_onboard_user` signature + add `service_area TEXT[]` to `companies`
- [ ] Migration: rename role `'employee'` → `'tech'` (CHECK constraint update)
- [ ] `POST /v1/company` accepts full profile payload (single atomic call)
- [ ] `CompanyCreate` Pydantic schema extended with address fields + `service_area`
- [ ] Frontend `/onboarding` calls `POST /v1/company` (NOT `PATCH`) on Screen 2 submit
- [ ] pytest: company profile create with full payload
- [ ] pytest: rpc_onboard_user idempotency preserved
- [ ] pytest: role rename — existing 'owner' rows unaffected (regression)
- [ ] "Have active jobs?" link → Quick Add form
- [ ] Quick Add form: up to 10 jobs with address, customer, phone, type, status dropdown
- [ ] `POST /v1/jobs/batch` endpoint — atomic transaction
- [ ] pytest: batch create 3 jobs, batch rejects > 10, batch atomicity (one bad → all rollback)
- [ ] `/settings/jobs/import` route reuses the same Quick Add form
- [ ] Mobile: address/city/state/zip keyboards correct, `autoComplete="street-address"` on address

---

## Phase 3: Pricing Upload (Screen 3 — Optional)

### Pricing Upload Screen

**Progress bar:** `Step 2 of 3: Pricing Setup (Optional)`

Same layout as Brett's PRD: drag-and-drop Excel zone, template download, [Skip for Now] / [Upload].

### File Upload Behavior

**On file selected:** filename + size + "Validating..." spinner + server-side validation
**Validation passes:** ✓ + "Loaded N line items" + [Continue] active → Screen 4 (First Job)
**Validation fails:** ✗ + row-level errors + [Download Error Report] CSV + [Try Again]
**Skip for Now:** advances to Screen 4

### Backend — Pricing Upload

```
POST /v1/pricing/upload    Content-Type: multipart/form-data
GET  /v1/pricing/template
```

**Minimal `scope_codes` schema (lives in this spec, will be extended by Spec 01D):**

```sql
CREATE TABLE scope_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    code        TEXT NOT NULL,           -- Xactimate code (e.g., WTR DRYOUT)
    description TEXT,
    unit        TEXT,                    -- SF, LF, EA, etc.
    price       NUMERIC(10, 2),
    tier        TEXT,                    -- A / B / C / etc.
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, code, tier)
);

CREATE INDEX idx_scope_codes_company ON scope_codes (company_id);
ALTER TABLE scope_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope_codes_select ON scope_codes FOR SELECT
    USING (company_id IN (SELECT company_id FROM users WHERE auth_user_id = auth.uid()));
-- (and matching insert/update/delete policies — same pattern as bootstrap)
```

This is intentionally minimal. Spec 01D will extend with selectors, dependencies, etc.

**Why kept inline:** dropping Phase 3 cascades through step numbering, completion checklist, and dashboard banner copy. Cheaper to ship the minimal table than rewrite the wizard twice.

### Checklist
- [ ] Pricing upload screen with drag-and-drop zone
- [ ] Progress bar `Step 2 of 3` at top
- [ ] File picker accepts `.xlsx`
- [ ] Migration: create `scope_codes` table + RLS
- [ ] `POST /v1/pricing/upload` endpoint with `openpyxl` parsing + row-level validation
- [ ] Row-level error response with `{row, field, message}` shape
- [ ] `GET /v1/pricing/template` returns pre-formatted xlsx
- [ ] Success: ✓ + count + Continue
- [ ] Failure: error list + [Download Error Report] CSV + [Try Again]
- [ ] Network failure: "Check connection" + Retry, file stays selected
- [ ] pytest: valid file parsed and inserted, invalid file row errors, template download
- [ ] "Skip for Now" → Screen 4 (First Job)
- [ ] `/settings/pricing` route reuses the upload component

---

## Phase 4: Guided First Job + Completion + State Machine

### Create Your First Job (Screen 4 — Optional)

**Progress bar:** `Step 3 of 3: Create Your First Job`

Simplified version of Spec 01F's Create Job form. Same `POST /v1/jobs` endpoint.

**Layout:** same as Brett's PRD — address, customer name, phone, job type radio. No loss date, emergency, or notes shown.

**Job type → backend:**
- Water Damage / Fire Damage / Mold Remediation → `mitigation`
- Reconstruction → `reconstruction`

**Job status:** uses backend default (`needs_scope`).

**On Create Job:**
- `POST /v1/jobs` → creates property + job atomically (Spec 01F flow)
- Redirects to Job Detail Page with completion overlay

**On Skip for Now:**
- Goes straight to Dashboard
- Empty state: "No jobs yet. [Create Your First Job]"

### Onboarding Completion Screen

```
┌─────────────────────────────────────────┐
│      🎉 Welcome to Crewmatic!          │
│                                         │
│  Your account is set up and ready.      │
│                                         │
│  ✓ Company profile created              │
│  ✓ First job created                    │
│  ○ Pricing setup (optional - do it      │
│    anytime)                             │
│                                         │
│  Next steps:                            │
│  • Add photos and documentation         │
│  • Create an estimate                   │
│  • Explore the dashboard                │
│                                         │
│         [Go to Dashboard]               │
└─────────────────────────────────────────┘
```

✓ = completed step. ○ = skipped (can do later). Team invites NOT shown here — deferred to separate project.

### Onboarding State Machine — per-user, server-derived

```sql
-- Add per-user onboarding state
ALTER TABLE users ADD COLUMN onboarding_step TEXT DEFAULT 'company_profile'
    CHECK (onboarding_step IN ('company_profile', 'jobs_import', 'pricing', 'first_job', 'complete'));
ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN setup_banner_dismissed_at TIMESTAMPTZ;
```

**State transitions (server-side, after each real mutation):**

```
                  POST /v1/company           POST /v1/jobs/batch (or skip)
account created   ───────────────►            ───────────────►
                  company_profile  jobs_import  pricing      first_job   complete
                                   ▲             ▲           ▲           ▲
                                   │ on company  │ pricing   │ first job │ on first
                                   │ create      │ upload OR │ create OR │ skip OR
                                   │             │ skip      │ skip      │ create
```

**Key principle:** the `onboarding_step` column tracks "where the user is in the flow," but **completion checks are derived server-side** from real data:

```python
# backend/api/auth/service.py — pseudo-code
async def get_onboarding_status(user_id: UUID) -> OnboardingStatus:
    user = await get_user(user_id)
    company_id = user.company_id

    return {
        "step": user.onboarding_step,
        "completed_at": user.onboarding_completed_at,
        "setup_banner_dismissed_at": user.setup_banner_dismissed_at,
        # Derived from real data — client cannot fake these
        "has_jobs": await db.fetch_val("SELECT EXISTS(SELECT 1 FROM jobs WHERE company_id = $1)", company_id),
        "has_pricing": await db.fetch_val("SELECT EXISTS(SELECT 1 FROM scope_codes WHERE company_id = $1)", company_id),
        "show_setup_banner": ...,  # computed below
    }
```

**Resume logic:** on login, `auth-redirect.ts` reads `onboarding_step`. If not `'complete'` → `/onboarding` at the right step. If `'complete'` → `/jobs` or wherever they were.

### Dashboard Banner

```
┌─────────────────────────────────────────┐
│ ℹ Complete your setup:                  │
│ ○ Upload pricing to create estimates    │
│   faster                                │
│                                         │
│     [Complete Setup]  [Dismiss]         │
└─────────────────────────────────────────┘
```

- Shows when `setup_banner_dismissed_at IS NULL` AND `has_pricing = false`
- "Dismiss" → `PATCH /v1/me/dismiss-setup-banner` → sets `setup_banner_dismissed_at = now()`
- "Complete Setup" → reopens `/onboarding` at first incomplete optional step

### Backend — Onboarding State Endpoints

```
GET   /v1/company/onboarding-status     # derived state (read-only)
PATCH /v1/me/dismiss-setup-banner       # explicit user action — sets timestamp
PATCH /v1/me/onboarding-step            # server advances step on real mutations OR explicit skip
```

**Critical:** there is no client-asserted "I uploaded pricing" or "I created a first job" flag. Server reads `EXISTS` queries. The only client-asserted state is **explicit skip** (which advances the step) and **explicit dismiss** (which sets a timestamp).

### Protected Layout Onboarding Gate

`web/src/app/(protected)/layout.tsx` — server-side check on each request:

```typescript
// pseudo-code
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect('/login');

const { onboardingStep } = await fetchOnboardingStatus();
if (onboardingStep !== 'complete') redirect('/onboarding');
```

No client-side check (avoids flicker).

### Checklist
- [ ] Guided first job screen (no loss date / emergency / notes)
- [ ] Progress bar `Step 3 of 3` at top
- [ ] Calls `POST /v1/jobs` from Spec 01F (job_type maps water/fire/mold→mitigation, recon→reconstruction)
- [ ] Skip for Now → Dashboard with empty state
- [ ] Onboarding completion screen with ✓/○ checklist + next steps
- [ ] Migration: add `onboarding_step`, `onboarding_completed_at`, `setup_banner_dismissed_at` to `users`
- [ ] `GET /v1/company/onboarding-status` — server-derived
- [ ] `PATCH /v1/me/onboarding-step` — accepts only valid forward transitions or explicit skip
- [ ] `PATCH /v1/me/dismiss-setup-banner`
- [ ] Resume logic in `auth-redirect.ts` — incomplete onboarding routes to `/onboarding`
- [ ] `(protected)/layout.tsx` — onboarding completion gate (server-side)
- [ ] Dashboard banner: shows when `has_pricing = false` AND not dismissed
- [ ] "Complete Setup" link reopens onboarding at first incomplete step
- [ ] Banner disappears once pricing uploaded
- [ ] pytest: state transitions, derived status accurate, dismiss persists across sessions, layout gate redirects

---

## Visual Design Notes

**Branding:**
- Crewmatic logo at top of every onboarding screen
- Consistent color scheme (per design system in `web/src/app/globals.css`)
- Clean, professional look (not playful/casual)

**Button hierarchy:**
- Primary action (Continue, Create Job) → brand-accent button
- Secondary (Skip for Now, Cancel) → gray outline
- Primary on right, secondary on left

**Form design (apply via shared `<FormField>` component):**
- Large input fields, clear labels above
- Asterisks (*) for required fields in `text-red-500`
- Real-time validation (red border if invalid)
- `onFocus={(e) => e.target.select()}` baked into the component

**Mobile:**
- Vertical stacking, larger fields
- Sticky progress bar
- Address: `autoComplete="street-address"`
- Email: `inputMode="email"`
- Phone: `inputMode="tel"`
- ZIP: `inputMode="numeric"`
- File upload: opens native picker (Files / Drive / Dropbox)

---

## Edge Cases & Error Handling

| Scenario | Behavior |
|---|---|
| User closes browser mid-onboarding | Per-user `onboarding_step` saved. Next login: "Welcome back! Let's finish setting up your account." Resumes at next incomplete step. |
| Email already registered (Screen 1) | "This email is already registered." + [Sign In] + [Use Different Email] |
| Invalid pricing file | Row-level errors + [Download Error Report] CSV + [Try Again] |
| Network failure during upload | "Check connection, try again." + Retry. File stays selected (no re-browse). |
| Back button to previous step | Allowed. Data preserved. |
| Manual nav to `/jobs` before onboarding complete | `(protected)/layout.tsx` redirects back to `/onboarding`. |
| Auth user exists but no `users` row (signup completed but Screen 2 abandoned) | On next login: route to `/onboarding` (Screen 2). RPC is idempotent — re-submission attaches them to the company they just created. |

---

## Cross-References

| Spec | Relationship |
|------|-------------|
| Spec 00 (Bootstrap, complete) | Extends auth + minimal onboarding. Google OAuth preserved, email/password added. `rpc_onboard_user` extended. Role rename. |
| Spec 01F (Create Job v2) | Screen 4 uses `POST /v1/jobs` from 01F. Simplified frontend wrapper, same backend. |
| Spec 01D (Xactimate Codes) | Pricing upload feeds the `scope_codes` table created here. 01D extends with selectors/dependencies. |
| Spec 04A (Dashboard) | Dashboard shows "Complete your setup" banner. First job visible after onboarding. |
| **Team Invites & Acceptance project (separate)** | Will design accept-invite route, token redemption, auth-redirect logic, JOIN-not-CREATE flow, `/settings/team` surface. NOT in this spec. |

## Test Coverage

See `docs/specs/qa-checklist.md` § Onboarding for Brett's 9 success criteria as `/qa` test scenarios.

**Backend pytest:**
- `backend/tests/test_onboarding.py` — extend `rpc_onboard_user`, role rename regression, batch jobs (atomic, > 10 rejected), pricing parse, state machine derived correctly, dismiss persists
- 12+ tests

**Frontend Vitest** (already installed):
- `web/src/lib/__tests__/` — extend with form validation logic per screen
- 6+ tests

**Manual `/qa`** via Claude-in-Chrome against Brett's 9 criteria — see QA checklist spec.

---

## Quick Resume

**Status: shipped.** PR #17 merged to `main` on 2026-04-28 via merge commit `938eaa8c`. No follow-up tasks open on this spec — Welcome redesign with real product screenshots tracked separately as CREW-58 (blocked on Spec 02A capture assets).

---

## Session Log

| # | Date | What was done | Phases |
|---|------|---------------|--------|
| 1 | 2026-04-27 | Initial implementation across all phases — backend foundation (migrations, RPC extension, endpoints), Phase 1 signup, Phases 2-4 wizard, protected gate, dashboard banner, settings recovery surfaces. Eng review (codex + cursor) caught 8 architectural gaps; addressed in-session. Code review (post-implementation) flagged 3 critical + 1 high + 4 medium + 5 low; all fixed in same session. | All |
| 2 | 2026-04-28 | UX polish round: dropped first-job step from wizard, dropped service area, added owner name capture (avatar `??` fix), Google Places autocomplete on every address, Welcome `'complete'` stamping, "Coming soon" → anticipatory copy on Pricing, per-screen feature badges. `/qa` ran on email/password sweep — found + fixed page titles, stacked login alerts, Quick Add row-cap leak. Logged Decisions 13-22. | Polish + /qa |
| 3 | 2026-04-28 | Post-merge polish: dropped "AI" as brand prefix from auth + onboarding (Decision 23), then extended the reframe across `/product`, dashboard, jobs, notifications. Replaced inline-SVG wordmark with official `crewmatic-logo.png` asset, cropped from 2576² down to 2110×519 to remove whitespace padding (Decision 24). Two commits: `8edcd8b` (auth/onboarding) + `d551eae` (broader surfaces). | Post-merge |

---

## Decisions & Notes

Append-only as implementation progresses. Initial Decision Log is at the top of this file (post eng review revision); Decisions 13-24 added during build + post-merge polish.
