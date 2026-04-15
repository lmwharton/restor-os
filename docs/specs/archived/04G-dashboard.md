# Spec 04G: Dashboard — Mission Control

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/6 phases) |
| **State** | Draft — under review |
| **Blocker** | None (Phase 1-3 can start now; Phase 4-6 need team management) |
| **Branch** | TBD |
| **Issue** | TBD |
| **Source** | Brett's "Crewmatic Dashboard — Product Specification v1.0" (April 13, 2026) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-14 16:00 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] Live Job Map with dark mode, custom job-type icons, pulsing active jobs, hover cards
- [ ] Map ↔ Dispatch toggle shows per-tech job list with tomorrow's needs
- [ ] Task Feed shows all tasks with red/amber/green urgency badges, tap navigates to job section
- [ ] Alerts section shows red (urgent) and amber (informational) alerts with Mark Resolved
- [ ] Time Clock (optional, owner-configurable) with one-tap clock in/out, session log, GPS
- [ ] Team Chat with flat crew-wide messaging, real-time updates, unread badge
- [ ] Mobile view stacks components vertically with big tap targets
- [ ] Dashboard auto-refreshes (chat: 5s, alerts: 30s, tasks: 60s, map: 2min)
- [ ] Tests passing
- [ ] Code review approved

## Overview

**Problem:** The current dashboard is analytics-focused — KPI gauges, pipeline bars, event feed. It answers "how's business doing?" but not the question field techs and owners actually ask every morning: "Where are my jobs, what needs my attention, and what does my crew need right now?" Brett's feedback: techs should glance at this screen and know exactly what to do next.

**Solution:** Replace the current dashboard with a 5-component mission control screen designed for speed:
1. **Live Job Map** — spatial view of all active jobs with custom icons and status colors
2. **Dispatch View** — per-tech task list for today (toggles with map)
3. **Task Feed** — all tasks across jobs, sorted by urgency
4. **Alerts** — system-generated items needing attention
5. **Time Clock** — optional clock in/out with session tracking
6. **Team Chat** — internal crew-wide messaging

**Scope:**
- IN: All 6 components above, both frontend and backend, mobile-responsive layout, real-time updates, role-based visibility (owner vs tech), empty states, Settings toggle for Time Clock
- OUT: Job Detail Page changes (already specced), push notifications (future), file attachments in chat (future), auto-detection of job addresses in chat messages (future), scheduling/calendar board (Spec 04B — Dispatch View here is read-only daily view, not the scheduling tool)

**Relationship to existing specs:**
- **04A (Team Management)** — prerequisite for Dispatch View, Time Clock owner view, and per-tech filtering. Phases 1-3 can start without it (single-user mode). Phases 4-6 need `company_members` table.
- **04B (Scheduling & Dispatch)** — the scheduling/calendar board is separate. This spec's Dispatch View is a read-only "today's assignments" view that reads from whatever 04B creates.
- **04D (Board & People)** — Board is per-job messaging. Team Chat here is company-wide, separate channel. No overlap.
- **04F (Notifications)** — the bell dropdown stays. Dashboard Alerts is a separate, always-visible section for high-priority items (not all events).

---

## What Changes from Current Dashboard

| Current | New |
|---------|-----|
| KPI gauges (Active Jobs, Revenue, AR, Cycle Days) | **Removed** — moves to a future Analytics/Reports page |
| Pipeline bars (Mitigation + Recon stages) | **Removed** — moves to Jobs list page filters |
| Company Event Feed | **Replaced by** Team Chat + Alerts |
| Map (light theme, colored circles, click-to-info) | **Upgraded** — dark mode, custom icons, pulsing, hover cards |
| Priority Task list (inline, derived from jobs) | **Upgraded** — standalone Task Feed with urgency badges, system-generated tasks |
| AttentionBar (amber bar at top) | **Replaced by** dedicated Alerts section |
| No dispatch view | **New** — Dispatch View toggle |
| No time clock | **New** — Time Clock component |
| No team chat | **New** — Team Chat component |

---

## Component Details

### Component 1: Live Job Map

**What exists:** `dashboard-map.tsx` — Google Maps with geocoded pins, colored circles per stage, info windows on click, stage filter dimming. Light warm/earthy theme.

**What changes:**

| Area | Change | Effort |
|------|--------|--------|
| Map style | Switch to dark mode (gray/black background, lighter roads). Light mode option in settings. | Small — Google Maps style JSON swap |
| Job-type icons | Replace colored circles with custom SVG icons: water droplet, flame, mold spore, hammer/wrench. White/gray icon on colored circle background (blue=active, amber=pending, green=complete, red=attention). | Medium — SVG icons + custom AdvancedMarkerElement |
| Pulsing animation | Active jobs (crew on-site) pulse slowly via CSS animation on the marker. | Small — CSS keyframes |
| Hover cards | Hover (desktop) or long-press (mobile) shows quick info card: address, job type, assigned tech, next task, day count. Without full click. | Medium — custom overlay |
| Size differentiation | Your assigned jobs: 48px, bright colors, subtle glow. Others: 32px, 80% opacity, no glow. | Small — conditional marker size |
| "My Jobs" toggle | Top-right toggle: "All Jobs" (default) / "My Jobs Only" (hides others). | Small — filter state |
| Red attention icons | Jobs with overdue tasks or alerts show red circle + slightly larger (40px). | Small — conditional styling |
| Double-click | Navigates directly to Job Detail Page (power user shortcut). | Small |

**Backend:** No changes — existing `GET /v1/jobs` provides all needed data. May need `assigned_to` field on jobs (depends on 04A).

### Component 2: Dispatch View

**What it is:** Toggle in same card as Map. Shows per-tech job list for today + tomorrow's flagged needs. Read-only daily view (scheduling/assignment is Spec 04B).

**What's needed:**

Frontend:
- Toggle button in Map/Dispatch card header
- Per-tech collapsible sections: tech name, job count, job list (address + task)
- "Tomorrow's Needs" section: parsed from job check-in notes containing tomorrow-related keywords
- Mobile: shows only logged-in tech's jobs by default, owner can expand to see all techs

Backend:
- `GET /v1/dashboard/dispatch?date=2026-04-14` — returns jobs grouped by assigned tech for that date
- Requires `job_assignments` or `assigned_to` on jobs (Spec 04A dependency)
- Tomorrow's needs: parse `tech_notes` for keywords ("tomorrow", "need more", "next day") — simple keyword match, not AI

**Hard dependency:** Spec 04A (Team Management) for multi-tech. In single-user mode, Dispatch View shows the owner's own jobs only (still useful).

### Component 3: Task Feed

**What exists:** `usePriorityTasks` hook derives tasks from active jobs. Inline list in dashboard. Tasks are computed client-side from job status.

**What changes:**

Frontend:
- Standalone `<TaskFeed>` component (extract from dashboard-client.tsx)
- Task card format: colored badge (red/amber/green) + task name + address-room + due status + "View Job" link
- Tap navigates to Job Detail Page, auto-scrolls to relevant section (e.g., Moisture Readings tab)
- Mobile: swipe right to mark complete
- Completed tasks show green, auto-archive after 24 hours

Backend — **new `tasks` table:**
```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  assigned_to UUID REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL,          -- 'moisture_reading', 'equipment_check', 'walkthrough', 'manual', 'photo_upload'
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'completed'
  priority TEXT NOT NULL DEFAULT 'normal', -- 'critical', 'warning', 'normal', 'low'
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'manual',  -- 'system', 'manual'
  metadata JSONB DEFAULT '{}',     -- room_name, reading_id, etc.
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

API:
- `GET /v1/tasks?status=pending&assigned_to=me` — list tasks for logged-in tech
- `PATCH /v1/tasks/{id}` — update status (mark complete)
- `POST /v1/tasks` — create manual task

**Auto-generated tasks (system logic):**
- Moisture reading due: last reading > 24 hours ago on active drying job → create task
- Equipment check due: based on deployment date + scheduled interval
- Final walkthrough: job status changes to "complete" → create task
- Manual tasks: tech adds note with "tomorrow" keyword → create task for that tech

**Migration from current:** `usePriorityTasks` currently derives tasks in-memory from job status. New approach stores tasks in DB for persistence, assignment, and completion tracking. Hook becomes a thin fetch wrapper.

### Component 4: Alerts

**What exists:** `AttentionBar` (checks jobs for missing readings/photos, shows amber bar). `notification-dropdown` (bell icon, event feed). Neither matches Brett's spec.

**What changes:**

Frontend:
- Dedicated `<AlertsPanel>` on dashboard (always visible if alerts exist, not a dropdown)
- Sorted by urgency: red first, then amber
- Alert card: colored dot + description + "View Job" + "Mark Resolved" buttons
- "Mark Resolved" dismisses without navigating
- Empty state: green checkmark "No alerts — Everything looks good"
- Full-width bar on desktop, stacked cards on mobile

Backend — **new `alerts` table:**
```sql
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  alert_type TEXT NOT NULL,        -- 'moisture_overdue', 'drying_log_overdue', 'equipment_malfunction', 'supplement_approved', 'supplement_denied', 'equipment_delivery', 'walkthrough_scheduled'
  severity TEXT NOT NULL,          -- 'red', 'amber'
  title TEXT NOT NULL,
  description TEXT,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id),
  auto_dismiss_at TIMESTAMPTZ,    -- amber alerts auto-dismiss after 7 days
  created_at TIMESTAMPTZ DEFAULT now()
);
```

API:
- `GET /v1/alerts?resolved=false` — active alerts for company
- `PATCH /v1/alerts/{id}/resolve` — mark resolved

**Alert triggers (background job or on-event):**
| Trigger | Severity | Title |
|---------|----------|-------|
| Moisture reading > dry threshold for 3+ days | Red | "Moisture reading overdue — {address} ({N} days)" |
| No drying log in 48+ hours | Red | "Drying log overdue — {address}" |
| Equipment malfunction reported | Red | "Equipment malfunction — {address}" |
| Supplement approved by carrier | Amber | "Supplement approved — {address} ({amount})" |
| Supplement denied by carrier | Amber | "Supplement denied — {address}" |
| Equipment delivery scheduled | Amber | "Equipment delivery — {address} ({date})" |
| Final walkthrough scheduled | Amber | "Final walkthrough — {address}" |

**Auto-resolution:** Alert disappears when condition is resolved (e.g., moisture reading taken) OR tech marks as resolved manually. Amber alerts auto-dismiss after 7 days.

**Relationship to notifications:** The bell dropdown (04F) shows all activity. Alerts are a filtered, high-priority subset that lives on the dashboard surface, not buried in a dropdown. They coexist — alerts are louder.

### Component 5: Time Clock (Optional)

**What exists:** Nothing.

**What's needed:**

Frontend:
- `<TimeClock>` component: status indicator (clocked in/out), today's hours, weekly hours, Clock In/Out button, session log
- Single button toggles state — one tap
- Session log shows segments: `8:00 AM - 12:30 PM (4.5 hrs)`, `1:00 PM - now`
- Owner view: see all crew members' time clock data (not just own)
- Mobile: huge button at top of screen, thumb-friendly
- Conditionally rendered based on company setting `time_clock_enabled`

Backend — **new `time_entries` table:**
```sql
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  user_id UUID NOT NULL REFERENCES users(id),
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,          -- NULL means currently clocked in
  latitude_in DECIMAL(10,8),
  longitude_in DECIMAL(11,8),
  latitude_out DECIMAL(10,8),
  longitude_out DECIMAL(11,8),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Settings addition:
```sql
ALTER TABLE companies ADD COLUMN time_clock_enabled BOOLEAN DEFAULT true;
```

API:
- `POST /v1/time-clock/clock-in` — creates entry with current timestamp + GPS coords
- `POST /v1/time-clock/clock-out` — sets clock_out on open entry + GPS coords
- `GET /v1/time-clock/status` — current clock state + today's hours + weekly hours
- `GET /v1/time-clock/entries?user_id=X&week_of=2026-04-14` — session log (owner can query any user)

**GPS:** Captured passively via browser Geolocation API. NOT shown to tech — available for owner/admin for job costing and audit. Permission requested once, captured silently on each clock event.

**Weekly calculation:** Monday–Sunday, resets Monday morning. Running total throughout the week.

### Component 6: Team Chat

**What exists:** Nothing. No WebSocket/real-time infrastructure.

**What's needed:**

Frontend:
- `<TeamChat>` component: message list + input box + send button
- Flat feed (not threaded), newest at bottom, auto-scroll on new message
- Message format: sender name + timestamp + message text
- Plain text only in V1 (no attachments, no formatting)
- Sticky input field at bottom (doesn't scroll away)
- Badge count on Dashboard tab for unread messages
- Mobile: push notification opt-in for new messages

Backend — **new `team_messages` table:**
```sql
CREATE TABLE team_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  user_id UUID NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Track last-read per user
ALTER TABLE company_members ADD COLUMN chat_last_read_at TIMESTAMPTZ;
```

API:
- `GET /v1/team-chat?limit=50&before={cursor}` — paginated messages, newest last
- `POST /v1/team-chat` — send message
- `POST /v1/team-chat/mark-read` — update `chat_last_read_at`
- `GET /v1/team-chat/unread-count` — count messages since `chat_last_read_at`

**Real-time:** Start with polling every 5 seconds. Supabase Realtime subscription on `team_messages` table is the upgrade path but not required for V1 launch. Polling is simpler and adequate for crew sizes of 3-10.

**Visibility:** Internal crew only. NOT visible to homeowners, adjusters, or PA portal users. This is casual crew coordination, not formal job documentation.

---

## Layout

### Desktop (3-column grid)
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
│                  │                 │                    │
└──────────────────┴─────────────────┴────────────────────┘
```

- Map takes ~50% width, right column splits Time Clock / Tasks and Alerts / Chat
- If Time Clock disabled, map expands to fill

### Mobile (stacked vertical)
1. Time Clock (if enabled) — always at top
2. Alerts (if any)
3. Map/Dispatch toggle
4. Tasks
5. Team Chat

---

## Phases & Checklist

### Phase 1: Map Upgrade — ❌
Dark mode, custom icons, pulsing, hover cards. No backend changes.
- [ ] Dark mode map style JSON (Google Maps styling)
- [ ] Custom SVG icons: water droplet, flame, mold spore, hammer/wrench
- [ ] Icon rendering with colored circle background via AdvancedMarkerElement
- [ ] Size differentiation (48px assigned vs 32px others — uses hardcoded user ID until 04A)
- [ ] Pulsing CSS animation for active jobs (status = 'mitigation' or 'drying')
- [ ] Hover card overlay (address, type, assigned tech, next task, day count)
- [ ] "All Jobs" / "My Jobs Only" toggle
- [ ] Red attention styling for jobs with overdue conditions
- [ ] Double-click → navigate to Job Detail Page
- [ ] Light mode option in user settings

### Phase 2: Task Feed + Backend — ❌
New `tasks` table, API, standalone component. Replaces inline priority task list.
- [ ] `tasks` table migration
- [ ] `GET /v1/tasks`, `PATCH /v1/tasks/{id}`, `POST /v1/tasks` endpoints
- [ ] Auto-task generation logic (moisture reading due, equipment check, walkthrough)
- [ ] `<TaskFeed>` component with urgency badges (red/amber/green)
- [ ] Task card format: badge + title + address-room + due status
- [ ] Tap task → navigate to job, auto-scroll to relevant section
- [ ] Completed tasks: green badge, auto-archive after 24 hours
- [ ] Mobile: swipe right to mark complete
- [ ] Empty state: "All caught up! No tasks due right now"
- [ ] pytest: task CRUD, auto-generation logic, completion

### Phase 3: Alerts + Backend — ❌
New `alerts` table, API, dedicated alerts panel. Replaces AttentionBar.
- [ ] `alerts` table migration
- [ ] `GET /v1/alerts`, `PATCH /v1/alerts/{id}/resolve` endpoints
- [ ] Alert trigger logic (moisture overdue, drying log overdue, equipment malfunction)
- [ ] `<AlertsPanel>` component: sorted by severity, red first
- [ ] Alert card: colored dot + title + "View Job" + "Mark Resolved"
- [ ] Auto-dismiss logic: amber alerts expire after 7 days
- [ ] Auto-resolve: alert cleared when condition is fixed (reading taken, etc.)
- [ ] Empty state: green checkmark "No alerts — Everything looks good"
- [ ] Remove old `AttentionBar` component
- [ ] pytest: alert creation, resolution, auto-dismiss, trigger conditions

### Phase 4: Time Clock + Backend — ❌
New `time_entries` table, API, optional component. Requires company settings.
- [ ] `time_entries` table migration
- [ ] `time_clock_enabled` column on companies table
- [ ] Clock in/out API endpoints with GPS capture
- [ ] Status endpoint (current state + today's hours + weekly hours)
- [ ] `<TimeClock>` component: status, hours, session log, big button
- [ ] Weekly hours calculation (Monday–Sunday reset)
- [ ] Session log display: `8:00 AM - 12:30 PM (4.5 hrs)`
- [ ] Owner view: see all crew members' time data (after 04A)
- [ ] Settings toggle in Company Settings page
- [ ] Conditional rendering based on `time_clock_enabled`
- [ ] Mobile: huge button at top, thumb-friendly
- [ ] GPS capture via browser Geolocation API (silent after first permission)
- [ ] pytest: clock in/out, hours calculation, weekly reset, settings toggle

### Phase 5: Team Chat + Backend — ❌
New `team_messages` table, API, chat component with polling.
- [ ] `team_messages` table migration
- [ ] `chat_last_read_at` column on company_members (needs 04A)
- [ ] Chat API: send, list (paginated), mark-read, unread-count
- [ ] `<TeamChat>` component: message list + input + send
- [ ] Auto-scroll on new message
- [ ] Polling every 5 seconds for new messages
- [ ] Unread badge count on Dashboard tab
- [ ] Sticky input field at bottom
- [ ] Empty state: "No messages yet — Start the conversation!"
- [ ] pytest: send message, list messages, pagination, unread count

### Phase 6: Dispatch View + Layout Overhaul — ❌
Map/Dispatch toggle, new dashboard layout, mobile responsive. Ties it all together.
- [ ] Map ↔ Dispatch toggle button in card header
- [ ] `GET /v1/dashboard/dispatch` endpoint (jobs grouped by tech for today)
- [ ] `<DispatchView>` component: per-tech collapsible sections
- [ ] Tomorrow's Needs: parse tech notes for tomorrow-related keywords
- [ ] New dashboard layout: 3-column desktop grid per wireframe
- [ ] Mobile stacked layout: Time Clock → Alerts → Map/Dispatch → Tasks → Chat
- [ ] Responsive breakpoints: mobile (<768px) stacked, desktop (>=768px) grid
- [ ] Remove old dashboard components (KPI gauges, pipeline bars, event feed)
- [ ] Move KPI/pipeline content to Jobs list page or future Analytics page
- [ ] Verify all 6 components work together
- [ ] Cross-browser QA (desktop + mobile)

## Technical Approach

**Map upgrade (Phase 1):** Replace the Google Maps style JSON in `dashboard-map.tsx` with a dark theme. Replace `google.maps.Marker` with `AdvancedMarkerElement` for custom HTML content (SVG icons in colored circles). Add CSS `@keyframes pulse` for active jobs. Hover card is a positioned `div` overlay managed by React state, not a Google Maps InfoWindow.

**Tasks & Alerts (Phase 2-3):** New Supabase tables with RLS policies scoped to `company_id`. Background task generation runs as a periodic check (cron or on-event hook when readings/status change). Frontend uses TanStack Query with appropriate polling intervals.

**Time Clock (Phase 4):** Browser `navigator.geolocation.getCurrentPosition()` on clock events. GPS coordinates stored but not displayed to tech. Weekly hours computed server-side from `time_entries` — sum of `(clock_out - clock_in)` per user per week.

**Team Chat (Phase 5):** Start with 5-second polling via TanStack Query `refetchInterval`. This is adequate for crews of 3-10 people. Upgrade path: Supabase Realtime `postgres_changes` subscription on `team_messages` table — swap polling for subscription with no API changes.

**Layout (Phase 6):** CSS Grid layout with `grid-template-columns: 1fr 320px 320px` on desktop, single column on mobile. Each component is a self-contained card. Conditional rendering of Time Clock based on company setting.

**Key Files:**
- `web/src/app/(protected)/dashboard/dashboard-client.tsx` — full rewrite (current → new layout)
- `web/src/components/dashboard-map.tsx` — upgrade (dark mode, icons, hover, pulse)
- `web/src/components/task-feed.tsx` — new
- `web/src/components/alerts-panel.tsx` — new
- `web/src/components/time-clock.tsx` — new
- `web/src/components/team-chat.tsx` — new
- `web/src/components/dispatch-view.tsx` — new
- `web/src/lib/hooks/use-tasks.ts` — new
- `web/src/lib/hooks/use-alerts.ts` — new
- `web/src/lib/hooks/use-time-clock.ts` — new
- `web/src/lib/hooks/use-team-chat.ts` — new
- `backend/api/tasks/` — new module
- `backend/api/alerts/` — new module
- `backend/api/time_clock/` — new module
- `backend/api/team_chat/` — new module

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
git checkout lm-dev
# Continue at: Phase 1, step 1 (dark mode map style)
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Source document:** Brett's "Crewmatic Dashboard — Product Specification v1.0" (April 13, 2026), filed at `/Users/lakshman/Downloads/Crewmatic Dashboard Summary.docx.pdf`
- **Dashboard is a replacement, not addition.** Current KPI gauges + pipeline bars move elsewhere. Brett's spec is operations-focused, not analytics-focused.
- **Phase ordering rationale:** Phases 1-3 (Map, Tasks, Alerts) can start immediately — they build on existing code and don't require team management. Phases 4-6 (Time Clock, Chat, Dispatch) need `company_members` table from Spec 04A.
- **Team Chat vs Board (04D):** Team Chat is company-wide casual crew coordination. Board (04D) is per-job formal documentation visible to external parties. They are separate systems.
- **Dispatch View vs Scheduling (04B):** Dispatch View is read-only "today's assignments." Scheduling (04B) is the tool to create/edit assignments. Dispatch reads from whatever 04B writes.
- **Real-time strategy:** Polling first (5s chat, 30s alerts, 60s tasks, 2min map). Supabase Realtime is the upgrade path but not V1 blocker. Polling is simpler and adequate for crew sizes of 3-10.
- **No push notifications in V1.** Badge counts and polling are the notification mechanism. Push notifications are a future enhancement.
