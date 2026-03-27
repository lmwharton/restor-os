# AI Pipeline — Photo Scope, Hazmat Scanner, Scope Check, Job Assistant, AI Feedback

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/9 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 01 (jobs + site log + floor plan) must be complete |
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
- [ ] "Generate Line Items" via `POST /v1/jobs/{job_id}/photos/generate-scope` — user selects damage photos → taps "Generate Line Items" → sees Xactimate line items stream in within 15-30 seconds
- [ ] Line items grouped by trade category (Mitigation, Insulation, Drywall, Painting, Structural, General) with colored headers
- [ ] Every line item has an S500/OSHA citation inline (no item without citation)
- [ ] Non-obvious items highlighted with "AI found this — you might have missed it"
- [ ] User can edit any line item inline (code, description, quantity, unit, room)
- [ ] User can add manual line items and delete AI-generated ones
- [ ] User can re-run AI on additional photos (iterative scoping — new items merge with existing)
- [ ] "Push to Report →" sends approved items to PDF report
- [ ] "Check for Hazards" via `POST /v1/jobs/{job_id}/photos/check-hazards` — scans photos for asbestos + lead paint risk
- [ ] "Scope Check" via `POST /v1/jobs/{job_id}/scope-check` — reviews scope for missed items before submission (AI real-time source)
- [ ] "Job Assistant" via `POST /v1/jobs/{job_id}/assistant` — context-aware AI assistant for any job screen
- [ ] "AI Feedback" via `POST /v1/ai/feedback` — centralized thumbs up/down feedback for all AI features
- [ ] Accuracy tracking: event_history records AI accuracy per job
- [ ] AI pipeline works on Brett's first 5 real jobs at 80%+ accuracy
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Contractors spend 2-4 hours per job manually entering Xactimate line items. They scope from memory, miss non-obvious billable items (HEPA filters, baseboard removal, equipment decon, PPE), and leave money on the table. No tool on the market converts damage photos to Xactimate line items.

**Solution:** Three AI capabilities that work together:
1. **AI Photo Scope** — select damage photos → AI generates Xactimate line items with S500/OSHA citations, grouped by trade category. Contractor reviews, edits, approves, pushes to report.
2. **AI Hazmat Scanner** — scans photos for asbestos-containing materials and lead paint risk. Flags findings with severity, next steps, and local contractor referrals.
3. **AI Scope Auditor** — "second expert" that reviews the scope before submission. Catches missed items, validates data quality, suggests additions with one-click add + auto-citation.

**Scope:**
- IN: Claude Vision integration, Xactimate code matching, S500/OSHA/EPA citation generation, per-photo analysis, agentic retry (auto + manual), thumbs up/down feedback, line item CRUD, trade category grouping, scope review UI, accuracy tracking (via event_history from Spec 01), hazmat scanning (asbestos + lead paint), scope auditing, Job Assistant (context-aware AI per screen), AI Feedback (centralized feedback endpoint), Push to Report flow
- OUT: Voice scoping (Spec 03), network intelligence (V3/Spec 05), carrier-specific rules (V3), supplement detection (V2.5), Scope Intelligence / Train AI (moved to Spec 04)
- NOTE: Accuracy tracking uses event_history table (from Spec 01), not a separate event_history table. Events: ai_photo_analysis, line_item_accepted/edited/deleted, ai_feedback_thumbs_up/down. Accuracy = (thumbs_up + accepted) / (total generated).

## Database Schema Updates

**line_items** (add category field — from design.md)
```sql
ALTER TABLE line_items ADD COLUMN category TEXT;
-- Categories: mitigation, insulation, drywall, painting, structural, plumbing, electrical, general
-- Drives which report each item appears in (mitigation invoice vs full report)
-- Items sorted by category for display
```

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
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Upload Past Jobs → moved to Spec 04 Phase 4.** No separate `scope_intelligence` table — imported past jobs use the existing `jobs` + `line_items` schema with `jobs.source = 'imported'`. See Spec 04 for details.

## Phases & Checklist

### Phase 1: AI Pipeline Core (Backend) — ❌
- [ ] Create `api/ai/pipeline.py` — main photo scope orchestrator
- [ ] Create `api/ai/prompt.py` — system prompt with all hard rules + Xactimate code database
- [ ] Create `api/ai/parser.py` — parse Claude's structured output into line items
- [ ] Integrate Claude Vision API (anthropic Python SDK)
- [ ] Use Claude tool-use/function-calling mode for structured JSON output (not raw prompt-based JSON)
- [ ] Structured output schema: xactimate_code, description, unit, quantity, category, room, citations[], is_non_obvious
- [ ] Per-photo analysis: each photo analyzed individually by AI (not batched). AI returns what it sees in THAT photo + line items.
- [ ] Photo preprocessing: fetch from Supabase Storage, resize to 1920px max before sending
- [ ] Cross-photo deduplication: after all photos analyzed, deduplicate line items (same xactimate_code + description = merge, keep higher quantity)
- [ ] Timeout handling: 30-second timeout per photo analysis, skip and flag on timeout
- [ ] Cost tracking: calculate AI cost per photo, log in event_history
- [ ] **Agentic retry flow:**
  - [ ] After AI generates line items for a photo, if user gives thumbs-down or deletes items → auto-retry with feedback context
  - [ ] Retry prompt includes: "User rejected these items: [list]. Re-analyze the photo considering this feedback."
  - [ ] Max 2 auto-retries per photo. After that, accept what AI returns.
  - [ ] User can also manually trigger "Re-analyze" on any photo
  - [ ] Each retry logged as `ai_photo_analysis_retry` event with feedback context
- [ ] Include room context: pass room assignments from photo tags so AI generates per-room line items
- [ ] Include job context: loss_cause, water_category, water_class, room dimensions (for SF/LF calculations)

### Phase 2: Hard Rules + Xactimate Codes — ❌
- [ ] Embed Xactimate WTR code database (from docs/research/xactimate-codes-water.md) in prompt
- [ ] Embed S500 standard reference sections in prompt
- [ ] Embed OSHA regulation references in prompt
- [ ] Implement language rules: NEVER output "mold" — use "visible staining," "microbial growth," "suspect organic growth"
- [ ] Implement auto-add rules:
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
- [ ] Implement physics rules: 2" water line → moisture wicks to 12-15" → suggest flood cut at wicking height
- [ ] Implement output ordering: assess → demo → protect → clean → dry → monitor → decon
- [ ] Target 8-25 line items per job (small=10, large=30)
- [ ] Core instruction: "Think about everything you do and how you need to get paid for it"
- [ ] Assign trade categories to each line item (mitigation, insulation, drywall, painting, structural, plumbing, electrical, general)
- [ ] Use room dimensions for quantity calculations: SF = square_footage, LF = perimeter from dimensions
- [ ] pytest: prompt includes all hard rules
- [ ] pytest: "mold" never appears in any AI output (test with multiple scenarios)
- [ ] pytest: auto-add rules fire correctly (drywall removal → baseboard + air scrubber)
- [ ] pytest: output is in correct workflow order
- [ ] pytest: trade categories assigned correctly

### Phase 3: Scope Endpoints + Accuracy Tracking — ❌
- [ ] Create `api/scope/schemas.py` — Pydantic models for scope request/response/line items
- [ ] Create `api/scope/service.py` — orchestrates pipeline, stores results
- [ ] Create `api/scope/router.py` — route handlers
- [ ] `POST /v1/jobs/{job_id}/photos/generate-scope` — trigger AI Photo Scope (SSE streaming response)
- [ ] `GET /v1/jobs/{job_id}/scope` — get current scope results (all line items for job, grouped by category)
- [ ] `POST /v1/jobs/{job_id}/scope/items` — add manual line item (source: 'manual')
- [ ] `PATCH /v1/jobs/{job_id}/scope/items/{item_id}` — edit line item (code, description, qty, unit, room, category)
- [ ] `DELETE /v1/jobs/{job_id}/scope/items/{item_id}` — delete line item
- [ ] `POST /v1/jobs/{job_id}/scope/push-to-report` — mark items as approved, transition to report
- [ ] Alembic migration: create line_items table (with category TEXT field, citation JSONB)
- [ ] `log_ai_event()` returns `event_id: UUID` (not fire-and-forget — raises on failure). event_id included in every SSE event and all AI responses.
- [ ] Log `ai_photo_analysis` event to event_history on each photo analysis (photo_id, duration_ms, ai_cost_cents, line_items_generated)
- [ ] Log `line_item_generated` event for each AI-generated line item
- [ ] Log `line_item_accepted` / `line_item_edited` / `line_item_deleted` events on user actions
- [ ] Calculate accuracy from events: (accepted + thumbs_up) / (total generated) per job
- [ ] Iterative scoping: POST /v1/jobs/{job_id}/photos/generate-scope with additional photos → merge new items with existing
- [ ] Update job status to "scoped" after first successful analysis
- [ ] pytest: scope endpoint triggers AI pipeline and returns line items
- [ ] pytest: manual line item CRUD (add, edit, delete)
- [ ] pytest: iterative scoping merges without duplicates
- [ ] pytest: event_history accuracy calculation
- [ ] pytest: push-to-report marks items as approved

### Phase 4: Scope Review UI — ❌
- [ ] "Generate Line Items" button on Photos tab (enabled when photos are tagged to rooms)
- [ ] Pre-analysis: "Tag Rooms" must be complete (photos assigned to rooms)
- [ ] Loading state: "AI is analyzing damage... Just a moment..." with spinner overlay
- [ ] "Generate Line Items" button changes to "Generating..." state during processing
- [ ] SSE events include `event_id` from the start (every streamed event carries the event_id)
- [ ] AI Photo Scope results page/section:
  - Summary paragraph at top: overall damage assessment description
  - "Push to Report →" button at top right
- [ ] Line items grouped by trade category with colored header bars:
  - MITIGATION (blue)
  - INSULATION (yellow)
  - DRYWALL (orange/peach)
  - PAINTING (yellow)
  - STRUCTURAL (gray)
  - GENERAL (green)
- [ ] Each line item row: CODE (colored text) | DESCRIPTION | UNIT | QTY | ROOM | justify icon | delete (x)
- [ ] Citations inline below relevant line items: "Citation: OSHA General Duty Clause 5(a)(1); IICRC S500 Sec 13.5.6.1 — AFDs required when particulates are aerosolized during demolition"
- [ ] Inline editing: tap any field to edit in place
- [ ] "+ Add Line Item" button at bottom of each category (or at bottom of all items)
- [ ] Delete line item: x button per item
- [ ] **Thumbs up / thumbs down per line item:** small icons next to each AI-generated item. Linked via `event_id` + item index. Thumbs up = "correct, good job." Thumbs down = "wrong" → triggers agentic retry for that photo. Feedback sent to centralized `POST /v1/ai/feedback`.
- [ ] **Thumbs up / thumbs down on hazmat findings and scope audit items too** — same pattern, different context, same feedback endpoint
- [ ] Non-obvious items: highlighted with special styling + "AI found this — you might have missed it"
- [ ] Streaming: line items appear progressively as AI generates them (SSE)
- [ ] Processing state: "Analyzing 12 photos... this takes 15-30 seconds"
- [ ] Failure state: "We couldn't analyze these photos. Try taking clearer photos." with retry
- [ ] Photo quality feedback: before AI analysis, check for blurry/dark/overexposed photos. Flag with "This photo may be too dark/blurry for accurate analysis — retake?" Allow user to proceed anyway or remove.
- [ ] "Re-run AI" button: select additional photos → run scope again → merge results
- [ ] Collapse/expand categories (x button on category header to collapse)

### Phase 5: Hazmat Scanner — ❌
**Backend:**
- [ ] Create `api/ai/hazmat.py` — hazmat scanning pipeline
- [ ] `POST /v1/jobs/{job_id}/photos/check-hazards` — trigger hazmat scan on job photos
- [ ] `GET /v1/jobs/{job_id}/hazmat-findings` — list findings
- [ ] `POST /v1/jobs/{job_id}/hazmat-findings/{finding_id}/add-to-report` — add finding to PDF report
- [ ] Asbestos Risk Scan: AI analyzes photos for ACMs (vermiculite insulation, pipe wrap, 9x9 floor tiles, popcorn ceiling, transite siding)
- [ ] Lead Paint Risk Scan: AI analyzes photos for lead paint indicators (alligatoring pattern, chalking, multi-layer peeling)
- [ ] Lead paint risk check: use property.year_built (via job.property_id) — pre-1978 = lead risk (EPA RRP rule)
- [ ] Per-finding output: material_name, location, risk_level (HIGH/MEDIUM/LOW), description ("What I see: ..."), next_steps ("Do not disturb. Have certified inspector...")
- [ ] Alembic migration: create hazmat_findings table

**Frontend:**
- [ ] "Check for Hazards" button on Photos tab toolbar
- [ ] Loading state: "Scanning for hazardous materials..."
- [ ] Asbestos Risk Scan section:
  - Disclaimer: "This scan uses AI visual analysis to flag materials that *may* contain asbestos... not a substitute for professional testing."
  - Summary: "4 potential ACMs identified across 4 photos"
  - Per-finding card: material name, photo reference, location, HIGH RISK badge, "What I see" description, next steps
  - "Order Test Kit →" CTA per finding
  - "Find Local Asbestos Abatement Contractors" — links by zip code (Google Maps, Angi, HomeAdvisor, EPA Directory)
  - "Add to Report →" button
- [ ] Lead Paint Risk Scan section:
  - Disclaimer: similar to asbestos
  - "Ask the Homeowner" prompt: "Do you know approximately when this home was built?"
  - Year input + "Check Risk →" button
  - If pre-1978: "Pre-1978 Home — Lead Test Recommended" with "Order Test Kit →" + "EPA Lead Info →"
- [ ] pytest: hazmat scan identifies known ACMs in test photos
- [ ] pytest: lead paint risk correctly flags pre-1978 homes

### Phase 6: Scope Check — ❌
**Backend:**
- [ ] Create `api/ai/auditor.py` — scope check pipeline
- [ ] `POST /v1/jobs/{job_id}/scope-check` — trigger AI scope check of current scope
- [ ] AI Scope Auditor analyzes:
  1. Line items in scope vs photos/rooms/readings (what's present vs what should be)
  2. S500/OSHA/EPA standards for what SHOULD be present given damage type
  3. Domain logic rules (Cat 2 → antimicrobial, affected rooms need equipment, source appliance disconnect, Class 2 → flood cut, etc.)
  4. Data quality (impossible moisture readings = data entry error)
- [ ] Output: list of flagged items with severity, title, room tag, Xactimate code badges, explanation
- [ ] Each flagged item has: one-click "Add to Scope" with auto-generated citation
- [ ] Severity levels: critical (alarm icon), warning (triangle icon), suggestion (lightbulb icon)

**Frontend:**
- [ ] "Scope Check" banner on Report tab: "Reviews your scope like a 10-year veteran — flags missed line items before it goes to the adjuster"
- [ ] "Scope Check" button
- [ ] Results: "10 items flagged — review before submitting to adjuster"
- [ ] Per-finding card (dark theme from Brett's demo):
  - Title (bold): "No Emergency Services or Water Extraction"
  - Room tag: "General" or specific room name
  - Xactimate code badges: `WTR - EXTRWTR`, `DRY - AIRM`, `DRY - DEHU`
  - Explanation: "Missing initial emergency response, water extraction, and drying equipment setup..."
  - Severity icon
- [ ] "Re-check" button after making changes
- [ ] pytest: auditor catches missing antimicrobial for Cat 2
- [ ] pytest: auditor flags impossible moisture readings
- [ ] pytest: auditor suggests equipment for affected rooms without equipment

### Phase 7: Job Assistant — ❌
**Backend:**
- [ ] Create `api/ai/assistant.py` — job assistant pipeline
- [ ] `POST /v1/jobs/{job_id}/assistant` — context-aware AI assistant
- [ ] Request schema: `AssistantRequest { message: str, screen_context: Literal['photos','floor_plan','scope','readings','general'], target_id: UUID | None }`
- [ ] Response schema: `AssistantResponse { reply: str, suggested_actions: list[SuggestedAction], event_id: UUID, cost_cents: int, duration_ms: int }`
- [ ] `SuggestedAction` = `AddLineItemAction | EditSketchAction | NavigateAction | ExplainAction`
- [ ] Context-aware: fetches relevant job data based on `screen_context` (e.g., scope screen → loads line items; photos screen → loads photo metadata)
- [ ] Validates `target_id` exists and belongs to the job when provided
- [ ] Uses `log_ai_event()` — returns `event_id` in response
- [ ] pytest: assistant returns valid response for each screen_context
- [ ] pytest: target_id validation rejects invalid IDs
- [ ] pytest: suggested_actions match expected types per screen_context

**Frontend:**
- [ ] Floating Action Button (FAB) on all job screens — opens Job Assistant panel
- [ ] Chat-style UI: user message → assistant reply with suggested actions
- [ ] Suggested actions rendered as tappable chips/buttons
- [ ] Screen context auto-detected from current route

### Phase 8: AI Feedback — ❌
**Backend:**
- [ ] Create `api/ai/feedback.py` — centralized AI feedback handler
- [ ] `POST /v1/ai/feedback` — submit feedback for any AI feature
- [ ] Request schema: `AIFeedbackRequest { event_id: UUID, item_id: str | None, rating: Literal['up','down'], comment: str | None }`
- [ ] Validates `event_id` belongs to the requesting user's company
- [ ] Validates the referenced event has `is_ai=true`
- [ ] Stores feedback linked to the original AI event
- [ ] pytest: feedback accepted for valid event_id
- [ ] pytest: feedback rejected for event_id from another company
- [ ] pytest: feedback rejected for non-AI events

**Frontend:**
- [ ] Thumbs up/down component reused across all AI features (scope, hazmat, scope check, assistant)
- [ ] Optional comment field on thumbs-down
- [ ] All feedback calls go through single `POST /v1/ai/feedback` endpoint

### ~~Phase 7 (old): Upload Past Jobs~~ → Moved to Spec 04 Phase 4
No separate scope_intelligence table. Past jobs are imported into the existing jobs + line_items schema with `jobs.source = 'imported'`. See Spec 04 for details.

### Phase 9: Integration Testing + Validation — ❌
- [ ] End-to-end test: upload photos → tag rooms → run scope → review items → edit → push to report → generate PDF (from Spec 01)
- [ ] End-to-end test: upload photos → hazmat scan → review findings → add to report
- [ ] End-to-end test: push to report → audit scope → add flagged items → re-audit → submit
- [ ] Test with public water damage photos (3-5 different scenarios: roof leak, basement flood, pipe burst, dishwasher leak)
- [ ] Verify AI produces real Xactimate codes (not made-up codes)
- [ ] Verify every line item has a citation
- [ ] Verify non-obvious items are flagged
- [ ] Verify output is in correct workflow order
- [ ] Verify trade categories assigned correctly
- [ ] Verify batch processing works (>10 photos)
- [ ] Verify iterative scoping merges correctly
- [ ] Measure actual AI cost per job analysis
- [ ] The Assignment: test with Brett's real job photos (when available) — target 80%+ accuracy

## Technical Approach

**AI pipeline architecture:**
```
1. User taps "Generate Line Items" on Photos tab
2. Pre-check: all photos must be tagged to rooms
3. POST /v1/jobs/{job_id}/photos/generate-scope
4. Fetch selected photos from Supabase Storage (signed URLs)
5. Resize each to 1920px max
6. Split into batches of 10
7. For each batch:
   a. Send to Claude Vision API with:
      - Xactimate code database (50+ WTR codes)
      - S500/OSHA reference sections
      - Hard rules (13 auto-add rules, language rules, physics rules)
      - Job context (loss_cause, water category, room dimensions)
      - Room assignments (which photos belong to which room)
   b. Claude returns structured JSON via tool-use
   c. Parse into line_item objects with trade categories
8. Merge all batches, deduplicate
9. Apply auto-add rules (check for missing non-obvious items)
10. Stream results to client via SSE
11. Client renders line items grouped by trade category
12. User reviews → edits → "Push to Report →"
13. Create event_history record for accuracy tracking
```

**Five AI endpoints:**
```
Generate Line Items  → POST /v1/jobs/{job_id}/photos/generate-scope  → line_items (via SSE)
Check for Hazards    → POST /v1/jobs/{job_id}/photos/check-hazards   → hazmat_findings
Scope Check          → POST /v1/jobs/{job_id}/scope-check            → flagged items
Job Assistant        → POST /v1/jobs/{job_id}/assistant              → assistant reply + suggested actions
AI Feedback          → POST /v1/ai/feedback                          → feedback record
```

**Prompt strategy:**
- Use Claude's tool-use mode — define a `generate_scope` tool with strict JSON schema
- This dramatically improves structured output reliability vs raw prompt-based JSON
- System prompt is ~2000 tokens (Xactimate codes + rules + instructions)
- Each batch is ~1000-3000 tokens of image input
- Total cost: ~$0.15-0.30 per job

**SSE streaming:**
- FastAPI SSE endpoint streams line items as they're generated
- Frontend uses EventSource or fetch + ReadableStream
- Every SSE event includes `event_id` (from `log_ai_event()`) for feedback tracking
- Each event: one line item as JSON with `event_id` and item index
- Final event: `{type: "complete", scope_run_id: "...", event_id: "..."}`

**`log_ai_event()` pattern:**
- Unlike fire-and-forget `log_event()`, `log_ai_event()` returns a `UUID` (the `event_id`)
- Raises on failure (not silent) — AI responses must have trackable events
- `event_id` is included in every SSE event and all AI endpoint responses
- Used by `POST /v1/ai/feedback` to link feedback to the originating AI action

**Shared AI service layer:**
- `backend/api/ai/client.py` — Anthropic SDK wrapper, retry logic, cost tracking
- `backend/api/ai/config.py` — model selection, token limits, feature flags
- `backend/api/ai/validator.py` — response validation, Xactimate code checking
- `backend/api/ai/prompts/` — prompt templates per feature (scope, hazmat, auditor, assistant)
- `backend/api/ai/tools/` — Claude tool-use definitions per feature

**Xactimate code matching:**
- AI generates codes from the embedded database
- Post-processing validates codes exist in our reference
- Invalid codes get flagged for manual correction
- V2: fuzzy matching + suggestion for close-but-wrong codes

**Key Files:**
- `backend/api/ai/pipeline.py` — photo scope orchestrator
- `backend/api/ai/prompt.py` — system prompt construction
- `backend/api/ai/parser.py` — structured output parsing
- `backend/api/ai/rules.py` — auto-add rules engine
- `backend/api/ai/hazmat.py` — hazmat scanning pipeline
- `backend/api/ai/auditor.py` — scope check pipeline
- `backend/api/ai/assistant.py` — job assistant pipeline
- `backend/api/ai/feedback.py` — centralized AI feedback handler
- `backend/api/ai/client.py` — Anthropic SDK wrapper
- `backend/api/ai/config.py` — model selection + feature config
- `backend/api/ai/validator.py` — response validation
- `backend/api/ai/prompts/` — prompt templates per feature
- `backend/api/ai/tools/` — Claude tool-use definitions
- `backend/api/ai/xactimate_codes.py` — code validation
- `backend/api/scope/router.py`, `service.py`, `schemas.py` — scope endpoints
- `web/src/app/(protected)/jobs/[id]/scope/` — scope review UI
- `web/src/components/line-item-card.tsx` — line item display + edit
- `web/src/components/scope-stream.tsx` — SSE stream consumer
- `web/src/components/hazmat-results.tsx` — hazmat findings display
- `web/src/components/scope-auditor.tsx` — audit results display

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1, AI pipeline core
# Prerequisite: Spec 01 (jobs + site log + floor plan) must be complete
# Note: Phase 1-2 (backend) can be built independently and tested via pytest
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **AI model:** Claude Vision API (Anthropic). Use tool-use/function-calling for structured output.
- **Structured output > raw JSON:** Tool-use mode dramatically improves schema conformance. Don't prompt for raw JSON.
- **Hard rules are non-negotiable:** 13 auto-add rules from Brett's domain expertise. These make the AI find money humans miss.
- **"Mold" is forbidden:** Insurance industry forbidden word. AI must NEVER use it. Use "visible staining" etc.
- **Activation metric:** User approves at least 1 non-obvious item. This is the "holy shit" moment.
- **Accuracy target:** 80%+ on Brett's first 5 real jobs. Accuracy = (kept unchanged) / (total final items).
- **V1 citation standards:** S500 + OSHA. V2 adds: S520, EPA, IRC, IBC, NIOSH (per Brett's feedback).
- **Iterative scoping:** Damage discovery is progressive. AI must support re-running on new photos and merging results.
- **Cost budget:** ~$0.15-0.30 per job. Track in event_history.ai_cost_cents.
- **The Assignment:** Test AI pipeline with real photos before building full UI. A 2-hour exercise that validates the entire product thesis.
- **Trade category grouping (from Brett's ScopeFlow demo):** Line items grouped by category with colored headers: Mitigation (blue), Insulation (yellow), Drywall (orange), Painting (yellow), Structural (gray), General (green). Categories drive which report items appear in (mitigation invoice vs full report). Categories are billing-critical — mitigation items get invoiced first for faster payment.
- **Citations inline:** Justifications show below the line item row, not in a separate column. "Citation: OSHA General Duty Clause 5(a)(1); IICRC S500 Sec 13.5.6.1 — AFDs required when particulates are aerosolized during demolition." Citations are the revenue tool — adjusters cannot argue with S500/OSHA citations.
- **Flow: Tag Rooms → Analyze → Review/Edit → Push to Report → Audit → Submit.** Two AI passes: one to generate (Photo Scope), one to audit (Scope Auditor). The audit is the "second expert overseeing before submitting."
- **Hazmat Scanner:** Two scan types — Asbestos Risk Scan + Lead Paint Risk Scan. AI analyzes photos for potential ACMs (vermiculite insulation, pipe wrap, 9x9 floor tiles) and lead paint indicators (alligatoring). Per-finding: material name, location, risk level (HIGH RISK badge), "What I see" description, next steps. Lead paint uses year_built (pre-1978 = risk). Mandatory disclaimer. Local contractor referrals by zip. Future revenue: sponsored listings + test kit affiliates.
- **AI Scope Auditor — three audit sources (shipped progressively):**
  - **(a) AI REAL-TIME (this spec):** Analyzes current job against S500/OSHA/EPA standards. Works from job #1.
  - **(b) AI PAST HISTORY (V2):** Learns from contractor's own past jobs + uploaded PDFs. "You had a similar job last month — you added this there but it's missing here."
  - **(c) AI NETWORK (V3/Spec 03):** Anonymized aggregate from all contractors. "92% of contractors add this for Cat 2 losses."
- **AI as coach:** References specific past jobs. Reinforces good catches ("Good catch — you missed this on your last 3 jobs"). Catches regressions. Reduces noise over time by learning contractor patterns.
- **Scope Intelligence / Train AI:** Upload up to 10 past scope PDFs. AI extracts line items, pricing patterns, identifies gaps. Can be part of onboarding or accessed anytime. Makes Scope Auditor smarter for future jobs.
- **Future AI features from Brett's brainstorm sessions (post-V1):**
  - **AI Deposition Prep Assistant** — feed job record, AI prepares contractor for litigation questions
  - **Equipment ROI Tracker** — AI tracks which equipment generates most billing
  - **Supplement Trigger Engine** — flags when material/labor cost changes justify a supplement
- **Voice scoping UX decision:** Guided form approach tested poorly with Brett — too rigid. V2 voice must use free-form AI extraction. Two modes: Continuous and Push-to-Talk. See `docs/research/brett-prototype-sessions.md`.
- **User-facing names drop "AI":** "Generate Line Items" not "Analyze with AI", "Scope Check" not "AI Scope Auditor", "Check for Hazards" not "Hazard Scan". Users don't care that it's AI — they care what it does.
- **Three-layer frontend pattern:** Primary action button per screen (e.g., "Generate Line Items" on Photos tab), secondary toolbar actions (e.g., "Check for Hazards", "Scope Check"), and Job Assistant FAB available on all screens.
- **Sketch cleanup is deterministic code:** Geometry math (wall snapping, room closing, angle correction) is NOT an LLM task. Use computational geometry, not Claude.
- **Model selection:** Sonnet 4 for complex features (photo scope, scope check, assistant). Haiku 3.5 for lightweight tasks (voice transcription quality check, photo quality assessment).
- **All AI responses include event_id:** Every AI endpoint returns an `event_id` (UUID) from `log_ai_event()`. This enables centralized feedback tracking via `POST /v1/ai/feedback`.
