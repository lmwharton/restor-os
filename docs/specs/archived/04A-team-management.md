# Team Management — Invites, Roles, Job Assignment

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/1 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 01 + Spec 02 must be complete |
| **Branch** | TBD |
| **Issue** | TBD |
| **Split from** | Spec 04 (Platform V2), Phase 1 |

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
- [ ] Team management: invite techs, assign roles (owner/admin/tech), job assignment
- [ ] Team Members section in Company Settings
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** After V1 ships (jobs + AI scope), Brett needs to grow beyond a solo operation. He has 3-5 employees who need access, need role-based visibility, and job assignment.

**Solution:** Team management with invites, roles, and per-job assignment. Takes Crewmatic from a single-user tool to a team operating system.

## Phases & Checklist

### Phase 1: Team Management — ❌
- [ ] `company_members` table: user_id, company_id, role (owner/admin/tech), invited_at, joined_at
- [ ] `company_invites` table: email, company_id, role, invite_token, expires_at
- [ ] Invite flow: owner enters email + role → invite email sent → tech clicks link → joins company
- [ ] Role permissions: owner (all), admin (all except billing), tech (assigned jobs + own data)
- [ ] Job assignment: assign techs to jobs, "My Jobs" filtered view per tech
- [ ] Team Members section in Company Settings (from Brett's demo — currently shows "No members yet")
- [ ] pytest: invite flow, role-based access, job assignment

## Technical Approach

- PostgreSQL RLS policies enforce role-based access at the database level
- Techs see only their assigned jobs + company-level data
- Admins see all jobs, manage team, manage settings
- Owners have full access including billing

## Key Files
- `backend/api/team/` — team management (invites, roles, assignment)
- `web/src/app/(protected)/settings/team/` — team management UI

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **From Brett's ScopeFlow demo:** Team Members section links to Company Settings. Currently shows "No members yet."
- **Three roles:** owner (sees everything, manages billing), admin (manages jobs + team, no billing), tech (sees assigned jobs only).
