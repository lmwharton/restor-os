# Future Features — ESX Export, Digital Contracts, Document Vault, Advanced AI

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/10 phases) |
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

### Phase 5: Insurance Repair Vertical (V2) — ❌

The entire reconstruction workflow — the natural second half of every water/fire/storm job. Same claim, same adjuster. Turns Crewmatic from a mitigation tool into a full-lifecycle claim tool. Source: Brett's Product Spec v2.0 (March 2026).

**Core Design Principle: Flexible Job Modes** — Restoration and Insurance Repair are not two separate apps, they are two modes within a single job record (Restoration Only / Insurance Repair Only / Restoration + Repair). Jobs can be promoted mid-job when the carrier confirms rebuild scope.

#### Claim & Job Intake (Insurance Repair extends existing job intake)
- [ ] **Job Mode Selector:** Three-option toggle at intake (Restoration Only / Insurance Repair Only / Restoration + Repair). Default: Restoration Only. Mode can change mid-job via Job Settings
- [ ] **Claim Number:** Required field. Shared across both phases in combined mode
- [ ] **Carrier & Adjuster:** Carrier name, adjuster name, adjuster email and phone. Pre-populated from Restoration intake on job conversion
- [ ] **Policy Limits:** Dwelling coverage limit, ACV vs. RCV policy designation. Used downstream to flag scope items that may exceed coverage
- [ ] **Loss Type:** Water / Fire / Wind / Hail / Storm / Other. Drives AI prompt tuning — fire loss scope audits flag different line items than water loss
- [ ] **Assignment Source:** Direct from carrier / TPA referral / Customer referral / Internal (Restoration converted). Tracking for business development analytics
- [ ] **Prior Mitigation:** Was mitigation performed? By whom? Upload mitigation scope PDF. AI parses and pre-populates reconstruction scope gaps. If Crewmatic Restoration job: auto-linked

#### Reconstruction Scope Builder
- [ ] **Xactimate Line Items:** Full reconstruction division coverage: drywall, framing, flooring, painting, cabinetry, millwork, roofing, windows, doors, insulation, HVAC, plumbing, electrical. AI suggests codes from photo analysis and room descriptions
- [ ] **Scope Import / Parse:** Upload adjuster's initial estimate (PDF or Xactimate export). AI parses line items, maps to Crewmatic scope, and flags items present in adjuster estimate but missing from your scope — and vice versa
- [ ] **Room-by-Room Scope:** Scope organized by room, matching the floor plan sketch tool structure. Each room has its own line item list. Totals roll up to job-level summary
- [ ] **Mitigation-to-Recon Handoff:** In combined mode, the reconstruction scope pre-populates based on what was documented in the mitigation phase — affected rooms, materials documented as damaged, equipment areas. Technician reviews and confirms before the scope is finalized
- [ ] **Scope Version History:** Each scope save creates a version. Adjuster portal shows version history. Useful when supplementing — adjuster can see what changed and why
- [ ] **Xactimate Export:** Scope exports in Xactimate-compatible format (ESX or formatted PDF). Same export logic as the existing mitigation scope PDF but mapped to reconstruction codes

#### AI Scope Auditor — Reconstruction Mode
- [ ] **Reconstruction Code Library:** Separate Xactimate code set covering rebuild divisions. Maintained alongside the existing mitigation code library
- [ ] **Loss-Type Tuning:** Audit prompt adjusts based on loss type. Fire loss audits flag pack-out line items, smoke cleaning, content cleaning, and HVAC decontamination. Water loss audits flag subfloor, insulation, cabinet toe kicks, and trim items commonly missed
- [ ] **Code Upgrade Flagging:** AI identifies when code compliance requires items beyond like-for-like replacement: egress window sizing, AFCI/GFCI requirements, insulation R-value upgrades, smoke detector placement. Generates defensible code citation for each flagged item
- [ ] **O&P Monitor:** AI flags whether Overhead and Profit is included on the estimate and at what percentage. If missing or below market (typically 10/10 for GCs, 20% for specialty), generates standard justification paragraph for supplement
- [ ] **Depreciation Flagging:** Flags non-recoverable depreciation items on ACV policies. Helps contractor and homeowner understand what may not be covered
- [ ] **Adjuster Exclusion Patterns:** AI trained on common carrier exclusion arguments. Flags items likely to be disputed and pre-generates defensible justification language for each

#### Supplement Management
- [ ] **Supplement Log:** Running list of all supplements submitted on a job — date, line items, dollar amount, status (pending / approved / denied / partial). Visible in adjuster portal
- [ ] **Supplement Generator:** Technician documents additional damage discovered during demo by voice or photo. AI generates a supplement narrative with Xactimate line items, quantities, and adjuster-language justification paragraph. Tech reviews and fires off. One workflow, no Word doc required
- [ ] **Demo Discovery Trigger:** When a photo is uploaded tagged as "Demo Discovery," AI automatically runs a supplement analysis against the current approved scope and flags new billable items
- [ ] **Supplement Cover Letter:** AI drafts the email cover letter to accompany each supplement submission. Professional, concise, uses standard adjuster language. Editable before sending
- [ ] **Dispute Response Generator:** Carrier denies a line item. Tech enters the denial reason. AI generates a written dispute response citing applicable IICRC standards, code sections, or Xactimate pricing methodology as applicable
- [ ] **Supplement Status Tracker:** Each supplement line item has an approval status. Dashboard view shows total approved, pending, and denied supplement dollars across all jobs

#### Phase Tracking (Replaces drying log for Insurance Repair jobs)
- [ ] **Phase List:** Demo Verification → Structural Repair → Rough Mechanical → Insulation → Drywall → Paint → Finish Carpentry → Final Walkthrough → Certificate of Completion. Phases are configurable — techs can add or remove phases based on job scope
- [ ] **Phase Completion:** Mark phase complete, add completion date, attach required photos. System enforces minimum photo count per phase (configurable at company level)
- [ ] **Inspection Holds:** Flag a phase as held pending inspection. Phase cannot be marked complete until hold is cleared. Tracks inspector name, date, pass/fail result
- [ ] **Permit Tracking:** Permit number, submission date, permit type (building, plumbing, electrical), inspection scheduling, pass/fail, reinspection notes. Linked to relevant phase
- [ ] **Auto Progress Photos:** Each phase completion triggers a photo package push to the adjuster portal. Adjuster sees the job progressing without a phone call
- [ ] **Phase-Triggered Holdback Requests:** Configurable: when a specified phase is marked complete, system auto-generates an ACV/RCV holdback release request with supporting photo documentation

#### ACV / RCV and Financial Tracking
- [ ] **ACV vs. RCV Tracker:** Tracks the gap between actual cash value payment received and replacement cost value holdback remaining. Running balance by phase completion
- [ ] **Holdback Release Requests:** When a phase milestone is reached, system generates a holdback release request document with phase completion summary, photos, and remaining holdback amount. Ready to send to carrier
- [ ] **Depreciation Recovery Log:** Tracks recoverable depreciation items. As repairs are completed, flags items eligible for depreciation recovery submission and generates the request
- [ ] **Payment Tracking:** Log carrier payments, homeowner payments (deductible, upgrades). Running job-level P&L view for contractor
- [ ] **Mortgage Coordination Package:** For large losses where the carrier check is co-payable to the mortgage company: generates the full documentation package (scope summary, photos, completion cert) formatted for mortgage company endorsement requests

#### Adjuster Portal — Extended for Insurance Repair
- [ ] **Claim Summary View:** Claim number, carrier, date of loss, loss type, current job mode, assigned contractor. Read-only
- [ ] **Scope Version History:** All scope versions with timestamps. Adjuster can see what changed between versions without a phone call
- [ ] **Supplement Log:** All submitted supplements with status, dollar amounts, and supporting documentation. Adjuster can track approvals without back-and-forth
- [ ] **Phase Progress View:** Current phase, completed phases with photos, upcoming phases. Visual progress indicator
- [ ] **Photo Timeline:** Chronological photo feed organized by phase and room. Each photo tagged with date, room, and AI-generated description
- [ ] **Document Library:** All job documents — signed contracts, scope PDFs, supplement packages, certificates — accessible in one place

#### Document Outputs — Insurance Repair
- [ ] **Reconstruction Scope PDF:** Xactimate-formatted scope with room-by-room breakdown, line items, quantities, unit costs, and totals. Branded with company logo
- [ ] **Supplement Package:** Cover letter + Xactimate line items + supporting photos + justification narrative. Single PDF, ready to email
- [ ] **Phase Completion Report:** Per-phase summary with photos, inspection results, and completion date. Sent to adjuster portal automatically
- [ ] **ACV/RCV Holdback Request:** Formal holdback release request with scope summary, payment history, and remaining holdback calculation
- [ ] **Certificate of Completion:** Final job certificate — scope summary, before/after photos, all phases completed, warranty language. Triggers final holdback release request. Homeowner and adjuster both receive
- [ ] **Mortgage Endorsement Package:** Scope + completion cert + photos formatted for mortgage company co-payee release process
- [ ] **Dispute Response Letter:** Formal written dispute of line item denial. AI-generated, editable, cites applicable standards and pricing methodology

### Phase 5b: Supplement Engine (V2.5) — ❌
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

### Phase 7: Fire-Specific AI Tools — ❌
- [ ] **Photo Smoke/Char Classifier:** Upload fire scene photos → AI returns damage category (Cat 1/2/3 smoke), smoke type (protein, synthetic, wood), char depth measurement, severity score 1-10, structural integrity flags, and mapped Xactimate line items. Extends Spec 02 Photo Scope with fire-specific classification logic.
- [ ] **Fire Scope Quick-Start:** Pick fire type from menu (kitchen, electrical, structure, attic, vehicle, smoke-only) + enter sqft/rooms → AI generates a full Xactimate scope template organized by section with supplement opportunities and pre-work safety flags. Pre-loaded templates eliminate blank-page problem on fire jobs.
- [ ] **Cause & Origin Documentation Tool:** Guided 4-step form (carrier info, origin observations, spread path, damage summary) → outputs formal adjuster-facing C&O report in insurance industry language. Ready to copy into documentation or export as PDF. Critical for fire subrogation cases.
- [ ] **AI Adjuster Negotiation Coach:** Upload adjuster's lowball scope or denial → AI writes pushback with S500/OSHA/IRC citations, comparable scope data, and professional language. Fire losses are the most contested claims — this has the highest per-job value.

### Phase 8: AI Lead Generation Suite — ❌
- [ ] **Fire Scanner:** Monitor dispatch feeds / public safety APIs for structure fire calls. 3-layer architecture: keyword filter (free, instant) → local speech-to-text confidence scoring → Claude AI confirms structure fire + extracts address. Auto-populates a new job card on confirmed fire. Brett built a standalone prototype (March 2026).
- [ ] **Weather Alert Monitor:** Watch NWS severe weather alerts for contractor's service area. Flags heavy rain, flash flood watch, freeze events, high wind/storm warnings. Returns lead score 1-10, affected areas, estimated lead window ("calls start in 2-4 hrs"), and pre-written SMS/social blast template. Water jobs spike 24-48hrs after freeze events — being first call wins the job.
- [ ] **Social Media Scanner:** Paste posts from Facebook, Nextdoor, X, Instagram → AI qualifies if it's a real damage lead, extracts address/neighborhood, flags urgency level, notes insurance involvement, and drafts warm (non-spammy) outreach reply. Manual workflow — contractor scrolls feeds 10min/morning, pastes anything relevant.
- [ ] **Competitor Monitor:** Enter address → shows nearby restoration companies with Google ratings, review counts, response strength ratings. Quick landscape read when driving to a loss. AI-estimated data, not real-time API pull (acknowledge limitation).
- [ ] **Google Alerts Integration Guide:** Pre-configured alert templates for contractor's service area — "water damage [city]", "pipe burst [county]", "basement flooded [area]". Free, legitimate, runs automatically.
- [ ] **Local News RSS Monitor:** IFTTT/Make.com integration watching RSS feeds from local news stations for flood/storm/fire damage coverage in service area → push notification to contractor.

### Phase 9: Revenue Generation & Gamified Referral Engine — ❌
- [ ] **Tier-based loyalty program for referral partners:** Plumbers, HVAC techs, electricians, property managers — anyone who sends restoration jobs. Tier model inspired by Duolingo (streaks/habits), Marriott Bonvoy (status tiers), United MileagePlus (earn + burn). Tiers unlock higher per-referral payouts, priority scheduling, and branded status badges.
- [ ] **Referral tracking dashboard:** Real-time visibility for referrers — which referrals converted, payout status, tier progress, streak count. Transparency = trust. Attribution must be bullet-proof (plumbers compare notes).
- [ ] **Automated drip campaigns (Make + Brevo):** SMS + email sequences to referral partners. Auto-generated blog content keeps brand top-of-mind. Sequences: onboarding (first referral bonus), nurture (weekly tips + status update), win-back (30-day inactivity re-engagement), tier-up celebration.
- [ ] **Gamification mechanics:** Streaks (consecutive weeks with referrals), loss aversion ("2 referrals from Gold — don't lose your streak!"), milestone rewards, leaderboards (opt-in), first-referral instant bonus (reduce time-to-first-reward).
- [ ] **SEO & geo audit for contractor clients:** AI-generated local SEO reports, Google Business Profile optimization suggestions, social presence scoring. Crewmatic helps contractors bring in NEW revenue, not just manage existing workflow.
- [ ] **Social presence automation:** Auto-generate job completion posts (with permission), before/after galleries, review request sequences. Contractor's marketing runs on autopilot.
- [ ] **White-label referral portal:** Branded portal for each restoration company's referral network. Plumber logs in, sees their tier, submits referrals, tracks payouts. Built with Perplexity Computer as prototype (March 2026), production version in Crewmatic platform.
- [ ] **Revenue attribution analytics:** For restoration company owners — see which referral channels (plumbers, property managers, insurance agents) generate the most revenue, highest close rate, best average job size. Data-driven referral investment decisions.

**Validated prototype (March 2026):** Lakshman built a working plumber loyalty app using Perplexity Computer + Make + Brevo SMS/Email. Going live with first plumber set week of March 31, 2026. App: https://www.perplexity.ai/computer/a/irp-plumber-prime-cV5K_sceRZamM237wRQJCQ

**Key insight:** "We're not just helping contractors manage their workflow — we're helping them bring in new revenue." This shifts the value proposition from cost savings to revenue generation, which is a much stronger sales argument.

**Automation stack (prototype):** Make (workflow orchestration) → Brevo (SMS + Email delivery) → Perplexity Computer (referral portal UI) → Auto-generated blog content (AI) → Tier status notifications

### Phase 10: Other Deferred Items — ❌
- [ ] **HEIC photo support:** Convert HEIC → JPEG on upload. V1 requires JPEG/PNG (Brett sets iPhone to "Most Compatible"). Needed for default iPhone settings.
- [ ] **Offline mode:** Local-first data architecture with sync. Restoration work happens in basements/crawl spaces with no signal. Design doc lists this under iOS-forward design.
- [ ] **AI Deposition Prep Assistant:** Feed job record → AI prepares contractor for litigation questions ("An attorney may ask why equipment was removed on day 6 given these moisture readings...")
- [ ] **Equipment ROI Tracker:** AI tracks which equipment generates most billing, flags underperformers
- [ ] **Photo Geo-Tagging with AI:** Beyond basic GPS — AI analysis layered on location data
- [ ] **AI-Powered Adjuster Communication:** Draft professional adjuster emails, supplement cover letters, dispute responses in adjuster language
- [ ] **Cross-trade referral network:** Every trade on the platform becomes a lead source for every other trade. One-tap referral between verticals with pre-populated job data, photos, and AI-generated situation summary. Key flows: Plumber→Restoration (source of loss report), HVAC→Restoration (condensate/drainage damage), Electrician→Restoration (moisture near panels/walls), Restoration→Insurance Repair (mitigation→reconstruction handoff), Insurance Repair→Plumbing/Electrical (licensed sub for code-required work). Referral tracking with fee confirmation. This is the platform flywheel — each new vertical increases the value of every existing vertical. See `docs/specs/draft/07-future-verticals.md` for full cross-trade referral flow details.
- [ ] **Customer Feedback Loop:** When a shared link is sent to a customer/adjuster, allow them to respond with feedback, questions, or approvals directly through the shared portal. Feedback reflects on the job (visible in job timeline/event history). Use cases: adjuster replies "approved" or "need more photos of kitchen ceiling", customer confirms "work looks good." This closes the communication loop without requiring the external party to have a Crewmatic account. Feedback events show in the job timeline as `customer_feedback_received` or `adjuster_feedback_received`.
- [ ] **Pricing Database (Platform-Level):** Long-term platform moat. Anonymized actual cost data contributed by every job across every trade. Phase 1: RSMeans licensing for baseline. Phase 2: crowdsourced actuals from platform jobs. Phase 3: AI pricing intelligence — market-rate suggestions by trade, region, and job type. Phase 4: enterprise monetization and benchmarking reports. The pricing database is the asset, not the app.
- [ ] **Freemium Gate:** High-value AI features (supplement suggestions, scope audits, pricing intelligence) unlock when contractors contribute data back to the platform — uploading completed estimates, confirming actual job costs. Drives data contribution and creates a flywheel between platform value and data quality.
- [ ] **Trade / Vertical Selector:** At account creation, select primary vertical. At job creation, select job mode. Architecture accommodates additional verticals without structural changes. Current verticals: Restoration, Insurance Repair. Roadmap: Plumbing, Electrical, HVAC, Remodeling.
- [ ] **Mobile-First Architecture:** All features designed for one-handed field use. Voice input as primary data entry. No feature requires a desktop. Techs in the field are the primary users — the app has to work the way they work.

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
- **Fire-specific tools from Brett's prototype (March 2026):** Brett built standalone prototypes for fire scanner, smoke/char classifier, fire scope quick-start, C&O doc tool, weather monitor, and social scanner in a Claude chat. Source: https://claude.ai/share/51a9e2e5-2f02-4684-b08c-4e1e5addad38
- **Lead gen is a new product surface:** None of the V1-V4 specs cover lead generation. Brett is clearly interested — he prototyped 4 lead gen tools himself. Weather monitor is highest ROI per Brett's feedback (water jobs from freeze events are predictable, first call wins).
- **Facebook automation is not viable:** Meta blocks automated scraping since 2018. Nextdoor business API is more accessible. Google Alerts is free and legitimate. Manual "paste and qualify" workflow is the realistic V1 for social scanning.
- **Adjuster Negotiation Coach:** Fire losses are the most contested claims in restoration. Brett identified this in the same conversation. Overlaps with "AI-Powered Adjuster Communication" in Phase 9 but is more specific — upload a denial, get a pushback letter.
- **Revenue Generation is a new product pillar (Lakshman, March 2026):** The platform shouldn't just help contractors manage work — it should help them bring in NEW revenue. Gamified referral programs (plumbers, property managers, insurance agents), automated SEO/social presence, drip campaigns. This shifts the value prop from "save money on tools" to "make more money with Crewmatic." Working prototype built with Perplexity Computer + Make + Brevo, going live with first plumber set week of March 31, 2026. This concept ties to the cross-trade referral network (Phase 10) but is broader — it's about making every trade partner a habitual referrer through behavioral gamification.
- **Insurance Repair vertical (Phase 5) sourced from Brett's Product Spec v2.0 (March 2026):** Brett's 33-page spec details the full reconstruction workflow including supplement management, ACV/RCV tracking, phase-triggered holdback requests, adjuster portal extensions, and 7 document outputs. This is the most detailed insurance repair workflow spec in our research. Source: `/Users/lakshman/Downloads/ScopeFlow_Product_Spec_v2.pdf`
- **Future verticals (Plumbing, Electrical, HVAC) specced separately:** See `docs/specs/draft/07-future-verticals.md`. These may become a separate product or remain within Crewmatic. Priority: Plumbing > Electrical > HVAC. Each has a "killer feature" for demo/sales: Water Heater EOL (plumbing), Panel Photo Diagnosis (electrical), Symptom-to-Diagnosis Engine (HVAC).
- **Cross-trade referral network validated by Brett's spec:** Brett independently specced the same cross-trade referral flows we planned. Every referral creates three things: revenue for the referring contractor, revenue for the receiving contractor, and a data point in the pricing database. The referral network + pricing database = compounding flywheel.
- **Platform-level features added (March 2026):** Pricing Database (4-phase plan), Freemium Gate (AI features unlock with data contribution), Trade/Vertical Selector, Mobile-First Architecture mandate. Source: Brett's Product Spec v2.0, Section 12.
