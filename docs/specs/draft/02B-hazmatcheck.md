# HazmatCheck — Asbestos + Lead Paint Risk Detection

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/2 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 02A (shared AI service layer: client.py, config.py) |
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
- [ ] "Check for Hazards" via `POST /v1/jobs/{job_id}/photos/check-hazards` — scans photos for asbestos + lead paint risk
- [ ] Per-finding output: material name, location, risk level, description, next steps
- [ ] Findings can be added to PDF report
- [ ] Lead paint risk uses property year_built (pre-1978 = risk)
- [ ] Mandatory disclaimer on all results
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** Contractors encounter hazardous materials (asbestos, lead paint) on restoration jobs but lack tools to quickly identify risk. Missing hazmat findings creates liability and safety issues.

**Solution:** HazmatCheck — scans job photos for potential asbestos-containing materials (ACMs) and lead paint indicators. AI narrates what it's examining ("Examining ceiling texture... this granular pattern is consistent with vermiculite...") while findings stream in. Flags findings with severity, next steps, and local contractor referrals.

**Scope:**
- IN: Asbestos risk scan, lead paint risk scan, hazmat_findings table, findings CRUD, add-to-report flow
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
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Phases & Checklist

### Phase 1: Backend — ❌
- [ ] Create `api/ai/hazmat.py` — hazmat scanning pipeline
- [ ] `POST /v1/jobs/{job_id}/photos/check-hazards` — trigger hazmat scan on job photos
- [ ] `GET /v1/jobs/{job_id}/hazmat-findings` — list findings
- [ ] `POST /v1/jobs/{job_id}/hazmat-findings/{finding_id}/add-to-report` — add finding to PDF report
- [ ] Asbestos Risk Scan: AI analyzes photos for ACMs (vermiculite insulation, pipe wrap, 9x9 floor tiles, popcorn ceiling, transite siding)
- [ ] Lead Paint Risk Scan: AI analyzes photos for lead paint indicators (alligatoring pattern, chalking, multi-layer peeling)
- [ ] Lead paint risk check: use property.year_built (via job.property_id) — pre-1978 = lead risk (EPA RRP rule)
- [ ] Per-finding output: material_name, location, risk_level (HIGH/MEDIUM/LOW), description ("What I see: ..."), next_steps ("Do not disturb. Have certified inspector...")
- [ ] Alembic migration: create hazmat_findings table
- [ ] Uses shared AI service layer from Spec 02A (client.py, config.py)
- [ ] Log `hazmat_scan` event to event_history
- [ ] pytest: hazmat scan identifies known ACMs in test photos
- [ ] pytest: lead paint risk correctly flags pre-1978 homes

### Phase 2: Frontend — ❌
- [ ] "Check for Hazards" button on Photos tab toolbar
- [ ] **Thinking stream UX:** AI narrates what it's examining in each photo ("Examining pipe insulation in basement... wrap pattern and texture suggest potential ACM...") via SSE `thinking` events
- [ ] Loading state: thinking stream fills the wait, with photo progress
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
- [ ] Thumbs up/down on hazmat findings (uses Spec 02E feedback endpoint)

## Technical Approach

- Reuses shared AI service layer from Spec 02A (Anthropic client, config, cost tracking)
- Model: Sonnet 4 for vision analysis
- Separate prompt template in `backend/api/ai/prompts/hazmat.py`
- Tool-use mode for structured findings output

**Key Files:**
- `backend/api/ai/hazmat.py` — hazmat scanning pipeline
- `backend/api/ai/prompts/hazmat.py` — hazmat prompt template
- `backend/api/hazmat/router.py`, `service.py`, `schemas.py` — hazmat endpoints
- `web/src/components/hazmat/finding-card.tsx` — per-finding card
- `web/src/components/hazmat/hazmat-results.tsx` — results container

## Decisions & Notes

- **Two scan types:** Asbestos + Lead Paint. Different AI prompts, different risk indicators.
- **Mandatory disclaimer:** AI visual analysis is NOT professional testing. Always displayed.
- **Pre-1978 rule:** EPA RRP rule — homes built before 1978 have lead paint risk. Use property.year_built.
- **Future revenue:** Sponsored abatement contractor listings + test kit affiliate links (V2).
- **Model selection:** Sonnet 4 for hazmat vision analysis.

### Design Review Decisions (2026-04-07)

- **Shared workspace with PhotoScope:** HazmatCheck results live on the same Photos tab, under the [Line Items | Hazards] underline tab toggle. Same photo strip filter works for both.
- **Photo-tagged findings:** Each hazmat finding tagged to source photo(s). Selecting a photo in the strip filters to hazards found in that photo.
- **Zero findings = success state:** "No hazards found — no action needed" with a green checkmark (#2a9d5c). This is good news, not an empty state.
- **Risk badge design:** Use DESIGN.md accent colors — HIGH = error red (#dc2626 on #fef2f2), MEDIUM = warning amber (#d97706 on #fffbeb), LOW = muted (#6b6560 on #f5f5f4). Text labels always present (not color-only).
- **Runs in parallel with PhotoScope:** Both AI pipelines can run simultaneously on the same photos.

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|
