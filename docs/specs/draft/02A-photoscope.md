# PhotoScope — Damage Photos → Xactimate Line Items

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/7 phases) |
| **State** | ❌ Not Started |
| **Blocker** | None (Spec 01 jobs complete) |
| **Branch** | TBD |
| **Issue** | TBD |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-03-24 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] "Generate Line Items" via `POST /v1/scope/generate` — user selects damage photos → taps "Generate Line Items" → sees Xactimate line items stream in within 15-30 seconds
- [ ] Line items grouped by trade category (Mitigation, Insulation, Drywall, Painting, Structural, General) with colored headers
- [ ] Every line item has an S500/OSHA citation inline (no item without citation)
- [ ] Non-obvious items highlighted with "AI found this — you might have missed it"
- [ ] User can edit any line item (tap row to expand, full-width inputs)
- [ ] User can add manual line items and delete AI-generated ones
- [ ] User can re-run AI on additional photos (iterative scoping — new items merge with existing)
- [ ] "Push to Report →" sends approved items to PDF report
- [ ] Photo strip filter: tap a photo to see only its items, tap "All" for everything
- [ ] Thinking stream: AI narrates what it sees per photo as inline narrative (not chat bubbles)
- [ ] SSE + Celery architecture: worker processes photos, streams results via Redis pub/sub
- [ ] SSE reconnection: dropped connections replay missed events from Redis
- [ ] Accuracy tracking: event_history records AI accuracy per job
- [ ] AI pipeline works on Brett's first 5 real jobs at 80%+ accuracy
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Contractors spend 2-4 hours per job manually entering Xactimate line items. They scope from memory, miss non-obvious billable items (HEPA filters, baseboard removal, equipment decon, PPE), and leave money on the table. No tool on the market converts damage photos to Xactimate line items.

**Solution:** PhotoScope — select damage photos → AI generates Xactimate line items with S500/OSHA citations, grouped by trade category. While analyzing, the AI narrates what it sees ("I can see water staining on the ceiling, baseboard is swollen...") so the contractor watches the AI work instead of staring at a spinner. Contractor reviews, edits, approves, pushes to report.

**Scope:**
- IN: Claude Vision integration, Xactimate code matching, S500/OSHA/EPA citation generation, per-photo analysis, agentic retry (auto + manual), line item CRUD, trade category grouping, accuracy tracking (via event_history from Spec 01), Push to Report flow, SSE streaming via Celery + Redis
- OUT: HazmatCheck (Spec 02B), Job Audit (Spec 02C), Ask Crewmatic (Spec 02D), AI Feedback (Spec 02E), Voice scoping (Spec 03), network intelligence (V3), carrier-specific rules (V3), supplement detection (V2.5)
- NOTE: Accuracy tracking uses event_history table (from Spec 01), not a separate table. Events: ai_photo_analysis, line_item_accepted/edited/deleted. Accuracy = (accepted) / (total generated).

## Database Schema Updates

**line_items** (add category field — from design.md)
```sql
ALTER TABLE line_items ADD COLUMN category TEXT;
-- Categories: mitigation, insulation, drywall, painting, structural, plumbing, electrical, general
-- Drives which report each item appears in (mitigation invoice vs full report)
-- Items sorted by category for display
```

## Architecture

```
Client                    FastAPI                  Redis           Celery Worker
  │                          │                       │                  │
  ├─ POST /v1/scope/generate►│                       │                  │
  │  { job_id, photo_ids[] } │                       │                  │
  │                          ├─ Redis lock check ───►│                  │
  │                          │  (idempotency)        │                  │
  │                          ├─ Enqueue task ────────►│──── pick up ────►│
  │  ◄── { task_id } ────────┤                       │                  │
  │                          │                       │                  │
  ├─ GET /v1/scope/stream/   │                       │                  │
  │  {task_id} (SSE)         │                       │                  │
  │                          ├─ Replay from Redis ──►│                  │
  │                          │  list (catch-up)      │                  │
  │                          ├─ Subscribe pub/sub ──►│                  │
  │                          │                       │                  │
  │                          │                       │  ◄── fetch photo─┤
  │                          │                       │      from Storage│
  │                          │                       │  ◄── resize ─────┤
  │                          │                       │      (Pillow)    │
  │                          │                       │  ◄── Claude API ─┤
  │                          │                       │      (streaming) │
  │  ◄── SSE: thinking ──────┤◄── pub/sub + list ───┤◄── thinking ─────┤
  │  ◄── SSE: line_item ─────┤◄── pub/sub + list ───┤◄── tool result ──┤
  │  ◄── SSE: progress ──────┤◄── pub/sub + list ───┤◄── photo done ───┤
  │  ◄── SSE: complete ──────┤◄── pub/sub + list ───┤◄── all done ─────┤
  │                          │                       │                  │
  │  (connection drops)      │                       │                  │
  │                          │                       │  ◄── still going─┤
  │  (reconnects with        │                       │                  │
  │   Last-Event-ID: 12)     │                       │                  │
  │                          ├─ Replay from seq 13 ─►│                  │
  │  ◄── SSE: line_item ─────┤◄── catch-up ─────────┤                  │
  │  ◄── SSE: complete ──────┤                       │                  │
```

## Phases & Checklist

### Phase 1: Infrastructure — Celery + Redis + Shared AI Layer — ❌

**Celery + Redis setup:**
- [ ] Add dependencies to `pyproject.toml`: `celery`, `redis`, `Pillow`, `anthropic`, `sse-starlette`
- [ ] Create `backend/celery_app.py` — Celery app configuration with Railway Redis as broker
- [ ] Configure Redis URL from env var `REDIS_URL` (Railway Redis internal URL)
- [ ] Create `backend/worker.py` — Celery worker entrypoint
- [ ] Railway deployment: add second service for Celery worker (`celery -A celery_app worker`)
- [ ] Railway Redis: provision Redis plugin, get internal URL
- [ ] Add `REDIS_URL` and `ANTHROPIC_API_KEY` to Railway env vars for both API + worker services

**Shared AI service layer (`api/ai/`):**
- [ ] Create `api/ai/__init__.py`
- [ ] Create `api/ai/client.py` — Anthropic SDK wrapper (singleton client)
  - [ ] `call_claude_vision(images, system_prompt, tools, config)` — single image analysis
  - [ ] `stream_claude_response(messages, tools, config)` — streaming with thinking
  - [ ] Retry logic: exponential backoff on 429 (rate limit), max 3 retries
  - [ ] Timeout: 30 seconds per call, configurable per feature
  - [ ] Cost calculation: `(input_tokens * 0.3 / 1000) + (output_tokens * 1.5 / 1000)` cents
- [ ] Create `api/ai/config.py` — per-feature settings matrix:
  ```python
  AI_CONFIGS = {
      "photo_scope": AIFeatureConfig(
          model="claude-sonnet-4-6-20250514",
          max_tokens=4096, thinking=True, thinking_budget=2048,
          stream_thinking=True, temperature=0, timeout_seconds=30, vision=True,
      ),
      "hazmat_scan": AIFeatureConfig(
          model="claude-sonnet-4-6-20250514",
          max_tokens=2048, thinking=True, thinking_budget=1024,
          stream_thinking=True, temperature=0, timeout_seconds=30, vision=True,
      ),
      "scope_audit": AIFeatureConfig(
          model="claude-sonnet-4-6-20250514",
          max_tokens=4096, thinking=True, thinking_budget=2048,
          stream_thinking=True, temperature=0, timeout_seconds=45, vision=True,
      ),
      "assistant": AIFeatureConfig(
          model="claude-sonnet-4-6-20250514",
          max_tokens=2048, thinking=False, thinking_budget=0,
          stream_thinking=False, temperature=0.3, timeout_seconds=15, vision=False,
      ),
      "photo_quality": AIFeatureConfig(
          model="claude-haiku-4-5-20251001",
          max_tokens=256, thinking=False, thinking_budget=0,
          stream_thinking=False, temperature=0, timeout_seconds=5, vision=True,
      ),
  }
  ```
- [ ] Create `api/ai/events.py` — `log_ai_event()` variant that returns `event_id: UUID`
  - [ ] Unlike fire-and-forget `log_event()`, this RAISES on failure
  - [ ] Returns the generated UUID for feedback linking
  - [ ] Uses admin client (background worker context)
- [ ] Create `api/ai/stream.py` — SSE helpers for Redis pub/sub bridge
  - [ ] `publish_sse_event(task_id, event)` — writes to Redis list (`task:{id}:events`) AND pub/sub channel
  - [ ] Each event gets a sequential ID (for Last-Event-ID replay)
  - [ ] Redis list TTL: 1 hour (auto-expires after contractor closes page)
  - [ ] `sse_endpoint(task_id, last_event_id)` — FastAPI SSE endpoint:
    - Replay missed events from Redis list (seq > last_event_id)
    - Subscribe to pub/sub for live events
    - Yield SSE events with `id:` field for reconnection
- [ ] Create `api/ai/validator.py` — Xactimate code validation
  - [ ] Load codes from `api/ai/data/xactimate_codes.json` (NOT a Python module)
  - [ ] `validate_codes(line_items)` — flag invalid codes for manual correction
- [ ] Create `api/ai/data/xactimate_codes.json` — 50+ WTR codes from `docs/research/xactimate-codes-water.md`
  - [ ] JSON format: `{ "WTR DRYOUT": { "description": "...", "unit": "DAY", "category": "mitigation" }, ... }`
  - [ ] Reviewable by Brett without touching Python
- [ ] Create `api/ai/rules.py` — auto-add rules as declarative data (NOT if/else chains):
  ```python
  AUTO_ADD_RULES = [
      {"trigger": "DRYWLL RR", "add": "BSBD RR",
       "reason": "Baseboard must be removed before drywall work",
       "citation": "IICRC S500 Sec 12.3", "is_non_obvious": True},
      {"trigger": "DRYWLL RR", "add": "AIRSCR",
       "reason": "Air scrubber required when particulates aerosolized",
       "citation": "OSHA General Duty Clause 5(a)(1)", "is_non_obvious": False},
      {"trigger": "AIRSCR", "add": "HEPA FLTR",
       "reason": "HEPA filter replacement for air scrubber",
       "citation": "OSHA 29 CFR 1926.1101", "is_non_obvious": True},
      # ... all 13 rules as data
  ]
  ```
  - [ ] `apply_auto_add_rules(line_items) → line_items` — iterate rules, no duplicate adds
  - [ ] Each rule independently testable

**Prompt templates:**
- [ ] Create `api/ai/prompts/__init__.py`
- [ ] Create `api/ai/prompts/scope.py` — PhotoScope system prompt
  - [ ] Embed S500 standard reference sections
  - [ ] Embed OSHA regulation references
  - [ ] Embed Xactimate code database (loaded from JSON)
  - [ ] Language rules: NEVER output "mold" — use "visible staining," "microbial growth"
  - [ ] Physics rules: 2" water line → moisture wicks to 12-15" → flood cut at wicking height
  - [ ] Output ordering: assess → demo → protect → clean → dry → monitor → decon
  - [ ] Core instruction: "Think about everything you do and how you need to get paid for it"
  - [ ] Target 8-25 line items per job (small=10, large=30)

**Tool-use definitions:**
- [ ] Create `api/ai/tools/__init__.py`
- [ ] Create `api/ai/tools/scope.py` — `generate_line_items` tool schema
  - [ ] Schema: `{ xactimate_code, description, unit, quantity, category, room, citations[], is_non_obvious, photo_id }`
  - [ ] Tool-use mode (not raw JSON prompting)

**Tests for shared layer:**
- [ ] pytest: `test_client.py` — mock Anthropic SDK, verify retry on 429, timeout, cost calc
- [ ] pytest: `test_rules.py` — every auto-add rule fires correctly, no double-adds, no-trigger returns unchanged
- [ ] pytest: `test_validator.py` — valid code passes, invalid flagged, empty handled
- [ ] pytest: `test_events.py` — `log_ai_event()` returns UUID, raises on DB failure
- [ ] pytest: `test_stream.py` — Redis replay, reconnection with Last-Event-ID, TTL expiry

### Phase 2: Scope Endpoints + Celery Task — ❌

**Pydantic schemas (`api/scope/schemas.py`):**
- [ ] `GenerateScopeRequest { job_id: UUID, photo_ids: list[UUID] }`
- [ ] `GenerateScopeResponse { task_id: str }`
- [ ] `LineItem { id, job_id, photo_id, xactimate_code, description, unit, quantity, category, room, citations, is_non_obvious, source, accepted, event_id }`
- [ ] `ScopeResult { items: list[LineItem], total_items: int, by_category: dict }`
- [ ] `LineItemCreate { xactimate_code, description, unit, quantity, category, room }`
- [ ] `LineItemUpdate { xactimate_code?, description?, unit?, quantity?, category?, room? }`

**Celery task (`api/scope/tasks.py`):**
- [ ] `process_scope_task(job_id, photo_ids, task_id)` — the Celery task
- [ ] Set task status in Redis: `task:{id}:status` = PENDING → RUNNING → COMPLETE/FAILED
- [ ] Redis lock per `job_id` — prevent duplicate concurrent analyses
  - [ ] Before enqueuing: check `scope_lock:{job_id}` in Redis
  - [ ] If locked: return existing task_id (idempotent)
  - [ ] Lock expires after 5 minutes (safety valve)
- [ ] For each photo (sequential, NOT asyncio.gather):
  1. Fetch photo from Supabase Storage using admin client (signed URL)
  2. Resize to 1920px max using Pillow (reduces 3-12MB → 200-500KB)
  3. Call Claude Vision API with scope prompt + tools + job context
  4. Stream thinking blocks → publish as SSE `thinking` events via Redis
  5. Parse tool-use results → publish as SSE `line_item` events via Redis
  6. Publish SSE `progress` event (photo N of M done)
- [ ] After all photos: cross-photo deduplication (same code + room = merge, keep higher qty)
- [ ] Apply auto-add rules (`rules.py`)
- [ ] Validate Xactimate codes (`validator.py`)
- [ ] Store line items in Supabase `line_items` table (with `photo_id` tag)
- [ ] `log_ai_event()` for each photo analysis (photo_id, duration_ms, ai_cost_cents, items_generated)
- [ ] Publish SSE `complete` event with `event_id` and summary
- [ ] Release Redis lock on completion (or failure)
- [ ] `max_retries=2` with exponential backoff on task failure
- [ ] On failure: set task status to FAILED, publish SSE `error` event
- [ ] Include room context: pass room assignments from photo tags
- [ ] Include job context: loss_cause, water_category, water_class, room dimensions

**API routes (`api/scope/router.py`):**
- [ ] `POST /v1/scope/generate` — validate auth, check Redis lock, enqueue Celery task, return `{ task_id }`
- [ ] `GET /v1/scope/stream/{task_id}` — SSE endpoint (replay from Redis list + subscribe pub/sub)
  - [ ] Support `Last-Event-ID` header for reconnection
  - [ ] Return 404 if task_id not found in Redis
- [ ] `GET /v1/jobs/{job_id}/scope` — get all line items for job, grouped by category
  - [ ] Optional `?photo_id=` query param to filter by source photo
- [ ] `POST /v1/jobs/{job_id}/scope/items` — add manual line item (source: 'manual')
- [ ] `PATCH /v1/jobs/{job_id}/scope/items/{item_id}` — edit line item
- [ ] `DELETE /v1/jobs/{job_id}/scope/items/{item_id}` — delete line item
- [ ] `POST /v1/jobs/{job_id}/scope/push-to-report` — mark accepted items, update job status

**Service layer (`api/scope/service.py`):**
- [ ] Orchestrates Celery task enqueue + Redis lock logic
- [ ] CRUD operations for manual line items
- [ ] Iterative scoping: merge new items with existing (no duplicate codes per room)
- [ ] Update job status to "scoped" after first successful analysis
- [ ] Log `line_item_accepted` / `line_item_edited` / `line_item_deleted` events on user actions
- [ ] Calculate accuracy: (accepted) / (total generated) per job

**Alembic migration:**
- [ ] `line_items` table: add `category TEXT`, `citation JSONB`, `photo_id UUID REFERENCES photos(id)`, `source TEXT DEFAULT 'ai'`, `accepted BOOLEAN DEFAULT true`, `event_id UUID`
- [ ] Index on `line_items(job_id, category)` for grouped queries

**Mount router:**
- [ ] Add `scope_router` to `api/main.py` with `prefix="/v1"`

**Agentic retry:**
- [ ] After thumbs-down on a line item → auto-retry that photo with feedback context
- [ ] Retry prompt: "User rejected these items: [list]. Re-analyze considering this feedback."
- [ ] Max 2 auto-retries per photo. Each logged as `ai_photo_analysis_retry` event.
- [ ] Manual "Re-analyze" button per photo also triggers retry

**Tests:**
- [ ] pytest: `test_scope_service.py` — generate triggers Celery task, returns task_id
- [ ] pytest: `test_scope_service.py` — idempotency: second call returns same task_id
- [ ] pytest: `test_scope_service.py` — iterative merge: new items deduplicate
- [ ] pytest: `test_scope_service.py` — manual CRUD (add, edit, delete)
- [ ] pytest: `test_scope_service.py` — push-to-report marks items, updates job status
- [ ] pytest: `test_scope_tasks.py` — Celery task processes photos sequentially (mock Claude)
- [ ] pytest: `test_scope_tasks.py` — partial failure: 5/8 photos succeed, 3 timeout → partial results stored
- [ ] pytest: `test_scope_tasks.py` — auto-add rules applied after Claude results
- [ ] pytest: `test_scope_tasks.py` — Xactimate code validation flags bad codes
- [ ] pytest: `test_scope_tasks.py` — cost tracking: ai_cost_cents calculated from token usage
- [ ] pytest: `test_scope_router.py` — SSE stream replays from Redis on reconnect
- [ ] pytest: `test_scope_router.py` — 404 for unknown task_id
- [ ] pytest: `test_prompt.py` — prompt includes all hard rules, "mold" never in output
- [ ] pytest: `test_prompt.py` — output is in correct workflow order
- [ ] pytest: `test_prompt.py` — trade categories assigned correctly

### Phase 3: Hard Rules + Xactimate Codes — ❌
- [ ] Embed Xactimate WTR code database in prompt (loaded from `data/xactimate_codes.json`)
- [ ] Embed S500 standard reference sections in prompt
- [ ] Embed OSHA regulation references in prompt
- [ ] Language rules: NEVER output "mold" — use "visible staining," "microbial growth," "suspect organic growth"
- [ ] Auto-add rules (declarative, in `rules.py`):
  - Drywall cut/removed → air scrubber + OSHA aerosol citation
  - Air scrubber in scope → HEPA filter replacement (non-obvious)
  - Any equipment used → equipment decontamination (non-obvious)
  - Drywall removal → baseboard removal (non-obvious, techs' #1 missed item)
  - Cat 2+ water or demolition → PPE/Tyvek suit (non-obvious)
  - Containment built → zipper door (non-obvious)
  - Any demolition/work → floor protection (non-obvious)
  - Any hands-on work → gloves/PPE (non-obvious)
  - Ceiling damage with fixtures → "remove & reset [fixture]" (non-obvious)
  - Every consumable = a line item (Tyvek, poly sheeting, tape, antimicrobial)
- [ ] Physics rules: 2" water line → wicking to 12-15" → flood cut at wicking height
- [ ] Output ordering: assess → demo → protect → clean → dry → monitor → decon
- [ ] Target 8-25 line items per job (small=10, large=30)
- [ ] Core instruction: "Think about everything you do and how you need to get paid for it"
- [ ] Trade categories: mitigation, insulation, drywall, painting, structural, plumbing, electrical, general
- [ ] Room dimensions for quantity calculations: SF = square_footage, LF = perimeter

### Phase 4: Photos Tab AI Workspace (Frontend) — ❌

**Photo strip filter bar:**
- [ ] Horizontal scrollable strip at top of Photos tab (below job detail tabs)
- [ ] "All" chip as first item (always visible, selected by default)
- [ ] Photo thumbnails: 56px height, 8px gap, horizontal scroll
- [ ] Analyzed photos: green checkmark overlay (✓)
- [ ] Currently analyzing: pulse/highlight animation
- [ ] Pending photos: no overlay
- [ ] Tap photo → filter results below to that photo's items
- [ ] Tap "All" → show everything

**Result type tabs:**
- [ ] `[Line Items | Hazards]` underline tabs below photo strip
- [ ] Same pattern as job detail tabs (Photos | Readings | Report)
- [ ] Orange underline (#e85d26) on active tab
- [ ] Line Items tab shows PhotoScope results (02A)
- [ ] Hazards tab shows HazmatCheck results (02B)

**Thinking stream (inline narrative):**
- [ ] Secondary text (#6b6560) appearing line by line
- [ ] Orange left border (#e85d26), 3px solid
- [ ] No speech bubbles, no card — just bordered text block
- [ ] Updates per-photo: "Examining photo 3... Water staining on ceiling..."
- [ ] Collapses to single line after analysis completes ("Analysis complete — 18 items generated")
- [ ] `aria-live="polite"` for screen readers

**Line items by category:**
- [ ] Category header bars with colors from DESIGN.md palette:
  - MITIGATION: bg #eef0fc, text #5b6abf (indigo)
  - DRYWALL: bg #fff3ed, text #e85d26 (orange)
  - PAINTING: bg #fffbeb, text #d97706 (amber)
  - STRUCTURAL: bg #f5f5f4, text #6b6560 (muted)
  - INSULATION: bg #fffbeb, text #d97706 (amber)
  - GENERAL: bg #edf7f0, text #2a9d5c (green)
  - PLUMBING: bg #eef0fc, text #5b6abf (indigo)
  - ELECTRICAL: bg #fef2f2, text #dc2626 (red)
- [ ] Category headers: collapse/expand with `aria-expanded`
- [ ] Item count per category in header

**Line item rows (mobile layout):**
- [ ] Row 1: Xactimate code (accent color) + description
- [ ] Row 2: unit badge (SF/LF/EA/DAY) + quantity + room tag + 👍👎 icons + delete ✕
- [ ] Photo source tag: small "P3" badge or thumbnail reference
- [ ] Non-obvious items: orange left border (#e85d26) + #fff3ed background + "AI found this — you might have missed it"
- [ ] All touch targets: 48px minimum height
- [ ] Dividers: 1px solid #eae6e1 between rows

**Line item editing (tap-to-expand):**
- [ ] Tap anywhere on row → expands to edit form
- [ ] Full-width inputs, 48px height (field-ready):
  - Code: text input (with autocomplete from Xactimate codes JSON)
  - Description: text input
  - Unit: dropdown (SF, LF, EA, DAY, HR)
  - Quantity: number input
  - Room: dropdown (from job's rooms)
- [ ] [Cancel] and [Save] buttons
- [ ] Save → PATCH /v1/jobs/{id}/scope/items/{item_id}

**Citations:**
- [ ] Hidden by default on mobile (tap cite icon to expand inline)
- [ ] Always visible on desktop (below the line item row)
- [ ] Text: secondary color (#6b6560), 13px, italic
- [ ] Example: "Citation: OSHA General Duty Clause 5(a)(1); IICRC S500 Sec 13.5.6.1"

**Actions:**
- [ ] "+ Add Line Item" button at bottom of all items
- [ ] "Push to Report →" sticky bottom bar (disabled during analysis)
- [ ] "Re-run AI" button: select additional photos → enqueue new task → merge results

**SSE connection (`hooks/use-scope-stream.ts`):**
- [ ] Connect to `GET /v1/scope/stream/{task_id}` via EventSource
- [ ] Handle event types: `thinking`, `line_item`, `progress`, `error`, `complete`
- [ ] On disconnect: auto-reconnect with `Last-Event-ID` header
- [ ] Parse line items into state, grouped by category
- [ ] Real-time accept/reject: contractor can tap 👍👎 on items as they stream in

**Empty state (before first analysis):**
- [ ] Warm card below photo grid: "Tag your photos to rooms, then tap Generate Line Items to create your scope."
- [ ] Mini progress: Step 1: Tag rooms (✓ or pending), Step 2: Generate Line Items
- [ ] "Generate Line Items" button disabled until rooms are tagged

**Error/partial states:**
- [ ] Error: "We couldn't analyze these photos. Try taking clearer photos." + [Retry] button
- [ ] Partial: items from completed photos shown, failed photos flagged in strip with ⚠️
- [ ] Task status FAILED: "Analysis failed — tap to retry"

**Photo quality pre-check:**
- [ ] Before analysis, check photos for blur/darkness (Haiku 3.5, sync, no Celery)
- [ ] Flag: "This photo may be too dark/blurry — retake?" with [Proceed Anyway] / [Remove]

### Phase 5: Scope TanStack Query Hooks — ❌
- [ ] `use-scope.ts` — `useScope(jobId)`, `useAddLineItem()`, `useEditLineItem()`, `useDeleteLineItem()`, `usePushToReport()`
- [ ] `use-scope-stream.ts` — SSE hook for streaming (connects, reconnects, parses events)
- [ ] `use-ai-feedback.ts` — shared hook for thumbs up/down (used by 02A, 02B, 02C, 02D)
- [ ] Optimistic updates on CRUD operations
- [ ] Cache invalidation on scope changes

### Phase 6: Integration Testing + Validation — ❌
- [ ] E2E test: upload photos → tag rooms → generate → review → edit → push to report
- [ ] E2E test: photo filter (tap photo → see only its items)
- [ ] E2E test: re-run on additional photos → merge without duplicates
- [ ] E2E test: SSE drops → reconnect → all items received (mobile resilience)
- [ ] Test with public water damage photos (3-5 scenarios: roof leak, basement flood, pipe burst, dishwasher leak)
- [ ] Verify AI produces real Xactimate codes (not made-up)
- [ ] Verify every line item has a citation
- [ ] Verify non-obvious items are flagged
- [ ] Verify output is in correct workflow order
- [ ] Verify trade categories assigned correctly
- [ ] Verify batch processing works (>10 photos)
- [ ] Verify iterative scoping merges correctly
- [ ] Measure actual AI cost per job analysis
- [ ] The Assignment: test with Brett's real job photos — target 80%+ accuracy

### Phase 7: Railway Deployment — ❌
- [ ] Railway Redis: provision, get internal URL
- [ ] Railway Worker service: `celery -A celery_app worker --loglevel=info`
- [ ] Env vars on both services: `REDIS_URL`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Health check: worker heartbeat via Redis
- [ ] Alembic migration on deploy: `alembic upgrade head`
- [ ] Verify SSE works through Railway's proxy (may need keepalive headers)
- [ ] Verify Celery task retries work in production
- [ ] Monitor: task duration, failure rate, AI cost per job

## Technical Approach

**Prompt strategy:**
- Use Claude's tool-use mode — define `generate_line_items` tool with strict JSON schema
- Dramatically improves structured output reliability vs raw prompt-based JSON
- System prompt is ~2000 tokens (Xactimate codes + rules + instructions)
- Each photo is ~1000-3000 tokens of image input
- Total cost: ~$0.15-0.30 per job

**`log_ai_event()` pattern:**
- Unlike fire-and-forget `log_event()`, returns a `UUID` (the `event_id`)
- Raises on failure (not silent) — AI responses must have trackable events
- `event_id` included in every SSE event and all AI responses
- Used by `POST /v1/ai/feedback` (Spec 02E) to link feedback

**Xactimate code matching:**
- Codes stored in `api/ai/data/xactimate_codes.json` (not Python module)
- AI generates codes from the embedded database in the prompt
- Post-processing validates codes exist in our reference
- Invalid codes flagged for manual correction
- V2: fuzzy matching for close-but-wrong codes

**Key Files:**
```
backend/
├── celery_app.py                    # Celery app config (Railway Redis)
├── worker.py                        # Celery worker entrypoint
├── api/
│   ├── ai/                          # Shared AI service layer
│   │   ├── client.py                # Anthropic SDK wrapper
│   │   ├── config.py                # Per-feature settings matrix
│   │   ├── events.py                # log_ai_event() → UUID
│   │   ├── stream.py                # Redis pub/sub → SSE bridge
│   │   ├── validator.py             # Xactimate code validation
│   │   ├── rules.py                 # Declarative auto-add rules
│   │   ├── data/
│   │   │   └── xactimate_codes.json # Code database (reviewable by Brett)
│   │   ├── prompts/
│   │   │   └── scope.py             # PhotoScope system prompt
│   │   └── tools/
│   │       └── scope.py             # generate_line_items tool schema
│   └── scope/
│       ├── router.py                # API routes (generate, stream, CRUD)
│       ├── service.py               # Business logic + Celery enqueue
│       ├── schemas.py               # Pydantic models
│       └── tasks.py                 # Celery task (photo processing)
web/src/
├── components/
│   ├── ai/
│   │   ├── thinking-stream.tsx      # Inline narrative display
│   │   ├── ai-feedback.tsx          # Reusable 👍👎 (shared with 02B-02E)
│   │   └── photo-strip.tsx          # Photo filter bar with "All" chip
│   └── scope/
│       ├── line-item-card.tsx       # Line item row + tap-to-expand edit
│       ├── category-group.tsx       # Colored category header + items
│       └── scope-workspace.tsx      # Main workspace (stream + results)
├── hooks/
│   ├── use-scope.ts                 # TanStack Query CRUD hooks
│   ├── use-scope-stream.ts          # SSE consumer + reconnection
│   └── use-ai-feedback.ts           # Shared feedback hook
└── app/(protected)/jobs/[id]/
    └── photos/page.tsx              # Updated: photo strip + AI workspace
```

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1 (infrastructure)
# No blockers — Spec 01 jobs is complete
# Phase 1 (shared layer) must complete before Phase 2-3
# Phase 4-5 (frontend) can start once API contracts are defined
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **AI model:** Claude Vision API (Anthropic). Use tool-use/function-calling for structured output.
- **Structured output > raw JSON:** Tool-use mode dramatically improves schema conformance.
- **Hard rules are non-negotiable:** 13 auto-add rules from Brett's domain expertise.
- **"Mold" is forbidden:** Insurance industry forbidden word. Use "visible staining" etc.
- **Activation metric:** User approves at least 1 non-obvious item ("holy shit" moment).
- **Accuracy target:** 80%+ on Brett's first 5 real jobs.
- **V1 citation standards:** S500 + OSHA. V2 adds: S520, EPA, IRC, IBC, NIOSH.
- **Iterative scoping:** Re-running merges new items, preserves existing edits.
- **Cost budget:** ~$0.15-0.30 per job. Track in event_history.ai_cost_cents.
- **User-facing names drop "AI":** "Generate Line Items" not "Analyze with AI".
- **Model selection:** Sonnet 4 for photo scope, Haiku 3.5 for photo quality pre-check.

### Design Review Decisions (2026-04-07)

- **Photo-centric workspace:** PhotoScope + HazmatCheck + AI Feedback all live on the Photos tab. No separate Scope tab. Photos are the navigation.
- **"All" chip first in photo strip:** Explicit, discoverable, no hidden gestures.
- **[Line Items | Hazards] underline tabs:** Same pattern as job detail tabs.
- **Per-photo analysis view:** Each photo processed one at a time with thinking narration.
- **Thinking stream = inline narrative:** Orange left border, secondary text, collapses after analysis.
- **Trade category colors from DESIGN.md palette:** Indigo, orange, amber, muted, green, red.
- **Non-obvious item highlight:** Orange left border + "AI found this" text.
- **Mobile line item editing:** Tap row to expand, full-width 48px inputs.
- **Mobile layout:** Stacked rows, citations hidden by default, sticky Push to Report.
- **Guided empty state:** Warm card with step progress before first analysis.
- **Re-run AI = merge:** Deduplicate, preserve existing accepted/rejected items.

### Eng Review Decisions (2026-04-08)

- **SSE + Celery + Railway Redis:** Celery worker processes photos off the API server. Redis as broker + pub/sub. SSE streams results to client via Redis pub/sub bridge.
- **Redis event log + replay:** Worker writes events to Redis list AND pub/sub. SSE endpoint replays from list on reconnect (Last-Event-ID). 1-hour TTL on event lists.
- **Redis lock per job_id:** Prevents duplicate concurrent analyses. Returns existing task_id on second call. Lock expires after 5 minutes.
- **Auto-add rules as declarative data:** JSON-like Python dicts, not if/else chains. Each rule independently testable.
- **Xactimate codes as JSON data file:** `api/ai/data/xactimate_codes.json`, not a Python module. Reviewable by Brett.
- **Sequential photo processing:** No `asyncio.gather()` on shared sessions. Process photos one at a time in the Celery worker.
- **Worker uses admin client:** Background worker uses `get_supabase_admin_client()` for Storage access.
- **Celery task retry:** `max_retries=2` with exponential backoff. Task status tracked in Redis (PENDING/RUNNING/COMPLETE/FAILED).
- **Cost tracking:** Calculate from Anthropic SDK `usage.input_tokens` + `usage.output_tokens`. Store as `ai_cost_cents` in event_data.
- **Photo resize in worker:** Pillow, 1920px max. Reduces 3-12MB → 200-500KB before sending to Claude.
- **Critical failure modes:** Redis connection loss and worker OOM need task retry + FAILED status + frontend "tap to retry" state.
