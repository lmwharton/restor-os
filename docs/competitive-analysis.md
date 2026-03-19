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

## Follow-Up Questions for Brett

These are gaps identified after reviewing the initial 30 answers. Brett — voice-record these when you get a chance.

### Product & Prototype

> **F1.** You mentioned building an adjuster report that auto-generates and auto-sends daily, plus S500/OSHA justifications on line items. Can you walk us through exactly how those work in the prototype? Screen-share or screenshots would be ideal.
>
> **F2.** Can you share a sample Xactimate scope for a typical water job? (Doesn't need to be real customer data — just the format, line item codes, categories, how it's structured.) We need this to validate that our AI output matches what adjusters actually expect.
>
> **F3.** When you scope a job manually today, what's your process? Do you walk room by room? Do you have a mental checklist of line items? How do you make sure you don't miss anything?

### Competition & Market

> **F4.** Which specific Facebook groups are you in? (You mentioned you'd send the names — we need these for go-to-market.)
>
> **F5.** How does Shane Ozier reach contractors? Podcast? YouTube? Facebook posts? What's his handle/channel?
>
> **F6.** Are there any restoration conferences or trade shows coming up in the next 6 months that we should be at?
>
> **F7.** Do you know any contractors using Albi/DryBook or PSA? What do they say about it?

### Workflows & Daily Operations

> **F8.** When you create a scope, do you work room by room or do you walk the whole house first and then sit down to write it up?
>
> **F9.** How do you handle supplementing (adding line items after the initial scope)? Is it a formal process or just emails back and forth with the adjuster?
>
> **F10.** How do you currently share documentation with adjusters? Email attachments? A portal? Fax? (Seriously, some still fax.)
>
> **F11.** When a tech takes moisture readings on a return visit, how do they compare to yesterday's readings? Do they look at a printout, scroll their phone, or just remember?
>
> **F12.** What does your contract / work authorization look like? Is e-signature something you'd want in the app, or is paper fine?

### Business & Growth

> **F13.** How do you currently get new jobs? Referrals? Insurance program work? Google? What percentage comes from each?
>
> **F14.** If you could send a professional-looking daily update to the adjuster automatically (with photos, readings, equipment status), would that change how fast you get paid? Would adjusters actually look at it?
>
> **F15.** What's the split between insurance jobs vs. cash/out-of-pocket jobs? Does the workflow differ?

---

## Appendix A: Contractor Interview — Brett Sodders (Co-Founder)

**Date:** March 2026
**Role:** Water Restoration Contractor, Co-Founder of RestorOS
**Company:** DryPros (Michigan)
**Experience:** Multi-year water restoration business owner, 3-5 employees, residential and commercial

---

### Q1. Walk us through a typical day — from getting the call to finishing up. What do you do first on site? Where does documentation happen? How much of your day is job site vs. paperwork?

> On site, I try to identify the cause, all the damage that was caused, the quantity of rooms, the quantity of square footage, the amount of floor protection needed, the amount of equipment, the amount of tools needed, how many employees are gonna need to be there — basically just do a full analysis on the situation. Then I usually speak with the homeowner about the contract, having them sign a work authorization to start work. Once I get the work authorization signed, I'm contacting employees, letting them know the situation, getting them scheduled to get out there as soon as possible, and making sure they have the tools and equipment they need to get the job done.
>
> **30% of my day is documentation, 70% is actually working.** I actually do too much work in the field now. I'd like to get that down. It would help me. I don't want to continue to be a grunt worker.

---

### Q2. What's the most annoying part of your day — the thing you dread doing?

> Dealing with phone calls is a huge one. Another big one is dealing with humans — if it's not customers, it's employees. It's not that I don't like people, but it's a challenge. Other nuances — the unpredictability of it, because water restoration can happen at any time. You might get a call at 4 PM and have to drive an hour away and it's really frustrating.

---

### Q3. If you could fix ONE problem in your business with a magic wand, what would it be?

> **Scheduling.** Just being able to know that we have consistent work and it's scheduled appropriately. We have the right equipment, the right tools, with the right people, and it's expected. There's a lot of unexpectedness right now. Every day I'm sending a text late at night telling everyone whether they're gonna be in, what time they're gonna be there. There's too much unpredictability.

---

### Q4. What causes payment delays on your jobs? Is it usually missing documentation, scope disputes with the adjuster, the homeowner, or something else? How long does it typically take to get paid?

> This is actually a huge one. It's not necessarily missing documentation — it's just a lot of follow-up. Being persistent. Insurance companies are notorious. They say the same with insurance companies: **delay, deny, and defend** — that's what they do. They delay the claim, deny the claim, and then defend the claim. So it's always a big hassle. Sometimes it's the homeowner, sometimes the adjuster, but everything about it is a hassle. It just takes forever.
>
> **Insurance jobs are very lucrative — the margins are huge — but you might do a job in January and not get paid till April.** That's the reality.

---

### Q5. Do adjusters ever push back on your scope? What's the most common reason? Does really clean, thorough documentation actually help you get paid faster?

> Of course there's pushback on your scope. The most common reason is if you're anywhere near excessive on anything and they don't have full justification for it, they will reject it. This is a really common issue that causes the delays.
>
> **Really clean, thorough documentation helps you get paid faster — absolutely.** If everything is laid out perfectly on a platter where everything is justified, there's pictures, documentation, etc. — yes, you'll definitely get paid faster.

---

### Q6. How tech-savvy are your techs? Would they pick up a new app quickly, or would it be a fight? What phone do most of them use?

> I think they're relatively tech-savvy. The issue is when I tell my guys to go on Google Drive to upload their photos, then I need them to go to Notes to check on the job, then I need them to go check their emails — all these different things, that's what causes issues.
>
> **But if this is THE app — the only app — and this is what I expect them to do, there should be no problem.** I know I'm not alone in this. Any contractor that is able to just use one app for like 90% of the things they need to do in a day are gonna be thrilled.
>
> Currently down to three employees now (had five at one point). **We all have iPhones.** Some people occasionally get an Android but it's mostly iPhones.

---

### Q7. Do you have any creative workarounds or hacks you've invented because no tool does what you need?

> I'm a very heavy user of the iCloud Photos feature where you can look up photos based on where they were taken on a map. When customers ask me questions like "can I do this or that?" I can literally remember jobs where I've done something similar. I'll think "oh, that was at 12 Mile and Van Dyke" — then I go to the map, scroll in, zoom in on the address, click on it, and I'll have all the photos for the entire job. I can show them exactly what we did.

---

### Q8. Is this tool list accurate? Which of these do you actually use? Are there tools we're missing?

> This is very accurate. It's like the bane of my existence — the fact that we had to use so many tools. **I've been so annoyed at the different quantity of tools and not being overly satisfied with one over the other that I've almost naturally diverted to doing everything on paper.** I literally go there and have them sign a paper copy of a contract. I literally draw a sketch on a piece of paper and take a picture of it. I write down line items that I can think of and that's how I literally make my quotes — which is honestly probably pretty insane.

---

### Q9. Is the problem we're describing THE main problem? Or is there a bigger problem we should be solving?

> The biggest issue for the guys in the field is the use of too many tools, 100%. A lot of times there's not one guy dedicated to documentation — sometimes there is, but he's also helping put up a containment barrier and lay down floor protection. So he's not fully focused on documentation, and when he is, you're not getting that much out of him.
>
> Some guys are really good at the job but they'd be better off doing more manual work. Having them stand there taking photos and doing documentation during the whole job is kind of insane — **unless they're really really good at finding line items that are not obvious, to help pay for their labor to stand there and do documentation.**
>
> **Getting paid faster is a huge issue.** If you could do a job and send a report and have a check within a week or two, that would be absolutely amazing.

---

### Q10. Which of these competitors have you actually used? What did you like and hate about them?

> I've used CompanyCam and Encircle. Both are actually really good. Very pushy on sales, which I really don't like — it makes me feel like they don't let the product speak for itself.
>
> **CompanyCam** was cool. It's basically just a camera — you snap photos at a job site and it auto-logged it at the location you're at. You could see it on a map, kind of like what I was talking about earlier. Very smooth, very catchy, easy to collaborate with team members.
>
> **Encircle** — I haven't used it since 2021 so it's hard to say what it looks like now. Back then it was pretty state-of-the-art compared to everything else, but if I went back and looked at it now I'd probably be like "holy shit, this thing sucks" to be honest with you.

---

### Q11. Are there tools we're missing — anything your contractor friends use that's not on this list?

> Some guys have used **magicplan**. I actually tried it before and it was actually pretty cool. I don't think the room sketching was quite as advanced as it is now — they use LiDAR technology. It kind of sticks as you rotate the camera to the corner of the room and it's pretty accurate as far as measurements go. I could see that being a really cool sketch tool because they could do things pretty quickly.
>
> Another thing that could be really sweet is like a **Matterport** — a lot of people use Matterport where they set the camera in each room. It's a lot of setup, like an hour or two for a house, but the Matterport sketches turn into 3D and it's pretty freaking sweet. I don't know if you're gonna need to do that on every water restoration job but it is a cool feature. I don't know that these guys are gonna want to carry around a Matterport with them for sure.

---

### Q12. Is there anything a competitor does REALLY well that we absolutely must match or beat?

> I think we have enough right now to definitely differentiate ourselves. I mean, this is what I've put together so far and **we have more features than any other app that I know of.** Having said that, that LiDAR technology I was referencing would be pretty freaking cool. How to sell it, don't know if it's worth the effort to do all that.

---

### Q13. Look at this feature list — which features are absolute MUST-HAVES on day one? Which could wait?

> You absolutely need the initial job documentation. Equipment and moisture tracking would absolutely be required. Sketching is pretty important actually because you could run into issues with the adjuster based on square footage and the amount of equipment used. **Photo documentation is probably the biggest one just to get paid.** Outside of that, I don't think you have to do the hazard scanner right away even though it would be nice. I don't think you have to do the voice notes, but it would be nice.

---

### Q14. How important is floor plan / room sketching? Is it required by adjusters? Can you submit a scope without one?

> It's pretty important but at a minimum they would need to know the dimensions or at least square footage of what you're doing. **You could definitely submit a scope without one — it just might not get paid very quickly.**

---

### Q15. How important is offline capability? How often are you in spots with no cell signal?

> I really don't think this is all that important. There are situations where you have no cell signal and it's gonna be a real drag, but that's when you get a pen and paper. Most people in the metro Detroit area have cell reception. We're not going to the middle of freaking nowhere. **I don't think this is a must-have right off the bat.**

---

### Q16. How often do you encounter asbestos-suspect materials on jobs? How do you handle it today?

> I don't really run into too much, but you can run into it a lot when some of these older homes get water into their basements. A lot of homes in the Midwest have asbestos flooring in the basement. Occasionally you run into vermiculite insulation, but the primary one is definitely the flooring. It's pretty easy to remove most of the time. **It's pretty lucrative** so some of these restoration contractors are going to do this in-house but not all — and that's definitely an opportunity for us as far as reaching out to asbestos contractors that do removal.

---

### Q17. Rank these features by importance for YOUR daily work.

> In order from most important to least important:
>
> 1. **AI Photo Scope**
> 2. **Site Log** (moisture + equipment)
> 3. **Reports**
> 4. **Room Sketching**
> 5. **Voice Scoping**
> 6. **Photo Documentation**
> 7. **Team Management**
> 8. **Hazmat Scanner**

---

### Q18. For AI Photo Scope — how accurate would line items need to be for you to trust it?

> I think 80% is a reasonable number. Having said that, **it would be great if it could find line items that you don't typically think of** — like if it was able to get in the weeds a little bit.

---

### Q19. Would you actually use voice on a job site? How noisy is a typical job site?

> This is actually a great question and I've wondered this myself. I want this feature to be awesome and I think it could be, but **it needs to be really accurate or else I could see it not being utilized.** Job sites can get noisy. Homeowners can get annoying and you might not be able to find that separation to speak clearly and verify it's going the way you think it is — and it might be faster to type.
>
> I do think voice is faster, but depending on how quickly we can move from field to field, this is a tough one. **I do think that having the feature if it costs nothing or very minimal is worth it, but I could see it being underutilized if it's not good.**

---

### Q20. For room sketching — how detailed do adjusters need the sketches?

> The more detailed the better, but I don't think this is gonna make or break whether you get paid or not. It's nice when you can say "there's two air movers over here, a dehu over there, doorway here, window there." I think it does help, but it's not mandatory. **We just need a sketch of the room size — how long the walls are, ceiling height, etc.**

---

### Q21. Which moisture meters do you use? Do you have a Bluetooth-connected meter?

> I use the **Delmhorst QuickNav** currently. I do not have a Bluetooth-connected meter and **I don't think anybody really uses the Bluetooth** to be honest with you, at least from my experience.

---

### Q22. What format do adjusters actually want for reports?

> I've always sent PDFs. Occasionally they'll ask for the ESX file but mostly PDFs. **It feels weird to send somebody an ESX file because it's such a monopoly and it feels dirty** — once they get the ESX file they can kind of manipulate it. It's like handing off a Word document where they can rewrite it. It's just weird.

---

### Q23. Would you pay $149/mo for a tool that replaced Encircle + CompanyCam + magicplan + your job management tool?

> **I would absolutely pay $149 a month for this. I would pay more than that.** I'm a pretty small shop. Some of these big shops will absolutely pay more than that. As far as needing convincing — I don't. As long as the presentation is good and they are willing to listen, I think it's a no-brainer for them.

---

### Q24. What's the maximum you'd pay per month for a tool that cut your scoping time by 75%?

> I mean, any smart owner — time is money, right? So if I'm spending three hours less a day because I'm paying for an app that costs me $150 a month, just do the math on that. **If you value your hours at $50/hour and you're spending three less hours a day — it's paid for by itself.**

---

### Q25. Does the "magic moment" (photo to line items in seconds) resonate?

> Yeah, **this is an absolute game changer.** The fact that you can take a photo and ask AI to create an estimate is amazing in itself, but the way that you can craft it into your workflow on a daily basis — I'm not opening up my phone and asking Claude or GPT to write me an estimate. I'm literally doing all my job documentation, taking all my photos, and then I'm like "oh yeah, by the way, if you could just write a scope for me that would be great" — and then it's just there. That's amazing.
>
> **Yes, that would absolutely make me try the product. Just the time savings alone.**

---

### Q26. What would actually make you switch from your current tools?

> Change is hard, that's definitely gonna be a real challenge. But if we have tools that nobody else has, they might feel like they're gonna be missing out. That's the whole point — **we need to make them feel like they're missing out and their competitors are gonna get this.** We're obviously gonna market to their competitors, so they better get it or they're gonna be left behind. That's just my opinion.

---

### Q27. Where do YOU hang out online for work stuff?

> I use YouTube occasionally but I'm in Facebook groups. There's restoration groups out there — I can find them and send them. There's a lot of water restoration damage groups. There's also roofing contractor groups where contractors help each other identify issues with insurance scopes, adjuster disputes, shingle identification, etc. Same thing for water damage — people talk about what they do, how they use equipment, how they dry wood floors or crawlspaces. I go to a lot of those forums.

---

### Q28. Is there a specific person, company, or community that if they endorsed this product, every contractor would pay attention?

> Yeah, there's a few. There's this company called **Reets Drying Academy** — really big in the United States. They run a lot of training programs. There's also a guy by the name of **Shane Ozier** — he's a big marketing guy, big plumbing marketing guy, but he's all over those forums. **When he's in those forums, everyone's listening.** I think he's probably a big player.

---

### Q29. What's YOUR biggest concern about this product?

> My biggest concern is probably **speed to market.** I'm worried about AI and beating it before it beats us. Other than that, I'm pretty confident. We've already built what we've already built — obviously it needs to be properly structured, but the capabilities are there and that's what's really impressive about it. So I'm not too concerned.

---

### Q30. Final thoughts — what are we missing? What would you change? What gets you excited?

> I've got some new features I've been tinkering with and I'm pretty excited about. I got an **adjuster report that auto-generates and auto-sends to the adjuster on a daily basis** — but it's limited access so they're not getting all of the picture, but they're getting some of the picture. Same thing with the customer.
>
> I also added some **justifications to the estimate** — so when any line item needs to be justified with either a backing by the S500 or OSHA or something like that, I've already input that. I was gonna show you guys that tomorrow, but my brain's working right now. I'm sure I'll find more stuff to add and we'll see where it goes.

---

### Summary: Key Findings from Brett's Interview

| Finding | Impact on Product |
|---------|------------------|
| **Scheduling is the #1 pain, not scoping** | Elevate job scheduling/dispatch in V1 priority |
| **30/70 documentation/field split** | Tool should reduce that 30% significantly |
| **Late-night texting for next-day assignments** | Push notifications + scheduling board needed |
| **Payment delays (Jan job → April payment)** | Claims follow-up tracking feature worth exploring |
| **Delay/deny/defend insurance pattern** | Documentation must be "prosecution-grade" — every line item justified |
| **Clean docs = faster payment (confirmed)** | Core value prop validated |
| **Wants to stop being a "grunt worker"** | Tool should enable delegation — techs document, owner reviews |
| **Tool fragmentation → regressed to paper** | "One app" value prop is even stronger than expected |
| **Techs bounce between Drive/Notes/Email** | Consolidation is the killer feature |
| **iCloud photo map lookup as reference library** | Build searchable job photo archive by location/type |
| **iPhone-dominant workforce** | iOS-first PWA optimization |
| **Documentation is a tax on productive labor** | AI docs in seconds = tech can work AND document |
| **Skilled documenters find "non-obvious line items"** | AI Photo Scope selling point: "finds line items your tech would miss" |
| **$149/mo is a no-brainer, would pay more** | Pricing validated, possibly underpriced |
| **3 hrs saved/day at $50/hr = immediate ROI** | Use this math on the landing page |
| **FOMO/competitive pressure drives adoption** | Market to clusters in same area |
| **Voice needs to be really accurate or won't be used** | Don't lead with voice — make it excellent or defer |
| **PDF preferred over ESX (adjusters can manipulate ESX)** | Default export = PDF, ESX optional |
| **Offline is not a must-have** | Deprioritize offline for V1 |
| **No one uses Bluetooth moisture meters** | Skip Bluetooth meter integration |
| **Auto-sending limited adjuster reports** | New feature idea from Brett — auto daily updates to adjuster |
| **S500/OSHA justifications per line item** | New feature idea — auto-attach compliance citations to scope items |
| **Speed to market is the biggest risk** | Ship fast, iterate |
| **CompanyCam's auto-location logging was the best feature** | Auto geo-tagging is table stakes |
| **LiDAR sketching would be a differentiator** | Explore LiDAR integration for room measurements |

### Brett's Feature Priority (Ranked)

| Rank | Feature | Status |
|------|---------|--------|
| 1 | AI Photo Scope | V1 Core |
| 2 | Site Log (moisture + equipment) | V1 Core |
| 3 | Reports | V1 Core |
| 4 | Room Sketching | V1 Core |
| 5 | Voice Scoping | V1 Nice-to-have |
| 6 | Photo Documentation | V1 Core (table stakes) |
| 7 | Team Management | V1 Basic |
| 8 | Hazmat Scanner | V1 Nice-to-have |
| -- | Job Scheduling/Dispatch | V1 Core (from Q3 — his #1 pain) |
| -- | Auto Adjuster Reports | New feature from Brett |
| -- | S500/OSHA Line Item Justifications | New feature from Brett |

---

*— The RestorOS Team*
