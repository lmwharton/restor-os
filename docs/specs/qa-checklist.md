# Crewmatic Master QA Checklist

**State:** Living document. Append per-feature sections as they ship.
**Consumed by:** `/qa`, `/qa-only`, `/qa-refine-loop`, `frontend-qa` agent, `ai-qa` agent, `backend-qa` agent.
**Test runner for flow tests:** Claude-in-Chrome via `/qa` skill (no Playwright in V1).

## How to use this file

Each feature has a section with:
- **Source spec** — the implementation spec it tests
- **Source PRD** — Brett's original product spec, if applicable
- **Pre-test setup** — accounts, fixtures, viewport, env
- **Scenarios** — numbered, each with steps + expected outcome
- **Edge cases** — variants of the happy path that must also pass
- **Regression checks** — what must not break

When running QA, agents should:
1. Read this file's relevant section(s)
2. Execute each scenario via Claude-in-Chrome
3. Capture screenshot + console state at each assertion point
4. Report PASS / FAIL / BLOCKED per scenario with evidence
5. Append failed scenarios to that section's "Known issues" (until fixed)

When a feature spec moves from `in-progress/` → `implemented/`, its section here stays — these become the regression suite.

---

## § Onboarding (Spec 01I, CREW-57)

**Source spec:** `docs/specs/in-progress/01I-onboarding.md`
**Source PRD:** `docs/research/onboarding-spec-v1.pdf` (Brett, April 13, 2026)
**Linear:** [CREW-57](https://linear.app/crewmatic/issue/CREW-57)

### Pre-test setup
- Fresh Supabase auth user (no `users` or `companies` row)
- Frontend on staging URL (Vercel preview or production staging)
- Viewports tested: desktop (1280×800), iPhone 14 Pro (393×852)
- Test cards/files: `fixtures/qa/sample-pricing.xlsx` (147 valid rows), `fixtures/qa/invalid-pricing.xlsx` (5 rows with errors)

### Scenarios (Brett's 9 success criteria)

#### S1. Account created in under 2 minutes (criterion 1)
1. Navigate to `/signup`
2. Enter email `qa-test-{timestamp}@crewmatic.ai`, password `TestPassword123`, confirm same, check terms
3. Click [Create Account]
4. **Expected:** redirect to `/onboarding` within 2s, auth session established (verify via `supabase.auth.getSession()` in console)
5. **Stopwatch from /signup load → /onboarding render must be under 120s** including human typing time

#### S2. Company profile saves correctly (criterion 2)
1. From `/onboarding` (logged in, no company yet)
2. Fill: name "Dry Pros QA", phone "5551234567", address "123 Test St", city "Warren", state "MI", zip "48089", check "Warren/Macomb" service area
3. Click [Continue]
4. **Expected:** single `POST /v1/company` network call (NOT a separate PATCH), 201 response, advances to next step
5. Verify in DB: `companies` row has all fields persisted, `users.company_id` populated atomically

#### S3. Pricing upload validates correctly (criterion 3)
1. From pricing screen, drag-drop `fixtures/qa/sample-pricing.xlsx`
2. **Expected:** "Validating..." spinner, then ✓ "Loaded 147 line items"
3. Verify in DB: `scope_codes` has 147 rows for this `company_id`
4. Repeat with `fixtures/qa/invalid-pricing.xlsx`
5. **Expected:** ✗ error icon, list of 5 row errors with `{row, field, message}` shape, [Download Error Report] button works (downloads CSV)

#### S5. First job visible on Dashboard (criterion 5)
*(criterion 4 — team invites — moved to separate project, not in this section)*
1. From first-job screen, fill address/customer/phone, select "Water Damage Restoration"
2. Click [Create Job]
3. **Expected:** `POST /v1/jobs` 201, redirect to Job Detail or Dashboard with job pin visible on map

#### S6. Skip optional steps, complete later from Settings (criterion 6)
1. Sign up fresh user, complete company profile only
2. Skip pricing and first-job steps
3. **Expected:** Dashboard shows "Complete your setup" banner with one bullet (Upload pricing)
4. Navigate to `/settings/pricing` directly via URL — page exists, accepts upload
5. Upload valid pricing
6. **Expected:** banner disappears (after refresh)

#### S7. Progress saved if browser closed mid-flow (criterion 7)
1. Sign up fresh user, complete company profile, see pricing screen
2. Close browser tab
3. Open new tab, sign in
4. **Expected:** routed to `/onboarding` at pricing step, "Welcome back! Let's finish setting up your account" header visible
5. Verify in DB: `users.onboarding_step = 'pricing'`

#### S8. Mobile flow works smoothly (criterion 8)
1. Switch viewport to iPhone 14 Pro (393×852)
2. Run S1 → S7 in this viewport
3. **Expected at each step:**
   - Email field shows email keyboard (verify via `inputMode` attr)
   - Phone field shows tel pad (verify via `inputMode="tel"`)
   - ZIP shows numeric pad
   - Address has `autoComplete="street-address"` (browser autofill prompt may appear)
   - Progress bar sticky at top
   - All tap targets ≥ 44×44px
   - File picker opens native picker (Files / Drive / Dropbox shortcuts visible) on pricing screen

#### S9. Total flow feels fast — under 10 minutes total (criterion 9)
1. **Stopwatch test:** start at `/signup` load, end at first-job-created screen
2. All forms filled with realistic but typical values, no skipping
3. **Expected:** elapsed time < 10 minutes including human reading time

### Edge cases

#### E1. Email already registered
- Navigate to `/signup`, enter an email that already has a Supabase auth user
- **Expected:** error "This email is already registered." + visible [Sign In] link + [Use Different Email] button (clears the email field)

#### E2. Network failure during pricing upload
- Throttle network to "Offline" via DevTools
- Drag-drop pricing file
- **Expected:** "Upload failed. Please check your connection and try again." + [Retry] button. File stays selected (no re-browse needed).
- Restore network, click [Retry]
- **Expected:** upload succeeds

#### E3. Manual nav to `/jobs` before onboarding complete
- Sign up, complete company profile, but stop on pricing screen
- Manually navigate to `/jobs` via URL
- **Expected:** server-side redirect back to `/onboarding` (no flicker, no client-side redirect)

#### E4. Back button preserves data
- Fill company profile partially, click "Have active jobs?" link
- Click browser back button
- **Expected:** company profile retains entered data

#### E5. Skip first job → Dashboard empty state
- Skip first job creation
- **Expected:** Dashboard shows "No jobs yet. [Create Your First Job]" CTA, no error state

#### E6. Banner dismiss persists across devices
- Sign up on desktop, skip pricing, see banner, click [Dismiss]
- Sign in same account on mobile
- **Expected:** banner does NOT appear (dismiss state is per-user server-side, not localStorage)

### Regression checks (must not break)

#### R1. Google OAuth still works
- From `/login` or `/signup`, click "Continue with Google"
- **Expected:** OAuth flow completes, lands on `/onboarding` (if first time) or `/jobs` (if returning)

#### R2. `rpc_onboard_user` advisory lock holds
- Stress test: open 3 tabs, sign up new user simultaneously in each, submit company profile at the same instant
- **Expected:** exactly 1 company created, no duplicate-key errors, no orphaned rows

#### R3. Existing `'owner'` role rows unaffected by `'employee' → 'tech'` rename
- After role rename migration, verify all existing `users.role = 'owner'` rows untouched
- Verify CHECK constraint allows both `'owner'` and `'tech'`, rejects `'employee'`

#### R4. Returning user (already onboarded) skips wizard entirely
- Sign in as completed-onboarding user
- **Expected:** routes directly to `/jobs`, no `/onboarding` redirect

### Known issues
*(append PASS/FAIL rows during QA runs; remove when fixed)*

| Date | Scenario | Status | Issue | Resolved in |
|------|----------|--------|-------|-------------|

---

## § Future feature sections

Append new sections below this line when specs ship.
Format each section identically: source spec, source PRD, pre-test setup, scenarios, edge cases, regression checks, known issues.
