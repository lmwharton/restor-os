# Future Features — ESX Export, Digital Contracts, Document Vault, Advanced AI

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/7 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Spec 04 must be complete |
| **Branch** | TBD |
| **Issue** | TBD |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-03-26 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Overview

Features from the V2/V3 roadmap that are not yet assigned to Specs 01-04. These are real product needs identified in the design doc and Brett's feedback, collected here so nothing is lost.

## Phases & Checklist

### Phase 1: ESX Export — ❌
- [ ] Export scope as ESX file (Xactimate native format) for direct import into Xactimate
- [ ] ESX file structure research — reverse-engineer or use Xactimate SDK
- [ ] Map Crewmatic line_items → ESX line item format
- [ ] Include room assignments, quantities, codes, descriptions
- [ ] "Export to Xactimate" button on Report tab alongside PDF download
- [ ] This eliminates manual re-entry of Crewmatic scope into Xactimate — major time saver

### Phase 2: Digital Contracts / E-Signature — ❌
- [ ] Work authorization document template (contractor-branded)
- [ ] E-signature flow: contractor sends → homeowner signs on phone
- [ ] Signed document stored in Supabase Storage, linked to job
- [ ] Digital contract required before work begins (Brett's workflow step 2: "Contract")
- [ ] Template variables: company name, customer name, address, scope summary, date
- [ ] Integration options: DocuSign API, HelloSign API, or custom canvas-based signature

### Phase 3: Document Vault — ❌
- [ ] Per-company document storage: W-9, insurance certificates, licenses, bonds
- [ ] "On deck" for new carriers — all docs ready to submit instantly
- [ ] Per Brett: "Anything to get paid faster"
- [ ] Document types: W-9, COI (Certificate of Insurance), contractor license, business license, bond certificate
- [ ] Expiration tracking: alert when insurance cert or license is about to expire
- [ ] Share subset of docs with a new carrier/TPA in one click

### Phase 4: Expanded Justification Standards — ❌
- [ ] Add to AI pipeline prompt: IRC (International Residential Code) — critical for reconstruction/build-back
- [ ] Add: IBC (International Building Code) — commercial building code
- [ ] Add: IICRC S520 — Standard for Professional Mold Remediation
- [ ] Add: EPA — Environmental Protection Agency (lead paint RRP, asbestos NESHAP)
- [ ] Add: NIOSH — National Institute for Occupational Safety & Health (respiratory protection, exposure limits)
- [ ] V1 has S500 + OSHA only. This phase adds the remaining standards per Brett's feedback (March 2026).
- [ ] Each standard needs: section references, relevant text excerpts, mapping to Xactimate codes
- [ ] AI selects appropriate standard based on line item type (mitigation → S500, reconstruction → IRC, mold → S520)

### Phase 5: Supplement Engine (V2.5) — ❌
- [ ] **Supplement Trigger:** AI monitors new photos/readings against original scope, detects billable deviations automatically
- [ ] **Supplement Draft:** Auto-generates supplement request with new line items, Xactimate codes, S500 justifications, and photo evidence
- [ ] **Scope Diff View:** Side-by-side: original approved scope vs. proposed supplement, with delta highlighted
- [ ] Per Brett: "Monitors job documentation in real-time and auto-drafts a supplement request the moment it detects a billable deviation from the original scope"
- [ ] V1 foundation already exists: iterative scoping (re-run AI on new photos) + event_history tracking (multiple runs per job) = supplement detection primitive

### Phase 6: V3 Intelligence Layer — ❌
- [ ] **Carrier-Specific AI Rules:** Per-TPA rule sets in AI pipeline (Alacrity, Code Blue, Sedgwick)
- [ ] **Rejection Predictor:** AI flags line items likely to be denied based on carrier history
- [ ] **AI Completeness Check:** Reviews scope for missing items before submission (enhanced version of Scope Auditor)
- [ ] **Video Scoping:** Walkthrough video → frame extraction → comprehensive line items
- [ ] **Crowdsourced Pricing:** RS Means + BLS + user data → contractor-owned pricing engine
- [ ] **Scope Intelligence Network:** Anonymized aggregate scope data across all contractors (co-occurrence matrix, "92% of contractors add antimicrobial for Cat 2 losses"). See Spec 01 Decisions & Notes for full technical architecture.
- [ ] **Audit Log:** Cross-cutting concern — track all changes to jobs, line items, reports for compliance

### Phase 7: Other Deferred Items — ❌
- [ ] **HEIC photo support:** Convert HEIC → JPEG on upload. V1 requires JPEG/PNG (Brett sets iPhone to "Most Compatible"). Needed for default iPhone settings.
- [ ] **Offline mode:** Local-first data architecture with sync. Restoration work happens in basements/crawl spaces with no signal. Design doc lists this under iOS-forward design.
- [ ] **AI Deposition Prep Assistant:** Feed job record → AI prepares contractor for litigation questions ("An attorney may ask why equipment was removed on day 6 given these moisture readings...")
- [ ] **Equipment ROI Tracker:** AI tracks which equipment generates most billing, flags underperformers
- [ ] **Photo Geo-Tagging with AI:** Beyond basic GPS — AI analysis layered on location data
- [ ] **AI-Powered Adjuster Communication:** Draft professional adjuster emails, supplement cover letters, dispute responses in adjuster language
- [ ] **Cross-trade referral network:** Every trade on the platform becomes a lead source for every other trade

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1 (ESX Export) or whichever phase is prioritized
# Prerequisite: Specs 01-04 must be complete
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **ESX export is V2 priority** — eliminates manual re-entry into Xactimate. Currently contractors copy line items by hand from Crewmatic PDF into Xactimate. ESX import would save 30-60 minutes per job.
- **Digital contracts:** Brett's workflow step 2 is "Contract" — homeowner signs work authorization before work begins. Currently done on paper.
- **Document Vault:** Per Brett: "Anything to get paid faster." Having W-9 + COI + license ready to submit instantly to a new carrier/TPA removes a common payment delay.
- **Expanded justifications (per Brett, March 2026):** S520 (mold), EPA (lead/asbestos), IRC (residential code for build-backs), IBC (commercial code), NIOSH (respiratory). Critical for reconstruction scoping (V2 insurance repair vertical).
- **Supplement Engine is Brett's idea (March 2026):** "Monitors job documentation in real-time and auto-drafts a supplement request the moment it detects a billable deviation from the original scope." V1 foundation: iterative scoping + event_history tracking.
- **V3 Intelligence is the long-term moat** — carrier-specific rules, rejection prediction, video scoping, crowdsourced pricing. Requires significant user base to be meaningful.
