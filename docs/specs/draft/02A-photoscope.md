# PhotoScope — Damage Photos → Xactimate Line Items

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/5 phases) |
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
- [ ] "Generate Line Items" via `POST /v1/jobs/{job_id}/photos/generate-scope` — user selects damage photos → taps "Generate Line Items" → sees Xactimate line items stream in within 15-30 seconds
- [ ] Line items grouped by trade category (Mitigation, Insulation, Drywall, Painting, Structural, General) with colored headers
- [ ] Every line item has an S500/OSHA citation inline (no item without citation)
- [ ] Non-obvious items highlighted with "AI found this — you might have missed it"
- [ ] User can edit any line item inline (code, description, quantity, unit, room)
- [ ] User can add manual line items and delete AI-generated ones
- [ ] User can re-run AI on additional photos (iterative scoping — new items merge with existing)
- [ ] "Push to Report →" sends approved items to PDF report
- [ ] Accuracy tracking: event_history records AI accuracy per job
- [ ] AI pipeline works on Brett's first 5 real jobs at 80%+ accuracy
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Contractors spend 2-4 hours per job manually entering Xactimate line items. They scope from memory, miss non-obvious billable items (HEPA filters, baseboard removal, equipment decon, PPE), and leave money on the table. No tool on the market converts damage photos to Xactimate line items.

**Solution:** PhotoScope — select damage photos → AI generates Xactimate line items with S500/OSHA citations, grouped by trade category. While analyzing, the AI narrates what it sees ("I can see water staining on the ceiling, baseboard is swollen...") so the contractor watches the AI work instead of staring at a spinner. Contractor reviews, edits, approves, pushes to report.

**Scope:**
- IN: Claude Vision integration, Xactimate code matching, S500/OSHA/EPA citation generation, per-photo analysis, agentic retry (auto + manual), line item CRUD, trade category grouping, accuracy tracking (via event_history from Spec 01), Push to Report flow, SSE streaming
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

## Phases & Checklist

### Phase 1: AI Pipeline Core (Backend) — ❌
- [ ] Create `api/ai/pipeline.py` — main photo scope orchestrator
- [ ] Create `api/ai/prompt.py` — system prompt with all hard rules + Xactimate code database
- [ ] Create `api/ai/parser.py` — parse Claude's structured output into line items
- [ ] Integrate Claude Vision API (anthropic Python SDK)
- [ ] Use Claude tool-use/function-calling mode for structured JSON output (not raw prompt-based JSON)
- [ ] Structured output schema: xactimate_code, description, unit, quantity, category, room, citations[], is_non_obvious
- [ ] Per-photo analysis: each photo analyzed individually by AI. AI returns what it sees in THAT photo + line items. Photos processed sequentially within batches of up to 10.
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
- [ ] **Thinking stream UX:** Instead of a dead spinner, stream Claude's extended thinking to the user as narrated analysis. AI describes what it sees in each photo ("I can see water damage along the baseboards — staining reaches about 18 inches up the drywall...") before line items appear. Uses SSE `thinking` events.
- [ ] Loading state: thinking stream fills the wait time, with photo progress indicator
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
- [ ] **Thumbs up / thumbs down per line item:** small icons next to each AI-generated item. Linked via `event_id` + item index. Thumbs up = "correct, good job." Thumbs down = "wrong" → triggers agentic retry for that photo. Feedback sent to `POST /v1/ai/feedback` (Spec 02E).
- [ ] Non-obvious items: highlighted with special styling + "AI found this — you might have missed it"
- [ ] Streaming: line items appear progressively as AI generates them (SSE)
- [ ] Processing state: "Analyzing 12 photos... this takes 15-30 seconds"
- [ ] Failure state: "We couldn't analyze these photos. Try taking clearer photos." with retry
- [ ] Photo quality feedback: before AI analysis, check for blurry/dark/overexposed photos. Flag with "This photo may be too dark/blurry for accurate analysis — retake?" Allow user to proceed anyway or remove.
- [ ] "Re-run AI" button: select additional photos → run scope again → merge results
- [ ] Collapse/expand categories (x button on category header to collapse)

### Phase 5: Integration Testing + Validation — ❌
- [ ] End-to-end test: upload photos → tag rooms → run scope → review items → edit → push to report → generate PDF (from Spec 01)
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
- Used by `POST /v1/ai/feedback` (Spec 02E) to link feedback to the originating AI action

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
- `backend/api/ai/client.py` — Anthropic SDK wrapper
- `backend/api/ai/config.py` — model selection + feature config
- `backend/api/ai/validator.py` — response validation
- `backend/api/ai/prompts/` — prompt templates
- `backend/api/ai/tools/` — Claude tool-use definitions
- `backend/api/ai/xactimate_codes.py` — code validation
- `backend/api/scope/router.py`, `service.py`, `schemas.py` — scope endpoints
- `web/src/app/(protected)/jobs/[id]/scope/` — scope review UI
- `web/src/components/line-item-card.tsx` — line item display + edit
- `web/src/components/scope-stream.tsx` — SSE stream consumer

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1, AI pipeline core
# No blockers — Spec 01 jobs is complete
# Phases 1-3 (backend) can be built and tested independently via pytest
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
- **Trade category grouping (from Brett's ScopeFlow demo):** Line items grouped by category with colored headers. Categories drive which report items appear in (mitigation invoice vs full report). Categories are billing-critical — mitigation items get invoiced first for faster payment.
- **Citations inline:** Justifications show below the line item row. Citations are the revenue tool — adjusters cannot argue with S500/OSHA citations.
- **Flow: Tag Rooms → Analyze → Review/Edit → Push to Report.** 
- **User-facing names drop "AI":** "Generate Line Items" not "Analyze with AI". Users don't care that it's AI — they care what it does.
- **Model selection:** Sonnet 4 for photo scope (complex vision + structured output).
- **All AI responses include event_id:** Every AI endpoint returns an `event_id` (UUID) from `log_ai_event()`. Enables feedback tracking via Spec 02E.
- **Thumbs up/down per line item:** Uses centralized AI Feedback endpoint from Spec 02E.
