# Future Verticals — Plumbing, Electrical, HVAC

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/0 phases) |
| **State** | Future — Not Scheduled |
| **Blocker** | Insurance Repair vertical must ship first |
| **Branch** | TBD |
| **Issue** | TBD |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-03-30 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Overview

Future trade verticals that extend Crewmatic from a restoration platform into a multi-trade field documentation and AI scoping platform. These verticals share significant infrastructure with the core Restoration and Insurance Repair verticals (job management, photo AI, voice input, document generation, adjuster/customer portals) but add trade-specific AI features, workflows, and document outputs.

**Source:** Brett's Product Specification v2.0 (ScopeFlow) (March 2026, Dry Pros/Brett Sodders) + Brett's multi-trade expansion vision (March 2026 interviews).

**Strategic thesis:** Every new vertical added increases the value of every vertical already on the platform via the cross-trade referral network. A plumber on Crewmatic becomes a lead source for restoration contractors on Crewmatic, and vice versa. This is the ServiceTitan playbook ($10B company, started with HVAC, expanded trade by trade).

**Priority order:** Plumbing > Electrical > HVAC (per Brett's assessment and natural connection to restoration — plumbers are first on scene for water losses).

**These may become a separate product or remain within Crewmatic.** The decision depends on whether a unified multi-trade platform or trade-specific apps serve contractors better. Architecture should accommodate both via the Trade/Vertical Selector pattern.

---

## Plumbing Vertical

Plumbing is the highest-priority trade expansion after Insurance Repair. The connection is direct: plumbers are often the first trade on scene when a water loss occurs, making them the natural upstream referral source for restoration contractors. A Crewmatic-connected plumber becomes a lead generation partner, not just a user.

The plumbing workflow splits into two modes: **fast service calls** (diagnostic, single visit, customer-funded) and **project work** (repipes, rough-in for remodels, insurance-adjacent source-of-loss documentation).

### Service Call Mode

| Feature | Description |
|---------|-------------|
| **Fast Intake** | Address, problem description by voice, photo of issue. Optimized for speed — plumber standing at the front door should be fully checked in within 60 seconds |
| **AI Pre-Diagnosis** | Photo + voice description → AI returns most likely cause, what the tech is probably looking at behind the wall, what parts to grab from the van, and a rough scope. A confident second opinion before the wrench comes out |
| **Systemic vs. Isolated Detector** | AI analyzes damage photos and flags whether this looks like a localized failure or a sign of a larger system problem. Galvanized corrosion pattern → whole-house repipe conversation. Pinhole on copper + green oxidation → water chemistry issue recommendation |
| **Repair vs. Replace Recommendation** | Based on pipe age, material, damage extent, and local code, AI recommends repair or full replacement with written justification the tech can show the homeowner. Removes the "pushy salesperson" dynamic — the data is recommending it, not the tech |
| **Customer Portal** | Homeowner-facing read-only portal (not adjuster-facing). Here is what we found, here is what we did, here is why it cost what it cost. Builds trust and eliminates chargebacks |

### The Killer Feature: Water Heater EOL Detection

Every plumber walks past water heaters on every job. Most do nothing because initiating a replacement conversation mid-job feels off-topic.

| Feature | Description |
|---------|-------------|
| **Serial Number Age Decode** | Photo the water heater data plate. AI reads the serial number and decodes the manufacture date — most major manufacturers (Bradford White, Rheem, A.O. Smith, State) encode the year and week in the serial. No guessing |
| **Condition & Efficiency Score** | AI assesses visible condition: corrosion on anode rod port, rust staining, sediment buildup signs, flue condition on gas units. Combined with age, generates a condition score and estimated remaining service life |
| **Auto-Generated Replacement Proposal** | When age + condition cross a threshold (configurable, e.g., 10+ years or poor condition), app auto-generates a replacement proposal with recommended unit, efficiency comparison, and estimated energy savings. Tech reviews and hands to homeowner before leaving |
| **Fleet Tracking** | Every water heater documented across a plumber's customer base is tracked. AI generates a proactive outreach list: "these 8 customers have water heaters 12+ years old — contact before winter." Turns service history into a sales pipeline |

### Project Mode — Repipes & Rough-In

| Feature | Description |
|---------|-------------|
| **Repipe Scope Generator** | Room-by-room voice walkthrough of the structure. AI generates full material and labor scope: linear footage by pipe size, fixture count and types, shutoff valves, drain connections. Xactimate-adjacent line items for insurance-adjacent repipe work |
| **Permit & Inspection Tracking** | Plumbing permits are mandatory for most project work. Track permit number, submission, inspection scheduling (rough-in and final), pass/fail, reinspection notes. Linked to job phase |
| **Phase Tracking** | Rough-In → Pressure Test → Inspection Hold → Trim-Out → Final. Each phase has photo documentation and completion sign-off |
| **Material List Export** | Repipe scope generates a material list formatted for supply house ordering. Reduces truck rolls and eliminates "I forgot a fitting" trips |

### Source of Loss Documentation — The Referral Engine

When a plumber finds a pipe failure that caused water damage, they become the most important person in the chain — the first trade on scene with photo documentation before anyone else arrives.

| Feature | Description |
|---------|-------------|
| **Source of Loss Report** | AI generates a formal source of loss report from the pipe failure photos and description. Documents failure type, location, estimated duration of leak, estimated damage area. Professional format suitable for insurance submission |
| **Cause & Origin Documentation** | Photos tagged with AI-generated cause descriptions: "pinhole corrosion consistent with aggressive water chemistry," "joint failure at elbow — improper soldering visible," "supply line braided hose failure at fitting connection." Defensible language the carrier can use |
| **One-Tap Restoration Referral** | After documenting the source of loss, single tap generates a pre-populated referral to a Crewmatic restoration contractor. Job address, customer contact, photos, and source of loss report all transfer automatically. Plumber looks professional to the homeowner. Restoration contractor gets a warm lead with documentation already done |
| **Referral Tracking** | Plumber sees which referrals resulted in restoration jobs. Restoration contractor can optionally send referral fee confirmation through the platform. Creates a closed-loop referral relationship |

### AI Features Summary — Plumbing

| Feature | Description |
|---------|-------------|
| Pre-Diagnosis Engine | Photo + description → ranked probable causes + diagnostic steps before opening walls |
| Systemic Issue Detector | Pattern recognition across damage photos → localized vs. whole-system flag |
| Water Heater EOL Engine | Serial decode + condition score → auto-generated replacement proposal |
| Repipe Scope Generator | Voice walkthrough → full material and labor scope |
| Code Compliance Checker | Repair description → applicable plumbing codes for jurisdiction |
| Source of Loss Reporter | Pipe failure photos → formal cause and origin document |
| Customer Communication Drafter | AI drafts the plain-language explanation of what was found and why it costs what it costs |

### Document Outputs — Plumbing

| Document | Description |
|----------|-------------|
| Service Call Report | Customer-facing summary: what we found, what we did, photos, warranty on parts and labor |
| Source of Loss Report | Formal cause and origin document for insurance submission |
| Repipe Scope | Line-item scope with material list, labor breakdown, permit requirements |
| Water Heater Replacement Proposal | Condition assessment, recommended unit, efficiency comparison, pricing |
| Permit Documentation | Permit application support package, inspection records |

---

## Electrical Vertical

Electrical is the most liability-driven trade on this platform. Every feature has dual value: it makes the electrician more money and protects them legally. The AI capabilities are uniquely compelling because electrical deficiencies are often visible in photos to a trained model but invisible to a homeowner — the information asymmetry is large and the professional value of surfacing it is high.

### The Killer Feature: Panel Photo Diagnosis

Photo the panel, AI returns a complete assessment in 30 seconds.

| Feature | Description |
|---------|-------------|
| **Brand & Model Identification** | AI identifies panel manufacturer and model from photo. Immediately flags known problem panels: Federal Pacific (Stab-Lok), Zinsco, Pushmatic, Sylvania. These panels are associated with elevated fire risk and are a significant liability issue for electricians who service them without documenting the condition |
| **Age Estimation** | Visual assessment of panel components, breaker style, and wire insulation to estimate approximate installation decade |
| **Safety Deficiency Scan** | AI scans for: double-tapped breakers, missing knockouts, improper breaker sizing, mixed breaker brands, signs of heat damage or arcing on bus bar, deteriorated wire insulation, absence of main shutoff |
| **Hazard Report Generation** | Findings compiled into a formal panel assessment report with photo documentation, deficiency list, and remediation recommendations. Customer signs acknowledging the condition. Protects the electrician legally |
| **Upsell Trigger** | Panel assessment automatically generates a panel upgrade proposal when deficiencies cross a severity threshold. Not the tech pushing it — the documented findings driving it |

### Service Call Mode

| Feature | Description |
|---------|-------------|
| **Fast Intake** | Address, complaint description by voice, photo of panel and problem area. 60-second check-in |
| **Pre-Diagnosis Engine** | Symptom description + photos → AI returns probable cause and diagnostic sequence. "Tripping breaker on kitchen circuit" → check for overload, AFCI requirement, faulty receptacle, loose connection at panel. Tech arrives prepared |
| **Upsell Scanner** | AI reviews all photos taken during the service call and before the tech leaves flags secondary opportunities: no GFCI in bathrooms or kitchen, no AFCI protection in bedrooms, aluminum wiring visible, panel nearing capacity, outdated 2-prong outlets, lack of surge protection. Each flag generates a brief proposal the tech can leave with the homeowner |
| **Aluminum Wiring Hazard Documentation** | Aluminum wiring in homes built 1965-1973 is a significant fire hazard. AI identifies aluminum wiring from photos and generates a formal hazard disclosure document with remediation options (pigtailing, complete rewire, CO/ALR device installation). Customer signs. Protects electrician from future liability |
| **Knob-and-Tube Documentation** | Same hazard documentation workflow for knob-and-tube wiring. AI flags visible K&T from photos, generates disclosure with applicable insurance implications noted |

### Load Calculation Assistant

| Feature | Description |
|---------|-------------|
| **Service Adequacy Check** | Tech describes home: square footage, HVAC type, electric vs. gas, existing major loads, what is being added. AI runs a simplified load calculation and returns: service is adequate, needs a subpanel, or needs a full service upgrade. Determines the quote before the laptop opens |
| **Dedicated Circuit Sizing** | For specific appliances or equipment, AI returns the correct circuit size, wire gauge, and breaker type based on the load and applicable NEC requirements |
| **Load Calc Report** | Formal load calculation document attached to the job record. Supports the proposal and protects the electrician if a service upgrade is disputed later |

### Specialty Install Workflows

| Feature | Description |
|---------|-------------|
| **EV Charger Install** | Dedicated intake flow: panel capacity check, circuit routing, charger model and amperage, permit requirements by municipality, rebate eligibility flag. AI pre-populates the scope. Fastest-growing residential electrical category |
| **Whole-Home Generator** | Transfer switch type, generator sizing calculation based on desired loads, fuel type, placement requirements, permit needs. AI generates the full scope from a voice description of what the homeowner wants backed up |
| **Solar / Battery Integration** | As solar and battery storage installations grow, AI assists with interconnection scope, panel upgrade requirements, and utility interconnection documentation. Future roadmap item — stub in intake fields now |

### Code Reference Engine

| Feature | Description |
|---------|-------------|
| **NEC on Demand** | Tech describes proposed work or a field condition. AI returns applicable NEC code sections (2023 NEC) and flags common local amendments. Currently plumbers and electricians Google this in the field — integrating it into the job record with citations is a meaningful upgrade |
| **Code Upgrade Line Items** | When a repair requires bringing adjacent work up to current code, AI identifies the upgrade requirements and generates the line items with code citations. Defensible with the customer and billable |
| **Jurisdiction Awareness** | AI notes when local amendments commonly differ from NEC base code (e.g., California Title 24, Chicago amendments) and flags the tech to verify locally. Not a substitute for local knowledge — a prompt to apply it |

### AI Features Summary — Electrical

| Feature | Description |
|---------|-------------|
| Panel Photo Diagnosis | Photo → brand, age, deficiencies, hazard flags, formal assessment report |
| Pre-Diagnosis Engine | Symptom + photo → probable cause + diagnostic sequence |
| Upsell Scanner | All job photos → secondary opportunity flags with mini-proposals |
| Load Calculation Assistant | Home description → service adequacy determination + load calc report |
| Hazard Documentation AI | Aluminum wiring, K&T, Federal Pacific → formal disclosure with customer sign-off |
| Code Reference Engine | Work description → NEC citations + local amendment flags |
| EV / Generator Scope Generator | Voice describe the install → full scope with permit requirements |

### Document Outputs — Electrical

| Document | Description |
|----------|-------------|
| Service Call Report | Customer-facing: findings, work performed, photos, warranty |
| Panel Assessment Report | Formal deficiency report with photos, signed customer acknowledgment |
| Hazard Disclosure | Aluminum wiring / K&T / Federal Pacific — signed disclosure with remediation options |
| Load Calculation Report | Formal load calc document supporting service upgrade proposals |
| EV / Generator Proposal | Scope, permit requirements, timeline, pricing |
| Permit Documentation | Permit application support, inspection records |

---

## HVAC Vertical

HVAC has a fundamentally different business model than any other trade on this platform: maintenance contracts are the revenue backbone. A residential HVAC company with 500 active maintenance contract customers has recurring, predictable revenue that a plumber or electrician does not. That changes what the software needs to do — it is not just about the service call. It is about the relationship between calls.

The AI features operate across two timeframes: **in-the-moment** (diagnosis, replacement trigger, maintenance report) and **between-visits** (contract management, EOL alerts, proactive outreach).

### The Killer Feature: Symptom-to-Diagnosis Engine

HVAC diagnosis is the highest-skill, most time-consuming part of the trade. A junior tech who sounds like a senior tech on day one is worth significantly more revenue per truck.

| Feature | Description |
|---------|-------------|
| **Pre-Arrival Diagnosis** | Customer describes symptoms when scheduling. AI pre-diagnoses before the tech loads the van: most likely causes ranked by probability, what parts to pull, what tools to bring. Reduces forgotten parts and truck rolls |
| **In-Field Refinement** | Tech photos indoor and outdoor unit, logs refrigerant pressures, suction and discharge temps, delta-T across coil, static pressure, blower amps. AI refines diagnosis in real time as readings come in. "Low suction pressure + high superheat + warm liquid line → refrigerant restriction, check TXV and filter drier before assuming leak" |
| **Diagnostic Tree Navigation** | For common failure modes, AI walks the tech through a structured diagnostic sequence. Not a replacement for training — a structured scaffold that ensures nothing is skipped |
| **Parts Prediction** | Based on probable diagnosis, AI generates a parts list with part numbers for common brands. Tech can confirm availability with supply house before opening the unit |

### System Replacement Trigger

The replacement conversation is the most valuable and most avoided conversation in HVAC.

| Feature | Description |
|---------|-------------|
| **System Photo Assessment** | Photo indoor and outdoor units. AI reads brand, model number, approximate age from visual and model cues, estimated SEER rating, visible condition indicators (corrosion on coil fins, refrigerant oil staining, compressor condition) |
| **Age + Efficiency Score** | Combined age, efficiency, and condition score generates a replacement recommendation tier: monitor, plan for replacement, replace now. Each tier has a different proposal tone |
| **Energy Savings Calculator** | Current system SEER vs. proposed replacement SEER → estimated annual energy cost difference at local utility rates (configurable). "Replacing your 10 SEER system with a 20 SEER unit is estimated to save you approximately $480 per year in cooling costs." Customer-facing number that sells the replacement without the tech doing the math |
| **Auto-Generated Replacement Proposal** | Replacement tier + energy savings calculation → proposal generated automatically. Equipment options, installation scope, financing note. Tech reviews and presents before leaving. Same walk-out close dynamic as the water heater EOL feature in plumbing |

### Maintenance Visit Autopilot

The biggest complaint from maintenance contract customers is that they feel like they are paying for nothing — nobody explains what was done or why it matters.

| Feature | Description |
|---------|-------------|
| **Maintenance Checklist** | Configurable checklist per equipment type (gas furnace, heat pump, split AC, package unit). Tech works through checklist, logs readings at each point, takes photos. Structured but fast |
| **Reading Log** | Refrigerant pressures, subcooling, superheat, delta-T, static pressure, blower motor amps, filter condition, drain line condition, capacitor readings (uF). All readings timestamped and stored per visit. Voice input supported |
| **Trend Analysis** | Readings compared against prior visits. AI flags deteriorating trends: "suction pressure 8 psi lower than last spring visit — monitor for refrigerant loss," "blower motor amp draw increasing — motor approaching end of life." Turns historical data into proactive service recommendations |
| **Maintenance Report PDF** | AI generates a professional maintenance report from the checklist completion and reading log. Plain-language summary of what was done, what was found, what to watch. Photos attached. Customer receives via portal same day. This report is what makes customers renew their contracts |

### Maintenance Contract Management

| Feature | Description |
|---------|-------------|
| **Contract Tracking** | Customer name, equipment covered, contract tier (annual, bi-annual, priority), visit schedule, renewal date, payment status. All in one view |
| **Visit Scheduling** | Upcoming maintenance visits surfaced on the dashboard. Overdue visits flagged. Tech can schedule directly from the app |
| **Renewal Management** | AI sends renewal reminders at configurable intervals before expiration. Lapsed contracts flagged. Renewal rate tracked as a business metric |
| **Contract Proposal Generator** | At the end of any service call, AI generates a maintenance contract proposal tailored to the equipment serviced. Converts one-time customers into recurring revenue. Includes equipment age and condition in the pitch |

### Equipment EOL Alerts — Proactive Revenue

Every documented unit in the system has an install date. Most HVAC companies have this data somewhere but no one is using it proactively.

| Feature | Description |
|---------|-------------|
| **EOL Monitoring** | Every unit documented across the company's customer base is tracked. AI monitors age across the fleet and generates a proactive outreach list: customers with systems 14+ years old, customers with systems approaching warranty expiration, customers in high-demand seasons |
| **Seasonal Outreach Timing** | AI flags the outreach list 6-8 weeks before peak cooling and heating seasons — when replacement decisions have the most urgency and the customer is most receptive |
| **Pre-Season Replacement Proposals** | One-tap generates replacement proposals for all flagged customers. Tech or office staff reviews and sends. Turns a data list into a revenue action |

### IAQ Add-On Trigger

| Feature | Description |
|---------|-------------|
| **IAQ Opportunity Detection** | During any visit, AI scans context for IAQ upsell signals: high humidity readings → whole-home dehumidifier conversation. Dusty return condition → media filter or air purifier upgrade. Older system with no IAQ accessories → UV light system proposal. These are bolt-on sales the tech is already positioned to make but often forgets to mention |
| **IAQ Assessment** | Photo the return air area, describe any customer complaints (odors, dust, humidity discomfort). AI generates a brief IAQ assessment with recommended products and estimated improvement |
| **Product Proposals** | Air purifiers, UV systems, whole-home humidifiers, whole-home dehumidifiers, energy recovery ventilators. AI generates a product-specific proposal with installation scope and customer-facing benefits language |

### AI Features Summary — HVAC

| Feature | Description |
|---------|-------------|
| Symptom-to-Diagnosis Engine | Symptoms + readings + photos → ranked diagnosis + parts list |
| System Replacement Trigger | Photo → age/efficiency/condition score → auto-generated replacement proposal |
| Energy Savings Calculator | Current vs. proposed SEER → annual dollar savings at local utility rates |
| Maintenance Report Autopilot | Checklist + readings → professional maintenance report PDF same day |
| Reading Trend Analyzer | Current readings vs. historical → deterioration flags and service recommendations |
| EOL Alert Engine | Equipment age fleet monitoring → proactive outreach list with seasonal timing |
| Contract Renewal AI | Lapse prediction + renewal reminders + contract proposal generator |
| IAQ Opportunity Scanner | Visit context → IAQ upsell flags with product proposals |

### Document Outputs — HVAC

| Document | Description |
|----------|-------------|
| Diagnostic Report | What was found, probable cause, recommended repair, supporting readings and photos |
| Maintenance Visit Report | Full checklist completion, all readings, condition notes, photos, plain-language summary |
| System Assessment Report | Age, condition, efficiency score, replacement recommendation, energy savings projection |
| Replacement Proposal | Equipment options, installation scope, energy savings calculator, financing note |
| Maintenance Contract Proposal | Equipment covered, visit schedule, priority service terms, pricing |
| IAQ Assessment | Findings, recommended products, installation scope, customer-facing benefits |

---

## Remodeling Vertical (Placeholder)

The Remodeling vertical is planned as a future vertical that shares significant infrastructure with Insurance Repair — proposal generation, phase tracking, permit management, change order workflow — but operates in a non-insurance context where the customer is the budget holder and decision-maker.

Key differentiators from Insurance Repair:
- No carrier or adjuster — customer portal replaces adjuster portal as the primary external view
- Proposal and change order workflow replaces scope and supplement workflow
- No ACV/RCV tracking — replaced by customer payment schedule and draw management
- Subcontractor coordination and punch list management are primary workflows
- Material cost tracking vs. estimate is the financial monitoring tool

The Remodeling vertical will be fully specified once the Insurance Repair vertical reaches MVP. The Job Mode architecture (Trade/Vertical Selector) already accommodates a future "Remodeling" mode without structural changes.

---

## Shared Platform Infrastructure Required

All three verticals share these capabilities with the existing Restoration vertical:

- **Job Management** — intake, status panels, tech assignment, scheduling
- **Photo Documentation** — capture, GPS tagging, room assignment, AI analysis
- **VoiceForm** — voice input for all intake and documentation fields
- **Customer/Adjuster Portal** — read-only external view of job progress
- **Document Generation** — PDF generation pipeline with company branding
- **AI Pipeline** — Claude API integration for trade-specific analysis
- **Trade/Vertical Selector** — at account creation, select primary vertical. At job creation, select job mode. Architecture accommodates additional verticals without structural changes

## Cross-Trade Referral Flows

| Flow | Description |
|------|-------------|
| **Plumber → Restoration** | Plumber documents pipe failure causing water damage. One tap refers the water damage restoration job with source of loss report and photos attached |
| **HVAC → Restoration** | HVAC tech finds condensate drain backing up into ceiling, evaporator coil leak soaking insulation, or crawlspace moisture from equipment drainage. One tap referral to restoration |
| **Electrician → Restoration** | Electrician finds moisture damage near electrical panel or in walls during a service call. One tap refers the restoration job. Also potentially flags a safety hold until water intrusion is remediated |
| **Restoration → Insurance Repair** | Internal to the platform — mitigation job converts to reconstruction. But if the restoration contractor does not do reconstruction, one tap refers to an insurance repair contractor on the platform |
| **Insurance Repair → Plumbing / Electrical** | Insurance repair contractor needs a licensed sub for code-required plumbing or electrical during reconstruction. Finds and connects through the platform rather than calling around |

---

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# These verticals are future state — focus on Insurance Repair first
# Source document: /Users/lakshman/Downloads/ScopeFlow_Product_Spec_v2.pdf
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Source:** Brett's Product Specification v2.0 (ScopeFlow) (March 2026, Dry Pros/Brett Sodders) — 33-page document covering Restoration, Insurance Repair, Plumbing, Electrical, HVAC verticals
- **Priority order per Brett:** Insurance Repair (V2) > Plumbing > Electrical > HVAC > Remodeling
- **Plumbing is highest-priority trade expansion** because plumbers are first on scene for water losses — natural upstream referral source for restoration contractors
- **Each vertical has a "killer feature"** that sells itself in a 30-second demo: Water Heater EOL (plumbing), Panel Photo Diagnosis (electrical), Symptom-to-Diagnosis (HVAC)
- **HVAC is unique** because maintenance contracts create recurring revenue — the software needs to manage the relationship between calls, not just the call itself
- **Cross-trade referral network is the platform moat** — each new vertical increases the value of every existing vertical. This is the ServiceTitan playbook
- **Remodeling vertical** is mentioned in Brett's spec but not fully specced — shares infrastructure with Insurance Repair (phase tracking, permit management, change order workflow) but operates in a non-insurance context where the customer is the budget holder
- **These may become a separate product** — the decision depends on market validation. Architecture should support both unified platform and standalone trade apps
- **Brett's prototype architecture limitation:** Their vanilla JS + Firebase stack can't scale to multi-vertical. Our Next.js + FastAPI + Supabase stack is purpose-built for this expansion
