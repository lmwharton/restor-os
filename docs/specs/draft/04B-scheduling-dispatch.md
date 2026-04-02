# Scheduling & Dispatch — Calendar Board, Tech Schedules, GPS Check-in

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/1 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 04A (Team Management) must be complete |
| **Branch** | TBD |
| **Issue** | TBD |
| **Split from** | Spec 04 (Platform V2), Phase 6 (scheduling portion) |

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
- [ ] Scheduling/dispatch with calendar board
- [ ] "My Schedule" view for techs
- [ ] GPS check-in at job site
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Brett currently dispatches techs via late-night group texts. No visibility into who's where or what's next. GPS arrival time is tracked manually.

**Solution:** Calendar board for owners to schedule techs, "My Schedule" view for techs, and GPS check-in on arrival.

## Phases & Checklist

### Phase 1: Scheduling & Dispatch — ❌
- [ ] `job_schedules` table: job_id, tech_id, scheduled_date, start_time, end_time, notes
- [ ] Calendar board view: see all jobs/techs on a timeline
- [ ] Drag-and-drop to assign tech(s) with date/time
- [ ] "My Schedule" view for techs: today's jobs, tomorrow's jobs, navigation, contact info
- [ ] Push notifications for schedule changes
- [ ] GPS check-in at job site (logs arrival time automatically)
- [ ] Owner sees real-time status: who's en route, who's on-site, who's done
- [ ] pytest: schedule CRUD, tech assignment, GPS check-in

## Technical Approach

- Calendar board uses a timeline component (react-big-calendar or custom)
- GPS check-in uses browser geolocation API (web) or native GPS (future iOS app)
- Push notifications via web push or SMS fallback

## Key Files
- `backend/api/schedules/` — scheduling endpoints
- `web/src/app/(protected)/schedule/` — scheduling/dispatch UI

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Brett's #1 pain point:** "I'm sending texts late at night telling everyone if they're gonna be in."
- **GPS check-in** was listed under Site Arrival in product page but had no spec coverage. Now explicitly included here.
- **Future iOS app** will use native GPS for more reliable check-in.
