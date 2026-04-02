# Board & People — Per-Job Messaging, Contacts Management

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/1 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 04A (Team Management) must be complete |
| **Branch** | TBD |
| **Issue** | TBD |
| **Split from** | Spec 04 (Platform V2), Phase 2 |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-01 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] Per-job message board for communication between techs, owner, customer, adjuster
- [ ] Contacts management with Customers and Adjusters tabs
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Job communication happens via text messages, phone calls, and email — scattered across channels with no record tied to the job.

**Solution:** Simple per-job message board ("Board & People" tab) and contacts management. All communication tied to the job record.

## Phases & Checklist

### Phase 1: Board & People — ❌
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
- [ ] pytest: message CRUD, contact management, share link generation

## Key Files
- `backend/api/messages/` — per-job message board
- `web/src/app/(protected)/jobs/[id]/board/` — message board UI

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **From Brett's ScopeFlow demo:** "Board & People" tab on each job. Simple threaded messages (name + text + timestamp). Contacts section with Customers and Adjusters tabs.
- **Contacts auto-populated** from job fields to reduce double-entry.
- **Share portal link** already exists from Spec 01 — contacts management extends it with per-contact sharing.
