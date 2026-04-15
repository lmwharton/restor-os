# Spec 04-II: Job Communication

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/3 phases) |
| **State** | Draft — under review |
| **Blocker** | None — fully self-contained |
| **Branch** | TBD |
| **Issue** | TBD |
| **Consolidates** | 04D (Board & People) + 04E (Daily Auto-Reports) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-14 17:00 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] Per-job message board ("Board & People" tab) for techs, owner, customer, adjuster
- [ ] Contacts management with Customers and Adjusters tabs
- [ ] Auto-generated daily progress reports emailed to adjuster + customer
- [ ] Auto-send option (daily at 5pm) and manual send option
- [ ] Tests passing
- [ ] Code review approved

## Overview

**Problem:** Job communication happens via scattered text messages, phone calls, and emails with no record tied to the job. Adjusters and customers have no visibility into progress unless the contractor manually calls. This delays approvals and payment.

**Solution:** Two complementary communication systems for jobs:
1. **Board & People** — per-job message board + contacts management (real-time, interactive)
2. **Daily Auto-Reports** — automated progress emails to adjusters/customers (scheduled, one-way)

Both share the same contacts infrastructure (adjuster email, customer email, share links).

**Scope:**
- IN: Per-job message board, contacts management (Customers + Adjusters), daily auto-reports (email), auto-send scheduling, manual send, share portal link
- OUT: Push notifications for new board messages (future), file attachments on board (future), SMS notifications (future)

**Relationship to other specs:**
- **04-I (Team & Operations Dashboard):** Team Chat in 04-I is company-wide casual crew coordination. Board here is per-job formal documentation. Different audiences, different tables, no overlap.
- **Spec 01 (Jobs):** Share portal links already exist from Spec 01. Contacts management extends them with per-contact sharing.

---

## Phases & Checklist

### Phase 1: Per-Job Message Board — ❌
"Board & People" tab on Job Detail Page.

**Backend:**
- [ ] `job_messages` table migration:
```sql
CREATE TABLE job_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  author_name TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'team',  -- 'team', 'customer', 'adjuster'
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```
- [ ] `GET /v1/jobs/{id}/messages` — list messages for a job
- [ ] `POST /v1/jobs/{id}/messages` — post message
- [ ] Messages visible to all team members + invited contacts
- [ ] pytest: message CRUD, visibility rules

**Frontend:**
- [ ] "Board & People" tab on Job Detail Page
- [ ] Message list: author name + timestamp + message text
- [ ] Your Name field + message textarea + "Post Message" button
- [ ] Auto-scroll to newest message

### Phase 2: Contacts Management — ❌
Customers and Adjusters tabs with share link management.

**Backend:**
- [ ] `job_contacts` table migration:
```sql
CREATE TABLE job_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  contact_type TEXT NOT NULL,  -- 'customer', 'adjuster'
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  share_link_id UUID REFERENCES share_links(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```
- [ ] `GET /v1/jobs/{id}/contacts` — list contacts for a job
- [ ] `POST /v1/jobs/{id}/contacts` — add contact
- [ ] `DELETE /v1/jobs/{id}/contacts/{contact_id}` — remove contact
- [ ] `POST /v1/jobs/{id}/contacts/{contact_id}/share` — generate share link for contact
- [ ] Auto-populate contacts from job fields (customer_name/phone/email, adjuster_name/phone/email)
- [ ] pytest: contact CRUD, share link generation, auto-populate

**Frontend:**
- [ ] Contacts section on "Board & People" tab
- [ ] Two tabs: Customers | Adjusters
- [ ] Per-contact: name, phone, email, share link button, remove button
- [ ] "+ Add Customer" / "+ Add Adjuster" buttons
- [ ] Share link generates read-only job view URL

### Phase 3: Daily Auto-Reports — ❌
Automated progress emails to adjusters and customers.

**Backend:**
- [ ] `daily_reports` table migration:
```sql
CREATE TABLE daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  report_data JSONB NOT NULL,  -- snapshot of today's activity
  sent_to JSONB NOT NULL,      -- array of {email, name, contact_type}
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```
- [ ] `POST /v1/jobs/{id}/daily-report` — generate + send report
- [ ] `GET /v1/jobs/{id}/daily-reports` — list sent reports
- [ ] Report content aggregated from today's data:
  - Moisture readings recorded today
  - Photos uploaded today
  - Tech field notes written today
  - Equipment changes (placed/removed)
  - Line items added/modified
- [ ] Email via SendGrid/Resend with HTML template:
  - Summary of today's work
  - Moisture reading trends (table)
  - Photo thumbnails
  - Share Portal link for full details
- [ ] Auto-send option: cron job at 5pm per company timezone
- [ ] `auto_daily_report BOOLEAN DEFAULT false` + `daily_report_time TIME DEFAULT '17:00'` on companies table
- [ ] pytest: report generation, email content, auto-schedule

**Frontend:**
- [ ] "Send Update" button on Job Detail Page
- [ ] Preview report before sending
- [ ] Recipients auto-populated from job contacts
- [ ] Settings: enable/disable auto-send, configure time
- [ ] Report history: list of sent reports with dates

---

## Technical Approach

**Board (Phase 1):** Simple message table scoped to job_id. No threading in V1 — flat feed like SMS. Author name is free-text (not tied to user accounts) so external contacts can be represented.

**Contacts (Phase 2):** Extends existing share link system from Spec 01. Auto-populates from job fields to reduce double-entry. Share links give contacts read-only access to job progress.

**Auto-Reports (Phase 3):** Cron function runs at configured time per company timezone. Aggregates today's `event_history` entries for each active job. Generates HTML email via SendGrid/Resend. Includes share portal link with time-limited access token.

**Key Files:**
- `backend/api/messages/` — new: per-job message board
- `backend/api/contacts/` — new: contacts management
- `backend/api/reports/daily.py` — new: daily auto-report generation
- `web/src/app/(protected)/jobs/[id]/board/` — new: Board & People tab
- `web/src/app/(protected)/settings/reports/` — new: auto-report settings

## Quick Resume

```bash
cd /Users/lakshman/Workspaces/Crewmatic
git checkout lm-dev
# Continue at: Phase 1, step 1 (job_messages table)
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Consolidates 04D + 04E** — Board provides real-time per-job communication, Auto-Reports provides scheduled summaries. Both share contacts infrastructure.
- **Board is NOT Team Chat.** Board = per-job, visible to external contacts (customer, adjuster). Team Chat (04-I) = company-wide, internal crew only.
- **Auto-reports are a revenue tool.** Brett: "Auto-sends to the adjuster on a daily basis with limited access. This is a revenue tool." Proactive communication → faster approvals → faster payment.
- **Author name is free-text** in V1. External contacts (customer/adjuster posting via share portal) aren't Crewmatic users, so we store their name as text rather than requiring a user account.
- **From Brett's ScopeFlow demo:** "Board & People" tab on each job. Simple messages (name + text + timestamp). Contacts section with Customers and Adjusters tabs.
