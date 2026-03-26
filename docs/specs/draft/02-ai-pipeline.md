# AI Pipeline — Photo Scope, Hazmat Scanner, Scope Auditor

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/8 phases) |
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
- [ ] User selects damage photos → taps "Analyze with AI" → sees Xactimate line items stream in within 15-30 seconds
- [ ] Line items grouped by trade category (Mitigation, Insulation, Drywall, Painting, Structural, General) with colored headers
- [ ] Every line item has an S500/OSHA citation inline (no item without citation)
- [ ] Non-obvious items highlighted with "AI found this — you might have missed it"
- [ ] User can edit any line item inline (code, description, quantity, unit, room)
- [ ] User can add manual line items and delete AI-generated ones
- [ ] User can re-run AI on additional photos (iterative scoping — new items merge with existing)
- [ ] "Push to Report →" sends approved items to PDF report
- [ ] Hazmat Scanner: "Hazard Scan" button scans photos for asbestos + lead paint risk
- [ ] AI Scope Auditor: "Audit Scope" reviews scope for missed items before submission (AI real-time source)
- [ ] Scope Intelligence: "Train AI" accepts uploaded past scope PDFs to learn contractor patterns
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
- IN: Claude Vision integration, Xactimate code matching, S500/OSHA/EPA citation generation, per-photo analysis, agentic retry (auto + manual), thumbs up/down feedback, line item CRUD, trade category grouping, scope review UI, accuracy tracking (via event_history from Spec 01), hazmat scanning (asbestos + lead paint), scope auditing, scope intelligence (Train AI with past PDFs), Push to Report flow
- OUT: Voice scoping (Spec 03), network intelligence (V3/Spec 05), carrier-specific rules (V3), supplement detection (V2.5)
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

**scope_intelligence** (NEW — uploaded past scopes for training)
```sql
CREATE TABLE scope_intelligence (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    source_filename TEXT NOT NULL,
    storage_url     TEXT NOT NULL,
    extracted_data  JSONB,            -- parsed line items, patterns, pricing from PDF
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | completed | failed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

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
- [ ] `POST /v1/jobs/:id/scope` — trigger AI Photo Scope (SSE streaming response)
- [ ] `GET /v1/jobs/:id/scope` — get current scope results (all line items for job, grouped by category)
- [ ] `POST /v1/jobs/:id/scope/items` — add manual line item (source: 'manual')
- [ ] `PATCH /v1/jobs/:id/scope/items/:iid` — edit line item (code, description, qty, unit, room, category)
- [ ] `DELETE /v1/jobs/:id/scope/items/:iid` — delete line item
- [ ] `POST /v1/jobs/:id/scope/push-to-report` — mark items as approved, transition to report
- [ ] Alembic migration: create line_items table (with category TEXT field, citation JSONB)
- [ ] Log `ai_photo_analysis` event to event_history on each photo analysis (photo_id, duration_ms, ai_cost_cents, line_items_generated)
- [ ] Log `line_item_generated` event for each AI-generated line item
- [ ] Log `line_item_accepted` / `line_item_edited` / `line_item_deleted` events on user actions
- [ ] Calculate accuracy from events: (accepted + thumbs_up) / (total generated) per job
- [ ] Iterative scoping: POST /v1/jobs/:id/scope with additional photos → merge new items with existing
- [ ] Update job status to "scoped" after first successful analysis
- [ ] pytest: scope endpoint triggers AI pipeline and returns line items
- [ ] pytest: manual line item CRUD (add, edit, delete)
- [ ] pytest: iterative scoping merges without duplicates
- [ ] pytest: event_history accuracy calculation
- [ ] pytest: push-to-report marks items as approved

### Phase 4: Scope Review UI — ❌
- [ ] "Analyze with AI" button on Photos tab (enabled when photos are tagged to rooms)
- [ ] Pre-analysis: "Tag Rooms" must be complete (photos assigned to rooms)
- [ ] Loading state: "AI is analyzing damage... Just a moment..." with spinner overlay
- [ ] "Analyze with AI" button changes to "Analyzing..." state during processing
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
- [ ] **Thumbs up / thumbs down per line item:** small icons next to each AI-generated item. Thumbs up = "correct, good job." Thumbs down = "wrong" → triggers agentic retry for that photo. Logs ai_feedback_thumbs_up/down event.
- [ ] **Thumbs up / thumbs down on hazmat findings and scope audit items too** — same pattern, different context
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
- [ ] `POST /v1/jobs/:id/hazmat-scan` — trigger hazmat scan on job photos
- [ ] `GET /v1/jobs/:id/hazmat-findings` — list findings
- [ ] `POST /v1/jobs/:id/hazmat-findings/:fid/add-to-report` — add finding to PDF report
- [ ] Asbestos Risk Scan: AI analyzes photos for ACMs (vermiculite insulation, pipe wrap, 9x9 floor tiles, popcorn ceiling, transite siding)
- [ ] Lead Paint Risk Scan: AI analyzes photos for lead paint indicators (alligatoring pattern, chalking, multi-layer peeling)
- [ ] Lead paint risk check: use property.year_built (via job.property_id) — pre-1978 = lead risk (EPA RRP rule)
- [ ] Per-finding output: material_name, location, risk_level (HIGH/MEDIUM/LOW), description ("What I see: ..."), next_steps ("Do not disturb. Have certified inspector...")
- [ ] Alembic migration: create hazmat_findings table

**Frontend:**
- [ ] "Hazard Scan" button on Photos tab toolbar
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

### Phase 6: AI Scope Auditor — ❌
**Backend:**
- [ ] Create `api/ai/auditor.py` — scope audit pipeline
- [ ] `POST /v1/jobs/:id/scope/audit` — trigger AI audit of current scope
- [ ] AI Scope Auditor analyzes:
  1. Line items in scope vs photos/rooms/readings (what's present vs what should be)
  2. S500/OSHA/EPA standards for what SHOULD be present given damage type
  3. Domain logic rules (Cat 2 → antimicrobial, affected rooms need equipment, source appliance disconnect, Class 2 → flood cut, etc.)
  4. Data quality (impossible moisture readings = data entry error)
- [ ] Output: list of flagged items with severity, title, room tag, Xactimate code badges, explanation
- [ ] Each flagged item has: one-click "Add to Scope" with auto-generated citation
- [ ] Severity levels: critical (alarm icon), warning (triangle icon), suggestion (lightbulb icon)

**Frontend:**
- [ ] "AI Scope Auditor" banner on Report tab: "Reviews your scope like a 10-year veteran — flags missed line items before it goes to the adjuster"
- [ ] "Audit Scope" button
- [ ] Results: "10 items flagged — review before submitting to adjuster"
- [ ] Per-finding card (dark theme from Brett's demo):
  - Title (bold): "No Emergency Services or Water Extraction"
  - Room tag: "General" or specific room name
  - Xactimate code badges: `WTR - EXTRWTR`, `DRY - AIRM`, `DRY - DEHU`
  - Explanation: "Missing initial emergency response, water extraction, and drying equipment setup..."
  - Severity icon
- [ ] "Re-Audit" button after making changes
- [ ] "Train AI" button → opens Scope Intelligence modal
- [ ] pytest: auditor catches missing antimicrobial for Cat 2
- [ ] pytest: auditor flags impossible moisture readings
- [ ] pytest: auditor suggests equipment for affected rooms without equipment

### Phase 7: Scope Intelligence (Train AI) — ❌
**Backend:**
- [ ] Create `api/ai/intelligence.py` — scope intelligence pipeline
- [ ] `POST /v1/company/scope-intelligence/upload` — upload past scope PDFs (up to 10)
- [ ] `GET /v1/company/scope-intelligence` — list uploaded scopes + extraction status
- [ ] PDF parsing: extract line items, pricing patterns, category distribution from uploaded scopes
- [ ] Alembic migration: create scope_intelligence table
- [ ] Store extracted data in scope_intelligence table
- [ ] Feed extracted patterns into Scope Auditor prompts for personalized suggestions

**Frontend:**
- [ ] "Scope Intelligence" modal (triggered by "Train AI" button):
  - "Train AI on your past scopes"
  - "Upload your 10 most recent insurance scopes (PDF). AI will extract your line items, pricing patterns, and identify where you've been leaving money on the table."
  - Drag-and-drop upload zone: "Tap to select PDFs or drag and drop — up to 10 scopes"
  - "Analyze Scopes →" button
  - Processing status per PDF
- [ ] Can be part of onboarding flow (first-time setup) or accessed from Scope Auditor
- [ ] pytest: PDF upload and extraction produces valid line item data
- [ ] pytest: extracted patterns influence auditor suggestions

### Phase 8: Integration Testing + Validation — ❌
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
1. User taps "Analyze with AI" on Photos tab
2. Pre-check: all photos must be tagged to rooms
3. POST /v1/jobs/:id/scope
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

**Three AI actions on Photos tab:**
```
Hazard Scan    → POST /v1/jobs/:id/hazmat-scan    → hazmat_findings
Analyze with AI → POST /v1/jobs/:id/scope          → line_items (via SSE)
Audit Scope    → POST /v1/jobs/:id/scope/audit    → flagged items
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
- `backend/api/ai/pipeline.py` — photo scope orchestrator
- `backend/api/ai/prompt.py` — system prompt construction
- `backend/api/ai/parser.py` — structured output parsing
- `backend/api/ai/rules.py` — auto-add rules engine
- `backend/api/ai/hazmat.py` — hazmat scanning pipeline
- `backend/api/ai/auditor.py` — scope auditor pipeline
- `backend/api/ai/intelligence.py` — scope intelligence (Train AI)
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
