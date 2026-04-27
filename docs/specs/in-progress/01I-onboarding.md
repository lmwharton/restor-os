# Spec 01I: Onboarding Flow — Signup, Company Profile, Job Import, Pricing, First Job

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/4 phases) |
| **State** | In Progress |
| **Blocker** | None |
| **Branch** | `lakshman/crew-57-v1-onboarding-build-first-run-setup-wizard-spec-01i` |
| **Issue** | [CREW-57](https://linear.app/crewmatic/issue/CREW-57/v1-onboarding-build-first-run-setup-wizard-spec-01i) |
| **Source of truth** | Brett's PRD v1.0 (`docs/research/onboarding-spec-v1.pdf`, April 13, 2026) |
| **Out of scope** | Team invites + acceptance — moved to separate project after eng review caught missing accept flow |
| **QA** | `docs/specs/qa-checklist.md` § Onboarding (Brett's 9 criteria) |
| **Depends on** | Spec 00 (Bootstrap — complete), Spec 01F (Create Job v2 — endpoint live) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-15 |
| Started | 2026-04-27 |
| Last revised | 2026-04-27 (post eng review — codex outside voice) |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Reference
- **Brett's PRD:** [`docs/research/onboarding-spec-v1.pdf`](../../research/onboarding-spec-v1.pdf) — "Onboarding UI Flow — Product Specification v1.0" (April 13, 2026)
- **Current implementation:** Spec 00 (Bootstrap — complete) — Google OAuth, basic onboarding (company name + phone only)
- **Current frontend:** `web/src/app/(onboarding)/onboarding/page.tsx`
- **Current onboarding RPC:** `rpc_onboard_user` in `backend/alembic/versions/b3f1a2c4d5e6_add_rpc_functions_for_atomic_operations.py:140` — atomic with advisory lock

## Done When
- [ ] Email/password signup works alongside existing Google OAuth
- [ ] Company profile collects name*, phone*, business address*, and optional service area in a single atomic create
- [ ] Quick Add Active Jobs imports up to 10 existing jobs in one batch (optional, skippable)
- [ ] Pricing upload accepts Xactimate Excel file with row-level validation and error reporting (optional, skippable)
- [ ] Guided first job creation uses simplified Create Job form with fewer fields (optional, skippable)
- [ ] Onboarding completion screen shows checklist (✓ completed / ○ skipped) with next steps
- [ ] Progress bar shows "Step X of 3" at top of each screen (account creation is pre-step Screen 1)
- [ ] Onboarding state persists per-user — closing browser resumes at next incomplete step
- [ ] Dashboard shows "Complete your setup" banner if optional steps were skipped (per-user dismiss state)
- [ ] Total time target: signup to first job created in under 10 minutes
- [ ] Mobile-optimized: vertical stacking, correct keyboards, large tap targets
- [ ] Settings recovery surfaces exist: `/settings/jobs/import`, `/settings/pricing`
- [ ] Role rename: `'employee'` → `'tech'` migration applied
- [ ] Protected layout enforces onboarding completion (manual nav to `/jobs` redirects back if incomplete)
- [ ] QA checklist § Onboarding all green via `/qa` against `docs/specs/qa-checklist.md`

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
| 6 | Job statuses use the actual enum (`needs_scope/scoped/submitted`), not Brett's PRD wording (Lead/Scheduled/In Progress/Completed) | Spec 00 already shipped the pipeline with the actual enum. Brett's UI dropdown labels can map to the same backend values without a second enum. |
| 7 | Role rename `'employee'` → `'tech'` | DB CHECK is `'employee'`. Brett's PRD uses `'tech'`. Pre-launch zero data — cheap migration. Avoids ongoing app-layer aliasing. |
| 8 | Pricing upload kept in onboarding with **minimal** `scope_codes` table here | Codex called out that dropping pricing cascades through state machine, copy, and banner. Cheaper to ship the minimal table now and let Spec 01D extend it later than to rewrite the wizard twice. |
| 9 | Banner dismiss state per-user, server-side | Survives device switches. Trivial cost. |
| 10 | Onboarding completion gate at `(protected)/layout.tsx`, server-side | Single layer enforces it for every protected route. No client check (avoids flicker). |
| 11 | Skip Playwright; use `/qa` skill against `docs/specs/qa-checklist.md` | Vitest already exists for component logic. Playwright would add real value at scale, but pre-launch with 1-2 devs the manual `/qa` gate via Claude-in-Chrome is sufficient. Innovation tokens saved. |
| 12 | Team invites moved to separate project | Codex caught missing acceptance flow design (token redemption, auth-redirect, JOIN-not-CREATE). That's its own architecture problem. |

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

Brett's PRD UI labels use friendly terms; the backend uses the existing `('needs_scope', 'scoped', 'submitted')` CHECK constraint. Use the existing pipeline status values; the dropdown shows friendly labels.

| UI label | Backend value |
|---|---|
| Lead | `needs_scope` (default) |
| Scoped | `scoped` |
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

```bash
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1 (Email/Password signup — Screen 1)
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

---

## Decisions & Notes

Append-only as implementation progresses. Initial Decision Log is at the top of this file (post eng review revision).
