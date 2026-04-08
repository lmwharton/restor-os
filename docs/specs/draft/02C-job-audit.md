# Job Audit — Full Job Review Before Adjuster Submission

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/2 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 02A (scope endpoints + shared AI layer) |
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
- [ ] "Run Job Audit" via `POST /v1/jobs/{job_id}/audit` — full job review before adjuster submission
- [ ] Re-examines photos for damage the scope missed (fresh AI eyes on the same photos)
- [ ] Cross-checks readings against scope (moisture at 40% but no drying equipment? flag it)
- [ ] Validates data quality (impossible moisture readings, missing room assignments, incomplete data)
- [ ] Checks line items against S500/OSHA/EPA standards for completeness
- [ ] Flagged items with severity (critical/warning/suggestion), title, room, Xactimate codes, explanation
- [ ] One-click "Add to Scope" with auto-generated citation per flagged item
- [ ] Re-audit after making changes
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Before sending a scope to the adjuster, contractors have no way to know if they missed something. No second set of eyes. Missed items = lost revenue. Bad data = rejected claims.

**Solution:** Job Audit — a full review of the entire job before submission. A different AI model re-examines everything with fresh eyes: the photos (did PhotoScope miss visible damage?), the readings (do they match the scope?), the data quality (typos, missing info), and the standards compliance (S500/OSHA). It's like having a 10-year veteran PM review your work before it goes to the adjuster.

**What it audits (four layers):**
1. **Photo re-examination** — AI looks at the damage photos again independently. Catches damage PhotoScope missed, flags discrepancies between what's visible and what's scoped.
2. **Scope completeness** — Checks line items against S500/OSHA/EPA standards. Cat 2 water → antimicrobial required. Drywall removal → containment required. Equipment in use → decon required.
3. **Readings cross-check** — Moisture readings vs scope. High readings + no drying equipment = flag. Readings inconsistent across rooms = flag.
4. **Data quality** — Impossible values (moisture > 100%), missing room assignments, photos not tagged, incomplete job info.

**Scope:**
- IN: Full job audit (photos, scope, readings, data quality, standards), flagged items with severity, one-click add, re-audit flow
- OUT: AI past history learning (V2), AI network intelligence (V3), carrier-specific rules (V3)

**Three-layer audit (shipped progressively):**
- **(a) AI REAL-TIME (this spec):** Analyzes current job against standards. Works from job #1.
- **(b) AI PAST HISTORY (V2):** Learns from contractor's own past jobs. "You had a similar job last month — you added this there but it's missing here."
- **(c) AI NETWORK (V3):** Anonymized aggregate. "92% of contractors add this for Cat 2 losses."

## Phases & Checklist

### Phase 1: Backend — ❌
- [ ] Create `api/ai/auditor.py` — full job audit pipeline
- [ ] `POST /v1/jobs/{job_id}/audit` — trigger full job audit
- [ ] **Photo re-examination:** Send damage photos to Claude Vision (different prompt than PhotoScope) to independently assess what damage is visible. Compare AI findings against existing line items. Flag discrepancies: "Photo shows ceiling damage in Kitchen but no ceiling line items in scope."
- [ ] **Scope completeness check:** Analyze line items against S500/OSHA/EPA standards:
  - Cat 2 → antimicrobial required
  - Drywall removal → containment + air scrubber required
  - Affected rooms → drying equipment required
  - Source appliance → disconnect line item
  - Class 2+ → flood cut at wicking height
  - Any demolition → floor protection + PPE
- [ ] **Readings cross-check:** Compare moisture readings against scope:
  - High readings + no drying equipment = critical flag
  - Readings declining but equipment already removed = flag
  - Readings inconsistent across adjacent rooms = warning
- [ ] **Data quality validation:**
  - Impossible values (moisture > 100%, negative quantities)
  - Missing room assignments on line items
  - Photos not tagged to rooms
  - Incomplete job info (no water category, no loss cause)
- [ ] Output: list of flagged items with severity, title, room tag, Xactimate code badges, explanation, audit_layer (photo/scope/readings/data)
- [ ] Each flagged item has: one-click "Add to Scope" with auto-generated citation
- [ ] Severity levels: critical (alarm icon), warning (triangle icon), suggestion (lightbulb icon)
- [ ] Uses shared AI service layer from Spec 02A (vision=True for photo re-exam)
- [ ] Log `job_audit` event to event_history
- [ ] pytest: auditor catches missing antimicrobial for Cat 2
- [ ] pytest: auditor flags impossible moisture readings
- [ ] pytest: auditor suggests equipment for rooms without equipment
- [ ] pytest: auditor catches damage visible in photos but missing from scope
- [ ] pytest: auditor flags incomplete job data

### Phase 2: Frontend — ❌
- [ ] "Job Audit" banner on Report tab: "Reviews your entire job like a 10-year veteran — photos, scope, readings, everything — before it goes to the adjuster"
- [ ] "Run Job Audit" button
- [ ] Results grouped by audit layer:
  - 📸 **Photo Findings** — "AI re-examined your photos and found 2 issues"
  - 📋 **Scope Gaps** — "3 items missing based on S500 standards"
  - 📊 **Reading Issues** — "1 reading doesn't match the scope"
  - ⚠️ **Data Quality** — "2 data issues to fix"
- [ ] Per-finding card (dark theme from Brett's demo):
  - Title (bold): "No Emergency Services or Water Extraction"
  - Audit layer badge: [Photo] / [Scope] / [Readings] / [Data]
  - Room tag: "General" or specific room name
  - Xactimate code badges: `WTR - EXTRWTR`, `DRY - AIRM`, `DRY - DEHU`
  - Explanation: "Missing initial emergency response, water extraction, and drying equipment setup..."
  - Severity icon
- [ ] "Add to Scope" button per finding — one click adds line items with auto-citation
- [ ] "Re-audit" button after making changes
- [ ] Thumbs up/down on audit findings (uses Spec 02E feedback endpoint)

## Technical Approach

- Reuses shared AI service layer from Spec 02A
- **Two Claude calls per audit:**
  1. **Photo re-examination** (vision=True) — sends photos with a fresh auditor prompt, not the PhotoScope prompt. Different model perspective on the same images.
  2. **Scope/readings/data analysis** (vision=False) — analyzes line items, readings, job data against standards. Text-only, no photos.
- Results from both calls merged into a single findings list, tagged by audit_layer
- Model: Sonnet 4 for both calls (needs deep reasoning about standards + visual analysis)
- Prompt templates in `backend/api/ai/prompts/auditor.py` (two prompts: photo_audit + scope_audit)
- Stream thinking for both: "Re-examining photos... I see ceiling damage in Kitchen that isn't in the scope..."

**Key Files:**
- `backend/api/ai/auditor.py` — full job audit pipeline (orchestrates both Claude calls)
- `backend/api/ai/prompts/auditor.py` — two prompt templates (photo re-exam + scope/data audit)
- `web/src/components/job-audit.tsx` — audit results display grouped by layer

## Decisions & Notes

- **Fresh eyes, not a re-run:** The photo re-examination uses a completely different prompt than PhotoScope. It's a second opinion, not a repeat. This catches things PhotoScope's prompt biases might miss.
- **AI as coach:** References specific patterns. Reinforces good catches. Reduces noise over time.
- **Two AI passes across the product:** PhotoScope generates (02A), Job Audit reviews (02C). Different prompts, potentially different reasoning, same model.
- **V1 = real-time only.** Past history (V2) and network intelligence (V3) come later.
- **Model selection:** Sonnet 4 for both audit calls (complex reasoning about standards + vision).

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|
