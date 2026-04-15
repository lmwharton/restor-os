# Spec 04-I: Team & Operations Dashboard

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/9 phases) |
| **State** | Draft — under review |
| **Blocker** | None — fully self-contained |
| **Branch** | TBD |
| **Issue** | TBD |
| **Source** | Brett's "Crewmatic Dashboard — Product Specification v1.0" (April 13, 2026) |
| **Consolidates** | 04A (Team Management) + 04B (Scheduling & Dispatch) + 04F (Notifications) + 04G (Dashboard) |

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
- [ ] Team management: invite techs, roles (owner/admin/tech), job assignment
- [ ] Live Job Map with dark mode, custom job-type icons, pulsing active jobs, hover cards
- [ ] Task Feed with red/amber/green urgency badges, auto-generated tasks, tap navigates to job
- [ ] Unified Notifications & Alerts: bell dropdown (all activity) + dashboard panel (high-priority)
- [ ] Time Clock (optional, owner-configurable) with one-tap clock in/out, session log, GPS
- [ ] Team Chat with flat crew-wide messaging, real-time updates, unread badge
- [ ] Scheduling: calendar board, drag-drop tech assignment, "My Schedule" view
- [ ] Dispatch View: per-tech daily job list, tomorrow's needs, Map ↔ Dispatch toggle
- [ ] Dashboard layout: 3-column desktop grid, stacked mobile, auto-refresh
- [ ] Tests passing
- [ ] Code review approved

## Overview

**Problem:** Crewmatic is currently single-user with an analytics-focused dashboard (KPI gauges, pipeline bars, event feed). Brett has 3-5 techs who need access, need to know where their jobs are, what needs attention, and what the crew is doing. He dispatches via late-night group texts. No time tracking. No team communication channel.

**Solution:** Build the complete multi-user operations platform in one spec:
1. **Team Management** — invite techs, assign roles, assign jobs (foundation for everything)
2. **Job Assignment** — assign techs to jobs, "My Jobs" filtered view
3. **Map Upgrade** — dark mode, custom icons, pulsing, hover cards
4. **Task Feed** — all tasks across jobs, urgency badges, auto-generated from system events
5. **Notifications & Alerts** — unified system: bell dropdown (activity) + dashboard panel (action items)
6. **Time Clock** — optional clock in/out with session tracking and GPS
7. **Team Chat** — internal crew-wide messaging
8. **Scheduling** — calendar board for tech assignment
9. **Dispatch View + Layout** — daily view, dashboard layout overhaul, mobile

**Scope:**
- IN: All 9 phases above, both frontend and backend, mobile-responsive, role-based visibility, empty states
- OUT: Job Detail Page changes (Spec 01), push notifications (future), file attachments in chat (future), adjuster/customer portal access (future)

---

## What Changes from Current Dashboard

| Current | New |
|---------|-----|
| KPI gauges (Active Jobs, Revenue, AR, Cycle Days) | **Removed** — moves to future Analytics page |
| Pipeline bars (Mitigation + Recon stages) | **Removed** — moves to Jobs list page filters |
| Company Event Feed | **Replaced by** Team Chat + Notifications/Alerts |
| Map (light theme, colored circles, click-to-info) | **Upgraded** — dark mode, custom icons, pulsing, hover cards |
| Priority Task list (inline, derived from jobs) | **Upgraded** — standalone Task Feed with urgency badges, DB-backed tasks |
| AttentionBar (amber bar at top) | **Replaced by** dedicated Alerts panel |
| Bell dropdown (event feed) | **Extended** — adds severity levels, alert triggers, resolved state |
| No team management | **New** — invites, roles, job assignment |
| No dispatch view | **New** — Dispatch View toggle |
| No time clock | **New** — Time Clock component |
| No team chat | **New** — Team Chat component |
| No scheduling | **New** — Calendar board |

---

## Phases & Checklist

### Phase 1: Team Management — ❌
Foundation: `company_members` table, invites, roles. Everything else builds on this.

**Backend:**
- [ ] `company_members` table: user_id, company_id, role (owner/admin/tech), invited_at, joined_at, chat_last_read_at
- [ ] `company_invites` table: email, company_id, role, invite_token, expires_at
- [ ] `POST /v1/team/invite` — owner sends invite (email + role)
- [ ] `POST /v1/team/accept-invite` — tech accepts invite, joins company
- [ ] `GET /v1/team/members` — list all members with roles
- [ ] `PATCH /v1/team/members/{id}` — update role
- [ ] `DELETE /v1/team/members/{id}` — remove member
- [ ] RLS policies: owner (all), admin (all except billing), tech (assigned jobs + own data)
- [ ] pytest: invite flow, role-based access, member CRUD

**Frontend:**
- [ ] Team Members section in Company Settings
- [ ] Invite form: email + role selector
- [ ] Member list: name, email, role badge, actions (change role, remove)
- [ ] Invite acceptance page (linked from email)

### Phase 2: Job Assignment — ❌
Assign techs to jobs, "My Jobs" filter. Enables per-tech views across the dashboard.

**Backend:**
- [ ] `assigned_to UUID[]` column on jobs table (array of user IDs — multi-tech per job)
- [ ] `PATCH /v1/jobs/{id}` — update assigned_to
- [ ] `GET /v1/jobs?assigned_to=me` — filter jobs by assignment
- [ ] pytest: assignment CRUD, "my jobs" filter

**Frontend:**
- [ ] Tech assignment selector on Job Detail Page (multi-select from team members)
- [ ] "My Jobs" / "All Jobs" toggle on Jobs list page
- [ ] Assignment badge on job cards

### Phase 3: Map Upgrade — ❌
Dark mode, custom icons, pulsing, hover cards. No new backend.

- [ ] Dark mode map style JSON (Google Maps styling)
- [ ] Custom SVG icons: water droplet (💧), flame (🔥), mold spore (🍄), hammer/wrench (🔨)
- [ ] Icon rendering with colored circle background via AdvancedMarkerElement
- [ ] Status colors: Blue = Active, Amber = Pending, Green = Complete, Red = Needs attention
- [ ] Size differentiation: 48px bright for your jobs, 32px muted (80% opacity) for others
- [ ] Pulsing CSS animation for active jobs (crew on-site)
- [ ] Hover card overlay: address, job type, assigned tech, next task, day count
- [ ] "All Jobs" / "My Jobs Only" toggle (top-right of map)
- [ ] Red attention styling for jobs with overdue conditions (40px, slightly larger)
- [ ] Double-click → navigate to Job Detail Page
- [ ] Light mode option in user settings

### Phase 4: Task Feed + Backend — ❌
New `tasks` table, API, standalone component. Replaces inline priority task list.

**Backend:**
- [ ] `tasks` table migration:
```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  assigned_to UUID REFERENCES company_members(user_id),
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL,          -- 'moisture_reading', 'equipment_check', 'walkthrough', 'manual'
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'completed'
  priority TEXT NOT NULL DEFAULT 'normal', -- 'critical', 'warning', 'normal', 'low'
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'manual',  -- 'system', 'manual'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```
- [ ] `GET /v1/tasks?status=pending&assigned_to=me` — list tasks
- [ ] `PATCH /v1/tasks/{id}` — update status (mark complete)
- [ ] `POST /v1/tasks` — create manual task
- [ ] Auto-task generation logic:
  - Moisture reading due: last reading > 24 hrs on active drying job
  - Equipment check due: deployment date + scheduled interval
  - Final walkthrough: job status → "complete"
  - Manual: tech note with "tomorrow" keyword
- [ ] pytest: task CRUD, auto-generation, completion

**Frontend:**
- [ ] `<TaskFeed>` component with urgency badges (red=overdue, amber=due today, green=completed)
- [ ] Task card: badge + title + address-room + due status + "View Job"
- [ ] Tap task → navigate to job, auto-scroll to relevant section
- [ ] Completed tasks: green badge, auto-archive after 24 hours
- [ ] Mobile: swipe right to mark complete
- [ ] Empty state: "All caught up! No tasks due right now"

### Phase 5: Notifications & Alerts (Unified) — ❌
Extend existing `event_history` with severity levels. Bell dropdown = all events. Dashboard panel = high-priority only.

**Backend — extend `event_history`:**
- [ ] Add columns to `event_history`:
```sql
ALTER TABLE event_history ADD COLUMN severity TEXT;          -- NULL=normal, 'amber', 'red'
ALTER TABLE event_history ADD COLUMN resolved BOOLEAN DEFAULT false;
ALTER TABLE event_history ADD COLUMN resolved_at TIMESTAMPTZ;
ALTER TABLE event_history ADD COLUMN resolved_by UUID;
ALTER TABLE event_history ADD COLUMN auto_dismiss_at TIMESTAMPTZ;
```
- [ ] `GET /v1/alerts?resolved=false` — active alerts (severity IS NOT NULL, not resolved)
- [ ] `PATCH /v1/alerts/{id}/resolve` — mark alert resolved
- [ ] Alert trigger logic (creates event_history rows with severity):

| Trigger | Severity | Title |
|---------|----------|-------|
| Moisture reading > dry threshold for 3+ days | red | "Moisture reading overdue — {address} ({N} days)" |
| No drying log in 48+ hours | red | "Drying log overdue — {address}" |
| Equipment malfunction reported | red | "Equipment malfunction — {address}" |
| Supplement approved by carrier | amber | "Supplement approved — {address} ({amount})" |
| Supplement denied by carrier | amber | "Supplement denied — {address}" |
| Equipment delivery scheduled | amber | "Equipment delivery — {address} ({date})" |
| Final walkthrough scheduled | amber | "Final walkthrough — {address}" |

- [ ] Auto-resolution: alert resolved when condition is fixed (reading taken, etc.)
- [ ] Auto-dismiss: amber alerts expire after 7 days (`auto_dismiss_at`)
- [ ] Verify existing notification endpoints still work (backward compatible)
- [ ] Verify existing `log_event()` calls still work (severity defaults to NULL = normal)
- [ ] pytest: alert creation, resolution, auto-dismiss, trigger conditions

**Frontend:**
- [ ] `<AlertsPanel>` on dashboard: always visible if alerts exist, sorted red-first
- [ ] Alert card: colored dot + title + "View Job" + "Mark Resolved"
- [ ] "Mark Resolved" dismisses without navigating
- [ ] Empty state: green checkmark "No alerts — Everything looks good"
- [ ] Bell dropdown (existing): verify it still works, unread counts still correct
- [ ] Staging verification: end-to-end test (upload photo → bell shows event)

### Phase 6: Time Clock + Backend — ❌
New `time_entries` table, optional component, GPS capture.

**Backend:**
- [ ] `time_entries` table migration:
```sql
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  user_id UUID NOT NULL REFERENCES company_members(user_id),
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  latitude_in DECIMAL(10,8),
  longitude_in DECIMAL(11,8),
  latitude_out DECIMAL(10,8),
  longitude_out DECIMAL(11,8),
  created_at TIMESTAMPTZ DEFAULT now()
);
```
- [ ] `time_clock_enabled BOOLEAN DEFAULT true` on companies table
- [ ] `POST /v1/time-clock/clock-in` — create entry + GPS coords
- [ ] `POST /v1/time-clock/clock-out` — close open entry + GPS coords
- [ ] `GET /v1/time-clock/status` — current state + today's hours + weekly hours
- [ ] `GET /v1/time-clock/entries?user_id=X&week_of=2026-04-14` — session log
- [ ] Weekly calculation: Monday–Sunday, resets Monday morning
- [ ] Owner can query any user's entries; tech sees only own
- [ ] pytest: clock in/out, hours calculation, weekly reset, settings toggle

**Frontend:**
- [ ] `<TimeClock>` component: status (clocked in/out), today hours, weekly hours, big button
- [ ] Session log: `8:00 AM - 12:30 PM (4.5 hrs)`, `1:00 PM - now`
- [ ] Owner view: see all crew members' time data
- [ ] Settings toggle in Company Settings (owner only)
- [ ] Conditional rendering based on `time_clock_enabled`
- [ ] Mobile: huge button at top, thumb-friendly
- [ ] GPS capture via `navigator.geolocation.getCurrentPosition()` (silent after first permission)

### Phase 7: Team Chat + Backend — ❌
New `team_messages` table, chat component with polling.

**Backend:**
- [ ] `team_messages` table migration:
```sql
CREATE TABLE team_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  user_id UUID NOT NULL REFERENCES company_members(user_id),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```
- [ ] `chat_last_read_at` column on `company_members` (added in Phase 1 table)
- [ ] `GET /v1/team-chat?limit=50&before={cursor}` — paginated messages
- [ ] `POST /v1/team-chat` — send message
- [ ] `POST /v1/team-chat/mark-read` — update `chat_last_read_at`
- [ ] `GET /v1/team-chat/unread-count` — messages since `chat_last_read_at`
- [ ] pytest: send, list, pagination, unread count

**Frontend:**
- [ ] `<TeamChat>` component: message list + input + send button
- [ ] Flat feed, newest at bottom, auto-scroll on new message
- [ ] Message format: sender name + timestamp + text
- [ ] Plain text only V1 (no attachments, no formatting)
- [ ] Sticky input field at bottom
- [ ] Polling every 5 seconds via TanStack Query `refetchInterval`
- [ ] Unread badge count on Dashboard tab
- [ ] Empty state: "No messages yet — Start the conversation!"
- [ ] NOT visible to homeowners/adjusters/PA portal — internal crew only

### Phase 8: Scheduling — ❌
Calendar board for owners to assign techs to jobs by date.

**Backend:**
- [ ] `job_schedules` table migration:
```sql
CREATE TABLE job_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  tech_id UUID NOT NULL REFERENCES company_members(user_id),
  scheduled_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```
- [ ] `GET /v1/schedules?date=2026-04-14` — schedules for a date (or date range)
- [ ] `POST /v1/schedules` — create schedule entry
- [ ] `PATCH /v1/schedules/{id}` — update (reassign, change time)
- [ ] `DELETE /v1/schedules/{id}` — remove
- [ ] pytest: schedule CRUD, date filtering, tech assignment

**Frontend:**
- [ ] Calendar board page (`/schedule`): timeline view of all techs × dates
- [ ] Drag-and-drop to assign tech to job for a date
- [ ] "My Schedule" view for techs: today's jobs, tomorrow's jobs, navigation links
- [ ] GPS check-in at job site (logs arrival via browser geolocation)

### Phase 9: Dispatch View + Dashboard Layout — ❌
Map/Dispatch toggle, new dashboard layout, mobile responsive. Ties it all together.

**Backend:**
- [ ] `GET /v1/dashboard/dispatch?date=2026-04-14` — jobs grouped by tech for date (reads from `job_schedules`)
- [ ] Tomorrow's needs: parse `tech_notes` for keywords ("tomorrow", "need more", "next day")

**Frontend:**
- [ ] Map ↔ Dispatch toggle button in card header
- [ ] `<DispatchView>` component: per-tech collapsible sections (name, job count, job list)
- [ ] Tomorrow's Needs section under each tech
- [ ] Mobile: shows logged-in tech's jobs by default, owner can expand all

**Dashboard Layout — Desktop (3-column grid):**
```
┌─────────────────────────────────────────────────────────┐
│ Header: Crewmatic    [Map/Dispatch ▼]    [Brett ▼]      │
├──────────────────┬─────────────────┬────────────────────┤
│                  │  Time Clock     │                    │
│  LIVE JOB MAP    │  (if enabled)   │   Alerts           │
│  (or Dispatch)   │                 │   (if any exist)   │
│                  │                 │                    │
├──────────────────┤                 ├────────────────────┤
│                  ├─────────────────┤                    │
│                  │  Tasks (5)      │   Team Chat        │
│                  │                 │                    │
└──────────────────┴─────────────────┴────────────────────┘
```

**Mobile (stacked vertical):**
1. Time Clock (if enabled) — always at top
2. Alerts (if any)
3. Map/Dispatch toggle
4. Tasks
5. Team Chat

**Layout & cleanup:**
- [ ] CSS Grid: `grid-template-columns: 1fr 320px 320px` desktop, single column mobile
- [ ] Responsive breakpoint: mobile (<768px) stacked, desktop (>=768px) grid
- [ ] If Time Clock disabled, map expands
- [ ] Remove old dashboard components (KPI gauges, pipeline bars, event feed)
- [ ] Move KPI/pipeline content to Jobs list page or future Analytics page
- [ ] Auto-refresh intervals: chat 5s, alerts 30s, tasks 60s, map 2min
- [ ] Verify all components work together
- [ ] Cross-browser QA (desktop + mobile)

---

## Technical Approach

**Team Management (Phase 1-2):** New `company_members` and `company_invites` tables with RLS policies. Three roles enforce visibility at DB level. Job assignment uses `assigned_to UUID[]` array on jobs table — supports multi-tech per job.

**Map (Phase 3):** Replace Google Maps style JSON with dark theme. Replace `google.maps.Marker` with `AdvancedMarkerElement` for custom HTML (SVG icons in colored circles). CSS `@keyframes pulse` for active jobs. Hover card is a React-managed positioned div, not a Google InfoWindow.

**Tasks (Phase 4):** New `tasks` table with auto-generation logic. Auto-tasks created on-event (status change, reading recorded) or via periodic check. Frontend uses TanStack Query with 60s polling.

**Notifications & Alerts (Phase 5):** Extend existing `event_history` table with `severity`, `resolved`, `auto_dismiss_at` columns. Existing `log_event()` calls remain unchanged (severity defaults to NULL = normal notification). New alert triggers create events with severity set. Bell dropdown reads all events. Dashboard AlertsPanel reads only `severity IS NOT NULL AND resolved = false`. One system, two views.

**Time Clock (Phase 6):** Browser `navigator.geolocation.getCurrentPosition()` on clock events. GPS stored but not shown to tech. Weekly hours computed server-side.

**Team Chat (Phase 7):** 5-second polling via TanStack Query. Adequate for crews of 3-10. Upgrade path: Supabase Realtime subscription (swap polling for subscription, no API changes).

**Scheduling (Phase 8):** Calendar board with `job_schedules` table linking techs to jobs by date. GPS check-in uses same browser geolocation pattern as Time Clock.

**Layout (Phase 9):** CSS Grid dashboard. Each component is a self-contained card. Conditional rendering of Time Clock based on company setting.

**Key Files:**
- `backend/api/team/` — new: invites, roles, members
- `backend/api/tasks/` — new: task CRUD, auto-generation
- `backend/api/notifications/` — extend: add alert endpoints
- `backend/api/time_clock/` — new: clock in/out, session log
- `backend/api/team_chat/` — new: messaging
- `backend/api/schedules/` — new: calendar scheduling
- `web/src/app/(protected)/dashboard/dashboard-client.tsx` — full rewrite
- `web/src/components/dashboard-map.tsx` — upgrade
- `web/src/components/task-feed.tsx` — new
- `web/src/components/alerts-panel.tsx` — new
- `web/src/components/time-clock.tsx` — new
- `web/src/components/team-chat.tsx` — new
- `web/src/components/dispatch-view.tsx` — new
- `web/src/app/(protected)/settings/team/` — new: team settings
- `web/src/app/(protected)/schedule/` — new: calendar board

## Quick Resume

```bash
cd /Users/lakshman/Workspaces/Crewmatic
git checkout lm-dev
# Continue at: Phase 1, step 1 (company_members table)
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Source document:** Brett's "Crewmatic Dashboard — Product Specification v1.0" (April 13, 2026), filed at `/Users/lakshman/Downloads/Crewmatic Dashboard Summary.docx.pdf`
- **Consolidates 04A + 04B + 04F + 04G** into one self-contained spec with zero external dependencies
- **Dashboard is a replacement, not addition.** Current KPI gauges + pipeline bars move elsewhere. Brett's spec is operations-focused, not analytics-focused.
- **Notifications & Alerts unified.** Instead of a separate `alerts` table, extend `event_history` with `severity` column. Bell dropdown shows all events (severity NULL). Dashboard AlertsPanel shows only severity red/amber. One table, two views.
- **Phase ordering rationale:** Team management first (foundation), then individual dashboard components (each shippable on its own), then scheduling + dispatch + layout last (ties everything together).
- **Team Chat vs Board (04-II):** Team Chat is company-wide casual crew coordination. Board (04-II) is per-job formal documentation visible to external parties. Separate systems.
- **Dispatch View vs Scheduling:** Scheduling (Phase 8) is the write side (create assignments). Dispatch View (Phase 9) is the read side (today's snapshot). Same spec, clear separation.
- **Real-time strategy:** Polling first (chat 5s, alerts 30s, tasks 60s, map 2min). Supabase Realtime is the upgrade path but not blocker.
- **GPS strategy:** Used by both Time Clock (Phase 6) and Scheduling GPS check-in (Phase 8). Same browser Geolocation API pattern. Captured passively, not shown to tech, available for owner.
- **Brett's pain points addressed:** "I'm sending texts late at night" → Scheduling + Dispatch. "Where are my jobs?" → Map. "What needs attention?" → Alerts. "What's my crew doing?" → Dispatch + Time Clock + Chat.
