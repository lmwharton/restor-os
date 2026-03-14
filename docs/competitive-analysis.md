# RestorOS — Competitive Analysis & Product Strategy

> **The Operating System for Restoration Contractors**
>
> *A field-first platform that uses AI to turn photos and voice into insurance-ready estimates — replacing 4+ tools with one.*

---

> **How to review this document:**
> Read each section, then answer the review questions at the end. You can voice-record your answers — just mention the question number before each answer (like "Question 3..."). Should take about 20-30 minutes total. Be honest and specific. If something is wrong, say so. If something is missing, tell us what. Your field experience is what makes this product real.
>
> **There are 30 questions total across the whole document.**

---

## Section 1: Your World

Before we get into the product, we need to understand your daily reality.

### Review Questions

> **Q1.** Walk us through a typical day — from getting the call to finishing up. What do you do first on site? Where does documentation happen? How much of your day is job site vs. paperwork?
>
> **Q2.** What's the most annoying part of your day — the thing you dread doing?
>
> **Q3.** If you could fix ONE problem in your business with a magic wand, what would it be?
>
> **Q4.** What causes payment delays on your jobs? Is it usually missing documentation, scope disputes with the adjuster, the homeowner, or something else? How long does it typically take to get paid?
>
> **Q5.** Do adjusters ever push back on your scope? What's the most common reason? Does really clean, thorough documentation actually help you get paid faster?
>
> **Q6.** How tech-savvy are your techs? Would they pick up a new app quickly, or would it be a fight? What phone do most of them use?
>
> **Q7.** Do you have any creative workarounds or hacks you've invented because no tool does what you need? *(These are gold — please share them.)*

---

## Section 2: The Problem We're Solving

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

### Review Questions

> **Q8.** Is this tool list accurate? Which of these do you actually use? Are there tools we're missing?
>
> **Q9.** Is the problem we're describing (too many tools, too much manual scoping) THE main problem? Or is there a bigger problem we should be solving — getting paid faster, winning more jobs, dealing with adjusters, compliance, hiring? What actually keeps you up at night?

---

## Section 3: Market Opportunity

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

---

## Section 4: Competitor Deep Dive

### Tier 1: Direct Competitors

---

#### Encircle — Field Documentation Leader

The most popular field documentation app for restoration. Photos, floor plans, moisture readings, drying logs, contents inventories.

| | Detail |
|---|---|
| **Pricing** | Small: $270/mo, Medium: $455/mo, Large: $650/mo — flat rate, unlimited users |
| **Mobile** | Native iOS + Android |
| **AI** | Auto photo labeling, voice-to-text notes — no AI scoping |
| **Xactimate** | Floor plan import into Xactimate sketches |
| **Strengths** | Brand recognition, comprehensive documentation, unlimited users, Xactimate sketch integration |
| **Weaknesses** | No AI-generated line items, no voice-guided scoping, $270/mo minimum is steep for small shops, documentation only (not job management) |

**What this means for RestorOS:**
- Encircle is the benchmark for field documentation quality
- Their $270/mo floor creates a pricing opportunity — RestorOS at $149/mo with MORE features
- They could add AI, so speed-to-market matters
- **Threat level: HIGH**

---

#### DASH (by CoreLogic/Cotality) — Enterprise Legacy

The most comprehensive all-in-one platform. Job management, compliance automation, accounting, CRM. Built 20+ years ago.

| | Detail |
|---|---|
| **Pricing** | Custom/enterprise — reportedly $500+/month |
| **Mobile** | DASH mobile + Mitigate mobile apps |
| **AI** | Minimal — automated compliance checklists |
| **Xactimate** | Deep integration (same parent company: Verisk/Cotality) |
| **Strengths** | Most comprehensive features, SOC 2 certified, compliance automation |
| **Weaknesses** | 20-year-old infrastructure, dated UI, expensive, overkill for small shops |

**What this means for RestorOS:**
- DASH is the incumbent to displace at the enterprise level (later)
- Their legacy tech is a liability — modern mobile-first UX is a real differentiator
- Small shops actively avoid DASH due to cost and complexity
- **Threat level: MEDIUM** (slow to innovate, but deep pockets)

---

#### Albiware (Albi) + DryBook 2.0 — Modern Mid-Market

Job management + CRM + DryBook for field documentation (moisture, equipment, photos).

| | Detail |
|---|---|
| **Pricing** | Base: $55/mo, Pro: $85/mo per user |
| **AI** | None |
| **Strengths** | Most affordable full-featured platform, DryBook 2.0 solid for moisture logging |
| **Weaknesses** | No AI, less established brand, limited customization |

**Threat level: MEDIUM**

---

#### PSA (Canam Systems) — Accounting-First

| | Detail |
|---|---|
| **Pricing** | $325/mo for 5 users + $5.25/additional. $1,500 mandatory onboarding fee |
| **Strengths** | Best accounting features, good franchise support |
| **Weaknesses** | $1,500 onboarding barrier, no field moisture logging, no AI |

**Threat level: LOW-MEDIUM**

---

### Tier 2: Adjacent Competitors

---

#### DocuSketch — Hardware-Assisted Scoping

| | Detail |
|---|---|
| **What** | 360-degree scanning, floor plans, "Estimating as a Service" (human-verified estimates in 48 hours) |
| **Pricing** | $40/project + $795 hardware kit |
| **Strengths** | 99% accurate floor plans, 20 seconds per room |
| **Weaknesses** | Requires $795 hardware, 48-hour estimate turnaround, not a job management tool |

**RestorOS advantage:** No hardware, instant AI results (not 48-hour turnaround).

---

#### magicplan — LiDAR + Emerging AI

| | Detail |
|---|---|
| **What** | LiDAR-based floor plans, moisture readings, drying reports |
| **Pricing** | $40/project |
| **AI** | **Announced "AI Capture Mode"** (walk through + voice + auto-reports) — not yet shipped |
| **Strengths** | Fast LiDAR scanning, upcoming AI features |
| **Weaknesses** | Requires LiDAR-enabled iPhone, per-project pricing, AI not shipped yet |

**Threat level: MEDIUM-HIGH — closest to our vision. Monitor closely.**

---

#### Restorator Pro — AI Claims Advisor

| | Detail |
|---|---|
| **What** | AI assistant trained on 10,000+ pages of restoration playbooks |
| **Pricing** | $29/month with free tier |
| **AI** | Core feature — users report 15-30% more collected on claims |
| **Weaknesses** | Not a field documentation or job management tool — advisor only |

---

#### Other Players

| Tool | What | Price | Why not a direct threat |
|------|------|-------|------------------------|
| Clean Claims | IoT remote moisture monitoring | Unknown | Requires hardware sensors |
| Xcelerate | Workflow automation | $55-85/user/mo | No field tools |
| JobNimbus | CRM (roofing-first) | Custom | Not built for restoration |
| CompanyCam | Photo docs only | $19-27/user/mo | Photos only |
| Job-Dox | Project management | $350-650/mo | General PM |

### Review Questions

> **Q10.** Which of these competitors have you actually used? What did you like and hate about them?
>
> **Q11.** Are there tools we're missing — anything your contractor friends use that's not on this list?
>
> **Q12.** Is there anything a competitor does REALLY well that we absolutely must match or beat?

---

## Section 5: The Feature Matrix

| Feature | RestorOS | Encircle | DASH | Albi | DocuSketch | magicplan | PSA |
|---------|:--------:|:--------:|:----:|:----:|:----------:|:---------:|:---:|
| **AI Photo to Xactimate Line Items** | **YES** | -- | -- | -- | -- | -- | -- |
| **AI Hazmat Scanner (Asbestos + Lead)** | **YES** | -- | -- | -- | -- | -- | -- |
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
| **AI Claims Assistance** | Planned | -- | -- | -- | -- | -- | -- |
| **Remote Monitoring (IoT)** | V3+ | -- | -- | -- | -- | -- | -- |

### What Only RestorOS Does

**Three features no competitor has:**

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

3. **Voice-Guided Scoping.** Not just voice-to-text notes — a structured AI-guided workflow that walks the tech through documenting damage room by room, producing Xactimate-ready data from spoken descriptions.

### Review Questions

> **Q13.** Look at this feature list — which features are absolute MUST-HAVES on day one? Which could wait?
>
> **Q14.** How important is floor plan / room sketching? Is it required by adjusters? Can you submit a scope without one?
>
> **Q15.** How important is offline capability? How often are you in spots with no cell signal?
>
> **Q16.** How often do you encounter asbestos-suspect materials on jobs? How do you handle it today — test yourself or call an abatement company? Would auto-flagging in photos be useful, especially for newer techs?

---

## Section 6: What We're Building

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

### Feature 2: Voice-Guided Scoping

Instead of typing, the app walks you through the scope step by step via voice:

```
App: "What room are you in?"
You: "Master bedroom"

App: "Describe the damage you see."
You: "Water damage on the north wall, about 3 feet up.
      Drywall is saturated, baseboard is warped, carpet is wet."

App: "What material is the flooring?"
You: "Carpet over plywood subfloor"

→ AI generates line items from your spoken description
```

Works hands-free with voice commands: say "next" to advance, "done" to finish.

### Feature 3: Site Log (Moisture Readings + Equipment)

Per-room tracking of:
- **Atmospheric readings:** Temperature, Relative Humidity (RH%), Grains Per Pound (GPP)
- **Moisture points:** Numbered measurement points on walls/floors with material type
- **Dehumidifier output:** Temperature and RH of dehu exhaust
- **Equipment placement:** Which dehumidifiers, air movers, air scrubbers are in which room
- **Trend tracking:** See drying progress over multiple daily visits

### Feature 4: Room Sketching

Draw floor plans of affected rooms directly in the app. Mark affected areas, equipment placement, moisture reading points. Export sketches compatible with Xactimate.

### Feature 5: Job Management

Create and track jobs with customer info, insurance info (carrier, claim number, adjuster), loss details (type, category, class), tech assignment, and status tracking.

### Feature 6: Photo Documentation

Capture photos with automatic GPS tagging. Assign to rooms, tag as before/after. Offline capture with auto-upload when back online.

### Feature 7: Report Generation

Generate Xactimate-ready scope notes (CSV/ESX export), moisture log reports with trend charts, job summaries with photos — all exportable as PDF.

### Feature 8: Team Management

Invite techs by email, assign to jobs, role-based access (Owner sees everything, Tech sees assigned jobs).

### Feature 9: AI Hazardous Material Scanner

Every photo automatically scanned for asbestos-risk materials and lead paint. Flagged photos show test kit links and local abatement contractors. (See Section 5 for full details.)

### Review Questions

> **Q17.** Rank these features by importance for YOUR daily work (1 = need it most):
> AI Photo Scope / Voice Scoping / Site Log / Room Sketching / Job Management / Photo Docs / Reports / Team Management / Hazmat Scanner
>
> **Q18.** For AI Photo Scope — how accurate would line items need to be for you to trust it? If it's right 80% of the time and you fix the other 20%, is that useful or frustrating?
>
> **Q19.** Would you actually use voice on a job site? How noisy is a typical job site? What about when the homeowner is standing right there listening?
>
> **Q20.** For room sketching — how detailed do adjusters need the sketches? Just room shape + dimensions? Or do they want damage areas, equipment positions, and reading points marked?
>
> **Q21.** Which moisture meters do you use? (Protimeter, Delmhorst, Flir, Wagner, Tramex, other?) Do you read the number and type it in, or do you have a Bluetooth-connected meter?
>
> **Q22.** What format do adjusters actually want for reports? PDF? Xactimate ESX file? Or do they just want photos + line items emailed?

---

## Section 7: Pricing

### What Contractors Pay Today (3-5 Tech Shop)

| Tool | Monthly Cost |
|------|-------------|
| Xactimate (required) | $100-149/user |
| Encircle (documentation) | $270-455 |
| Job management (Albi or PSA) | $165-325 |
| CompanyCam (photos) | $57-135 |
| magicplan (floor plans) | ~$400 (per project) |
| **Total** | **$592 - $1,464/month** |

### What RestorOS Will Charge

| Tier | Monthly | What's Included | Target |
|------|---------|----------------|--------|
| **Solo** | **$49** | 2 users, core features, 50 AI scopes/month | 1-2 person shops |
| **Team** | **$149** | Unlimited users, full AI scoping (200/mo), all features | 3-10 person shops |
| **Pro** | **$299** | Everything + adjuster portal, advanced analytics, 1,000 AI scopes/mo | 10-25 person shops |
| **Enterprise** | Custom | Multi-location, API access, unlimited AI | Franchise operations |

RestorOS replaces Encircle + job management + CompanyCam + magicplan. Contractors still need Xactimate (we complement it, not replace it).

### Additional Revenue: Hazmat Scanner Marketplace

| Revenue Source | How it works |
|---------------|-------------|
| **Test kit manufacturers** | Featured placement when asbestos/lead is flagged |
| **Abatement contractors** | "Licensed contractors near you" — lead gen fee per referral |
| **Equipment suppliers** | Recommended PPE, containment supplies when hazards detected |

### Savings Calculator

| Scenario | Before RestorOS | With RestorOS | Monthly Savings |
|----------|----------------|---------------|----------------|
| Solo contractor | $492-714/mo | $149 (Team) | **$343-565/mo** |
| 5-person shop | $692-1,164/mo | $149 (Team) | **$543-1,015/mo** |
| 15-person company | $1,100-2,000+/mo | $299 (Pro) | **$801-1,701/mo** |

### Review Questions

> **Q23.** Would you pay $149/mo for a tool that replaced Encircle + CompanyCam + magicplan + your job management tool? No-brainer or would you need convincing?
>
> **Q24.** What's the maximum you'd pay per month for a tool that cut your scoping time by 75%?

---

## Section 8: Our Strategy to Win

### 1. Lead with the "Magic Moment"

The AI Photo Scope demo sells itself. Upload a photo of water-damaged drywall. Within seconds, Xactimate line items appear. **No other tool does this.** Every demo starts here.

### 2. Complement Xactimate, Never Compete

99% of carriers require Xactimate. We don't replace it — we feed it. RestorOS generates line items, exports in Xactimate-compatible format.

**Tagline: "Everything before the estimate, faster."**

### 3. Win on Price for Small Shops

50,000+ restoration businesses can't afford $500-1,500/month in software. RestorOS at $49-149/month replaces 3-4 tools.

### 4. Voice-First for Field Credibility

Techs work in wet, dirty environments with gloves. Voice-guided scoping is the only input that actually works in the field.

### 5. Built by a Restorer

Contractors trust other contractors. The fact that RestorOS was conceived by a working restoration contractor who couldn't find the right tool is powerful: **"I built this because nothing on the market worked."**

### Review Questions

> **Q25.** Does the "magic moment" (photo to line items in seconds) resonate? Would that alone make you try the product?
>
> **Q26.** What would actually make you switch from your current tools? What's the minimum this product needs before you'd use it on a real job?

---

## Section 9: How We'll Reach Contractors

| Channel | How |
|---------|-----|
| **Restoration Facebook Groups** | Demo videos in groups like "Water Damage Restoration Pros," "Restoration Nation" |
| **YouTube / TikTok** | "Watch AI scope this water loss in 30 seconds" |
| **IICRC / RIA Conferences** | Booth + live "bring your own damage photo" demo |
| **Supply distributors** | Aramsco, DKI ProSupply, Jon-Don — bundle with equipment |
| **Training organizations** | IICRC, Reets Drying Academy — get into curriculum |
| **Insurance carrier networks** | Preferred vendor partnerships |
| **Referral program** | 1 free month for each referral that converts |
| **Franchise networks** | SERVPRO, ServiceMaster — enterprise deals |

### Review Questions

> **Q27.** Where do YOU hang out online for work stuff? Which Facebook groups, YouTube channels, forums?
>
> **Q28.** Is there a specific person, company, or community that if they endorsed this product, every contractor would pay attention?

---

## Section 10: Expansion Roadmap

| Phase | Vertical | Why |
|-------|----------|-----|
| **V1 (Now)** | Water restoration | Most documentation-heavy, highest compliance |
| **V2** | Fire & smoke | Same insurance workflow, same Xactimate |
| **V3** | Mold remediation | Heavily regulated, caused by water damage |
| **V4** | Contents restoration | High-value — catalog damaged property |
| **V5** | Adjacent trades | Plumbing, general contractors |

---

## Section 11: Risks and Final Thoughts

| Risk | Our Plan |
|------|----------|
| **AI scope accuracy** | All suggestions are human-verified. Contractors approve/edit/reject every item |
| **Encircle adds AI** | Ship first, build data moat, establish brand |
| **Xactimate blocks integration** | Multiple export formats. We make Xactimate more valuable |
| **Contractor tech resistance** | Voice-first eliminates keyboard. Founder credibility |
| **Insurance pushback on AI** | "AI-assisted, human-verified." Contractor is the professional |

### Review Questions

> **Q29.** What's YOUR biggest concern about this product? What would make you hesitate?
>
> **Q30.** Final thoughts — what are we missing? What would you change? What gets you excited? Don't hold back.

---

## Thank You

Your time and expertise are what make this product real. The difference between RestorOS and every other restoration tool is that this one is being built with direct input from people who actually do the work.

Record your answers, send them back, and we'll build this thing right.

*— The RestorOS Team*
