# HazmatCheck — Asbestos + Lead Paint Risk Detection

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/3 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 02A Phase 1 (shared AI service layer + Celery/Redis) |
| **Branch** | TBD |
| **Issue** | TBD |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-07 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] "Check for Hazards" via `POST /v1/hazmat/check` — scans photos for asbestos + lead paint risk
- [ ] Per-finding output: material name, location, risk level, description, next steps
- [ ] Findings can be added to PDF report
- [ ] Lead paint risk uses property year_built (pre-1978 = risk)
- [ ] Mandatory disclaimer on all results
- [ ] Results appear under [Hazards] tab in Photos tab workspace (shared with PhotoScope)
- [ ] Photo strip filter works for hazmat findings (tap photo → see its hazards)
- [ ] Thinking stream narrates hazmat analysis per photo
- [ ] SSE + Celery: same architecture as PhotoScope
- [ ] Zero findings = success state ("No hazards found — no action needed")
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Contractors encounter hazardous materials (asbestos, lead paint) on restoration jobs but lack tools to quickly identify risk. Missing hazmat findings creates liability and safety issues.

**Solution:** HazmatCheck — scans job photos for potential asbestos-containing materials (ACMs) and lead paint indicators. AI narrates what it's examining ("Examining ceiling texture... this granular pattern is consistent with vermiculite...") while findings stream in. Flags findings with severity, next steps, and local contractor referrals.

**Scope:**
- IN: Asbestos risk scan, lead paint risk scan, hazmat_findings table, findings CRUD, add-to-report flow, SSE streaming via Celery + Redis
- OUT: Test kit ordering (V2 revenue), sponsored listings (V2 revenue), abatement contractor marketplace

## Database Schema

**hazmat_findings** (NEW)
```sql
CREATE TABLE hazmat_findings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    photo_id        UUID REFERENCES photos(id) ON DELETE SET NULL,
    scan_type       TEXT NOT NULL,    -- 'asbestos' | 'lead_paint'
    material_name   TEXT NOT NULL,    -- "Vermiculite Insulation", "Pipe Insulation Wrap"
    location        TEXT,             -- "Attic", "Basement/Mechanical"
    risk_level      TEXT NOT NULL,    -- 'high' | 'medium' | 'low'
    description     TEXT NOT NULL,    -- "What I see: Pebble-like, lightweight..."
    next_steps      TEXT NOT NULL,    -- "Do not disturb. Have certified inspector..."
    added_to_report BOOLEAN DEFAULT false,
    event_id        UUID,            -- links to event_history for feedback
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Phases & Checklist

### Phase 1: Backend — Celery Task + Endpoints — ❌

**Prompt + tools:**
- [ ] Create `api/ai/prompts/hazmat.py` — hazmat scanning prompt
  - [ ] Asbestos indicators: vermiculite insulation, pipe wrap, 9x9 floor tiles, popcorn ceiling, transite siding
  - [ ] Lead paint indicators: alligatoring pattern, chalking, multi-layer peeling
  - [ ] Output per-finding: material_name, location, risk_level, description ("What I see:"), next_steps
  - [ ] Mandatory disclaimer text embedded in prompt
- [ ] Create `api/ai/tools/hazmat.py` — `report_hazard_findings` tool schema
  - [ ] Schema: `{ findings: [{ scan_type, material_name, location, risk_level, description, next_steps, photo_id }] }`

**Celery task (`api/hazmat/tasks.py`):**
- [ ] `process_hazmat_task(job_id, photo_ids, task_id)` — Celery task
- [ ] Redis lock per `job_id` + `hazmat` (separate from scope lock)
- [ ] Task status in Redis: `hazmat_task:{id}:status` = PENDING → RUNNING → COMPLETE/FAILED
- [ ] For each photo (sequential):
  1. Fetch from Supabase Storage (admin client)
  2. Resize with Pillow (1920px max)
  3. Call Claude Vision with hazmat prompt + tools + config `AI_CONFIGS["hazmat_scan"]`
  4. Stream thinking → publish SSE `thinking` events via Redis
  5. Parse findings → publish SSE `finding` events via Redis
  6. Publish SSE `progress` event (photo N of M)
- [ ] Lead paint check: fetch `property.year_built` via `job.property_id` — pre-1978 = flag
- [ ] Store findings in `hazmat_findings` table
- [ ] `log_ai_event()` for each scan (photo_id, duration_ms, ai_cost_cents, findings_count)
- [ ] Publish SSE `complete` event with event_id and summary
- [ ] `max_retries=2` on task failure
- [ ] On zero findings: publish SSE `complete` with `{ findings_count: 0 }` (success, not error)

**API routes (`api/hazmat/router.py`):**
- [ ] `POST /v1/hazmat/check` — validate auth, check lock, enqueue task, return `{ task_id }`
  - [ ] Body: `{ job_id: UUID, photo_ids: list[UUID] }`
- [ ] `GET /v1/hazmat/stream/{task_id}` — SSE endpoint (replay + pub/sub, same pattern as scope)
  - [ ] Support `Last-Event-ID` for reconnection
- [ ] `GET /v1/jobs/{job_id}/hazmat-findings` — list all findings for job
  - [ ] Optional `?photo_id=` filter
- [ ] `POST /v1/jobs/{job_id}/hazmat-findings/{finding_id}/add-to-report` — mark finding for PDF report

**Service layer (`api/hazmat/service.py`):**
- [ ] Enqueue Celery task with lock check
- [ ] CRUD for findings (add-to-report toggle)

**Alembic migration:**
- [ ] Create `hazmat_findings` table (schema above)
- [ ] Index on `hazmat_findings(job_id)`

**Mount router:**
- [ ] Add `hazmat_router` to `api/main.py` with `prefix="/v1"`

**Tests:**
- [ ] pytest: `test_hazmat_tasks.py` — identifies known ACMs in mock Claude response
- [ ] pytest: `test_hazmat_tasks.py` — lead paint flag for pre-1978 property
- [ ] pytest: `test_hazmat_tasks.py` — zero findings → success status (not error)
- [ ] pytest: `test_hazmat_tasks.py` — partial failure (some photos timeout)
- [ ] pytest: `test_hazmat_router.py` — idempotency (second call returns same task_id)
- [ ] pytest: `test_hazmat_router.py` — SSE stream with reconnect
- [ ] pytest: `test_hazmat_router.py` — add-to-report toggles flag

### Phase 2: Frontend — Hazards Tab in Photos Workspace — ❌

**[Hazards] tab content (under photo strip):**
- [ ] Uses same photo strip filter as Line Items tab (shared component from 02A)
- [ ] SSE connection to `GET /v1/hazmat/stream/{task_id}` via `use-hazmat-stream.ts`
- [ ] Thinking stream: same inline narrative component (shared from 02A)
  - "Examining pipe insulation in basement... wrap pattern and texture suggest potential ACM..."

**Findings display:**
- [ ] Disclaimer banner at top (always visible, yellow/warning style):
  - "This scan uses AI visual analysis to flag materials that *may* contain asbestos or lead paint. This is NOT a substitute for professional testing."
- [ ] Summary: "4 potential ACMs identified across 4 photos" (or "No hazards found — no action needed" ✓)

**Finding cards:**
- [ ] Material name (bold, 16px)
- [ ] Photo reference: small thumbnail or "P3" badge
- [ ] Location tag (if identified)
- [ ] Risk badge:
  - HIGH: bg #fef2f2, text #dc2626, label "HIGH RISK"
  - MEDIUM: bg #fffbeb, text #d97706, label "MEDIUM RISK"
  - LOW: bg #f5f5f4, text #6b6560, label "LOW RISK"
  - Text labels always present (not color-only, for accessibility)
- [ ] "What I see:" description section
- [ ] "Next steps:" section
- [ ] Action buttons: [Order Test Kit →] [Add to Report →]
- [ ] 👍👎 feedback (shared AI Feedback component from 02E)
- [ ] 48px touch targets on all interactive elements

**Lead paint section:**
- [ ] "Ask the Homeowner" prompt: "When was this home built?"
- [ ] Year input (number, 4 digits)
- [ ] If pre-1978: alert card with "Pre-1978 Home — Lead Test Recommended"
  - [Order Test Kit →] [EPA Lead Info →]
- [ ] If property already has year_built, pre-fill and auto-check

**Zero findings state:**
- [ ] Green checkmark (#2a9d5c) + "No hazards found — no action needed"
- [ ] This is a success state, not an empty state

**Error/partial states:**
- [ ] Same pattern as PhotoScope: failed photos flagged in strip, "Scan failed — tap to retry"

**Hooks:**
- [ ] `use-hazmat.ts` — `useHazmatFindings(jobId)`, `useAddFindingToReport()`
- [ ] `use-hazmat-stream.ts` — SSE consumer for hazmat (same pattern as scope stream)

### Phase 3: Tests — ❌
- [ ] E2E: check hazards → findings stream in → review → add to report
- [ ] E2E: zero findings displays success state
- [ ] E2E: photo filter works for hazmat findings
- [ ] Verify disclaimer always visible
- [ ] Verify risk badges have text labels (a11y)

## Technical Approach

- Reuses ENTIRE shared AI layer from Spec 02A Phase 1 (client, config, events, stream, Redis)
- Reuses Celery + Redis infrastructure from Spec 02A
- Separate Celery task (`api/hazmat/tasks.py`), separate Redis lock namespace
- Model: Sonnet 4 for vision analysis (`AI_CONFIGS["hazmat_scan"]`)
- Can run in parallel with PhotoScope (separate locks, separate tasks)
- SSE stream uses same `stream.py` helpers

**Key Files:**
```
backend/api/
├── ai/prompts/hazmat.py       # Hazmat prompt
├── ai/tools/hazmat.py         # report_hazard_findings tool
├── hazmat/
│   ├── router.py              # API routes
│   ├── service.py             # Business logic
│   ├── schemas.py             # Pydantic models
│   └── tasks.py               # Celery task
web/src/
├── components/hazmat/
│   ├── finding-card.tsx       # Per-finding card with risk badge
│   ├── hazmat-results.tsx     # Results container + disclaimer
│   └── lead-paint-check.tsx   # Year input + risk check
├── hooks/
│   ├── use-hazmat.ts          # TanStack Query hooks
│   └── use-hazmat-stream.ts   # SSE consumer
```

## Decisions & Notes

- **Two scan types:** Asbestos + Lead Paint. Different indicators, same prompt.
- **Mandatory disclaimer:** Always displayed. AI visual analysis is NOT professional testing.
- **Pre-1978 rule:** EPA RRP rule. Use property.year_built.
- **Future revenue:** Sponsored listings + test kit affiliates (V2).
- **Model selection:** Sonnet 4 for hazmat vision analysis.

### Design Review Decisions (2026-04-07)

- **Shared workspace with PhotoScope:** Results under [Hazards] tab in Photos tab workspace.
- **Photo-tagged findings:** Each finding tagged to source photo. Photo strip filter works.
- **Zero findings = success state:** Green checkmark, not empty state.
- **Risk badge design:** DESIGN.md accent colors with text labels (a11y).
- **Runs in parallel with PhotoScope:** Separate Celery tasks, separate Redis locks.

### Eng Review Decisions (2026-04-08)

- **Same Celery + Redis architecture as PhotoScope.** Separate task, separate lock namespace (`hazmat_lock:{job_id}`), same Redis pub/sub → SSE bridge.
- **Sequential photo processing.** No asyncio.gather. Same as PhotoScope.
- **Worker uses admin client.** Same as PhotoScope.
- **Task retry + status tracking.** Same PENDING/RUNNING/COMPLETE/FAILED pattern.

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|
