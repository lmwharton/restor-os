# Platform V2 — Team, Communications, Intelligence, Growth

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/6 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 01 + Spec 02 must be complete |
| **Branch** | TBD |
| **Issue** | TBD |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-03-26 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] Team management: invite techs, assign roles (owner/admin/tech), job assignment
- [ ] Board & People: per-job messaging between techs, customer, adjuster
- [ ] Daily auto-reports to adjuster + customer (auto-generated from day's data)
- [ ] AI Scope Auditor: past history source (contractor's own past jobs)
- [ ] Company settings expanded (website, social links, Google review, Yelp)
- [ ] Equipment inventory library
- [ ] Scheduling/dispatch with calendar board
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** After V1 ships (jobs + AI scope), Brett needs to grow beyond a solo operation. He has 3-5 employees who need access, needs to communicate with adjusters/customers efficiently, and wants AI to get smarter from his own history.

**Solution:** Platform features that take Crewmatic from a single-user tool to a team operating system:
1. Team management with roles and job assignment
2. In-app communication (message board per job, contacts management)
3. Automated adjuster/customer updates (daily progress reports)
4. AI past history intelligence (Scope Auditor source B)
5. Company profile expansion (website, review links, SEO/AEO audit)
6. Equipment inventory + scheduling

## Phases & Checklist

### Phase 1: Team Management — ❌
- [ ] `company_members` table: user_id, company_id, role (owner/admin/tech), invited_at, joined_at
- [ ] `company_invites` table: email, company_id, role, invite_token, expires_at
- [ ] Invite flow: owner enters email + role → invite email sent → tech clicks link → joins company
- [ ] Role permissions: owner (all), admin (all except billing), tech (assigned jobs + own data)
- [ ] Job assignment: assign techs to jobs, "My Jobs" filtered view per tech
- [ ] Team Members section in Company Settings (from Brett's demo — currently shows "No members yet")
- [ ] pytest: invite flow, role-based access, job assignment

### Phase 2: Board & People — ❌
**Message Board (per-job communication):**
- [ ] `job_messages` table: job_id, author_name, message_text, created_at
- [ ] Simple threaded messages on each job — "Board & People" tab (from Brett's demo)
- [ ] Your Name field + message textarea + "Post Message" button
- [ ] Messages visible to all team members + invited contacts
- [ ] Push notifications to team members on new messages (V2.1)

**Contacts Management:**
- [ ] Contacts section with tabs: Customers | Adjusters (from Brett's demo)
- [ ] Per-contact: name, phone, email, share link button, remove button
- [ ] "+ Add Customer name" to add contacts
- [ ] Contacts auto-populated from job fields (customer_name/phone/email, adjuster_name/phone/email)
- [ ] Share portal link per contact — read-only job view

### Phase 3: Daily Auto-Reports — ❌
- [ ] Auto-generate daily progress report from:
  - Moisture readings recorded today
  - Photos uploaded today
  - Tech field notes written today
  - Equipment changes (placed/removed)
  - Line items added/modified
- [ ] `POST /v1/jobs/:id/daily-report` — generate and send
- [ ] `GET /v1/jobs/:id/daily-reports` — list sent reports
- [ ] Email to adjuster + customer with:
  - Summary of today's work
  - Moisture reading trends (chart or table)
  - Photo thumbnails added today
  - Share Portal link for full details
- [ ] Auto-send option: configure to send daily at 5pm automatically
- [ ] Manual send option: "Send Update" button on job detail
- [ ] This is the "Auto Adjuster Reports" feature from the V2 roadmap
- [ ] Proactive communication → faster approvals → faster payment

### Phase 4: AI Past History Intelligence — ❌
- [ ] Scope Auditor Source (b): AI PAST HISTORY
- [ ] Query contractor's own scope_runs + line_items from completed jobs
- [ ] Build per-contractor patterns: "For Cat 2 dishwasher leaks, you typically add these items..."
- [ ] Reference specific past jobs: "You had a similar job at 123 Oak St — you added content manipulation there but it's missing here"
- [ ] Coach behavior: "Good catch adding deodorization — you missed this on your last 3 Cat 2 jobs"
- [ ] Include patterns from uploaded scope PDFs (Scope Intelligence from Spec 02)
- [ ] Feed patterns into Scope Auditor prompts alongside real-time analysis
- [ ] pytest: past history suggestions appear for contractors with 5+ completed jobs

### Phase 5: Company Settings Expansion — ❌
- [ ] Add to `companies` table: city, region/state, website_url, google_review_url, yelp_url, social_links (JSONB)
- [ ] Company Settings → Profile tab expanded (from Brett's demo):
  - Company Logo (upload)
  - Company Name, City/Region
  - Phone, Email
  - Website URL
  - Google Review Link
  - Yelp URL
  - Other social links (Facebook, BBB, Angi, HomeAdvisor)
- [ ] These fields show on branded PDF reports, share portals, emails
- [ ] Company Settings → Inventory tab (Phase 6)

**Future: SEO/AEO Audit (V3):**
- Analyze contractor's online presence (Google Business Profile, Yelp, website, social)
- Score their visibility for local restoration searches
- Suggest improvements: "Your Google Business Profile is missing 'water damage restoration' keyword"
- Value-add that deepens platform stickiness — Crewmatic helps them get MORE jobs, not just manage existing ones

### Phase 6: Equipment Inventory + Scheduling — ❌
**Equipment Inventory:**
- [ ] `equipment_library` table: company_id, equipment_type (air_mover/dehu/air_scrubber/etc), brand, model, serial_number, status (available/deployed/maintenance)
- [ ] Company Settings → Inventory tab: manage equipment library
- [ ] Track which equipment is deployed on which job/room
- [ ] Equipment ROI tracking: which units generate most billing

**Scheduling / Dispatch:**
- [ ] `job_schedules` table: job_id, tech_id, scheduled_date, start_time, end_time, notes
- [ ] Calendar board view: see all jobs/techs on a timeline
- [ ] "My Schedule" view for techs: today's jobs, navigation, contact info
- [ ] Push notifications for schedule changes
- [ ] GPS check-in at job site (for future iOS app)

## Technical Approach

**Team management:**
- PostgreSQL RLS policies enforce role-based access at the database level
- Techs see only their assigned jobs + company-level data
- Admins see all jobs, manage team, manage settings
- Owners have full access including billing

**Daily auto-reports:**
- Cron job or scheduled function runs at 5pm per company timezone
- Aggregates today's data per active job
- Generates email via SendGrid/Resend with HTML template
- Includes Share Portal link with time-limited access token

**AI past history:**
- Background job builds per-contractor pattern tables from completed scope_runs
- Stored as: `(contractor_id, loss_profile) → [{code, frequency, typical_qty}]`
- Injected into Scope Auditor prompt alongside real-time analysis
- Refreshed after each completed job

**Key Files:**
- `backend/api/team/` — team management (invites, roles, assignment)
- `backend/api/messages/` — per-job message board
- `backend/api/reports/daily.py` — daily auto-report generation
- `backend/api/ai/history.py` — past history pattern builder
- `web/src/app/(protected)/jobs/[id]/board/` — message board UI
- `web/src/app/(protected)/settings/team/` — team management UI
- `web/src/app/(protected)/settings/inventory/` — equipment library UI
- `web/src/app/(protected)/schedule/` — scheduling/dispatch UI

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1, Team Management
# Prerequisite: Spec 01 + Spec 02 must be complete
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Board & People (from Brett's ScopeFlow demo):** Per-job message board for communication between techs, owner, customer, adjuster. Simple threaded messages (name + text + timestamp). Contacts section with Customers and Adjusters tabs. Team Members section links to Company Settings.
- **Daily auto-reports:** Auto-generate daily progress email from today's moisture readings + photos + tech notes. Send to adjuster + customer. Proactive communication → faster approvals → faster payment.
- **AI Past History is Scope Auditor source (b):** Learns from contractor's own completed jobs. References specific past jobs. Coaches: reinforces good catches, flags regressions. Works alongside real-time analysis (source a) and network intelligence (source c, V3).
- **Company settings expanded (from Brett's demo):** Logo, name, city/region, phone, email, website, Google Review link, Yelp. Shows on all branded outputs. Future: SEO/AEO audit for online presence optimization.
- **Equipment inventory:** Tracks serial numbers, deployment status, billing ROI. Currently in Brett's demo under Company Settings → Inventory tab.
- **Scheduling/dispatch:** Calendar board + "My Schedule" for techs. V2 feature, not in Brett's demo but on the roadmap.
- **Network intelligence (V3):** Scope Auditor source (c) — anonymized aggregate from all contractors. Co-occurrence matrix. 20+ job minimum for suggestions. "Waze for restoration scoping." See Spec 01 Decisions & Notes for full technical architecture. Data collection starts in V1 via scope_runs — no additional work needed now.
- **Progressive intelligence timeline:** Job 1: AI real-time only. Jobs 1-10: + uploaded past scope PDFs. Jobs 11-20: + Crewmatic scope_runs. Job 21+: + network intelligence (when V3 ships). Each layer makes suggestions stronger.
