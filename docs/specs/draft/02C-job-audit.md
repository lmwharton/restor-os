# Job Audit — Full Job Review Before Adjuster Submission

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/3 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 02A (scope endpoints + shared AI layer + Celery/Redis) |
| **Branch** | TBD |
| **Issue** | TBD |
| **Implementation Phase** | Phase 2 (after PhotoScope + HazmatCheck ship) |

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
- [ ] "Run Job Audit" via `POST /v1/audit/run` — full job review before adjuster submission
- [ ] Re-examines photos for damage the scope missed (fresh AI eyes, different prompt)
- [ ] Cross-checks readings against scope (moisture at 40% but no drying equipment? flag it)
- [ ] Validates data quality (impossible moisture readings, missing room assignments, incomplete data)
- [ ] Checks line items against S500/OSHA/EPA standards for completeness
- [ ] Flagged items with severity (critical/warning/suggestion), room, Xactimate codes, explanation
- [ ] Each finding tagged with audit layer: photo / scope / readings / data
- [ ] One-click "Add to Scope" with auto-generated citation per flagged item
- [ ] Re-audit after making changes
- [ ] Tone: "Here's $2,400 you almost left on the table" not "You missed 5 items"
- [ ] SSE + Celery architecture (same as 02A)
- [ ] Thinking stream: AI narrates audit process
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Before sending a scope to the adjuster, contractors have no way to know if they missed something. No second set of eyes. Missed items = lost revenue. Bad data = rejected claims.

**Solution:** Job Audit — a full review of the entire job before submission. The AI re-examines everything with a fresh prompt (same model, different perspective): the photos (did PhotoScope miss visible damage?), the readings (do they match the scope?), the data quality (typos, missing info), and the standards compliance (S500/OSHA). It's like having a 10-year veteran PM review your work before it goes to the adjuster.

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
- **(b) AI PAST HISTORY (V2):** Learns from contractor's own past jobs.
- **(c) AI NETWORK (V3):** Anonymized aggregate from all contractors.

## Phases & Checklist

### Phase 1: Backend — Celery Task + Endpoints — ❌

**Prompt + tools:**
- [ ] Create `api/ai/prompts/auditor.py` — TWO prompt templates:
  - [ ] `photo_audit_prompt` — re-examines photos with auditor lens (different from PhotoScope prompt). Looks for damage that should generate line items but doesn't exist in scope.
  - [ ] `scope_audit_prompt` — analyzes line items + readings + job data against S500/OSHA/EPA standards. Text-only (no photos).
- [ ] Create `api/ai/tools/auditor.py` — `flag_audit_items` tool schema
  - [ ] Schema: `{ findings: [{ severity, title, audit_layer, room, xactimate_codes[], explanation, suggested_line_items[], estimated_revenue_impact }] }`
  - [ ] `estimated_revenue_impact` — dollar estimate of what was missed (for "money found" framing)

**Celery task (`api/audit/tasks.py`):**
- [ ] `process_audit_task(job_id, task_id)` — Celery task
- [ ] Redis lock per `job_id` + `audit`
- [ ] Task status in Redis: `audit_task:{id}:status`
- [ ] **Two Claude calls per audit (sequential):**
  1. **Photo re-examination** (vision=True, `AI_CONFIGS["scope_audit"]`):
     - Fetch all job photos from Storage (admin client)
     - Resize with Pillow
     - Send with auditor prompt: "You are an independent reviewer. Examine these photos and list all visible damage. Do NOT reference the existing scope — give your own assessment."
     - Compare AI findings against existing line items in DB
     - Flag discrepancies as `audit_layer: "photo"` findings
     - Stream thinking → SSE `thinking` events
  2. **Scope/readings/data analysis** (vision=False, `AI_CONFIGS["scope_audit"]`):
     - Load all line items, moisture readings, equipment logs, rooms, job info from DB
     - Send with scope audit prompt: standards checks, readings cross-check, data quality
     - Flag issues as `audit_layer: "scope"` / `"readings"` / `"data"` findings
     - Stream thinking → SSE `thinking` events
- [ ] Merge findings from both calls into single list, tagged by `audit_layer`
- [ ] For each finding: calculate `estimated_revenue_impact` from suggested line items
- [ ] Store findings in a `audit_findings` response (not a persistent table — re-audit regenerates)
- [ ] `log_ai_event()` for each audit run
- [ ] Publish SSE events: `thinking`, `finding`, `complete`
- [ ] `max_retries=2` on task failure

**Scope completeness checks (baked into prompt):**
- [ ] Cat 2 → antimicrobial required
- [ ] Drywall removal → containment + air scrubber required
- [ ] Affected rooms → drying equipment required
- [ ] Source appliance → disconnect line item
- [ ] Class 2+ → flood cut at wicking height
- [ ] Any demolition → floor protection + PPE

**Readings cross-check (baked into prompt):**
- [ ] High readings + no drying equipment = critical flag
- [ ] Readings declining but equipment already removed = flag
- [ ] Readings inconsistent across adjacent rooms = warning

**Data quality validation (baked into prompt):**
- [ ] Impossible values (moisture > 100%, negative quantities)
- [ ] Missing room assignments on line items
- [ ] Photos not tagged to rooms
- [ ] Incomplete job info (no water category, no loss cause)

**API routes (`api/audit/router.py`):**
- [ ] `POST /v1/audit/run` — validate auth, check lock, enqueue task, return `{ task_id }`
  - [ ] Body: `{ job_id: UUID }`
- [ ] `GET /v1/audit/stream/{task_id}` — SSE endpoint (same pattern as scope/hazmat)
- [ ] `POST /v1/audit/findings/{finding_index}/add-to-scope` — creates line items from a finding's `suggested_line_items` with auto-generated citation
  - [ ] Uses `POST /v1/jobs/{id}/scope/items` internally (reuses scope CRUD from 02A)

**Service + schemas:**
- [ ] `api/audit/service.py` — enqueue task, add-to-scope logic
- [ ] `api/audit/schemas.py` — `AuditFinding { severity, title, audit_layer, room, xactimate_codes, explanation, suggested_line_items, estimated_revenue_impact }`

**Mount router:**
- [ ] Add `audit_router` to `api/main.py` with `prefix="/v1"`

**Tests:**
- [ ] pytest: `test_audit_tasks.py` — catches missing antimicrobial for Cat 2 (mock Claude)
- [ ] pytest: `test_audit_tasks.py` — flags impossible moisture readings
- [ ] pytest: `test_audit_tasks.py` — suggests equipment for rooms without equipment
- [ ] pytest: `test_audit_tasks.py` — catches damage visible in photos but missing from scope
- [ ] pytest: `test_audit_tasks.py` — flags incomplete job data (no water category)
- [ ] pytest: `test_audit_tasks.py` — estimated_revenue_impact calculated
- [ ] pytest: `test_audit_router.py` — add-to-scope creates line items with citation
- [ ] pytest: `test_audit_router.py` — idempotency (lock per job_id)
- [ ] pytest: `test_audit_router.py` — SSE stream with reconnect

### Phase 2: Frontend — Report Tab Audit UI — ❌

**Audit banner on Report tab:**
- [ ] Banner: "Reviews your entire job like a 10-year veteran — photos, scope, readings, everything — before it goes to the adjuster"
- [ ] [Run Job Audit] button (primary orange)
- [ ] Disabled if no line items exist yet ("Generate line items first")

**Thinking stream:**
- [ ] Same inline narrative component (shared from 02A)
- [ ] "Reviewing against S500... Cat 2 water detected but no antimicrobial in scope..."
- [ ] "Re-examining kitchen photo — I see ceiling damage that isn't scoped..."

**Results grouped by audit layer:**
- [ ] Summary header: "Found $2,400 you almost left on the table" (total estimated_revenue_impact)
- [ ] Layer sections:
  - 📸 **Photo Findings** — "AI re-examined your photos and found 2 issues"
  - 📋 **Scope Gaps** — "3 items missing based on S500 standards"
  - 📊 **Reading Issues** — "1 reading doesn't match the scope"
  - ⚠️ **Data Quality** — "2 data issues to fix"

**Finding cards:**
- [ ] Title (bold): "No Emergency Services or Water Extraction"
- [ ] Audit layer badge: [Photo] / [Scope] / [Readings] / [Data] with colors:
  - Photo: #eef0fc/#5b6abf (indigo)
  - Scope: #fff3ed/#e85d26 (orange)
  - Readings: #fffbeb/#d97706 (amber)
  - Data: #f5f5f4/#6b6560 (muted)
- [ ] Severity icon: critical (🔴), warning (🟡), suggestion (💡)
- [ ] Room tag
- [ ] Xactimate code badges (if applicable)
- [ ] Explanation text
- [ ] Estimated revenue: "+$480" in green
- [ ] [Add to Scope →] button — one click adds suggested line items with auto-citation
- [ ] 👍👎 feedback (shared component from 02E)

**Re-audit:**
- [ ] [Re-audit] button appears after making changes
- [ ] Clears previous findings, runs fresh audit

**Hooks:**
- [ ] `use-audit.ts` — `useRunAudit(jobId)`, `useAddFindingToScope()`
- [ ] `use-audit-stream.ts` — SSE consumer for audit

### Phase 3: Tests — ❌
- [ ] E2E: run audit → findings stream in → add to scope → re-audit → fewer findings
- [ ] E2E: audit on job with no issues → "Your scope looks complete"
- [ ] Verify estimated_revenue_impact displayed correctly
- [ ] Verify all 4 audit layers produce findings when appropriate

## Technical Approach

- Reuses shared AI layer + Celery + Redis from Spec 02A
- **Two Claude calls per audit** (sequential in one Celery task):
  1. Photo re-exam (vision=True) — fresh auditor prompt, NOT PhotoScope prompt
  2. Scope/readings/data (vision=False) — standards analysis, text-only
- Results merged into single findings list tagged by audit_layer
- Model: Sonnet 4 for both calls (`AI_CONFIGS["scope_audit"]`)
- Findings are ephemeral (regenerated on each audit, not persisted in a table)
- "Add to Scope" reuses scope CRUD from 02A

**Key Files:**
```
backend/api/
├── ai/prompts/auditor.py      # Two prompts: photo_audit + scope_audit
├── ai/tools/auditor.py        # flag_audit_items tool
├── audit/
│   ├── router.py              # API routes
│   ├── service.py             # Business logic
│   ├── schemas.py             # Pydantic models
│   └── tasks.py               # Celery task (two Claude calls)
web/src/
├── components/audit/
│   ├── audit-banner.tsx       # Report tab banner + Run button
│   ├── audit-finding-card.tsx # Per-finding with layer badge + Add to Scope
│   └── audit-results.tsx      # Results grouped by layer
├── hooks/
│   ├── use-audit.ts           # TanStack Query hooks
│   └── use-audit-stream.ts    # SSE consumer
```

## Decisions & Notes

- **Fresh eyes, not a re-run:** Different prompt than PhotoScope. Second opinion, not repeat.
- **AI as coach:** Reinforces good catches. Reduces noise over time.
- **V1 = real-time only.** Past history (V2) and network (V3) come later.
- **Model selection:** Sonnet 4 for both audit calls.

### Design Review Decisions (2026-04-07)

- **Lives on Report tab.** Pre-submission review, separate from Photos tab workspace.
- **Tone = money found, not criticism.** Lead with dollar impact.
- **Phase 2 implementation.** Ships after PhotoScope + HazmatCheck.

### Eng Review Decisions (2026-04-08)

- **Same Celery + Redis architecture.** Separate task, separate lock (`audit_lock:{job_id}`).
- **Two Claude calls in one task.** Photo re-exam first, then scope/readings/data. Sequential.
- **Findings are ephemeral.** Not persisted in a table. Re-audit regenerates.
- **Add to Scope reuses 02A CRUD.** No new line item creation logic.

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

---

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1 (Backend — Celery task + Audit endpoints)
```
