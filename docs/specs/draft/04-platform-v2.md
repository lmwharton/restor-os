# Platform V2 — AI Past History, Company Settings Expansion

> **Note:** This spec was split on 2026-04-01 and consolidated on 2026-04-14.
> Original sub-specs (04A–04G) were consolidated into three self-contained specs:
> - **04A** (Team & Operations Dashboard) ← old 04A-04G consolidated
> - **04B** (Job Communication) ← old Board & People + Daily Auto-Reports
> - **04C** (Equipment & Certification) ← old Equipment Inventory & Drying Cert
> Old sub-specs archived in `specs/archived/`.
>
> This spec retains Phase 4 (AI Past History Intelligence) and Phase 5 (Company Settings Expansion).

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/2 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 01 + Spec 02 must be complete |
| **Branch** | TBD |
| **Issue** | TBD |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-03-26 |
| Split | 2026-04-01 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] AI Scope Auditor: past history source (contractor's own past jobs)
- [ ] Company settings expanded (website, social links, Google review, Yelp)
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Overview

**Problem:** After V1 ships, the AI needs to get smarter from the contractor's own history, and company branding needs to appear on all outputs (PDFs, share portals, emails).

**Solution:**
1. Upload past Xactimate PDFs → AI learns contractor's patterns → coaches during future scoping
2. Company profile expansion with branding fields that flow into all branded outputs

## Phases & Checklist

### Phase 1: AI Past History Intelligence — ❌
**Upload Past Jobs:**
- [ ] Alembic migration: `ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'imported'))`
- [ ] `POST /v1/company/upload-past-jobs` — upload Xactimate PDFs (up to 10)
- [ ] AI extracts from each PDF: loss type, category, source, carrier, room count, all line items (code, description, unit, qty, price, category)
- [ ] Creates regular job records with `source='imported'`, `status='collected'`
- [ ] Creates rooms + line items in normal tables (same schema as live jobs)
- [ ] No separate `scope_intelligence` table — imported jobs ARE jobs, just tagged as imported
- [ ] Can be part of onboarding flow (first-time setup) or Settings page
- [ ] pytest: imported job appears in job list with source=imported
- [ ] pytest: imported line items queryable alongside live job line items

**Past History Intelligence (Scope Auditor Source B):**
- [ ] Query contractor's own jobs + line_items from completed/collected jobs (both live and imported)
- [ ] Build per-contractor patterns: "For Cat 2 dishwasher leaks, you typically add these items..."
- [ ] Reference specific past jobs: "You had a similar job at 123 Oak St — you added content manipulation there but it's missing here"
- [ ] Coach behavior: "Good catch adding deodorization — you missed this on your last 3 Cat 2 jobs"
- [ ] Feed patterns into Scope Auditor prompts alongside real-time analysis
- [ ] pytest: past history suggestions appear for contractors with 5+ completed jobs

### Phase 2: Company Settings Expansion — ❌
- [ ] Add to `companies` table: city, region/state, website_url, google_review_url, yelp_url, social_links (JSONB)
- [ ] Company Settings → Profile tab expanded (from Brett's demo):
  - Company Logo (upload)
  - Company Name, City/Region
  - Phone, Email
  - Website URL
  - Google Review Link
  - Yelp URL
  - Other social links (Facebook, BBB, Angi, HomeAdvisor)
- [ ] These fields show on branded PDF reports, share portals, emails
- [ ] Company Settings → Inventory tab (see Spec 04C)

**Future: SEO/AEO Audit (V3):**
- Analyze contractor's online presence (Google Business Profile, Yelp, website, social)
- Score their visibility for local restoration searches
- Suggest improvements: "Your Google Business Profile is missing 'water damage restoration' keyword"
- Value-add that deepens platform stickiness — Crewmatic helps them get MORE jobs, not just manage existing ones

## Technical Approach

**AI past history:**
- Background job builds per-contractor pattern tables from completed event_history
- Stored as: `(contractor_id, loss_profile) → [{code, frequency, typical_qty}]`
- Injected into Scope Auditor prompt alongside real-time analysis
- Refreshed after each completed job

## Key Files
- `backend/api/ai/history.py` — past history pattern builder
- `backend/api/company/settings.py` — company profile endpoints

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1, AI Past History Intelligence
# Prerequisite: Spec 01 + Spec 02 must be complete
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **AI Past History is Scope Auditor source (b):** Learns from contractor's own completed jobs. References specific past jobs. Coaches: reinforces good catches, flags regressions. Works alongside real-time analysis (source a) and network intelligence (source c, V3).
- **Company settings expanded (from Brett's demo):** Logo, name, city/region, phone, email, website, Google Review link, Yelp. Shows on all branded outputs. Future: SEO/AEO audit for online presence optimization.
- **Network intelligence (V3):** Scope Auditor source (c) — anonymized aggregate from all contractors. Co-occurrence matrix. 20+ job minimum for suggestions. "Waze for restoration scoping." See Spec 01 Decisions & Notes for full technical architecture. Data collection starts in V1 via event_history — no additional work needed now.
- **Progressive intelligence timeline:** Job 1: AI real-time only. Jobs 1-10: + uploaded past scope PDFs. Jobs 11-20: + Crewmatic event_history. Job 21+: + network intelligence (when V3 ships). Each layer makes suggestions stronger.
