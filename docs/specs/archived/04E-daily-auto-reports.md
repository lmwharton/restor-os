# Daily Auto-Reports — Automated Adjuster & Customer Updates

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/1 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 01 must be complete |
| **Branch** | TBD |
| **Issue** | TBD |
| **Split from** | Spec 04 (Platform V2), Phase 3 |

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
- [ ] Auto-generate daily progress report from today's job data
- [ ] Email to adjuster + customer with summary, photos, moisture trends
- [ ] Auto-send option (daily at 5pm) and manual send option
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Adjusters and customers have no visibility into job progress unless the contractor manually calls/emails. This delays approvals and payment.

**Solution:** Auto-generated daily progress reports sent to adjusters and customers. Proactive communication → faster approvals → faster payment. This is the "Auto Adjuster Reports" feature from the product page.

## Phases & Checklist

### Phase 1: Daily Auto-Reports — ❌
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
- [ ] pytest: report generation, email sending, auto-schedule

## Technical Approach

- Cron job or scheduled function runs at 5pm per company timezone
- Aggregates today's data per active job
- Generates email via SendGrid/Resend with HTML template
- Includes Share Portal link with time-limited access token

## Key Files
- `backend/api/reports/daily.py` — daily auto-report generation
- `web/src/app/(protected)/jobs/[id]/reports/` — report UI

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **This IS the "Auto Adjuster Reports" feature** from the product page (functionality #12). No competitor automates this.
- **Proactive communication = faster payment.** Brett: "Auto-sends to the adjuster on a daily basis with limited access. They get some picture but not all. This is a revenue tool."
- **Two send modes:** Auto (daily at 5pm) and manual ("Send Update" button). Owner controls what's visible.
