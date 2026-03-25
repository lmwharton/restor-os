# AI Pipeline — Photo Scope, Line Items, Justifications

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/5 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 01 (jobs + photos) must be complete |
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
- [ ] User selects damage photos → taps "Run AI Scope" → sees Xactimate line items stream in within 15-30 seconds
- [ ] Every line item has an S500 or OSHA justification (no item without a citation)
- [ ] Non-obvious items highlighted with orange border + "AI found this — you might have missed it"
- [ ] User can edit any line item inline (code, description, quantity, unit)
- [ ] User can add manual line items and delete AI-generated ones
- [ ] User can re-run AI on additional photos (iterative scoping — new items merge with existing)
- [ ] Accuracy tracking: scope_runs records AI accuracy per job
- [ ] AI pipeline works on Brett's first 5 real jobs at 80%+ accuracy
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Contractors spend 2-4 hours per job manually entering Xactimate line items. They scope from memory, miss non-obvious billable items (HEPA filters, baseboard removal, equipment decon, PPE), and leave money on the table. No tool on the market converts damage photos to Xactimate line items.

**Solution:** AI Photo Scope — select damage photos, AI analyzes them via Claude Vision, generates structured Xactimate line items with S500/OSHA justifications, highlights non-obvious items the contractor would have missed. Contractor reviews, edits, approves. This is the core differentiator. Zero competitors offer this.

**Scope:**
- IN: Claude Vision integration, Xactimate code matching, S500/OSHA justification generation, structured output parsing, batch processing, iterative scoping, line item CRUD, scope review UI, accuracy tracking
- OUT: Voice scoping, moisture readings, equipment suggestions, carrier-specific rules, supplement detection, hazmat scanning

## Phases & Checklist

### Phase 1: AI Pipeline Core (Backend) — ❌
- [ ] Create `api/ai/pipeline.py` — main photo scope orchestrator
- [ ] Create `api/ai/prompt.py` — system prompt with all hard rules + Xactimate code database
- [ ] Create `api/ai/parser.py` — parse Claude's structured output into line items
- [ ] Integrate Claude Vision API (anthropic Python SDK)
- [ ] Use Claude tool-use/function-calling mode for structured JSON output (not raw prompt-based JSON)
- [ ] Structured output schema: xactimate_code, description, unit, quantity, justifications[], is_non_obvious, confidence
- [ ] Photo preprocessing: fetch from Supabase Storage, resize to 1920px max before sending
- [ ] Batch processing: max 10 photos per API call, split larger sets into batches
- [ ] Batch merging: deduplicate on xactimate_code + description, keep higher quantity
- [ ] Timeout handling: 60-second timeout per batch, return partial results on timeout
- [ ] Cost tracking: calculate AI cost per job, store in scope_runs.ai_cost_cents

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
- [ ] pytest: prompt includes all hard rules
- [ ] pytest: "mold" never appears in any AI output (test with multiple scenarios)
- [ ] pytest: auto-add rules fire correctly (drywall removal → baseboard + air scrubber)
- [ ] pytest: output is in correct workflow order

### Phase 3: Scope Endpoints + Accuracy Tracking — ❌
- [ ] Create `api/scope/schemas.py` — Pydantic models for scope request/response/line items
- [ ] Create `api/scope/service.py` — orchestrates pipeline, stores results
- [ ] Create `api/scope/router.py` — route handlers
- [ ] `POST /v1/jobs/:id/scope` — trigger AI Photo Scope (SSE streaming response)
- [ ] `GET /v1/jobs/:id/scope` — get current scope results (all line items for job)
- [ ] `POST /v1/jobs/:id/scope/items` — add manual line item
- [ ] `PATCH /v1/jobs/:id/scope/items/:iid` — edit line item (code, description, qty, unit)
- [ ] `DELETE /v1/jobs/:id/scope/items/:iid` — delete line item
- [ ] On scope run: create scope_runs record with photo_count, ai_items_generated, duration_ms
- [ ] On user edits: update scope_runs with items_kept, items_edited, items_deleted, items_added_manually
- [ ] Calculate accuracy: (items kept unchanged) / (total items in final scope)
- [ ] Iterative scoping: POST /v1/jobs/:id/scope with additional photos → merge new items with existing
- [ ] Update job status to "scoped" after first successful scope run
- [ ] pytest: scope endpoint triggers AI pipeline and returns line items
- [ ] pytest: manual line item CRUD (add, edit, delete)
- [ ] pytest: iterative scoping merges without duplicates
- [ ] pytest: scope_runs accuracy calculation

### Phase 4: Scope Review UI — ❌
- [ ] Line Items tab on job detail: list of generated Xactimate line items
- [ ] Each item displays: Xactimate code, description, quantity + unit, S500/OSHA justification
- [ ] Non-obvious items: orange left border + "AI found this — you might have missed it" label
- [ ] Streaming: line items appear one at a time as AI generates them (SSE → client renders progressively)
- [ ] Processing state: "Analyzing 12 photos... this takes 15-30 seconds" with progress indicator
- [ ] Failure state: "We couldn't analyze these photos. Try taking clearer photos." with retry button
- [ ] Timeout state: "Analysis is taking longer than usual. You can wait or try again."
- [ ] Inline editing: tap any field (code, description, quantity, unit) to edit in place
- [ ] Add manual line item: "Add line item" button at bottom → empty row for manual entry
- [ ] Delete line item: swipe-to-delete on mobile, delete button on desktop
- [ ] "What did AI miss?" button: prominent, opens manual add flow. Reframes AI as assistant, not authority.
- [ ] "Re-run AI" button: select additional photos → run scope again → merge results
- [ ] Photo evidence per line item (V1.1): "Detected in Photo 3" with thumbnail (stretch goal)
- [ ] Running total at bottom: estimated scope value in dollars (stretch goal)

### Phase 5: Integration Testing + Validation — ❌
- [ ] End-to-end test: upload photos → run scope → review items → edit → export PDF (from Spec 01)
- [ ] Test with public water damage photos (3-5 different scenarios: roof leak, basement flood, pipe burst)
- [ ] Verify AI produces real Xactimate codes (not made-up codes)
- [ ] Verify every line item has a justification
- [ ] Verify non-obvious items are flagged
- [ ] Verify output is in correct workflow order
- [ ] Verify batch processing works (>10 photos)
- [ ] Verify iterative scoping merges correctly
- [ ] Measure actual AI cost per job analysis
- [ ] The Assignment: test with Brett's real job photos (when available) — target 80%+ accuracy

## Technical Approach

**AI pipeline architecture:**
```
1. POST /v1/jobs/:id/scope
2. Fetch selected photos from Supabase Storage (signed URLs)
3. Resize each to 1920px max
4. Split into batches of 10
5. For each batch:
   a. Send to Claude Vision API with:
      - Xactimate code database (50+ WTR codes)
      - S500/OSHA reference sections
      - Hard rules (13 auto-add rules, language rules, physics rules)
      - Job context (loss_cause, water category)
   b. Claude returns structured JSON via tool-use
   c. Parse into line_item objects
6. Merge all batches, deduplicate
7. Apply auto-add rules (check for missing non-obvious items)
8. Stream results to client via SSE
9. Client renders line items progressively
10. On user edits → update line_items table
11. Create scope_runs record for accuracy tracking
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
- Each event: one line item as JSON
- Final event: `{type: "complete", scope_run_id: "..."}`

**Xactimate code matching:**
- AI generates codes from the embedded database
- Post-processing validates codes exist in our reference
- Invalid codes get flagged for manual correction
- V2: fuzzy matching + suggestion for close-but-wrong codes

**Key Files:**
- `backend/api/ai/pipeline.py` — orchestrator
- `backend/api/ai/prompt.py` — system prompt construction
- `backend/api/ai/parser.py` — structured output parsing
- `backend/api/ai/rules.py` — auto-add rules engine
- `backend/api/ai/xactimate_codes.py` — code validation
- `backend/api/scope/router.py`, `service.py`, `schemas.py` — endpoints
- `web/src/app/(protected)/jobs/[id]/scope/` — scope review UI
- `web/src/components/line-item-card.tsx` — line item display + edit component
- `web/src/components/scope-stream.tsx` — SSE stream consumer

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1, AI pipeline core
# Prerequisite: Spec 01 (jobs + photos) must be complete
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
- **V1 justification standards:** S500 + OSHA. V2 adds: S520, EPA, IRC, IBC, NIOSH (per Brett's feedback).
- **Iterative scoping:** Damage discovery is progressive. AI must support re-running on new photos and merging results.
- **Cost budget:** ~$0.15-0.30 per job. Track in scope_runs.ai_cost_cents.
- **The Assignment:** Test AI pipeline with real photos before building full UI. A 2-hour exercise that validates the entire product thesis.
