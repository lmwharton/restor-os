# Spec 01I: Onboarding Flow — Signup, Company Profile, Job Import, Pricing, Team Invites, First Job

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/5 phases) |
| **State** | Draft |
| **Blocker** | None |
| **Branch** | TBD |
| **Issue** | TBD |
| **Depends on** | Spec 00 (Bootstrap — complete), Spec 01F (Create Job v2 — draft), Spec 01D (Xactimate Codes — draft) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-15 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Reference
- **Brett's spec:** [`docs/research/onboarding-spec-v1.pdf`](../../research/onboarding-spec-v1.pdf) — "Onboarding UI Flow — Product Specification v1.0" (April 13, 2026)
- **Current implementation:** Spec 00 (Bootstrap — complete) — Google OAuth, basic onboarding (company name + phone only)
- **Current frontend:** `web/src/app/(protected)/onboarding/page.tsx`

## Done When
- [ ] Email/password signup works alongside existing Google OAuth
- [ ] Company profile collects name*, phone*, business address*, and optional service area
- [ ] Quick Add Active Jobs imports up to 10 existing jobs in one batch (optional, skippable)
- [ ] Pricing upload accepts Xactimate Excel file with row-level validation and error reporting (optional, skippable)
- [ ] Team invite sends emails with signup link, supports Owner and Tech roles (optional, skippable)
- [ ] Guided first job creation uses simplified Create Job form with fewer fields
- [ ] Onboarding completion screen shows checklist (✓ completed / ○ skipped) with next steps
- [ ] Progress bar shows "Step X of 4" at top of each screen
- [ ] Onboarding state persists — closing browser resumes at next incomplete step
- [ ] Dashboard shows "Complete your setup" banner if optional steps were skipped
- [ ] Total time target: signup to first job created in under 10 minutes
- [ ] Mobile-optimized: vertical stacking, correct keyboards, large tap targets

## What Changes from Current Implementation

Current (Spec 00 Bootstrap):
- Google OAuth only — no email/password
- Onboarding collects company name + phone only
- No business address, no service area
- No job import, no pricing upload, no team invites
- No progress tracking, no resume logic, no completion screen

This spec (v1):
- **Email/password signup** added alongside Google OAuth
- **Company profile expanded** — business address (street, city, state, zip) + service area checkboxes
- **3 optional steps** — job import, pricing upload, team invites (all skippable)
- **Guided first job** — simplified Create Job v2 form
- **Onboarding state machine** — tracks progress, supports resume, persistent dashboard banner

---

## Phase 1: Email/Password Signup (Screen 1)

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

**Field validation:**
- Email: valid format (`name@domain.com`)
- Password: minimum 8 characters
- Confirm password: must match password field
- Terms checkbox: must be checked to proceed

**On submit:**
- Creates user account via `supabase.auth.signUp({ email, password })`
- Sends verification email (optional — user can verify later, not blocking)
- Advances to Screen 2: Company Profile

**Error handling:**
- Email already exists → "This email is already registered." with [Sign In] link + [Use Different Email] option
- Password mismatch → "Passwords do not match" (inline, real-time)
- Weak password → "Password must be at least 8 characters" (inline)

**"Sign In" link** → navigates to existing `/login` page (Google OAuth + now email/password)

### Login Page Update

Add email/password fields to existing `/login` page:
- Email + password fields above "Sign in with Google" button
- "Forgot password?" link → Supabase password reset flow
- "Create an account" link → navigates to signup screen

### Checklist
- [ ] Signup page at `/signup` with email, password, confirm password, terms checkbox
- [ ] `supabase.auth.signUp()` integration for email/password
- [ ] Verification email sent (non-blocking — user can proceed without verifying)
- [ ] Field validation: email format, password 8+ chars, passwords match, terms checked
- [ ] Error: email exists → "Already registered" with Sign In link
- [ ] Error: password mismatch → inline real-time feedback
- [ ] Login page updated with email/password fields + "Forgot password?" link
- [ ] "Create an account" link on login → `/signup`
- [ ] Google OAuth still works (unchanged from Spec 00)
- [ ] After signup → redirect to onboarding (company profile)
- [ ] Mobile: email keyboard for email field

---

## Phase 2: Company Profile + Quick Add Active Jobs (Screens 2 + 3A)

### Company Profile (Screen 2 — Required)

Extends the current basic onboarding (name + phone) with business address and service area.

**Progress bar at top:** "Step 1 of 4: Company Profile"

**Fields:**

| Field | Required | Type |
|---|---|---|
| Company Name | Yes | text |
| Phone Number | Yes | tel (`inputMode="tel"`) |
| Business Address (street) | Yes | text |
| City | Yes | text |
| State | Yes | select (2-letter) |
| ZIP Code | Yes | text (`inputMode="numeric"`) |
| Service Area | No | checkbox group |

**Service area checkboxes:**
- Predefined county options (configurable per region — MVP: Warren/Macomb, Oakland, Wayne)
- "Other" option with free text field
- Helps with future lead gen features

**On continue:** saves company profile, advances to Screen 3 (Pricing Upload)

**Optional action (bottom of screen):** "Have active jobs in progress? [Add them now]" link → opens Screen 3A: Quick Add Active Jobs. If ignored → proceeds to Pricing Upload.

**Cannot skip this screen** — company profile is required.

### Backend — Update Company Profile

Extend existing `PATCH /v1/company` (from Spec 00) to accept additional fields:

```json
{
  "name": "Dry Pros Restoration",
  "phone": "5551234567",
  "address_line1": "456 Business Ave",
  "city": "Warren",
  "state": "MI",
  "zip": "48089",
  "service_area": ["warren_macomb", "oakland"]
}
```

```sql
-- Add columns to companies table
ALTER TABLE companies ADD COLUMN address_line1 VARCHAR;
ALTER TABLE companies ADD COLUMN city VARCHAR;
ALTER TABLE companies ADD COLUMN state VARCHAR(2);
ALTER TABLE companies ADD COLUMN zip VARCHAR(10);
ALTER TABLE companies ADD COLUMN service_area text[];  -- array of area codes
```

### Quick Add Active Jobs (Screen 3A — Optional)

Accessed via link on Company Profile screen. Not a required step.

**Purpose:** Contractors switching from another tool (Encircle, CompanyCam, etc.) often have 3-10 active jobs. This lets them import those quickly without going through the full Create Job flow for each one.

**Layout:**
```
┌─────────────────────────────────────────┐
│  Import Active Jobs                     │
├─────────────────────────────────────────┤
│                                         │
│  Already have jobs in progress? Add     │
│  them here to track everything in       │
│  Crewmatic.                             │
│                                         │
│  Job 1                                  │
│  ─────────────────────────────────────  │
│  Address:  [_________________________]  │
│  City:     [________] State: [__]       │
│  ZIP:      [_____]                      │
│  Customer: [_________________________]  │
│  Phone:    [_________________________]  │
│  Job Type: [Water Damage ▼]             │
│  Status:   [In Progress ▼]             │
│                                         │
│  [+ Add Another Job]                    │
│                                         │
│  ℹ Don't worry about photos or          │
│    documentation yet — you can add      │
│    those later.                         │
│                                         │
│       [Cancel]  [Import X Jobs]         │
└─────────────────────────────────────────┘
```

**Fields per job:**
- Address (street, city, state, ZIP)
- Customer name
- Phone
- Job Type dropdown: Water Damage / Fire Damage / Mold Remediation / Reconstruction
- Status dropdown: Lead / Scheduled / In Progress / Completed

**Behavior:**
- "+ Add Another Job" adds another form below (max 10 per session)
- If they need more than 10: "Need to import more? Email us at support@crewmatic.com for bulk import help"
- "Import X Jobs" button — X = count of filled-out jobs (e.g., "Import 3 Jobs")
- Batch creates all jobs in one API call
- Success: "3 jobs imported successfully" → returns to Company Profile → proceeds to Pricing Upload
- Cancel: discards entered data, returns to Company Profile

**Re-accessible later:** Settings > Jobs > [Import Active Jobs]

### Backend — Batch Job Import

```
POST /v1/jobs/batch
```

**Request:**
```json
{
  "jobs": [
    {
      "address_line1": "123 Main St",
      "city": "Warren",
      "state": "MI",
      "zip": "48089",
      "customer_name": "John Smith",
      "customer_phone": "5551234567",
      "job_type": "mitigation",
      "status": "in_progress"
    }
  ]
}
```

**Response:**
```json
{
  "created": 3,
  "jobs": [
    { "job_id": "uuid", "job_number": "JOB-2026-0415-01" },
    { "job_id": "uuid", "job_number": "JOB-2026-0415-02" },
    { "job_id": "uuid", "job_number": "JOB-2026-0415-03" }
  ]
}
```

- Max 10 jobs per request (validated server-side)
- Each job creates property + job atomically (same pattern as Spec 01F's `POST /v1/jobs`)
- All jobs created in a single database transaction — all succeed or all fail

### Checklist
- [ ] Company profile screen with expanded fields (address, service area)
- [ ] Progress bar "Step 1 of 4" at top
- [ ] `PATCH /v1/company` extended with address + service_area fields
- [ ] Company table migration: add address_line1, city, state, zip, service_area columns
- [ ] pytest: company profile update with new fields
- [ ] "Have active jobs?" link → Quick Add form
- [ ] Quick Add form: up to 10 jobs with address, customer, phone, type, status
- [ ] "+ Add Another Job" adds form (max 10)
- [ ] `POST /v1/jobs/batch` endpoint — batch create up to 10 jobs
- [ ] pytest: batch create 3 jobs in one request
- [ ] pytest: batch rejects > 10 jobs
- [ ] pytest: batch is atomic (all or nothing)
- [ ] Success message with count → return to Company Profile
- [ ] Cancel discards data → return to Company Profile
- [ ] Re-accessible from Settings > Jobs > Import Active Jobs

---

## Phase 3: Pricing Upload (Screen 3 — Optional)

### Pricing Upload Screen

**Progress bar:** "Step 2 of 4: Pricing Setup (Optional)"

**Layout:**
```
┌─────────────────────────────────────────┐
│  Import Your Pricing                    │
│                                         │
│  Upload your pricing to create          │
│  estimates faster. This is optional —   │
│  you can do it later if you prefer.     │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  📄 Drag & drop Excel file here │    │
│  │                                 │    │
│  │     or [Browse Files]           │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Don't have your pricing ready?         │
│  [Download Pricing Template]            │
│                                         │
│  ℹ You can skip this and upload pricing │
│    later from Settings > Pricing        │
│                                         │
│       [Skip for Now]  [Upload]          │
└─────────────────────────────────────────┘
```

### File Upload Behavior

**On file selected:**
- Show filename and size
- Show "Validating..." spinner
- Run server-side validation (same rules as Spec 01D's Xactimate Excel format)

**Validation passes:**
- ✓ checkmark: "Pricing uploaded successfully"
- Summary: "Loaded 147 line items from Tier A"
- [Continue] button becomes active → advances to Screen 4: Team Invites

**Validation fails:**
- ✗ error icon
- Display specific row-level errors: "Row 45: Invalid price format" / "Missing required fields in Tier A"
- [Download Error Report] → CSV with all errors
- [Try Again] → re-upload

**On "Skip for Now":**
- No pricing uploaded
- Advances to Screen 4: Team Invites
- User can upload later from Settings > Pricing

### Backend — Pricing Upload

```
POST /v1/pricing/upload
Content-Type: multipart/form-data
```

**Request:** Excel file (`.xlsx`)

**Success Response (200):**
```json
{
  "status": "success",
  "items_loaded": 147,
  "tier": "A",
  "message": "Pricing uploaded successfully"
}
```

**Validation Error Response (422):**
```json
{
  "status": "validation_error",
  "errors": [
    { "row": 45, "field": "price", "message": "Invalid price format. Expected number, got text." },
    { "row": 67, "field": "code", "message": "Missing required field: Xactimate code" }
  ],
  "error_report_url": "/v1/pricing/upload/error-report"
}
```

**Template download:**
```
GET /v1/pricing/template
```
Returns a pre-formatted Excel template with headers, sample rows, and instructions.

**Why this is optional:** Brett's reasoning — new contractors may not have Xactimate pricing ready. They might only do retail (homeowner) work. Reduces friction — they can get started immediately.

### Checklist
- [ ] Pricing upload screen with drag-and-drop zone
- [ ] Progress bar "Step 2 of 4" at top
- [ ] File picker: accepts `.xlsx` files
- [ ] "Validating..." spinner during server-side validation
- [ ] `POST /v1/pricing/upload` endpoint with Excel parsing
- [ ] Row-level validation with specific error messages
- [ ] Success: checkmark + item count + [Continue] button
- [ ] Failure: error list + [Download Error Report] CSV + [Try Again]
- [ ] `GET /v1/pricing/template` — downloadable Excel template
- [ ] pytest: valid Excel file parsed and loaded
- [ ] pytest: invalid file returns row-level errors
- [ ] pytest: template download returns valid xlsx
- [ ] "Skip for Now" advances to Team Invites
- [ ] Re-accessible from Settings > Pricing

---

## Phase 4: Team Invites (Screen 4 — Optional)

### Team Invite Screen

**Progress bar:** "Step 3 of 4: Invite Your Team (Optional)"

**Layout:**
```
┌─────────────────────────────────────────┐
│  Add crew members to Crewmatic          │
│                                         │
│  Team Member 1                          │
│  Name:  [_____________________________] │
│  Email: [_____________________________] │
│  Role:  [Tech ▼]                        │
│                                         │
│  [+ Add Another Team Member]            │
│                                         │
│  ℹ You can invite team members later    │
│    from Settings > Team                 │
│                                         │
│      [Skip for Now]  [Send Invites]     │
└─────────────────────────────────────────┘
```

**Team member fields:**
- Name (text)
- Email (text, must be valid email format)
- Role dropdown: Owner / Tech

**Roles:**
- **Owner** — full access (sees all jobs, manages settings)
- **Tech** — standard access (sees assigned jobs, limited settings)

**On "Send Invites":**
- Sends email invitation to each team member
- Email contains: "{Company Owner} invited you to join {Company Name} on Crewmatic" + signup link
- Advances to Screen 5: Create Your First Job

**On "Skip for Now":**
- No invites sent
- Contractor proceeds solo
- Can invite team later from Settings > Team

**Why this is optional:** Solo contractors don't need this. Some want to try the platform themselves first before inviting crew.

### Backend — Team Invites

```
POST /v1/team/invite
```

**Request:**
```json
{
  "invites": [
    { "name": "Mike Johnson", "email": "mike@example.com", "role": "tech" },
    { "name": "Sarah Chen", "email": "sarah@example.com", "role": "owner" }
  ]
}
```

**Response:**
```json
{
  "sent": 2,
  "invites": [
    { "email": "mike@example.com", "status": "sent" },
    { "email": "sarah@example.com", "status": "sent" }
  ]
}
```

- Creates pending invite records in database
- Sends invite email via Supabase Auth `inviteUserByEmail()` or custom email service
- Invite link includes company context so new user auto-joins the right company

```sql
CREATE TABLE team_invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES companies(id),
    invited_by uuid NOT NULL REFERENCES auth.users(id),
    name VARCHAR NOT NULL,
    email VARCHAR NOT NULL,
    role VARCHAR NOT NULL CHECK (role IN ('owner', 'tech')),
    status VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
    token uuid DEFAULT gen_random_uuid(),
    created_at timestamptz DEFAULT now(),
    expires_at timestamptz DEFAULT now() + interval '7 days',
    UNIQUE(company_id, email)
);

-- RLS policies
CREATE POLICY team_invites_select ON team_invites FOR SELECT
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY team_invites_insert ON team_invites FOR INSERT
    WITH CHECK (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY team_invites_update ON team_invites FOR UPDATE
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY team_invites_delete ON team_invites FOR DELETE
    USING (company_id = current_setting('app.company_id')::uuid);
```

### Checklist
- [ ] Team invite screen with name, email, role fields
- [ ] Progress bar "Step 3 of 4" at top
- [ ] "+ Add Another Team Member" adds another invite row
- [ ] Role dropdown: Owner / Tech
- [ ] `POST /v1/team/invite` endpoint — batch send invites
- [ ] `team_invites` table with full schema + RLS
- [ ] Email sent to each invitee with company name + signup link
- [ ] Invite link includes company context (auto-join on signup)
- [ ] Invite expires after 7 days
- [ ] pytest: invite creation + email sending
- [ ] pytest: duplicate email for same company returns error
- [ ] pytest: invite RLS (company isolation)
- [ ] "Skip for Now" advances to First Job
- [ ] Re-accessible from Settings > Team > [Invite Team Member]
- [ ] Mobile: email keyboard for email field

---

## Phase 5: Guided First Job + Completion + Onboarding State

### Create Your First Job (Screen 5)

**Progress bar:** "Step 4 of 4: Create Your First Job"

This is a **simplified version** of the Create New Job screen (Spec 01F). Same `POST /v1/jobs` endpoint, but with fewer visible fields and guided context.

**Layout:**
```
┌─────────────────────────────────────────┐
│  Let's create your first job to get     │
│  you started                            │
│                                         │
│  You can use a real job or a test       │
│  example.                               │
│                                         │
│  Property Address                       │
│  [________________________________]     │
│  [City________] [State__] [ZIP____]     │
│                                         │
│  Customer Name                          │
│  [________________________________]     │
│                                         │
│  Phone                                  │
│  [________________________________]     │
│                                         │
│  Job Type                               │
│  ○ Water Damage Restoration             │
│  ○ Fire Damage Restoration              │
│  ○ Mold Remediation                     │
│  ○ Reconstruction                       │
│                                         │
│       [Skip for Now]  [Create Job]      │
└─────────────────────────────────────────┘
```

**Differences from regular Create Job (Spec 01F):**
- No loss date, emergency checkbox, or notes fields shown (fewer fields = faster)
- No internal property autocomplete (this is their first job — no existing properties yet)
- Guided context: "Let's create your first job to get you started"
- "You can use a real job or a test example" — reduces pressure
- Same required fields: address (street, city, state, zip), customer name, phone, job type

**On "Create Job":**
- Calls `POST /v1/jobs` (same endpoint as Spec 01F)
- Creates job with `status = 'lead'`
- Redirects to Job Detail Page (per Brett's spec) with onboarding completion message overlaid

**On "Skip for Now":**
- Skips job creation
- Goes straight to Dashboard with empty state: "No jobs yet. [Create Your First Job]"

### Onboarding Completion Screen

Shown after all steps are complete (or skipped).

```
┌─────────────────────────────────────────┐
│                                         │
│      🎉 Welcome to Crewmatic!          │
│                                         │
│  Your account is set up and ready       │
│  to use.                                │
│                                         │
│  ✓ Company profile created              │
│  ✓ First job created                    │
│  ○ Pricing setup (optional - do it      │
│    anytime)                             │
│  ○ Team invites (optional - do it       │
│    anytime)                             │
│                                         │
│  Next steps:                            │
│  • Add photos and documentation to      │
│    your job                             │
│  • Create an estimate                   │
│  • Explore the dashboard                │
│                                         │
│         [Go to Dashboard]               │
│                                         │
└─────────────────────────────────────────┘
```

- ✓ Green checkmark = completed step
- ○ Gray circle = skipped step (can do later)
- "Go to Dashboard" → dismisses welcome, shows Dashboard with first job visible on map

### Onboarding State Machine

Track onboarding progress so users can resume mid-flow and see the dashboard reminder.

```sql
-- Add onboarding state to companies table
ALTER TABLE companies ADD COLUMN onboarding_step VARCHAR DEFAULT 'company_profile'
    CHECK (onboarding_step IN ('company_profile', 'pricing', 'team_invites', 'first_job', 'complete'));
ALTER TABLE companies ADD COLUMN onboarding_completed_at timestamptz;
ALTER TABLE companies ADD COLUMN pricing_uploaded boolean DEFAULT false;
ALTER TABLE companies ADD COLUMN team_invited boolean DEFAULT false;
ALTER TABLE companies ADD COLUMN first_job_created boolean DEFAULT false;
```

**State transitions:**
- After account creation → `onboarding_step = 'company_profile'`
- After company profile saved → `onboarding_step = 'pricing'`
- After pricing uploaded OR skipped → `onboarding_step = 'team_invites'`
- After team invites sent OR skipped → `onboarding_step = 'first_job'`
- After first job created OR skipped → `onboarding_step = 'complete'`, set `onboarding_completed_at`

**Resume logic:**
- On login, check `onboarding_step`
- If not `complete` → show: "Welcome back! Let's finish setting up your account." → continue from current step
- If `complete` → go to Dashboard

### Dashboard Banner (Persistent)

If onboarding is complete but optional steps were skipped, show a dismissible banner on Dashboard:

```
┌─────────────────────────────────────────┐
│ ℹ Complete your setup:                  │
│ ○ Upload pricing to create estimates    │
│   faster                                │
│ ○ Invite your team to collaborate       │
│                                         │
│     [Complete Setup]  [Dismiss]         │
└─────────────────────────────────────────┘
```

- Shows if `pricing_uploaded = false` OR `team_invited = false`
- Dismissible — user can close it (stores dismiss state in localStorage or company record)
- "Complete Setup" → reopens onboarding wizard at first incomplete optional step
- Banner disappears permanently once all optional steps are completed

### Backend — Onboarding State

```
GET /v1/company/onboarding-status
```

**Response:**
```json
{
  "step": "complete",
  "completed_at": "2026-04-15T10:00:00Z",
  "pricing_uploaded": false,
  "team_invited": false,
  "first_job_created": true,
  "show_setup_banner": true
}
```

```
PATCH /v1/company/onboarding-step
```

**Request:**
```json
{
  "step": "pricing",
  "pricing_uploaded": true
}
```

Called by frontend after each step completes or is skipped.

### Checklist
- [ ] Guided first job screen with simplified fields (no loss date, emergency, notes)
- [ ] Progress bar "Step 4 of 4" at top
- [ ] "Create Job" calls `POST /v1/jobs` from Spec 01F
- [ ] Job created with `status = 'lead'`
- [ ] "Skip for Now" → Dashboard with empty state
- [ ] Onboarding completion screen with ✓/○ checklist
- [ ] Next steps section with suggested actions
- [ ] "Go to Dashboard" → Dashboard with first job visible
- [ ] Onboarding state columns added to companies table
- [ ] `GET /v1/company/onboarding-status` endpoint
- [ ] `PATCH /v1/company/onboarding-step` endpoint
- [ ] pytest: onboarding state transitions
- [ ] pytest: resume returns correct step after browser close
- [ ] Resume logic: incomplete onboarding → "Welcome back" → continue at current step
- [ ] Dashboard banner: "Complete your setup" if optional steps skipped
- [ ] Banner dismissible (localStorage or company flag)
- [ ] "Complete Setup" link reopens onboarding at first incomplete step
- [ ] Banner disappears when all optional steps done

---

## Visual Design Notes

**Branding:**
- Crewmatic logo at top of every onboarding screen
- Consistent color scheme (blues for primary actions)
- Clean, professional look (not playful/casual)

**Button hierarchy:**
- **Primary action** (Continue, Create Job, Send Invites) → brand-accent button (per CLAUDE.md conventions)
- **Secondary action** (Skip for Now, Cancel) → gray outline button
- Primary on right, secondary on left

**Form design:**
- Large input fields (easy to click/tap)
- Clear labels above each field
- Asterisks (*) for required fields in `text-red-500`
- Placeholder text for guidance (e.g., "yourcompany.com")
- Real-time validation (red border if invalid)
- `onFocus={(e) => e.target.select()}` on all text inputs (per CLAUDE.md)

**Success states:**
- Green checkmarks for completed steps
- Brief success messages ("Pricing uploaded successfully!")
- Smooth transitions between screens (no jarring page loads)

**Mobile:**
- All fields stack vertically
- Larger input fields (easy to tap)
- Progress bar sticky at top of screen
- Address field → default keyboard with `autoComplete="street-address"`
- Email field → email keyboard
- Phone field → number pad
- File upload → "Browse Files" opens mobile file picker (Files app, Google Drive, Dropbox)
- Upload progress bar shown during file upload

---

## Edge Cases & Error Handling

| Scenario | Behavior |
|---|---|
| User closes browser mid-onboarding | Progress saved. On next login: "Welcome back! Let's finish setting up your account." Resumes at next incomplete step. |
| Email already registered (Screen 1) | "This email is already registered." + [Sign In] link + [Use Different Email] option |
| Invalid pricing file (Screen 3) | Row-level errors displayed. [Download Error Report] CSV. [Try Again] to re-upload. |
| No internet during upload | "Upload failed. Please check your connection and try again." + [Retry] button. File stays selected (no re-browse). |
| User goes back to previous step | Allowed — back button works. Data from previous steps preserved. |
| User manually navigates to `/jobs` before completing onboarding | Redirect back to onboarding. Only Dashboard access after completion. |

---

## Cross-References

| Spec | Relationship |
|------|-------------|
| Spec 00 (Bootstrap) | This extends Spec 00's auth + onboarding. Google OAuth preserved, email/password added. Company profile expanded. |
| Spec 01F (Create Job v2) | Screen 5 uses `POST /v1/jobs` from 01F. Simplified frontend wrapper, same backend. |
| Spec 01D (Xactimate Codes) | Pricing upload feeds into 01D's `scope_codes` table. Same Excel format, validated against 01D's schema. |
| Spec 04A (Dashboard) | Dashboard shows "Complete your setup" banner. First job visible on map after onboarding. |

## Decision Log

| # | Decision | Reasoning |
|---|----------|-----------|
| 1 | Email/password alongside Google, not replacing it | Brett's spec shows email/password signup. But Google OAuth is already built and many users prefer it. Support both. |
| 2 | Company profile is required, other steps optional | Brett's spec: "Required steps (cannot skip): 1. Create account, 2. Company profile." Everything else skippable. Minimizes friction. |
| 3 | Quick Add Jobs is a link, not a mandatory step | Brett's spec: "accessed via link on Company Profile screen. Not a required step." Most new users don't have existing jobs to import. |
| 4 | Pricing upload uses 01D's schema | No need to define a separate pricing format. Xactimate Excel format is industry standard. 01D already defines the code/pricing schema. |
| 5 | Guided first job is a simplified 01F wrapper | Brett's spec: "This is a simplified version of the Create New Job screen (already specced)." No duplicate backend — same `POST /v1/jobs`. |
| 6 | Onboarding state on companies table, not separate table | Simple column approach. Only 5 boolean/enum fields. No need for a full `onboarding_steps` table — this isn't a multi-user flow, it's per-company. |
| 7 | Dashboard banner is dismissible | Brett's spec: "Dismissible (user can close it)." Respects user autonomy. Banner returns if they click "Complete Setup" elsewhere. |
| 8 | Company Profile has no Skip button | Brett's wireframe shows [Skip] [Continue] but his text says "Cannot skip this screen (company profile is required)." We follow the text — company name/phone/address are essential for job creation and reports. |

---

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1 (Email/Password signup — Screen 1)
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

---

## Decisions & Notes

Key decisions with rationale. Append-only as implementation progresses. See the Decision Log table above for the initial set captured during spec authoring.
