# Spec 08: Portals — Audience-Specific External Views

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/4 phases) |
| **State** | Draft |
| **Blocker** | 04B (Job Communication) should be built first for message board infrastructure. Can stub without it. |
| **Branch** | TBD |
| **Issue** | TBD |
| **Source** | Brett's "Crewmatic UI Layout & Navigation Summary v2.0" (April 13, 2026) — `docs/research/layout-summary-v2.pdf` |
| **Depends On** | Spec 01 (complete), Spec 04B (draft — message board), Spec 01E (draft — selections/payments for recon portal) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-14 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] Contractor can invite a homeowner, adjuster, or recon client to a portal via link or email
- [ ] Homeowner portal shows unified property view across all jobs (mitigation + reconstruction)
- [ ] Homeowner portal has two-way communication board
- [ ] Adjuster portal shows mitigation-only documentation (read-only, no reconstruction data)
- [ ] Adjuster portal has PDF download for complete job documentation package
- [ ] Reconstruction client portal shows recon-only data (materials, milestones, change orders, punch list)
- [ ] Reconstruction client portal has two-way communication board
- [ ] Owner/admin can preview each portal type from outside perspective
- [ ] Owner/admin can send/revoke invite links per job
- [ ] Portal scope rules enforced: homeowner=property-level, adjuster=mitigation-only, recon=recon-only
- [ ] One portal invite per (property, job, portal_type) combination — no duplicates
- [ ] Tests passing
- [ ] Code review approved

## Overview

**Problem:** Restoration contractors share job progress with homeowners, adjusters, and reconstruction clients via scattered emails, texts, and phone calls. Homeowners don't know what's happening. Adjusters can't access documentation without requesting it. Reconstruction clients have no visibility into material selections or milestone progress. This delays approvals, payments, and creates friction.

**Solution:** Three audience-specific portal views, each accessible via an invite link with no account required:
1. **Homeowner Portal** — unified property view across ALL jobs (mitigation + reconstruction), two-way messaging
2. **Adjuster / Carrier Portal** — mitigation-only documentation, read-only, professional/clinical presentation
3. **Reconstruction Client Portal** — recon-only data (materials, milestones, change orders), two-way messaging

Plus an internal **Portal Management** screen where contractors send invites, revoke access, and preview portals.

**Scope:**
- IN: Portal invite system (create/revoke/expire), three portal types with scoped views, two-way messaging on homeowner + recon portals, PDF download on adjuster portal, portal preview for admins, company branding on portals
- OUT: Push notifications for portal messages (future), SMS invite delivery (future), portal analytics/tracking (future), real-time WebSocket updates (future — polling is fine for V1)

### Portal Scope Rules (Critical)

These rules are the core architectural constraint. Every data query, every component render, every API response must respect them:

| Portal Type | Scope | Data Visible | Communication |
|-------------|-------|-------------|---------------|
| **Homeowner** | Property-level (ALL jobs) | Job status, recent photos, drying progress, milestones — across mitigation + reconstruction | Two-way message board |
| **Adjuster / Carrier** | Single mitigation job only | Moisture logs, drying reports, equipment records, photos, daily summaries | Read-only — NO messaging |
| **Recon Client** | Single reconstruction job only | Material selections, milestone payments, change orders, punch lists, phase progress | Two-way message board |

**Exclusion rules:**
- Adjuster portal NEVER shows reconstruction data, equipment affiliate links, or contractor internal notes
- Recon client portal NEVER shows mitigation data (moisture readings, drying logs, equipment)
- Homeowner portal shows both but scoped to their property only (not other company properties)

**Relationship to other specs:**
- **Spec 01 (Jobs):** Has basic share links (read-only `/shared/[token]`, 7-day expiry). Portals replace share links for external parties with audience-specific views and longer-lived tokens (90 days).
- **Spec 04B (Job Communication):** The `job_messages` table with `author_type` ('team', 'customer', 'adjuster') is the data layer for portal messaging. Portal message boards write to the same table — no separate messages table.
- **Spec 01E (Selections + Payments):** Recon client portal displays data from 01E. If 01E tables don't exist yet, portal shows graceful empty states.

---

## Phases & Checklist

### Phase 1: Portal Infrastructure + Invite System — ❌
Foundation: invite table, token generation, public validation endpoint, internal invite management.

**Backend:**
- [ ] `portal_invites` table migration:
```sql
CREATE TABLE portal_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  property_id UUID NOT NULL REFERENCES properties(id),
  job_id UUID REFERENCES jobs(id),  -- NULL for property-level (homeowner portal)
  portal_type TEXT NOT NULL CHECK (portal_type IN ('homeowner', 'adjuster', 'recon_client')),
  invitee_name TEXT NOT NULL,
  invitee_email TEXT,
  access_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '90 days',
  last_accessed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),

  -- One invite per (property, job, portal_type) combination
  -- Note: standard UNIQUE won't enforce uniqueness when job_id is NULL (homeowner portals).
  -- We handle this with a partial unique index below.
);

-- For job-scoped portals (adjuster, recon_client): one invite per (property, job, portal_type)
CREATE UNIQUE INDEX idx_portal_invites_unique_job
  ON portal_invites (property_id, job_id, portal_type)
  WHERE job_id IS NOT NULL AND status = 'active';

-- For property-scoped portals (homeowner): one active homeowner invite per property
CREATE UNIQUE INDEX idx_portal_invites_unique_homeowner
  ON portal_invites (property_id, portal_type)
  WHERE job_id IS NULL AND status = 'active';

-- RLS policies
ALTER TABLE portal_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal_invites_tenant_isolation"
  ON portal_invites
  FOR ALL
  USING (company_id = (current_setting('app.company_id'))::uuid);

-- Index for public token lookup (used by unauthenticated portal endpoint)
CREATE INDEX idx_portal_invites_token ON portal_invites (access_token)
  WHERE status = 'active';

-- Index for listing invites by job
CREATE INDEX idx_portal_invites_job ON portal_invites (job_id, portal_type)
  WHERE status = 'active';
```

- [ ] Portal type validation rules (enforced in API layer):
  - `homeowner` → `job_id` must be NULL (property-level access)
  - `adjuster` → `job_id` required, referenced job must have `job_type = 'mitigation'`
  - `recon_client` → `job_id` required, referenced job must have `job_type = 'reconstruction'`

- [ ] `POST /v1/portals/invite` — create invite
  - Body: `{ portal_type, property_id, job_id?, invitee_name, invitee_email?, expires_days? }`
  - Validates portal type → scope rules above
  - Returns invite with `access_token` and shareable URL
  - If `invitee_email` provided: sends invite email via SendGrid/Resend with portal link, company name, and brief context ("View your restoration progress" / "View job documentation"). Email sending is fire-and-forget — invite is created regardless of email delivery status. Failed sends logged but don't block.
  - If no `invitee_email`: returns copyable link only (contractor texts it manually)
  - Auth: owner/admin only

- [ ] `GET /v1/portals/invites` — list invites
  - Query params: `?job_id=X` or `?property_id=X`
  - Returns all invites (active + revoked) for the job/property
  - Auth: owner/admin only

- [ ] `DELETE /v1/portals/invites/{id}` — revoke invite
  - Sets `status = 'revoked'`
  - Auth: owner/admin only

- [ ] `GET /v1/portal/{token}` — public portal data endpoint (NO auth required)
  - Validates token: exists, status='active', not expired
  - Updates `last_accessed_at`
  - Returns portal data scoped by `portal_type`:
    - `homeowner` → all jobs at property with status, photos, drying progress, milestones
    - `adjuster` → single mitigation job documentation
    - `recon_client` → single reconstruction job data
  - Uses service-role Supabase client (bypasses RLS — token is the auth mechanism)
  - Returns 404 for invalid/expired/revoked tokens (no information leakage)

- [ ] `GET /v1/portal/{token}/messages` — list messages for portal
  - Homeowner: messages across all jobs at property, **grouped by job** (each message includes `job_id` and `job_number` so the UI can show "Re: J-001" headers). Returned chronologically with job context.
  - Recon client: messages for the linked recon job only
  - Adjuster: returns 403 (no messaging)

- [ ] `POST /v1/portal/{token}/messages` — post message from portal visitor
  - Body: `{ author_name, message }`
  - Writes to `job_messages` table (from Spec 04B) with appropriate `author_type`
  - Homeowner portal: `author_type = 'customer'`, requires `job_id` in body (which job to message about)
  - Recon client portal: `author_type = 'customer'`, auto-scoped to linked `job_id`
  - Adjuster portal: returns 403 `{"error": "Messaging is not available on this portal"}`

- [ ] pytest: invite CRUD, token validation, expiry, revocation, portal type scope rules, unique constraint, public endpoint auth bypass, message routing

**Frontend:**
- [ ] No public pages in this phase — infrastructure only
- [ ] Internal invite management UI deferred to Phase 4

---

### Phase 2: Homeowner Portal (Public View) — ❌
Property-level view spanning all jobs. Two-way communication.

**Backend:**
- [ ] `GET /v1/portal/{token}` response for `portal_type = 'homeowner'`:
```json
{
  "portal_type": "homeowner",
  "company": { "name": "...", "logo_url": "..." },
  "property": { "address": "...", "city": "...", "state": "...", "zip": "..." },
  "jobs": [
    {
      "id": "...",
      "job_number": "J-001",
      "job_type": "mitigation",
      "status": "drying",
      "loss_type": "Water",
      "created_at": "...",
      "recent_photos": [
        { "id": "...", "url": "...", "room_name": "...", "photo_type": "damage", "created_at": "..." }
      ],
      "drying_progress": {
        "current_day": 3,
        "latest_readings": [
          { "room_name": "Kitchen", "moisture_content": 15.2, "gpp": 68, "target_gpp": 55 }
        ],
        "trend": "improving"
      },
      "milestones": [
        { "label": "Water Extraction", "completed": true, "date": "..." },
        { "label": "Equipment Placed", "completed": true, "date": "..." },
        { "label": "Drying Complete", "completed": false, "date": null }
      ]
    },
    {
      "id": "...",
      "job_number": "J-002",
      "job_type": "reconstruction",
      "status": "in_progress",
      "phase_progress": { "current_phase": "Framing", "percent_complete": 40 },
      "milestones": [...]
    }
  ],
  "messages": [...]
}
```
- [ ] Milestones derived from job status transitions in `event_history` table
- [ ] Recent photos: last 5 per job, ordered by `created_at` DESC
- [ ] Drying progress: latest moisture readings per room with GPP trend
- [ ] pytest: homeowner portal data assembly, multi-job aggregation, photo limiting, milestone derivation

**Frontend:**
- [ ] Public page at `web/src/app/portal/[token]/page.tsx` — no auth, no `(protected)` wrapper
- [ ] Token validation on page load → fetch portal data → render by `portal_type`
- [ ] Homeowner layout (mobile-first):
  - Company branding header (logo + company name)
  - Property address bar
  - Per-job collapsible sections:
    - Status badge (color-coded)
    - Recent photos carousel (horizontal scroll, tap to enlarge)
    - Drying progress chart (if mitigation): bar chart showing GPP per room vs target
    - Phase progress bar (if reconstruction): labeled steps with current highlighted
    - Key milestones timeline (vertical, completed items checked)
  - Communication board at bottom:
    - Message list: author name + timestamp + message text
    - "Your Name" input (remembered in localStorage) + message textarea + Send button
    - Auto-scroll to newest message
- [ ] Loading skeleton while portal data fetches
- [ ] Expired/invalid token → friendly error page ("This link has expired. Contact your restoration company for a new link.")
- [ ] Responsive: full-width on mobile, max-width container on desktop
- [ ] No navigation chrome — standalone page, not inside app shell

---

### Phase 3: Adjuster Portal (Public View) — ❌
Mitigation-job-only documentation view. Read-only. Professional presentation.

**Backend:**
- [ ] `GET /v1/portal/{token}` response for `portal_type = 'adjuster'`:
```json
{
  "portal_type": "adjuster",
  "company": { "name": "...", "logo_url": "..." },
  "job": {
    "id": "...",
    "job_number": "J-001",
    "job_type": "mitigation",
    "status": "drying",
    "loss_type": "Water",
    "loss_date": "...",
    "customer_name": "...",
    "address": "...",
    "claim_number": "...",
    "carrier": "...",
    "created_at": "..."
  },
  "moisture_logs": [
    {
      "date": "2026-04-10",
      "rooms": [
        {
          "room_name": "Kitchen",
          "atmospheric": { "temperature": 72, "humidity": 45, "gpp": 55 },
          "moisture_points": [
            { "location": "North Wall", "material": "drywall", "reading": 18.5 }
          ],
          "dehu_output": 8.5
        }
      ]
    }
  ],
  "drying_charts": {
    "gpp_by_room": [...],
    "moisture_trend": [...]
  },
  "equipment_records": [
    {
      "room_name": "Kitchen",
      "air_movers": 3,
      "dehumidifiers": 1,
      "placed_date": "...",
      "removed_date": null
    }
  ],
  "photos": [
    {
      "id": "...",
      "url": "...",
      "room_name": "...",
      "photo_type": "damage",
      "created_at": "...",
      "caption": "..."
    }
  ],
  "daily_summaries": [
    {
      "date": "2026-04-10",
      "notes": "...",
      "readings_count": 4,
      "photos_added": 3
    }
  ]
}
```
- [ ] Explicitly exclude from adjuster response:
  - Any job with `job_type != 'mitigation'` (even if `linked_job_id` points to one)
  - Equipment affiliate links or recommendations
  - Contractor internal notes (notes marked with `internal: true` if that field exists, or tech field notes that contain internal markers)
  - Any reconstruction-phase data
- [ ] `GET /v1/portal/{token}/pdf` — generate PDF documentation package
  - Compiles: moisture logs, photos organized by room, equipment records, daily summaries
  - Returns PDF as binary download
  - Professional formatting: company header, job info, organized sections
- [ ] pytest: adjuster portal data assembly, reconstruction exclusion, PDF generation, internal notes filtering

**Frontend:**
- [ ] Adjuster portal layout (rendered at same `/portal/[token]` route, switched by `portal_type`):
  - Company branding header
  - Job info summary bar (job number, address, claim number, carrier, loss date)
  - Tabbed sections:
    - **Moisture Logs** — table: date, room, atmospheric readings, moisture points, dehu output
    - **Drying Charts** — GPP trend line per room, moisture content trend, target lines
    - **Equipment** — table: room, equipment type, count, date placed, date removed
    - **Photos** — grid organized by room, tap to enlarge, photo type badges
    - **Daily Progress** — chronological summary cards with tech notes, reading counts, photo counts
  - PDF Download button (prominent, top-right) — "Download Documentation Package"
  - NO message board, NO input fields, NO edit capabilities
  - Professional/clinical design — muted colors, clean typography, data-dense layout
- [ ] Print-friendly CSS (adjuster may want to print from browser too)

---

### Phase 4: Reconstruction Client Portal + Portal Management — ❌
Recon client portal for construction phase visibility. Internal portal management for contractors.

#### 4A: Reconstruction Client Portal

**Backend:**
- [ ] `GET /v1/portal/{token}` response for `portal_type = 'recon_client'`:
```json
{
  "portal_type": "recon_client",
  "company": { "name": "...", "logo_url": "..." },
  "job": {
    "id": "...",
    "job_number": "J-002",
    "job_type": "reconstruction",
    "status": "in_progress",
    "address": "...",
    "customer_name": "...",
    "created_at": "..."
  },
  "material_selections": [],
  "milestone_payments": [],
  "change_orders": [],
  "punch_list": [],
  "phase_progress": {
    "phases": [
      { "name": "Demo", "status": "complete" },
      { "name": "Framing", "status": "in_progress" },
      { "name": "Drywall", "status": "pending" },
      { "name": "Paint", "status": "pending" },
      { "name": "Flooring", "status": "pending" },
      { "name": "Final", "status": "pending" }
    ],
    "percent_complete": 30
  },
  "messages": [...]
}
```
- [ ] Graceful empty states: if 01E tables (`material_selections`, `milestone_payments`, `change_orders`, `punch_list`) don't exist yet, return empty arrays — not errors. Use try/except on table queries.
- [ ] Explicitly exclude from recon client response:
  - Mitigation data (moisture readings, drying logs, equipment, Cat/Class info)
  - Internal contractor notes (any `tech_notes` field or notes with `internal` flag)
  - Cost breakdowns: `actual_cost` and `overage` fields from selections are excluded (homeowner sees `allowance_amount` and `selected_option` only). Payment amounts are visible (homeowner needs to know what's due) but contractor margin/markup is never exposed.
- [ ] pytest: recon portal data assembly, mitigation exclusion, graceful 01E absence, message scoping

**Frontend:**
- [ ] Recon client portal layout (same `/portal/[token]` route, switched by `portal_type`):
  - Company branding header
  - Job info summary bar
  - Phase progress stepper (horizontal on desktop, vertical on mobile) — labeled steps, current highlighted
  - Sections (collapsible):
    - **Material Selections** — list with status badges (pending/ordered/installed), or empty state: "No material selections yet"
    - **Milestone Payments** — table: milestone name, amount, status (upcoming/due/paid), due date, or empty state
    - **Change Orders** — list: description, amount, status (pending/approved/rejected), date, or empty state
    - **Punch List** — checklist: item description, status (open/in_progress/complete), assigned, or empty state
  - Communication board (same component as homeowner portal):
    - Message list + name input + textarea + Send button
    - Scoped to this reconstruction job only
- [ ] Empty state component: friendly illustration + "This section will be available soon" message

#### 4B: Portal Management (Internal View)

**Backend:**
- [ ] `GET /v1/portals/summary` — portal management overview
  - Returns all active/revoked invites grouped by property, then by job
  - Includes: invite status, portal type, invitee name, last accessed, message count
  - Auth: owner/admin only

- [ ] `GET /v1/portals/invites/{id}/preview` — preview portal as external user
  - Returns same data as `GET /v1/portal/{token}` but authenticated via internal JWT auth (not token-based)
  - Backend verifies the requesting user is owner/admin of the company that owns the invite
  - Used for "View as Homeowner" / "View as Adjuster" / "View as Client" preview
  - Auth: owner/admin only (JWT verified, company_id matched against invite's company_id)

- [ ] `GET /v1/portals/communication-history?property_id=X` — cross-portal message timeline
  - Returns all messages from all portals for a property, chronologically
  - Includes: portal type, author name, author type, message, timestamp, job reference
  - Auth: owner/admin only

- [ ] pytest: summary aggregation, preview data matches public endpoint, communication history ordering

**Frontend:**
- [ ] "Portals" top-level navigation item (same level as Jobs, Dashboard)
- [ ] Route: `web/src/app/(protected)/portals/page.tsx`
- [ ] Portal management layout:
  - Property list (grouped view):
    - Property address as section header
    - Per-job portal cards:
      - Portal type badge (Homeowner / Adjuster / Recon Client)
      - Invitee name + email
      - Status indicator (active / revoked / expired)
      - Last accessed date
      - Actions: Preview | Copy Link | Revoke
  - "+ Send Invite" button → modal:
    - Select property (searchable dropdown)
    - Select portal type (radio: Homeowner / Adjuster / Recon Client)
    - Conditional: if Adjuster or Recon Client, select specific job (filtered by type)
    - Invitee name (required) + email (optional)
    - Expiry: 90 days default, configurable (30/60/90/180 days)
    - "Send Invite" button → creates invite, optionally sends email, shows copyable link
  - Preview mode:
    - "Preview" button opens portal in new tab with `?preview=true` param
    - Shows exactly what the external user sees
    - Yellow banner at top: "PREVIEW MODE — This is how [Invitee Name] sees this portal"
  - Communication history panel:
    - Slide-out panel showing all messages across all portals for selected property
    - Timeline view: message bubbles with portal type badges, author names, timestamps
    - Filter by portal type

---

## Technical Approach

### Authentication & Access Control

Portal public pages use **token-based access** (no Supabase account required):
- External users access via `/portal/[token]` — the 64-character hex token IS the credential
- Backend validates token, checks expiry and status, then queries data using a **service-role Supabase client** that bypasses RLS
- All data queries are explicitly scoped in application code (not relying on RLS for portal data filtering)
- Internal portal management endpoints use standard JWT auth + role checks (owner/admin only)

### Data Flow

```
Contractor (internal)                 External User (portal)
─────────────────────                 ──────────────────────
POST /v1/portals/invite               
  → creates portal_invites row        
  → returns access_token              
  → sends email (optional)            
                                      GET /v1/portal/{token}
                                        → validates token
                                        → queries data (service-role)
                                        → filters by portal_type scope rules
                                        → returns scoped JSON
                                      
                                      POST /v1/portal/{token}/messages
                                        → validates token + portal_type
                                        → writes to job_messages table
                                        → author_type from portal_type mapping
```

### Portal Type → Author Type Mapping

| Portal Type | `author_type` in `job_messages` | Can Post Messages |
|-------------|--------------------------------|-------------------|
| `homeowner` | `customer` | Yes |
| `adjuster` | — | No (read-only) |
| `recon_client` | `customer` | Yes |

### Graceful Degradation

- **04B not built yet:** Stub the message endpoints. Portal pages show "Messaging coming soon" instead of the board. All other portal data still renders.
- **01E not built yet:** Recon client portal shows empty states for material selections, milestone payments, change orders, and punch list. Phase progress stepper still works (derived from job status).
- **No photos uploaded:** Photo sections show "No photos yet" with a friendly illustration.
- **No moisture readings:** Drying progress section hidden (not shown as empty).

### Key Files

**Backend:**
- `backend/api/portals/` — new module
  - `router.py` — internal invite management endpoints (auth required)
  - `public.py` — public portal data endpoints (token-based, no auth)
  - `schemas.py` — Pydantic models for portal responses
  - `service.py` — portal data assembly, scope filtering, milestone derivation
  - `email.py` — invite email sending (SendGrid/Resend)
- `backend/api/portals/assemblers/` — data assembly per portal type
  - `homeowner.py` — multi-job property-level data assembly
  - `adjuster.py` — mitigation-only documentation assembly
  - `recon_client.py` — reconstruction data assembly with 01E graceful fallback

**Frontend:**
- `web/src/app/portal/[token]/page.tsx` — public portal page (route shared by all portal types)
- `web/src/app/portal/[token]/components/` — portal type-specific components
  - `HomeownerPortal.tsx` — property view with job sections + message board
  - `AdjusterPortal.tsx` — mitigation documentation view (read-only)
  - `ReconClientPortal.tsx` — reconstruction view + message board
  - `PortalMessageBoard.tsx` — shared message board component (used by homeowner + recon)
  - `PortalHeader.tsx` — company branding header
  - `PortalExpired.tsx` — expired/invalid token error page
  - `DryingProgressChart.tsx` — GPP bar chart for moisture data
  - `PhaseProgressStepper.tsx` — reconstruction phase visualization
  - `MilestoneTimeline.tsx` — vertical timeline of job milestones
- `web/src/app/(protected)/portals/page.tsx` — internal portal management
- `web/src/app/(protected)/portals/components/` — management UI components
  - `InviteModal.tsx` — create invite form
  - `PortalCard.tsx` — per-invite card with actions
  - `CommunicationHistory.tsx` — cross-portal message timeline
  - `PreviewBanner.tsx` — yellow preview mode indicator

### Mobile-First Design

All portal views are designed mobile-first (homeowners and clients primarily view on phones):
- Single-column layout, full-width on mobile
- Max-width container (640px) centered on desktop
- Touch-friendly: large tap targets, swipeable photo carousels, no hover-dependent interactions
- Font sizes: 16px minimum for body text (prevents iOS zoom)
- Communication board: sticky input at bottom of viewport (like messaging apps)

### Security Considerations

- Tokens are 64-character hex (256 bits of entropy) — not guessable
- Expired tokens return 404 (not 401) to avoid confirming token existence
- Rate limiting on `GET /v1/portal/{token}` — 60 requests/minute per IP
- Portal data queries use explicit column selection (no `SELECT *`) to prevent accidental data leaks
- Internal notes and cost data are filtered at the assembler level, not the database level, for defense-in-depth
- Revoked invites return 404 immediately — no grace period

---

## Quick Resume

```bash
cd /Users/lakshman/Workspaces/Crewmatic
git checkout lm-dev
# Continue at: Phase 1, step 1 (portal_invites table migration)
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Portals replace share links for external parties.** Spec 01's share links (7-day, read-only, generic) are a simpler mechanism. Portals provide audience-specific views with longer-lived tokens (90 days). Share links remain for quick ad-hoc sharing; portals are the formal external-facing product.
- **Token-based access, no accounts.** External users (homeowners, adjusters, recon clients) don't create Crewmatic accounts. The 64-character access token is the auth mechanism. This matches contractor workflow — they text or email a link, the recipient taps it and sees their portal.
- **One invite per (property, job, portal_type).** Prevents duplicate portals. To change the invitee, revoke the old invite and create a new one. The unique constraint is on the database level.
- **Messages reuse `job_messages` from 04B.** Portal communication boards write to the same table that the internal "Board & People" tab uses. The `author_type` field distinguishes portal messages from team messages. This means contractors see portal messages in their Board tab alongside team messages.
- **Adjuster portal is strictly read-only.** Brett was explicit: adjusters should see documentation but not interact. No messaging, no editing. This is an insurance documentation presentation tool.
- **Homeowner portal is property-level, not job-level.** A homeowner with both a mitigation and reconstruction job sees both in one portal. This reflects reality — the homeowner cares about their property being fixed, not about the contractor's internal job separation.
- **Graceful degradation is a hard requirement.** Portals must work even if dependent specs (04B, 01E) aren't built yet. Empty states, not errors. This allows portals to be built and deployed incrementally.
- **Mobile layout is primary.** Brett: homeowners view on phones. Adjuster might view on desktop but also on tablet in the field. Mobile-first, desktop-compatible.
- **No equipment affiliate links in any carrier-facing view.** Brett's explicit rule. Contractor-side marketing and equipment recommendations are excluded from all portal views, but especially adjuster/carrier portals.
- **90-day default expiry (not 7-day).** Share links use 7-day tokens because they're ad-hoc. Portal invites are long-lived because the homeowner/adjuster needs ongoing access throughout the job lifecycle. Configurable at invite creation.
