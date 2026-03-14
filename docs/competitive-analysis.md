# RestorOS — Competitive Analysis & Product Strategy

> **The Operating System for Restoration Contractors**
>
> *A field-first platform that uses AI to turn photos and voice into insurance-ready estimates — replacing 4+ tools with one.*

---

> **How to review this document:**
> Read each section, then answer the review questions at the end of that section. You can voice-record your answers — just mention the section number and question number before each answer. Be honest and specific. If something is wrong, say so. If something is missing, tell us what. Your field experience is what makes this product real.

---

## Section 1: The Problem

Water restoration contractors today juggle **4-6 separate tools** to document a single job:

| What they need to do | Tool they use | Monthly cost |
|---------------------|--------------|-------------|
| Take photos | CompanyCam or phone camera | $19-27/user |
| Document damage | Encircle | $270-650 |
| Log moisture readings | Paper/Excel or DryBook | $55-85/user |
| Draw floor plans | magicplan or pen & paper | $40/project |
| Write the estimate | Xactimate (required by insurance) | $100-149 |
| Manage jobs & team | DASH or PSA or Albi | $55-650 |

**Total: $500-1,600+/month** for a small restoration company — before they've restored a single property.

And even with all these tools, the core workflow is still painfully manual:
1. Tech walks the job site with a clipboard
2. Takes photos on their phone
3. Writes notes by hand or types them later
4. Sits at a desk for 2-4 hours manually entering Xactimate line items
5. Hopes they didn't miss anything

**RestorOS eliminates steps 2-4.** Take a photo of the damage, AI generates the Xactimate line items. Speak your scope, AI structures it. That's the product.

### Review Questions — Section 1

> **1.1** Is the tool list above accurate? Which of these tools do you actually use day-to-day? Are there tools we're missing?
>
> **1.2** Is the cost range ($500-1,600/mo) realistic for your shop? What do you actually spend on software per month?
>
> **1.3** How long does scoping actually take you? We said 2-4 hours of manual Xactimate entry — is that right, or is it more/less?
>
> **1.4** What's the most painful part of the current workflow? If you could wave a magic wand and fix ONE thing, what would it be?
>
> **1.5** Are there pain points we're not mentioning? Things that waste your time that aren't on this list?

---

## Section 2: Market Opportunity

| Metric | Value |
|--------|-------|
| US restoration businesses | 62,582 (IBISWorld 2025) |
| Market growth rate | 4.3% YoY |
| US restoration services market | $7.2 billion (2025) |
| Water damage market (2026 to 2032) | $5.97B to $8.97B (6.93% CAGR) |
| IICRC certified technicians | 49,000+ |
| IICRC certified firms | 6,500+ |
| Software TAM (US) | **$225M - $600M/year** |
| Addressable (small/mid shops) | **$180M - $360M/year** |

The market is large, growing, and **underserved by modern software.** The dominant players (DASH, Xactimate) are 15-20+ years old. AI adoption in restoration is near zero.

### Key Market Dynamics

- **Insurance carriers mandate digital documentation** — paper is being rejected
- **99% of carriers require Xactimate-formatted estimates** — any tool must output Xactimate data
- **AI + IoT in water damage assessment is a $3 billion emerging market**
- **High technician turnover** — tools must be dead simple to learn
- **Seasonal demand spikes** (hurricanes, winter pipe bursts) — infrastructure must scale
- **Major franchises control significant market share:** SERVPRO (2,370+ locations), ServiceMaster Restore (800+), Paul Davis (300+)

### Review Questions — Section 2

> **2.1** Do the carriers you work with actually reject paper documentation now? Or do some still accept it?
>
> **2.2** Is Xactimate truly required by every carrier you work with? Have you ever submitted a non-Xactimate estimate and had it accepted?
>
> **2.3** How many restoration companies do you personally know in your area? Would you describe the market as competitive (lots of companies) or thin (few companies, lots of work)?
>
> **2.4** How bad is technician turnover in your experience? How long does it take to train a new tech on the current tools?
>
> **2.5** Do you work with any franchises (SERVPRO, etc.) or are you independent? How do franchise shops differ from independents in terms of tool adoption?

---

## Section 3: Competitor Deep Dive

### Encircle — Field Documentation Leader

The most popular field documentation app for restoration. Photos, floor plans, moisture readings, drying logs, contents inventories.

| | Detail |
|---|---|
| **Pricing** | Small: $270/mo, Medium: $455/mo, Large: $650/mo — flat rate, unlimited users |
| **Mobile** | Native iOS + Android |
| **AI** | Auto photo labeling, voice-to-text notes — no AI scoping |
| **Xactimate** | Floor plan import into Xactimate sketches |
| **Strengths** | Brand recognition, comprehensive documentation, unlimited users, Xactimate sketch integration |
| **Weaknesses** | No AI-generated line items, no voice-guided scoping, $270/mo minimum is steep for small shops, documentation only (not job management) |

---

### DASH (by CoreLogic/Cotality) — Enterprise Legacy

The most comprehensive all-in-one platform. Job management, compliance automation, accounting, CRM. Built 20+ years ago.

| | Detail |
|---|---|
| **Pricing** | Custom/enterprise — reportedly $500+/month |
| **Mobile** | DASH mobile + Mitigate mobile apps |
| **AI** | Minimal — automated compliance checklists |
| **Xactimate** | Deep integration (same parent company: Verisk/Cotality) |
| **Strengths** | Most comprehensive features, SOC 2 certified, compliance automation |
| **Weaknesses** | 20-year-old infrastructure, dated UI, expensive, overkill for small shops |

---

### Albiware (Albi) + DryBook 2.0 — Modern Mid-Market

Job management + CRM + DryBook for field documentation (moisture, equipment, photos).

| | Detail |
|---|---|
| **Pricing** | Base: $55/mo, Pro: $85/mo per user |
| **AI** | None |
| **Strengths** | Most affordable full-featured platform, DryBook 2.0 solid for moisture logging |
| **Weaknesses** | No AI, less established brand, limited customization |

---

### PSA (Canam Systems) — Accounting-First

All-in-one with strong accounting built for restoration.

| | Detail |
|---|---|
| **Pricing** | $325/mo for 5 users + $5.25/additional. $1,500 mandatory onboarding fee |
| **Strengths** | Best accounting features, good franchise support |
| **Weaknesses** | $1,500 onboarding barrier, no field moisture logging, no AI |

---

### DocuSketch — Hardware-Assisted Scoping

360-degree scanning, floor plan generation, and "Estimating as a Service" (human-verified estimates in 48 hours).

| | Detail |
|---|---|
| **Pricing** | $40/project + $795 hardware kit |
| **Strengths** | 99% accurate floor plans, 20 seconds per room |
| **Weaknesses** | Requires $795 hardware, 48-hour turnaround on estimates, not a job management tool |

---

### magicplan — LiDAR + Emerging AI

LiDAR-based floor plans, moisture readings, drying reports.

| | Detail |
|---|---|
| **Pricing** | $40/project, custom for high volume |
| **AI** | **Announced "AI Capture Mode"** (walk through + voice + auto-reports) — not yet shipped |
| **Strengths** | Fast LiDAR scanning, upcoming AI features |
| **Weaknesses** | Requires LiDAR-enabled iPhone, per-project pricing, AI not shipped yet |

---

### Restorator Pro — AI Claims Advisor

AI assistant trained on 10,000+ pages of restoration playbooks.

| | Detail |
|---|---|
| **Pricing** | $29/month with free tier |
| **AI** | Core feature — users report 15-30% more collected on claims |
| **Weaknesses** | Not a field documentation or job management tool — it's an advisor only |

---

### Clean Claims — IoT Remote Monitoring

Moisture mapping + remote monitoring with Wi-Fi sensors — live 24/7 data without site visits.

| | Detail |
|---|---|
| **Strengths** | Remote monitoring eliminates unnecessary site visits |
| **Weaknesses** | Requires physical sensors/hardware, smaller brand, no AI |

---

### Other Players

| Tool | What | Price | Why it's not a direct threat |
|------|------|-------|------------------------------|
| Xcelerate | Workflow automation | $55-85/user/mo | No field tools, no moisture logging |
| JobNimbus | CRM (roofing-first) | Custom | Not built for restoration |
| CompanyCam | Photo docs only | $19-27/user/mo | Photos only, no scoping |
| Job-Dox | Project management | $350-650/mo | General PM, nothing restoration-specific |
| KnowHow | Training/SOPs | Varies | Complementary, not competitive |

### Review Questions — Section 3

> **3.1** Which of these competitors have you actually used? What did you like/hate about them?
>
> **3.2** Are there tools we're missing? Anything your contractor friends use that's not on this list?
>
> **3.3** Is Encircle as dominant as we think? Do most restoration companies in your area use it?
>
> **3.4** Have you looked at magicplan? Their AI Capture Mode sounds similar to what we're building — have you seen it in action or heard other contractors talk about it?
>
> **3.5** Have you used Restorator Pro ($29/mo AI advisor)? Is the claims guidance actually useful?
>
> **3.6** What about DocuSketch — is the $795 hardware kit a real barrier, or do serious shops just buy it?
>
> **3.7** Is there anything a competitor does REALLY well that we absolutely must match or beat?

---

## Section 4: The Feature Matrix

How RestorOS stacks up against every competitor:

| Feature | RestorOS | Encircle | DASH | Albi | DocuSketch | magicplan | PSA |
|---------|:--------:|:--------:|:----:|:----:|:----------:|:---------:|:---:|
| **AI Photo to Xactimate Line Items** | **YES** | -- | -- | -- | -- | -- | -- |
| **Voice-Guided Scoping** | **YES** | Partial | -- | -- | Partial | Announced | -- |
| **Moisture Logging (Atmospheric)** | **YES** | YES | YES | YES | -- | YES | -- |
| **Moisture Point Tracking** | **YES** | YES | YES | YES | -- | YES | -- |
| **Dehumidifier Output Logging** | **YES** | YES | YES | YES | -- | Partial | -- |
| **Equipment Tracking** | **YES** | YES | YES | YES | -- | -- | -- |
| **Floor Plan / Room Sketching** | **YES** | YES | YES | Partial | YES | YES | -- |
| **Xactimate-Ready Output** | **YES** | YES | YES | YES | YES | YES | YES |
| **Photo Documentation** | **YES** | YES | YES | YES | YES | YES | Partial |
| **Job Management** | **YES** | -- | YES | YES | -- | -- | YES |
| **Team Management** | **YES** | Unlimited | YES | YES | -- | YES | Per-user |
| **Adjuster/Customer Portal** | V2 | Reports | YES | Partial | Sharing | Collab | -- |
| **Accounting** | V2+ | -- | YES | YES | -- | -- | **YES** |
| **S500/IICRC Compliance** | **YES** | YES | YES | Partial | -- | -- | -- |
| **Offline Capable** | **YES** | YES | Partial | Partial | -- | Partial | -- |
| **Works on Any Phone** | **YES** | YES | YES | YES | YES | LiDAR only | YES |
| **No Hardware Required** | **YES** | YES | YES | YES | $795 kit | LiDAR phone | YES |
| **AI Hazmat Scanner (Asbestos + Lead)** | **YES** | -- | -- | -- | -- | -- | -- |
| **AI Claims Assistance** | Planned | -- | -- | -- | -- | -- | -- |
| **Remote Monitoring (IoT)** | V3+ | -- | -- | -- | -- | -- | -- |

### What Only RestorOS Does

**Two features no competitor has:**

1. **AI Photo to Xactimate Line Items.** No other tool takes a damage photo and produces Xactimate-ready scope entries. Every other tool requires manual line-item entry. This collapses a 2-4 hour workflow into minutes.

2. **AI Hazardous Material Scanner.** When photos are uploaded, AI automatically scans for materials that are high-risk for asbestos and lead-based paint, and flags them with a warning.

   **Asbestos detection:** Identifies popcorn ceilings, old vinyl floor tiles (9x9), pipe insulation, vermiculite insulation, transite siding, old duct tape/mastic — any material in a pre-1980s home that should be tested before disturbing.

   **Lead paint detection:** Flags painted surfaces in pre-1978 homes, especially windowsills, trim, doors, and chipping/peeling paint in older construction.

   **How it works:** Upload 10 photos of a job site. AI reviews every image. If 2 photos show asbestos-risk materials (e.g., old flooring and pipe wrap), those photos get flagged immediately with:
   - A clear hazard warning explaining the risk
   - Links to purchase asbestos/lead test kits
   - Licensed abatement contractors in the area

   **Revenue model:** Test kit manufacturers and abatement contractors pay for placement — essentially sponsored recommendations. This creates a revenue stream beyond subscriptions, and it's genuinely useful (contractors need test kits and abatement referrals anyway).

   **No competitor does this.** Every other tool treats photos as passive documentation. RestorOS actively analyzes them for safety risks.

### Review Questions — Section 4

> **4.1** Look at this feature list — which features are absolute MUST-HAVES for you on day one? Which ones could wait?
>
> **4.2** Are there features missing from this matrix entirely? Things you need that no tool currently does well?
>
> **4.3** How important is floor plan / room sketching? Is it required by adjusters, or is it a "nice to have"? Can you submit a scope without a sketch?
>
> **4.4** How important is S500/IICRC compliance automation? Do adjusters actually check for compliance, or is it more of a CYA thing?
>
> **4.5** How important is offline capability? How often are you in basements or crawlspaces with no signal?
>
> **4.6** Is accounting integration a dealbreaker? Or do most small shops use QuickBooks separately and that's fine?
>
> **4.7** Would an adjuster/customer portal actually save you time? How do you currently share documentation with adjusters?

---

## Section 5: Pricing Comparison

### What Contractors Pay Today (Typical Small Shop, 3-5 Techs)

| Tool | Monthly Cost |
|------|-------------|
| Xactimate | $100-149/user (required, can't avoid) |
| Encircle (documentation) | $270-455 |
| Job management (Albi or PSA) | $165-325 |
| CompanyCam (photos) | $57-135 (3-5 users) |
| magicplan (floor plans) | $40/project x ~10 jobs = $400 |
| **Total** | **$592 - $1,464/month** |

### What RestorOS Will Charge

| Tier | Monthly | What's Included | Target |
|------|---------|----------------|--------|
| **Solo** | **$49** | 2 users, core features, 50 AI scopes/month | 1-2 person shops |
| **Team** | **$149** | Unlimited users, full AI scoping (200/mo), moisture logging, reports | 3-10 person shops |
| **Pro** | **$299** | Everything + adjuster portal, advanced analytics, priority support, 1,000 AI scopes/mo | 10-25 person shops |
| **Enterprise** | Custom | Multi-location, API access, unlimited AI, dedicated support | Franchise operations |

**Note:** Contractors still need Xactimate ($100-149/mo) — RestorOS complements it, doesn't replace it. But RestorOS replaces Encircle + job management + CompanyCam + magicplan.

### Additional Revenue: Hazmat Scanner Marketplace

Beyond subscriptions, the AI Hazmat Scanner creates a marketplace revenue stream:

| Revenue Source | How it works | Estimated Revenue |
|---------------|-------------|------------------|
| **Test kit manufacturers** | Featured placement when asbestos/lead is flagged (e.g., "Order a test kit from [Brand]") | Per-click or monthly sponsorship |
| **Abatement contractors** | "Licensed abatement contractors near you" listings on flagged photos | Lead generation fee per referral |
| **Equipment suppliers** | Recommended PPE, containment supplies when hazards detected | Affiliate commission |

This is advertising contractors actually WANT — they need test kits and abatement referrals when hazards are detected. It's not intrusive, it's useful.

### Savings Calculator

| Scenario | Before RestorOS | With RestorOS | Monthly Savings |
|----------|----------------|---------------|----------------|
| Solo contractor | $492-714/mo | $149 (Team) | **$343-565/mo** |
| 5-person shop | $692-1,164/mo | $149 (Team) | **$543-1,015/mo** |
| 15-person company | $1,100-2,000+/mo | $299 (Pro) | **$801-1,701/mo** |

### Review Questions — Section 5

> **5.1** Would you pay $149/mo for a tool that replaced Encircle + CompanyCam + magicplan + your job management tool? Is that a no-brainer or would you need convincing?
>
> **5.2** Is the Solo tier at $49/mo attractive for a 1-2 person shop? Or would they need more than 50 AI scopes/month?
>
> **5.3** How many jobs do you scope per month? That helps us set the right AI scope limits per tier.
>
> **5.4** Would you prefer per-user pricing ($X/user/mo) or flat-rate pricing (one price, unlimited users)? Why?
>
> **5.5** What's the maximum you'd pay per month for a tool that cut your scoping time by 75%?
>
> **5.6** Is "AI scopes per month" the right way to limit tiers? Or would you prefer limits on number of jobs, or number of users?

---

## Section 6: What We're Building (Core Features)

### Feature 1: AI Photo Scope (The Killer Feature)

Upload a photo of water damage. AI analyzes it and returns Xactimate-ready line items:

```
You upload a photo of water-damaged drywall and flooring.

AI returns:
  WTR DRYOUT  — Structural Drying         — 1 EA   — $480
  DRYWLL RR   — Remove & Replace Drywall   — 120 SF — $324
  BSBD RR     — Remove & Replace Baseboard — 32 LF  — $86
  PLR/STN     — Paint Walls                — 120 SF — $144
  FLR CVR     — Remove Floor Covering      — 80 SF  — $96

You review, edit if needed, approve. Done in minutes instead of hours.
```

The tech can approve, edit, or reject each line item. AI suggestions are always human-verified before submission.

### Feature 2: Voice-Guided Scoping

Instead of typing, the app walks you through the scope step by step via voice:

```
App: "What room are you in?"
You: "Master bedroom"

App: "Describe the damage you see."
You: "Water damage on the north wall, about 3 feet up from the floor.
      Drywall is saturated, baseboard is warped, carpet is wet."

App: "What material is the flooring?"
You: "Carpet over plywood subfloor"

App: "Estimated affected area?"
You: "About 10 by 12"

→ AI generates line items from your spoken description
```

Works hands-free with voice commands: say "next" to advance, "done" to finish, "approve" to accept AI suggestions.

### Feature 3: Site Log (Moisture Readings + Equipment)

Per-room tracking of:
- **Atmospheric readings:** Temperature, Relative Humidity (RH%), Grains Per Pound (GPP)
- **Moisture points:** Numbered measurement points on walls/floors with material type
- **Dehumidifier output:** Temperature and RH of dehu exhaust
- **Equipment placement:** Which dehumidifiers, air movers, air scrubbers are in which room
- **Trend tracking:** See drying progress over multiple daily visits

### Feature 4: Room Sketching

Draw floor plans of affected rooms directly in the app. Mark affected areas, equipment placement, moisture reading points. Export sketches in a format compatible with Xactimate.

### Feature 5: Job Management

Create and track jobs with:
- Customer info (name, phone, email)
- Insurance info (carrier, claim number, adjuster)
- Loss details (type, category, class, source, date)
- Assign techs to jobs
- Track job status (New > In Progress > Monitoring > Completed > Invoiced > Closed)

### Feature 6: Photo Documentation

- Capture photos with automatic GPS tagging
- Assign photos to specific rooms
- Tag as before/after
- Offline capture with auto-upload when back online

### Feature 7: Report Generation

Generate professional reports:
- Xactimate-ready scope notes (CSV/ESX export for direct import)
- Moisture log reports (daily readings, trend charts)
- Job summary with photos, scope, readings, equipment log
- PDF export for adjusters

### Feature 8: Team Management

- Invite techs by email
- Assign techs to jobs
- Role-based access (Owner sees everything, Tech sees assigned jobs)

### Feature 9: AI Hazardous Material Scanner (Asbestos + Lead Paint)

Every photo uploaded to RestorOS is automatically scanned by AI for hazardous materials:

```
You upload 10 photos of a water-damaged home built in 1972.

AI flags 2 photos:
  PHOTO 3 — Kitchen floor: 9x9 vinyl tiles detected.
            HIGH RISK for asbestos-containing material.
            DO NOT disturb without testing.

  PHOTO 7 — Basement pipes: Wrapped pipe insulation detected.
            HIGH RISK for asbestos-containing material.
            DO NOT disturb without testing.

Each flagged photo shows:
  - Test kit links (purchase an asbestos test kit)
  - Licensed abatement contractors near the job site
  - EPA/OSHA compliance guidance
```

**What it detects:**
- **Asbestos risks:** Popcorn ceilings, 9x9 floor tiles, pipe wrap insulation, vermiculite, transite siding, old mastic/duct tape — any suspect material in pre-1980s construction
- **Lead paint risks:** Painted surfaces in pre-1978 homes, especially windowsills, trim, doors, chipping/peeling paint

**Why it matters:**
- Disturbing asbestos without testing can shut down a job, create massive liability, and endanger workers
- EPA requires testing before disturbing suspect materials during renovation/restoration
- Most contractors know to look for this, but new techs often don't — the AI catches what humans miss

**Revenue opportunity:** Test kit manufacturers and abatement contractors pay for featured placement. This is advertising that contractors actually want — they need test kits and abatement referrals. It's a revenue stream beyond subscriptions.

### Review Questions — Section 6

> **6.1** Rank these features in order of importance for YOUR daily workflow (1 = most important, 8 = least):
> - AI Photo Scope
> - Voice-Guided Scoping
> - Site Log (Moisture + Equipment)
> - Room Sketching
> - Job Management
> - Photo Documentation
> - Report Generation
> - Team Management
>
> **6.2** For AI Photo Scope — how accurate would the line items need to be for you to trust it? 70%? 85%? 95%? What happens if it misses something?
>
> **6.3** For Voice-Guided Scoping — would you actually use voice on a job site? How noisy is a typical job site? Are there situations where voice wouldn't work (homeowner present, loud equipment)?
>
> **6.4** For Room Sketching — how detailed do your sketches need to be? Just room shape and dimensions, or do you need to mark specific damage areas, equipment positions, reading points? Do adjusters actually look at the sketches closely?
>
> **6.5** For Moisture Readings — do you currently use a Bluetooth-connected moisture meter, or do you read the meter and type in the number? Which meters do you use (Protimeter, Delmhorst, Flir, Wagner, Tramex)?
>
> **6.6** For Reports — what format do adjusters actually want? PDF? Xactimate ESX file? Spreadsheet? Or do they just want photos + line items emailed?
>
> **6.7** Is there a feature NOT on this list that you'd need before you'd switch from your current tools?
>
> **6.8** What's your biggest concern about using AI for scoping? Accuracy? Liability? Adjuster pushback? Something else?
>
> **6.9** For the AI Hazardous Material Scanner — how often do you encounter asbestos-suspect materials on jobs? How do you currently handle it? Do you test yourself or call an abatement company?
>
> **6.10** Would auto-flagging asbestos/lead risks in photos be useful, or do experienced techs always catch it themselves? What about newer techs — would this help them?
>
> **6.11** Would you click through to buy a test kit or contact an abatement contractor if the app recommended one? Or would you just use your existing contacts?
>
> **6.12** Are there other hazards the AI should flag? Mold? Sewage/biohazard? Structural damage? Electrical hazards (water near panels)?

---

## Section 7: Our Strategy to Win

### 1. Lead with the "Magic Moment"

The AI Photo Scope demo sells itself. A contractor uploads a photo of water-damaged drywall. Within seconds, Xactimate line items appear. **No other tool does this.** Every demo, every video, every conference booth should start here.

### 2. Complement Xactimate, Never Compete

99% of insurance carriers require Xactimate. We never ask a contractor to stop using Xactimate. Instead:
- RestorOS generates Xactimate-compatible line items
- Export in CSV/ESX format for direct import
- Reduce time from "job site" to "estimate submitted" from days to hours
- **Tagline: "Everything before the estimate, faster."**

### 3. Win on Price for Small Shops

50,000+ restoration businesses with fewer than 20 employees can't afford $500-1,500/month in software. RestorOS at $49-149/month replaces 3-4 tools. The ROI conversation writes itself.

### 4. Voice-First for Field Credibility

Techs work in wet, dirty, hazardous environments. Hands are gloved, clothes are PPE. Typing on a phone is impractical. Voice-guided scoping isn't a nice-to-have — it's the only input method that works in the field.

### 5. Built by a Restorer

The origin story matters in trades. Contractors trust other contractors. The fact that RestorOS was conceived by a working restoration contractor who couldn't find the right tool is powerful.

**"I built this because nothing on the market worked. I still use it every day."**

### Review Questions — Section 7

> **7.1** Does the "magic moment" (photo to line items in seconds) resonate with you? Would that be enough to make you try the product?
>
> **7.2** Is the "complement Xactimate" positioning right? Or would some contractors actually want to REPLACE Xactimate if they could?
>
> **7.3** Does voice-first actually work in the field? Be honest — would you use voice, or would you just type? What about when the homeowner is standing right there?
>
> **7.4** How much does the "built by a restorer" story matter to you? Would you trust a tool more if you knew a contractor built it vs. a software company?
>
> **7.5** What would make you switch from your current tools? What's the minimum this product would need to do before you'd actually use it on a real job?

---

## Section 8: Distribution & Go-To-Market

### Where Contractors Actually Hang Out

| Channel | Why | How we'll reach them |
|---------|-----|---------------------|
| **Restoration Facebook Groups** | Groups like "Water Damage Restoration Pros" and "Restoration Nation" have 10,000-50,000+ members | Post 30-second demo videos of AI Photo Scope |
| **YouTube / TikTok** | Contractors consume how-to content | "Watch AI scope this water loss in 30 seconds" |
| **IICRC / RIA Conferences** | Annual gatherings of restoration pros | Booth + live "bring your own damage photo" demo |
| **Supply distributors** | Aramsco, DKI ProSupply, Jon-Don already sell to every contractor | Bundle subscription with equipment purchases |
| **Training organizations** | IICRC, Reets Drying Academy | Get RestorOS into certification curriculum |
| **Insurance carrier networks** | Carriers want faster documentation | Preferred vendor network partnerships |
| **Referral program** | Contractors talk to each other at water losses | 1 free month for each referral that converts |
| **Franchise networks** | SERVPRO (2,370+), ServiceMaster (800+) | Enterprise deals — one contract, hundreds of locations |

### Review Questions — Section 8

> **8.1** Which Facebook groups are you in? Which ones are the most active?
>
> **8.2** Which YouTube channels or influencers do restoration contractors actually follow?
>
> **8.3** Do you attend IICRC or RIA conferences? Which ones?
>
> **8.4** Where do you buy your equipment (Aramsco, Jon-Don, other)? Would you pay attention to software recommended by your supply distributor?
>
> **8.5** Would a referral program (1 free month per referral) motivate you to tell other contractors?
>
> **8.6** How do you currently find out about new tools? Word of mouth? Facebook? Google search? Conferences? Rep from a vendor?
>
> **8.7** Is there a specific person, company, or community that if they endorsed this product, every contractor would pay attention?

---

## Section 9: Expansion Roadmap

We start with water restoration, then expand:

| Phase | Vertical | Why |
|-------|----------|-----|
| **V1 (Now)** | Water restoration | Most documentation-heavy, highest compliance requirements |
| **V2** | Fire & smoke | Same insurance workflow, same Xactimate dependency |
| **V3** | Mold remediation | Heavily regulated, caused by water damage (natural upsell) |
| **V4** | Contents restoration | High-value — catalog damaged personal property |
| **V5** | Adjacent trades | Plumbing, general contractors (reconstruction after mitigation) |

### Review Questions — Section 9

> **9.1** Does this expansion order make sense? Would you prioritize differently?
>
> **9.2** Do you currently do fire, mold, or contents work? Or water only?
>
> **9.3** Are there other verticals we should consider? Roofing? Storm damage? Biohazard?
>
> **9.4** Do plumbers refer work to you? Would a tool that connected plumbers to restoration contractors be valuable?

---

## Section 10: Risks and Concerns

| Risk | Our Plan |
|------|----------|
| **AI scope accuracy** | All AI suggestions are human-verified. Contractors approve/edit/reject every line item. We never auto-submit to insurance |
| **Encircle adds AI** | Speed to market. Ship first, build data moat, establish brand |
| **Xactimate blocks integration** | Multiple export formats (CSV, ESX, PDF). We make Xactimate more valuable, not less |
| **Contractor tech resistance** | Voice-first eliminates the keyboard. Founder credibility ("I'm a restorer too") |
| **Insurance carrier pushback** | Position as "AI-assisted, human-verified." The contractor is the professional, AI is the tool |
| **Liability for incorrect AI scopes** | Clear terms: AI is a suggestion tool. Contractor is responsible for the final estimate |

### Review Questions — Section 10

> **10.1** What's YOUR biggest concern about this product? What would make you hesitate to use it?
>
> **10.2** Would adjusters push back on AI-generated line items? Have you ever had an adjuster question how you came up with your scope?
>
> **10.3** Are there liability concerns we're not thinking about? If AI suggests the wrong line item and it gets submitted, who's responsible?
>
> **10.4** How tech-savvy are the contractors you know? Would they struggle with a new app, or are they comfortable with phones/tablets?
>
> **10.5** Any final thoughts? What are we missing? What would you change? What gets you excited about this?

---

## Thank You

Your time and expertise are what make this product real. The difference between RestorOS and every other restoration tool is that this one is being built with direct input from people who actually do the work.

Record your answers, send them back, and we'll build this thing right.

*— The RestorOS Team*
