# Autonomous Job Agent — AI Chief of Staff for Contractors

## Status
| Field | Value |
|-------|-------|
| **Progress** | 0% (0/4 phases) |
| **State** | Not Started |
| **Blocker** | **Hard prerequisites:** (1) Wizard of Oz validation (Phase 0), (2) Spec 02A deployed (Celery + Redis infrastructure + line items), (3) Spec 04C deployed (equipment tracking data), (4) Spec 04F deployed (notification center). Phase 1 cannot start until all four are met. |
| **Branch** | TBD |
| **Issue** | TBD |
| **Design Doc** | `~/.gstack/projects/lmwharton-restor-os/lakshman-lm-dev-design-20260407-214429.md` |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-07 |
| Started | -- |
| Completed | -- |
| Sessions | 0 |
| Total Time | -- |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] Event bus receives job lifecycle events (photo upload, reading logged, status change, equipment log) via Supabase webhooks + scheduled worker (15 min)
- [ ] Agent context builder assembles full job state (photos, readings, equipment, timeline, line items, adjuster history)
- [ ] Agent reasoning engine (Claude Haiku triage + Sonnet escalation) evaluates job state using structured tool calls against domain knowledge base
- [ ] Confidence + stakes filter: push only when confidence >70% AND impact >$100 OR compliance risk
- [ ] Push notification with actionable proposals: "do it" / "skip" / "not now"
- [ ] Action executor performs approved actions (add line items, flag equipment, generate follow-up, create compliance entry)
- [ ] Daily digest for below-threshold items
- [ ] Feedback capture: action rate, false positive rate, snooze patterns
- [ ] Trust graduation: per-check-type scoring, auto-graduation prompt at threshold (90%/20+ high-freq, 95%/10+ low-freq)
- [ ] Daily per-tenant cost cap ($5/day) with rule-based fallback
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Contractors managing 5-15 concurrent jobs can't keep track of everything. Equipment stays on-site too long (eating rental costs), moisture readings go unlogged (giving adjusters denial ammunition), follow-ups don't get sent (delaying payment by weeks), and line items get missed (leaving revenue on the table). A 3-5 person shop has no project coordinator, collections person, or compliance officer. The owner IS all of those roles.

**Solution:** An always-on autonomous agent that has full context of every active job, watches for changes, reasons about what needs to happen next, and proactively tells the contractor what to do. Starts human-in-the-loop ("should I do this?") and graduates to autonomous ("I did this") as trust builds. Domain knowledge (S500, equipment economics, adjuster psychology) is embedded in the agent, not configurable by the user.

**Scope:**
- IN: Event bus (Supabase webhooks + scheduled worker), agent context builder, LLM reasoning engine (Haiku triage + Sonnet escalation), structured tool calls for domain knowledge, confidence/stakes filter, push notifications with actionable proposals, action executor, feedback capture, trust graduation, daily digest, cost cap
- OUT: Multi-vertical support (future), autonomous outbound email/text to adjusters (future), configurable rules builder (never -- domain knowledge IS the product), dashboard redesign
- NOTE: This spec depends on the AI pipeline (Spec 02A) for shared domain knowledge (S500, Xactimate codes) and the notification center (Spec 04F) for delivery. The agent is a layer on top of existing job data, not a separate product.

**Demand status:** Thesis-stage. Premise #1 (contractors want proactive AI) is unvalidated. Phase 0 (Wizard of Oz) must validate before engineering begins.

## Architecture

```
                    EVENT BUS
                       |
    [Photo uploaded] [Reading logged] [Status changed] [Timer tick]
                       |
                 AGENT CONTEXT BUILDER
                 (assembles full job state)
                       |
                 AGENT REASONING ENGINE
                 (LLM with domain knowledge tools:
                  S500 standards, equipment rental rates,
                  adjuster denial patterns, Xactimate checklists)
                       |
              CONFIDENCE + STAKES FILTER
              (>70% confidence AND >$100 impact
               OR compliance risk)
                       |
         HUMAN-IN-THE-LOOP GATE ──────── Daily Digest
         (push: do it / skip / not now)    (below threshold)
                       |
              ACTION EXECUTOR
              (updates job, sends follow-up,
               generates line items, flags compliance)
                       |
              TRUST GRADUATION
              (per-check-type scoring →
               auto-graduation prompt)
```

### Infrastructure Dependency
**Shared with Spec 02A (AI Pipeline):** The agent uses the same Celery + Redis broker infrastructure as PhotoScope and other AI features. Agent sweep = Celery Beat periodic task. Agent LLM calls = Celery tasks. One worker pool, not separate worker processes. Redis broker via Upstash Redis (see TODOS.md architecture note).

### Event Bus

Supabase database webhooks fire to `POST /v1/agent/event` when relevant tables change:
- `photos` — new photo uploaded
- `moisture_readings` — new reading logged
- `equipment_logs` — equipment added/removed
- `jobs` — status changed

**Webhook authentication:** Validate `x-webhook-secret` header against `AGENT_WEBHOOK_SECRET` env var. Reject with 401 if missing/invalid.

**Event deduplication:** Hash `(table, row_id, operation, timestamp)` and check against recent events (last 5 minutes) before processing. Prevents duplicate proposals from at-least-once webhook delivery.

**Concurrency:** Acquire per-job advisory lock before running reasoning engine. Prevents duplicate proposals when two events for the same job arrive simultaneously.

Scheduled worker (Celery Beat, every 15 min) handles time-based triggers:
- Equipment on-site duration exceeds expected drying time for damage class
- Moisture readings gap exceeds 24 hours on active job
- Adjuster follow-up window exceeded (7 days post-submission)
- Job stale (no activity in 48 hours on active job)

### Agent Context Builder

For each triggered job, assembles:
- All photos + AI scope results (from PhotoScope)
- All moisture readings + trend direction (improving/stagnating/worsening)
- Equipment on-site + duration + rental rates per unit
- Timeline + expected milestones per S500 for damage class/category
- Adjuster communication history + days since last contact
- Line items captured vs. expected for this damage type/class
- Job metadata (address, rooms, damage category, water class)

### Agent Reasoning Engine

Two-tier model selection:
- **Claude Haiku** ($0.02/call): High-frequency event triage. Most events result in "nothing to report." Quick assessment: does this event change the risk profile of the job?
- **Claude Sonnet** ($0.15/call): Complex reasoning on flagged jobs. Full analysis with domain knowledge tool calls. Generates actionable proposal with confidence score and financial impact estimate.

Domain knowledge delivered via structured tool calls (not monolithic system prompt):
- `query_s500_standards(damage_class, water_category)` — drying timelines, equipment requirements, documentation standards
- `query_equipment_rates(equipment_type)` — rental rates, expected duration by damage class
- `query_adjuster_patterns(carrier, claim_type)` — common denial triggers, required documentation
- `query_xactimate_completeness(damage_type, rooms, existing_line_items)` — missing line items for this damage profile

Each tool is independently testable and maintainable.

**Domain knowledge data source:** Database tables (not hardcoded Python modules). Four new tables: `s500_standards`, `equipment_rates`, `adjuster_patterns`, `xactimate_checklists`. Admin UI to update rates and standards. Seeded with initial data from `docs/research/` during migration.

**Context builder performance:** Batch queries per table across all active jobs for a company (not per-job queries). E.g., one query gets all readings for all active jobs, then groups in Python. Prevents N+1 at scale.

### Test Strategy
- **Unit tests:** Each domain knowledge tool tested independently with real DB data
- **Mock LLM tests:** Reasoning engine tested with recorded Anthropic SDK fixtures (deterministic)
- **Integration tests:** Full pipeline with mock LLM + real Supabase tables
- **E2E tests:** Notification → deep-link → job detail → approve flow (Phase 2)
- **Eval suite (manual):** LLM quality with golden examples, not in CI

### Confidence + Stakes Filter

Agent outputs per proposal:
- `confidence`: 0-100% (how certain is the agent this is a real issue?)
- `financial_impact`: estimated $ at risk
- `risk_type`: `revenue` | `compliance` | `efficiency`
- `proposed_action`: what the agent recommends doing

Push threshold: `confidence > 70% AND (financial_impact > $100 OR risk_type == 'compliance')`
Below threshold: accumulate in daily digest (sent at 7 AM local time, timezone from `companies.timezone`, fallback UTC-5)

### Notification Lifecycle
Agent creates the proposal first, then calls the notification center API to create a linked notification with `entity_type: 'agent_proposal', entity_id: proposal.id`. The notification center handles delivery. Notification tap deep-links to the job detail page, scrolled to the proposals section. On iOS, single "Approve" action in notification long-press menu (not 3 buttons, which isn't practical with gloves).

### Cost Cap Fallback Rules
When daily per-tenant cost cap ($5/day) is exceeded, fall back to rule-based checks (no LLM):
- Equipment on-site > expected_duration for damage class (simple date math)
- No moisture reading logged in 24h (simple query)
- No adjuster contact in 7 days post-submission (simple query)
- Job inactive for 48h while status is active (simple query)
Log to agent_events with `model_used: 'rules'`. Do not notify the contractor about the downgrade.

### Trust Graduation

Per-check-type trust scoring:
- Track: proposals sent, "do it" count, "skip" count, "not relevant" count
- High-frequency checks (equipment, readings): graduate at >90% approval over 20+ proposals
- Low-frequency checks (compliance, adjuster): graduate at >95% approval over 10+ proposals
- When threshold met: "I've been right about [check type] [N] out of [M] times. Want me to handle these automatically?"
- Contractor can revoke autonomy at any time

## Database Schema Updates

```sql
-- Agent proposals (what the agent suggests)
CREATE TABLE agent_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id),
    company_id UUID NOT NULL REFERENCES companies(id),
    check_type TEXT NOT NULL, -- 'equipment_overdue', 'readings_missing', 'adjuster_stale', 'scope_incomplete', 'compliance_gap'
    confidence NUMERIC(5,2) NOT NULL, -- 0-100
    financial_impact NUMERIC(10,2), -- estimated $ at risk
    risk_type TEXT NOT NULL, -- 'revenue', 'compliance', 'efficiency'
    title TEXT NOT NULL, -- human-readable summary
    detail JSONB NOT NULL, -- full reasoning, evidence, proposed action
    proposed_action JSONB NOT NULL, -- structured action the executor can perform
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'skipped', 'snoozed', 'auto_executed', 'expired'
    notification_id UUID REFERENCES notifications(id),
    snoozed_until TIMESTAMPTZ, -- when snoozed, resurfaces in next digest; expires after 48h
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- JSONB Schema: detail
-- {
--   "reasoning": "string (2-3 sentence explanation)",
--   "evidence": [{"type": "reading|photo|timeline|equipment", "id": "uuid", "summary": "string"}],
--   "financial_breakdown": {"amount": 510, "unit": "per_day|total", "basis": "2 dehus x $85/day x 3 days overdue"}
-- }

-- JSONB Schema: proposed_action (typed by action_type)
-- action_type: "add_line_items" | "flag_equipment" | "create_followup" | "add_compliance_note" | "update_job_status"
-- {
--   "action_type": "add_line_items",
--   "payload": {"items": [{"code": "WTR BSBD", "description": "Baseboard removal", "quantity": 1, "unit": "LF", "room_id": "uuid"}]}
-- }
-- {
--   "action_type": "flag_equipment",
--   "payload": {"equipment_ids": ["uuid"], "action": "schedule_pickup", "reason": "drying complete per readings"}
-- }
-- {
--   "action_type": "create_followup",
--   "payload": {"recipient": "adjuster", "subject": "Scope follow-up", "draft_message": "string"}
-- }
-- {
--   "action_type": "add_compliance_note",
--   "payload": {"note_type": "moisture_gap|containment|documentation", "description": "string", "room_id": "uuid"}
-- }

-- Trust scores per check type per company
CREATE TABLE agent_trust_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    check_type TEXT NOT NULL,
    proposals_count INTEGER NOT NULL DEFAULT 0,
    approved_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    irrelevant_count INTEGER NOT NULL DEFAULT 0,
    is_autonomous BOOLEAN NOT NULL DEFAULT false,
    autonomous_since TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(company_id, check_type)
);

-- Agent event log (for debugging and cost tracking)
CREATE TABLE agent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id),
    company_id UUID NOT NULL REFERENCES companies(id),
    trigger_type TEXT NOT NULL, -- 'webhook', 'scheduled', 'manual'
    trigger_source TEXT NOT NULL, -- 'photos', 'readings', 'equipment', 'timer'
    model_used TEXT, -- 'haiku', 'sonnet', null if no LLM call
    tokens_used INTEGER,
    estimated_cost NUMERIC(8,4),
    result TEXT NOT NULL, -- 'no_action', 'proposal_created', 'auto_executed', 'error'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS policies (standard company_id isolation)
ALTER TABLE agent_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_trust_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_proposals_company ON agent_proposals
    USING (company_id = (current_setting('app.company_id'))::uuid);
CREATE POLICY agent_trust_scores_company ON agent_trust_scores
    USING (company_id = (current_setting('app.company_id'))::uuid);
CREATE POLICY agent_events_company ON agent_events
    USING (company_id = (current_setting('app.company_id'))::uuid);
```

## API Endpoints

### Agent Core
| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/agent/event` | Webhook receiver for Supabase events (internal) |
| GET | `/v1/agent/proposals` | List proposals for company (filterable by job, status, check_type) |
| PATCH | `/v1/agent/proposals/{id}` | Respond to proposal: `{status: 'approved' | 'skipped' | 'snoozed'}` |
| GET | `/v1/agent/trust-scores` | Trust scores per check type for company |
| PATCH | `/v1/agent/trust-scores/{check_type}` | Toggle autonomous mode: `{is_autonomous: true | false}` |
| GET | `/v1/agent/digest` | Get daily digest (below-threshold items) |
| GET | `/v1/agent/stats` | Agent performance stats (action rate, false positive rate, cost) |

### Agent Admin (internal)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/agent/sweep` | Trigger manual sweep of all active jobs (admin/debug) |
| GET | `/v1/agent/cost` | Cost tracking per tenant (daily/monthly) |

## LLM Cost Model

| Scenario | Jobs | Events/job/day | Haiku triage | Sonnet reasoning | Daily cost | Monthly cost |
|----------|------|----------------|--------------|------------------|------------|--------------|
| Small shop (3-5 people) | 10 | 5 | 50 x $0.02 = $1.00 | ~5 x $0.15 = $0.75 | $1.75 | ~$53 |
| Mid shop (6-10 people) | 25 | 5 | 125 x $0.02 = $2.50 | ~12 x $0.15 = $1.80 | $4.30 | ~$129 |
| Large shop (11-15 people) | 50 | 5 | 250 x $0.02 = $5.00 | ~25 x $0.15 = $3.75 | $8.75 | ~$263 |

**Optimization:** 10% escalation rate from Haiku to Sonnet reduces small shop to ~$35/month (23% of $149 pricing). Early calibration may run 30-40%. Safeguard: daily per-tenant cost cap ($5/day) falls back to rule-based checks when exceeded.

**Break-even:** One prevented equipment overstay ($200+) or one caught line item ($50-500) per month justifies the cost.

## Phases & Checklist

### Phase 0: Wizard of Oz Validation -- Not Started
**Goal:** Validate premise #1 before any engineering investment.

- [ ] For 5 business days, manually review 5 active jobs each morning
- [ ] Identify 1-3 high-stakes insights per day using domain knowledge
- [ ] Push insights via existing notification center (Spec 04F)
- [ ] Track: did Brett act on them? Which types? Did any save real money?
- [ ] **Gate:** If 3/5 days produce at least one actionable insight Brett acts on, proceed to Phase 1. If not, re-evaluate the thesis.

### Phase 1: Agent Foundation (Backend) -- Not Started
**Goal:** Event bus + context builder + LLM reasoning for 3-5 check types.

- [ ] Database migration: `agent_proposals`, `agent_trust_scores`, `agent_events` tables
- [ ] `POST /v1/agent/event` — webhook receiver with event type routing
- [ ] Scheduled worker (every 15 min) for time-based triggers
- [ ] Agent context builder: assemble full job state from existing tables
- [ ] Domain knowledge tools: `query_s500_standards`, `query_equipment_rates`, `query_adjuster_patterns`, `query_xactimate_completeness`
- [ ] Agent reasoning engine: Haiku triage → Sonnet escalation pipeline
- [ ] Confidence + stakes filter with push threshold
- [ ] `GET /v1/agent/proposals` — list proposals
- [ ] `PATCH /v1/agent/proposals/{id}` — respond to proposal (approved/skipped/snoozed)
- [ ] Push notification integration with existing notification center
- [ ] Agent event logging for cost tracking
- [ ] Daily per-tenant cost cap ($5/day) with rule-based fallback
- [ ] pytest coverage for all endpoints and agent logic

### Phase 2: Frontend + Digest -- Not Started
**Goal:** Agent proposals embedded in job detail + daily digest + feedback UX.

**Information Architecture:**
- Agent proposals are NOT a separate screen. They appear as a priority section at the TOP of the job detail page, above the existing tabs (Photos, Readings, Report, Timeline, Floor Plan).
- Surface ownership: Push notifications only alert and deep-link to the job. The job detail page is where actions happen. Trust/autonomy settings live in Company Settings. Audit log is history-only.
- No separate "Agent Dashboard." Monthly stats (money saved, catches, accuracy) appear on the Dashboard page as a summary card, only after 10+ proposals.

**Proposal Row Anatomy (dense queue, not cards):**
```
┌─────────────────────────────────────────────────────────────┐
│ [!] Agent: 2 items need attention                           │
├─────────────────────────────────────────────────────────────┤
│ EQUIPMENT  Equipment overdue (3 days)    $510   [Schedule ▸]│
│            123 Oak St                     88%               │
├─────────────────────────────────────────────────────────────┤
│ COMPLIANCE Readings missing (36h gap)   Denial  [Log Now ▸] │
│            456 Maple Dr                   95%               │
└─────────────────────────────────────────────────────────────┘
```
- Row layout, NOT cards. One row per proposal. Dense, scannable.
- Visual hierarchy: (1) risk type badge (colored pill), (2) title (15px semibold #1a1a1a), (3) financial impact or risk label, (4) primary action button
- Risk type colors from DESIGN.md: Equipment = warning amber (#d97706/#fffbeb), Compliance = error red (#dc2626/#fef2f2), Revenue = success green (#2a9d5c/#edf7f0), Adjuster = info indigo (#5b6abf/#eef0fc)
- Action button: Primary style (bg-[#e85d26], 48px height). Contextual label ("Schedule Pickup", "Log Readings", "Add to Scope"). NOT generic "Do it".
- Expand row to see: detail text, evidence, "Skip" and "Later" ghost buttons
- All touch targets 48px minimum (contractors wear gloves, per DESIGN.md)

**Proposal Card State Machine:**
```
pending -> (tap action) -> loading -> success | error
pending -> (tap Skip) -> skipped (collapses, moves to resolved)
pending -> (tap Later) -> snoozed (disappears, resurfaces in next daily digest)
snoozed -> (digest time) -> pending again (or expires after 48h)
auto_executed -> (shown in resolved section with undo window)
```
- Loading: action button shows spinner, all buttons disabled, 48px height maintained
- Success: row collapses to single line with green check + confirmation text for 5 seconds, then moves to "Resolved" section below
- Error: inline red banner with retry button per DESIGN.md error pattern
- Auto-executed (after trust graduation): shown in "Recent Actions" section with 15-minute undo window

**Daily Digest (7 AM local):**
- Suppress push when 0 items. For 1-3 items, single grouped notification. For 4+ items, summary notification ("4 low-priority items across 3 jobs").
- Digest screen accessible from notification center, shows below-threshold items grouped by job
- Items in digest can be acted on or dismissed

**Daily Push Cap:** Max 3 proposal pushes per day (excluding compliance/safety which always push). Beyond cap, batch into next digest. Configurable in Company Settings (1 / 3 / 5 / unlimited).

**Stats (Dashboard page, not a separate screen):**
- Only show after 10+ proposals (before that: "Getting to know your workflow, 3 suggestions so far")
- Three numbers: Money saved, Catches, Accuracy. No LLM cost display to contractors.
- Monthly summary card on the main dashboard page

Checklist:
- [ ] Agent proposals section at top of job detail page (above tabs)
- [ ] Proposal row component with dense layout, risk type badge, action button
- [ ] Proposal state machine: loading, success, error, snoozed states
- [ ] Expanded row with detail, evidence, Skip/Later buttons
- [ ] "Resolved" section below active proposals (collapsible)
- [ ] Daily digest view accessible from notification center
- [ ] Daily push cap (3/day, configurable in settings)
- [ ] Monthly stats summary card on Dashboard (after 10+ proposals)
- [ ] Notification deep-link: tap notification -> opens job detail at proposals section
- [ ] Empty state: "Crewmatic AI is watching N active jobs. You'll get a heads-up when something needs attention."
- [ ] Cold start (first 48h): observation-only mode, single informational card

### Phase 3: Trust Graduation -- Not Started
**Goal:** Per-check-type autonomy with user control.

**Trust Graduation UX:**
- Bottom sheet modal (not a card or banner). Requires explicit "Enable Auto-handle" tap.
- Shows track record visually: "Equipment checks: 18/20 approved" with progress bar
- Copy uses utility language: "Enable auto-handle for equipment overstay checks? 23 approved, 1 skipped in 30 days."
- Appears only once per check type. If dismissed, won't ask again for 30 days.
- After acceptance: persistent badge in Company Settings > Agent Permissions
- Revoke: dedicated "Agent Permissions" screen in Company Settings with toggle per check type

**Auto-executed Actions UX:**
- Quiet confirmation: appears in "Recent Actions" section on job detail page
- Green "Auto-handled" badge + 15-minute undo button
- Daily digest includes summary line: "AI auto-handled 3 items today"
- No individual push notification per auto-action

Checklist:
- [ ] Trust scoring calculation (per check type, per company)
- [ ] Bottom sheet graduation prompt with track record visualization
- [ ] `PATCH /v1/agent/trust-scores/{check_type}` — toggle autonomous mode
- [ ] Action executor for autonomous actions (add line items, flag equipment, create compliance entry)
- [ ] "Recent Actions" section on job detail for auto-executed items with undo
- [ ] Agent Permissions screen in Company Settings (toggle per check type)
- [ ] Cross-job intelligence: patterns across all active jobs for the company

### Phase 4: Expansion + Optimization -- Not Started
**Goal:** Full job lifecycle coverage + cost optimization.

- [ ] Additional check types: payment tracking, supplement detection, warranty tracking
- [ ] Model fine-tuning or prompt optimization based on Phase 1-2 feedback data
- [ ] Escalation rate optimization (target: <10% Haiku → Sonnet)
- [ ] Batch reasoning for scheduled sweeps (multiple jobs in one LLM call)
- [ ] Push notification infrastructure for mobile (web push + future iOS)

## Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| Action rate | >50% | approved / (approved + skipped + irrelevant) |
| False positive rate | <20% | irrelevant / total proposals |
| Revenue impact | >$100/week saved | contractor-reported or calculated from caught issues |
| Time saved | 30% → 15% of day on oversight | contractor survey |
| Trust graduation | 1+ check type autonomous in 60 days | trust_scores table |
| Notification retention | Brett keeps notifs on after 30 days | observed |
| LLM cost | <$5/day per small shop | agent_events cost tracking |

## Data Dependency Table

Every data point the agent needs, which spec provides it, and whether it exists today.

| Data Point | Required By | Provider Spec | Exists Today? |
|------------|-------------|---------------|---------------|
| Job record (address, status, dates) | Context builder | Spec 01 (Jobs) | YES |
| Photos + AI scope results | Photo analysis check | Spec 02A (PhotoScope) | NO (spec drafted) |
| Moisture readings + trends | Readings gap check | Spec 01 (exists as readings tab) | YES |
| Equipment on-site + duration | Equipment overdue check | Spec 04C (Equipment) | NO (spec drafted) |
| Line items (Xactimate codes) | Scope completeness check | Spec 02A (PhotoScope) | NO (spec drafted) |
| Adjuster communication history | Follow-up check | Not yet specced | NO |
| Company timezone | Daily digest timing | Schema planned, not implemented | NO |
| Notification center API | Proposal delivery | Spec 04F (Notifications) | YES (event_history-based) |
| Celery + Redis infrastructure | Background workers | Spec 02A (shared infra) | NO |
| Rooms + floor plan data | Room-level context | Spec 01C (Floor Plans) | YES |

**Phase 1 minimum data:** Jobs (YES), Moisture readings (YES), Rooms (YES), Notifications (YES). Equipment and line items can be added as those specs ship. The agent starts with the data that exists and gains intelligence as more data becomes available.

**Rules-only fallback path:** If the Wizard of Oz test shows that simple rules catch 80%+ of value, Phase 1 can ship rules-only (the 4 deterministic checks from the Cost Cap Fallback section). The LLM architecture remains in the spec for Phase 2 when validated. This is not a scope cut; it's a validated decision gate.

## RLS Note

The current backend uses JWT-scoped Supabase clients for tenant isolation, not `current_setting('app.company_id')`. The RLS policies in the schema section above need to match the actual access pattern: either use Supabase's built-in `auth.uid()` with a join to companies, or use service-role client with explicit `company_id` filtering in the API layer (current pattern). Resolve during implementation based on the pattern established by Spec 02A.

## Relationship to Other Specs

- **Spec 02A (PhotoScope):** Agent reuses PhotoScope's domain knowledge (S500, Xactimate codes) and scope results. PhotoScope provides the data, the agent reasons about what's missing.
- **Spec 02C (Job Audit):** Job Audit is a one-time manual trigger ("audit this job before submission"). The autonomous agent is always-on. They complement each other: the agent catches issues early, the audit does a final review.
- **Spec 02E (AI Feedback):** Agent proposals use the same feedback pattern (thumbs up/down). Shared feedback infrastructure.
- **Spec 04F (Notifications):** Agent delivers proposals via the notification center. Push notification infrastructure is a dependency.
- **Spec 04C (Equipment/Drying):** Equipment tracking data feeds the agent's "equipment overdue" check. The richer the equipment data, the smarter the agent.

---

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1 (Agent Foundation — backend context builder + trust scoring)
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

---

## Decisions & Notes

Key decisions with rationale. Append-only as implementation progresses.
