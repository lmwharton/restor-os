# Multi-Trade Platform Expansion — Brett's Vision

> **Source:** Conversation between Brett Sodders (co-founder) and Claude, March 2026
> **Context:** After validating the water restoration V1, Brett mapped out how Crewmatic/ScopeFlow expands into adjacent trades.

---

## Strategic Framing

The core platform (job management, photo AI, voice input, portals, e-sig, white-label, multi-tenant) transfers to every vertical unchanged. What changes per trade is the **data model, AI prompts, document outputs, and workflow structure**. Think of this as a "trade config" that sits on top of the same engine.

### Three Job Modes (Architectural Decision)

The app supports three modes per job. This gives contractors flexibility — a company that does both mitigation and reconstruction can use combined mode, while a pure reconstruction company can skip the moisture/drying phase entirely.

| Mode | When to Use |
|------|------------|
| **Restoration Only** | Standard water mitigation — current V1 product |
| **Insurance Repair Only** | Reconstruction without prior mitigation (handed a rebuild job directly) |
| **Restoration + Repair** | Full lifecycle — water damage → dry-out → reconstruction in one job |

---

## Phase 1: Insurance Repair (Priority — Build Next)

**Why now:** This is the natural second half of every water damage job. Same adjuster, same claim number, same Xactimate language — just reconstruction line items instead of mitigation. Brett's existing Dry Pros customers and adjuster contacts can use this immediately.

### Core Features

**Claim & Assignment Intake**
- Claim number, carrier, adjuster name/contact, policy limits, date of loss, loss type (fire/water/wind/hail/other)
- Same adjuster portal — extended for reconstruction phase

**Scope of Loss Integration**
- Upload the mitigation scope (from Crewmatic Restoration) or the adjuster's initial estimate
- AI parses it and pre-populates the reconstruction scope with matching line items
- Eliminates double-entry and catches scope gaps between damage documented and what adjuster initially allowed

**Xactimate Reconstruction Scope**
- Full line-item scope: drywall, framing, flooring, painting, cabinetry, trim, roofing, windows, doors
- Same Scope Auditor logic as restoration but tuned to reconstruction codes
- AI flags commonly missed line items: O&P, detach/reset items, code upgrade requirements, debris disposal

**Supplement Management** (the big one)
- As demo reveals hidden damage (structural issues, mold behind walls, subfloor damage, code deficiencies), AI generates supplement narratives with Xactimate line items and adjuster-language justification
- Contractor reviews and sends — same concept as restoration supplements but for reconstruction

**Code Upgrade Tracking**
- When repairing to current code requires upgrades beyond original scope (electrical panels, egress windows, insulation R-values)
- AI identifies applicable code sections and generates line items with justification
- Carriers fight these — having the code citation built in makes it defensible

**O&P Tracking**
- AI automatically flags whether overhead and profit has been included and at what percentage
- If missing or low, generates justification paragraph
- Money left on the table constantly without this

**Phase Tracking (Insurance Version)**
- Demo Verification → Structural Repair → Rough Mechanical → Insulation → Drywall → Paint → Finish → Final Walkthrough → Certificate of Completion
- Each phase triggers progress photo package sent to adjuster portal automatically

**ACV vs. RCV Tracking**
- Tracks gap between actual cash value payment and replacement cost value holdback
- AI flags when phases are complete and holdback release should be requested
- Auto-generates supporting documentation

**Certificate of Completion**
- AI generates completion certificate with before/after photos, scope summary, warranty language
- Triggers final holdback release request to carrier

**Mortgage Company Coordination**
- On large losses, check goes to homeowner AND mortgage company
- AI generates documentation package (scope, photos, completion cert) formatted for mortgage company endorsement requests

### AI Features (Insurance Repair)

| Feature | Description |
|---------|------------|
| Scope of Loss Parser | Upload adjuster estimate → AI maps to Xactimate reconstruction line items, flags gaps |
| Supplement Generator | Demo discovery → supplement narrative with Xactimate codes and adjuster language |
| Code Upgrade Identifier | Cross-references repair scope against current applicable codes, generates defensible line items |
| O&P Monitor | Flags missing or undervalued overhead and profit on every estimate |
| Adjuster Communication Drafter | Writes supplement cover letters, dispute responses, approval follow-ups |
| Scope Auditor (Reconstruction) | Same auditor logic as restoration, tuned to reconstruction line items and common carrier exclusions |
| Holdback Release Tracker | Phase completion triggers auto-drafted holdback release request with photo documentation |

### Document Outputs
- Reconstruction scope (Xactimate-formatted)
- Supplement packages
- Adjuster portal progress updates
- Phase completion photo packages
- ACV/RCV tracking report
- Certificate of completion
- Mortgage endorsement package

---

## Phase 2: Remodeling

**Why:** Restoration companies that also do reconstruction naturally get remodeling referrals. A remodeling customer whose kitchen floods mid-renovation becomes an insurance repair job. An insurance repair job that reveals the customer wants to upgrade beyond scope becomes a remodeling add-on.

### Core Workflow Shift
No insurance adjuster. The customer is the decision-maker and budget holder. Revenue comes from signed proposals and change orders, not claims.

### Core Features

**Job Phases** (replaces drying log)
- Demo → Rough Framing → Rough Mechanical → Insulation → Drywall → Finish Carpentry → Paint → Finish → Punch List → Sign-off
- Each phase has photo documentation, completion status, and inspection hold flags

**Proposal Generator**
- Voice-describe scope on walkthrough, AI generates line-item proposal with labor and materials
- Customer reviews and e-signs in portal — the Xactimate equivalent for remodeling

**Change Order Workflow**
- Customer wants to add something mid-job → describe by voice → AI drafts change order with pricing and justification → customer e-signs before work starts
- Protects legally and keeps job financially clean — where most remodelers get killed (undocumented scope creep)

**Permit & Inspection Tracking**
- Permit number, submission date, inspection type (framing, rough electric, rough plumbing, insulation, final), pass/fail, reinspection scheduling
- Nobody has built this cleanly in a mobile-first tool

**Subcontractor Coordination**
- Lightweight sub dispatch — assign trade, date, scope section
- Daily log per sub
- Flag when a sub's phase isn't complete before next trade needs to start

**Punch List Management**
- End-of-job punch list with photo documentation, assigned trade, due date, customer sign-off

**Material Cost Tracker**
- Photo receipts in field, AI compares actuals vs. estimate in real time, flags overruns before they compound

**Client Communication Autopilot**
- AI drafts weekly plain-English project update for homeowner
- Remodeling clients are notoriously anxious — proactive communication kills most complaints

**Lien Waiver Assistant**
- Tracks what subs have been paid, flags missing lien waivers before final payment

**Warranty & Closeout Package**
- AI compiles warranties, manuals, permit final sign-offs, as-built notes into single PDF at job close

### AI Features (Remodeling)

| Feature | Description |
|---------|------------|
| AI Proposal Builder | Voice walkthrough → line-item proposal with labor and materials |
| Change Order Generator | Voice describe the add → AI drafts with pricing and justification |
| Photo Progress Verification | AI flags potential issues before inspection ("stud spacing appears wider than 16" OC") |
| Client Update Autopilot | Weekly homeowner update drafted from phase completion status |
| Material Cost Monitor | Receipt photos vs. estimate, real-time overrun alerts |
| Subcontractor Delay Predictor | Based on phase status and sub schedules, flags jobs at risk of timeline slip |
| Lien Waiver Tracker | Flags missing documentation before final payment |

---

## Phase 3: Plumbing

**Why:** Natural referral path — plumbers are often first on scene for water damage (burst pipe) and can refer restoration jobs through Crewmatic.

### Key AI Features That Would Get Plumbers' Attention

**Photo Diagnostic Engine** (day-one feature)
- Snap photo of problem area → AI tells likely cause, what's probably behind the wall, what parts to grab, rough scope
- Cuts diagnostic time significantly and gives defensible answer for billable diagnostic hours

**Whole-House Repipe Trigger** (biggest upsell)
- Photo corroded pipe → AI says "galvanized corrosion pattern consistent with whole-house deterioration — estimated remaining service life 2-4 years, recommend full repipe evaluation"
- Data recommends the upsell, not the plumber — completely changes conversation dynamic

**Water Heater EOL Detection**
- Photo the water heater → AI reads serial number (manufacture date encoded), calculates age, flags efficiency
- Auto-generates replacement proposal tech can hand homeowner before leaving
- Walk-out close on $1,500-3,000 job they'd otherwise drive away from

**Source of Loss Documentation** (the insurance angle)
- When plumber finds pipe failure that caused water damage, they document it with photo AI analysis
- Generate formal source of loss report
- One-tap refer restoration job to a Crewmatic restoration contractor with photos pre-attached

**Systemic vs. Isolated Damage Detector**
- AI determines if damage is localized failure or sign of bigger system problem
- "Pinhole leak pattern on copper + green oxidation consistent with aggressive water chemistry — recommend whole-system evaluation"
- Makes a junior tech sound like a 20-year veteran

**Code Compliance on the Fly**
- Describe situation → AI returns applicable code requirements, upgrade line items, documentation

### Additional Features
- Service Call Mode (fast intake — address, problem, photo → AI pre-diagnosis)
- Repipe Project Mode (room-by-room pipe inventory, linear footage, fixture count → full scope with material list)
- Hazard Scanning (asbestos pipe wrap, lead paint — more relevant here than restoration)
- Customer Portal (homeowner-facing: here's what we found, here's what we did, here's why it cost what it cost)

---

## Phase 4: Electrical

### Key AI Features

**Panel Photo Diagnosis** (the killer feature — worth the subscription alone)
- Photo the panel → AI reads: brand/model, flags known problem panels (Federal Pacific, Zinsco, Pushmatic), double-taps, missing knockouts, improper breaker sizing, signs of heat damage/arcing
- Liability shield + upsell engine + customer education tool in one

**Load Calculation Assistant**
- Describe home (sq ft, HVAC type, appliances, planned additions like EV charger/hot tub)
- AI runs simplified load calc → adequate as-is, needs subpanel, or needs full service upgrade
- Determines the quote before tech opens laptop

**EV Charger & Generator Install Workflows**
- Dedicated intake flows — panel capacity check, circuit routing, equipment specs, permit requirements
- Fastest-growing categories in residential electrical

**Upsell Scanner**
- AI reviews all photos from service call → flags: no GFCI in bathrooms/kitchen, no arc-fault in bedrooms, aluminum wiring, panel near capacity
- "Our system identified three additional safety items during your service visit"

**Aluminum Wiring & Hazard Documentation**
- Formal hazard disclosure with photo documentation, safety citations, remediation options
- Legal protection for electrician if something happens later

---

## Phase 5: HVAC

**Unique business model:** Maintenance contracts are the revenue backbone — recurring revenue, not job-by-job. The app needs to support recurring visit workflows.

### Key AI Features

**Symptom-to-Diagnosis Engine** (day-one feature)
- Tech describes symptoms → AI gives diagnostic tree (most likely causes ranked, what to check first, what parts to bring)
- In field: photos + readings → AI refines diagnosis in real time

**System Replacement Trigger**
- Photo unit → AI reads brand, model, age, SEER rating
- Generates replacement proposal with energy savings calculation automatically
- "Your current system is 16 years old with SEER rating of 10. A modern 18 SEER system would reduce annual cooling costs by ~$340."
- App initiates the conversation, not the tech — different dynamic for techs who hate feeling like salespeople

**Maintenance Visit Autopilot**
- Tech logs readings (refrigerant pressures, delta-T, static pressure, filter condition, blower amps), takes photos
- AI auto-generates professional maintenance report PDF customer gets via portal same day
- This report is what makes customers renew maintenance contracts

**Maintenance Contract Management**
- Track which customers are on contracts, what's included, when visits are due, renewal dates
- AI sends renewal reminders, flags lapsed contracts

**Equipment EOL Alerts** (sleeper feature)
- Every unit in customer database has install date
- AI generates proactive outreach list: "these 14 customers have systems 14+ years old — recommend reaching out before summer"
- Turns customer data into a sales pipeline automatically

**IAQ (Indoor Air Quality) Add-On Trigger**
- During service/maintenance, AI flags IAQ opportunities: high humidity → dehumidifier, older system → air purifier proposal

---

## Platform-Level Features (All Trades)

### Cross-Trade Referral Network (The Moat)

Every trade on the platform becomes a lead source for every other trade:
- HVAC finds water damage during maintenance (condensate drain backup) → one-tap refers Crewmatic restoration contractor with photos
- Plumber documents pipe failure → one-tap refers restoration job
- Electrician finds moisture damage near electrical → one-tap refers restoration

This is the network effect — the more trades you add, the more valuable the platform becomes for everyone on it. The restoration contractor is the anchor.

### Other Platform Features
- **Trade Selector at Onboarding** — pick your trade, entire UI vocabulary, site log, AI prompts, and document templates reconfigure automatically
- **Pricing Database** — each trade contributes anonymized actual cost data. Over time this becomes the moat — real market pricing, not RSMeans averages
- **Upsell Intelligence** — AI scans every job for secondary revenue opportunities regardless of trade, surfaces them during the visit

---

## Build Priority & Complexity

| Phase | Vertical | Complexity | Dependency |
|-------|----------|------------|------------|
| **Now** | Water Restoration V1 | High (building from scratch) | None — this is the foundation |
| **Next** | Insurance Repair | Medium (reuses 60%+ of restoration code) | Restoration V1 core must be live |
| **Future** | Remodeling | Medium (new workflow, reuses platform) | Insurance Repair validates the model |
| **Future** | Plumbing | Medium (new AI prompts, similar structure) | Platform proven with 2 verticals |
| **Future** | Electrical | Medium (panel AI is unique, rest is similar) | Platform proven |
| **Future** | HVAC | High (recurring visits = different data model) | Platform proven |

### Key Architectural Insight from Brett

> "Remodeling and GC are almost the same product — GC is just remodeling with budget draw management and sub bid tracking added. Could be a complexity tier toggle."

> "HVAC has the most unique infrastructure because of maintenance contracts and recurring visits — that's a meaningfully different data model."

> "Plumbing and electrical are very similar in service call + project structure. The AI modules differ but the workflow skeleton is nearly identical."

---

## Platform Portability Assessment

> **Source:** Conversation between Brett and Claude, March 19, 2026
> **Context:** Brett asked how easy it would be to adapt ScopeFlow for other trades.

### What Transfers Directly (Low Effort)
- Job management shell — create job, assign tech, track status. Totally trade-agnostic.
- Photo upload + AI analysis — swap the system prompt and the same pipeline works for any trade.
- Customer/adjuster portal — completely reusable as-is.
- E-signature + contracts — trade-agnostic with minor template tweaks.
- Voice input + site log — works for any field tech.
- Multi-tenant white-label — already built.

### What Needs Moderate Rework
- Moisture readings / drying logs / equipment tracking — restoration-specific. Replaced by trade-specific data models (inspection checklists, permit tracking, punch lists).
- Drying Certificate PDF — swap for trade-relevant docs (inspection report, completion cert, CO checklist).
- Scope generation prompts — AI prompting logic is restoration-tuned. Rebuild prompt templates per trade, but infrastructure stays.

### What's Genuinely Hard
- **Xactimate alignment** — that's the restoration moat. GC/plumbing/electrical use different estimating tools (Buildertrend, ServiceTitan, Knowify). Integration or export formatting rebuilds per trade.
- **Trade-specific data models** — a plumber needs different fields than a restoration tech. New "room card" equivalents per vertical.
- **Regulatory/licensing variance** — electrical and plumbing have permit/inspection workflows that vary by municipality. Scope creep risk.

### Build Estimate
~2-4 weeks per trade MVP once the core is stable. The core (auth, job flow, AI pipeline, portals, PDFs) is the hardest part and it's already being built.

---

## Pricing Database Strategy (The Long-Term Moat)

> **Source:** Same conversation, March 19, 2026
> **Context:** Brett asked how to build a price database without all trades involved.

### The Flywheel

More contractors using Crewmatic → more real invoice data → smarter pricing suggestions → better product → more contractors. This is the same flywheel Xactimate ran for 30 years. Crewmatic has a chance to do it faster with AI.

### Phase 1 — Seed (Now → Month 6)

**Goal:** Have something functional at launch. Don't let "no database" block you.

- License RSMeans data as baseline — most credible starting point, national coverage, API access available.
- For restoration specifically, manually build a Crewmatic price table based on Brett's 10+ years of actuals. Even 200-300 line items is enough to be useful.
- Add a "price per line item" field to every scope generated. Every estimate a contractor saves = a data capture event.
- Store every saved estimate with: line item, quantity, unit price, zip code, trade, date. That's the schema from day one.

### Phase 2 — Crowdsource (Month 6 → Month 18)

**Goal:** Let the user base fill in the gaps.

- "Did this price feel right?" prompt after job close. One tap — too low / about right / too high. Simple signal, massive value.
- Show contractors "avg price in your market" based on anonymized peer data once volume is sufficient. This becomes a feature they tell other contractors about.
- Contractor-submitted actuals flow — let users log what they actually invoiced vs. estimated. That delta data is gold.
- Segment by zip code clusters (metro areas first — Detroit, Chicago, Atlanta) rather than hyper-local too fast.

### Phase 3 — Intelligence Layer (Month 18 → Month 36)

**Goal:** The database becomes an AI-powered pricing engine.

- Train a model (or heavily prompt engineer) on actuals dataset to predict price ranges by scope item + market + season + material index.
- Integrate material cost feeds (lumber futures, copper prices) to auto-adjust labor-heavy vs. material-heavy line items dynamically.
- **Supplement Trigger Engine** — flags when current material/labor costs justify a supplement on an insurance job based on index changes since estimate date. This alone is worth a premium tier.
- At this point the database is a proprietary asset — not a licensed one. That's when the moat is real.

### Phase 4 — Monetize the Data (Month 36+)

**Goal:** The database becomes a revenue stream, not just a feature.

- **Benchmark reports** — sell anonymized regional pricing reports to manufacturers, insurance carriers, and industry associations.
- **Enterprise licensing** — large restoration franchises or GC networks pay for API access to the pricing engine.
- **Xactimate disruption play** — if data is good enough and user base is large enough, no longer dependent on their pricing. Negotiate from strength or go around them entirely.

### Critical Action Item

> Set up the database schema to capture pricing data on every estimate NOW — even if you never look at it for 12 months. The data you're not capturing today is the only thing you'll regret later. It costs almost nothing to store and everything to not have it.
