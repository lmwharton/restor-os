# RestorOS — Competitive Analysis & Product Strategy

> **The Operating System for Restoration Contractors**
>
> *A field-first platform that uses AI to turn photos and voice into insurance-ready estimates — replacing 4+ tools with one.*

---

## The Problem

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

**RestorOS eliminates steps 2-4.** Take a photo of the damage → AI generates the Xactimate line items. Speak your scope → AI structures it. That's the product.

---

## Market Opportunity

| Metric | Value |
|--------|-------|
| US restoration businesses | 62,582 (IBISWorld 2025) |
| Market growth rate | 4.3% YoY |
| US restoration services market | $7.2 billion (2025) |
| Water damage market (2026 → 2032) | $5.97B → $8.97B (6.93% CAGR) |
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

---

## Competitor Deep Dive

### Tier 1: Direct Competitors (Same Space)

---

#### Encircle — Field Documentation Leader

**What they do:** The most popular field documentation app for restoration. Photos, floor plans, moisture readings, drying logs, contents inventories.

| | Detail |
|---|---|
| **Founded** | 2013 (Kitchener, ON) |
| **Pricing** | Small: $270/mo, Medium: $455/mo, Large: $650/mo — flat rate, unlimited users |
| **Users** | Thousands of restoration companies globally |
| **Mobile** | Native iOS + Android |
| **AI** | Auto photo labeling, voice-to-text notes — **no AI scoping** |
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

**What they do:** The most comprehensive all-in-one platform. Job management, compliance automation, accounting, CRM. Includes sub-products: Mitigate (moisture logging), LuxorCRM, ProAssist.

| | Detail |
|---|---|
| **Pricing** | Custom/enterprise — reportedly $500+/month |
| **Users** | Large contractors, franchise networks |
| **Mobile** | DASH mobile + Mitigate mobile apps |
| **AI** | Minimal — automated compliance checklists |
| **Xactimate** | Deep integration (same parent company: Verisk/Cotality) |
| **Strengths** | Most comprehensive feature set, SOC 2 Type II certified, deep Xactimate integration, compliance automation |
| **Weaknesses** | **Built on 20-year-old infrastructure.** Dated UI, poor mobile experience, expensive, overkill for small shops, difficult integrations |

**What this means for RestorOS:**
- DASH is the incumbent to displace at the enterprise level (later)
- Their legacy tech is a liability — modern mobile-first UX is a real differentiator
- Small shops actively avoid DASH due to cost and complexity
- **Threat level: MEDIUM** (slow to innovate, but deep pockets)

---

#### Albiware (Albi) + DryBook 2.0 — Modern Mid-Market

**What they do:** Job management + CRM + DryBook for field documentation (moisture, equipment, photos).

| | Detail |
|---|---|
| **Pricing** | Base: $55/mo, Pro: $85/mo per user |
| **Mobile** | Mobile app (4.2 stars) |
| **AI** | None |
| **Xactimate** | Integration available |
| **Strengths** | Most affordable full-featured platform, DryBook 2.0 is solid for moisture logging, modern-ish UI |
| **Weaknesses** | No AI, less established brand, limited customization |

**What this means for RestorOS:**
- Similar price point — RestorOS needs to clearly differentiate on AI and voice
- DryBook 2.0 sets the baseline for what moisture logging should look like
- **Threat level: MEDIUM**

---

#### PSA (Canam Systems) — Accounting-First

**What they do:** All-in-one with strong accounting built for restoration. Job management, CRM, SMS alerts.

| | Detail |
|---|---|
| **Pricing** | $325/mo for 5 users + $5.25/additional user. **$1,500 mandatory onboarding fee** |
| **Users** | 1,500+ contractors |
| **AI** | None |
| **Strengths** | Best accounting features in the category, good franchise support, integrates with Encircle |
| **Weaknesses** | $1,500 onboarding barrier, per-user pricing, no field moisture logging, no AI |

**What this means for RestorOS:**
- PSA proves contractors will pay $325+/mo for the right all-in-one tool
- The $1,500 setup fee is universally hated — RestorOS should have zero setup cost
- **Threat level: LOW-MEDIUM**

---

### Tier 2: Adjacent Competitors

---

#### DocuSketch — Hardware-Assisted Scoping

| | Detail |
|---|---|
| **What** | 360-degree scanning, floor plan generation, Xactimate sketches, and "Estimating as a Service" (human-verified estimates) |
| **Pricing** | $40/project + $795 hardware kit |
| **Turnaround** | Floor plans: 5 hours. Estimates: 48 hours (human-verified) |
| **Strengths** | 99% accurate floor plans, 20 seconds per room capture, voice/video comments |
| **Weaknesses** | Requires $795 hardware, per-project pricing adds up, 48-hour estimate turnaround, not a job management tool |

**RestorOS advantage:** No hardware required (phone camera only), **instant** AI-generated line items (not 48-hour turnaround), full job management included.

---

#### magicplan — LiDAR + Emerging AI

| | Detail |
|---|---|
| **What** | LiDAR-based floor plans, moisture readings, drying reports, Xactimate sketch sync |
| **Pricing** | $40/project, custom for high volume |
| **AI** | **Announced "AI Capture Mode"** for 2025-2026: walk through + record + speak = carrier-compliant reports |
| **Strengths** | Fast LiDAR scanning, real-time collaboration (magicplan PRO), broad adoption, upcoming AI features |
| **Weaknesses** | Requires LiDAR-enabled iPhone, per-project pricing, AI Capture not yet shipped, not a full job management platform |

**What this means for RestorOS:**
- magicplan is the closest competitor to our vision — they see the same future (AI + voice)
- Their AI Capture Mode validates our approach, but they haven't shipped it yet
- LiDAR requirement limits their market; RestorOS works on any smartphone
- **Threat level: MEDIUM-HIGH — monitor closely**

---

#### Restorator Pro — AI Claims Advisor

| | Detail |
|---|---|
| **What** | AI assistant trained on 10,000+ pages of restoration playbooks. Answers questions about codes, pricing, compliance |
| **Pricing** | **$29/month** with free tier |
| **AI** | Core feature — users report 15-30% more collected on claims |
| **Weaknesses** | Not a field documentation or job management tool. It's an advisor, not an operational platform |

**What this means for RestorOS:**
- Proves contractors will pay for AI assistance
- RestorOS could incorporate similar claims guidance as a feature
- **Threat level: LOW** (complementary, not competitive)

---

#### Clean Claims — IoT Remote Monitoring

| | Detail |
|---|---|
| **What** | Moisture mapping + remote monitoring with Wi-Fi sensors — live 24/7 data without site visits |
| **Pricing** | Not published |
| **Strengths** | Remote monitoring eliminates unnecessary site visits, real-time job progress |
| **Weaknesses** | Requires physical hardware, smaller brand, no AI |

**What this means for RestorOS:**
- Remote monitoring is a V3+ feature for RestorOS (partner with IoT hardware, don't build it)
- **Threat level: LOW**

---

#### Other Players

| Tool | What | Price | RestorOS Advantage |
|------|------|-------|--------------------|
| **Xcelerate** | Job management + workflow automation | $55-85/user/mo | No field tools, no moisture logging, no AI |
| **JobNimbus** | CRM/PM (roofing-first) | Custom | Not built for restoration |
| **CompanyCam** | Photo documentation only | $19-27/user/mo | Photos only, no scoping, no readings |
| **Job-Dox** | Project management | $350-650/mo | General PM, no restoration-specific features |
| **Matterport** | 3D virtual tours | Enterprise | Overkill for most jobs |
| **KnowHow** | Training/SOPs | Varies | Complementary (onboarding), not competitive |

---

## The Feature Matrix

How RestorOS stacks up against every competitor across the features that matter:

| Feature | RestorOS | Encircle | DASH | Albi | DocuSketch | magicplan | PSA | Xcelerate |
|---------|:--------:|:--------:|:----:|:----:|:----------:|:---------:|:---:|:---------:|
| **AI Photo → Xactimate Line Items** | **YES** | -- | -- | -- | -- | -- | -- | -- |
| **Voice-Guided Scoping** | **YES** | Partial | -- | -- | Voice comments | Announced | -- | -- |
| **AI Claims Assistance** | Planned | -- | -- | -- | -- | -- | -- | -- |
| **Moisture Logging (Atmospheric)** | **YES** | YES | YES | YES | -- | YES | -- | -- |
| **Moisture Point Tracking** | **YES** | YES | YES | YES | -- | YES | -- | -- |
| **Dehumidifier Output Logging** | **YES** | YES | YES | YES | -- | Partial | -- | -- |
| **Equipment Tracking** | **YES** | YES | YES | YES | -- | -- | -- | -- |
| **Floor Plan / Room Sketching** | **YES** | YES | YES | Partial | YES (360 cam) | YES (LiDAR) | -- | -- |
| **Xactimate-Ready Output** | **YES** | YES | YES | YES | YES | YES | YES | YES |
| **Photo Documentation** | **YES** | YES | YES | YES | YES | YES | Partial | Partial |
| **Job Management** | **YES** | -- | YES | YES | -- | -- | YES | YES |
| **CRM / Lead Management** | V2 | -- | YES | YES | -- | -- | YES | Partial |
| **Team Management** | **YES** | Unlimited | YES | YES | -- | YES | Per-user | YES |
| **Adjuster/Customer Portal** | V2 | Reports | YES | Partial | Sharing | Collab | -- | -- |
| **Accounting** | V2+ | -- | YES | YES | -- | -- | **YES** | Partial |
| **Remote Monitoring (IoT)** | V3+ | -- | -- | -- | -- | -- | -- | -- |
| **S500/IICRC Compliance** | **YES** | YES | YES | Partial | -- | -- | -- | -- |
| **Mobile App** | PWA | Native | Native | Native | Native | Native | Native | Native |
| **Offline Capable** | **YES** | YES | Partial | Partial | -- | Partial | -- | -- |
| **Works on Any Phone** | **YES** | YES | YES | YES | YES | LiDAR only | YES | YES |
| **No Hardware Required** | **YES** | YES | YES | YES | $795 kit | LiDAR phone | YES | YES |

**Legend:** YES = Available, -- = Not available, Partial = Limited functionality

### What Only RestorOS Does

The highlighted row at the top of the matrix is the key: **AI Photo → Xactimate Line Items.** No other tool in the market takes a damage photo and produces Xactimate-ready scope entries. Every other tool requires manual line-item entry.

This single capability collapses a 2-4 hour workflow into minutes.

---

## Pricing Comparison

### What Contractors Pay Today (Typical Small Shop, 3-5 Techs)

| Tool | Monthly Cost |
|------|-------------|
| Xactimate | $100-149/user (required, can't avoid) |
| Encircle (documentation) | $270-455 |
| Job management (Albi or PSA) | $165-325 |
| CompanyCam (photos) | $57-135 (3-5 users) |
| magicplan (floor plans) | $40/project × ~10 jobs = $400 |
| **Total** | **$592 - $1,464/month** |

### What RestorOS Charges

| Tier | Monthly | What's Included | Target |
|------|---------|----------------|--------|
| **Solo** | **$49** | 2 users, core features, 50 AI scopes/month | 1-2 person shops |
| **Team** | **$149** | Unlimited users, full AI scoping (200/mo), moisture logging, reports | 3-10 person shops |
| **Pro** | **$299** | Everything + adjuster portal, advanced analytics, priority support, 1,000 AI scopes/mo | 10-25 person shops |
| **Enterprise** | Custom | Multi-location, API access, custom integrations, unlimited AI, dedicated support | Franchise operations |

**Note:** Contractors still need Xactimate ($100-149/mo) — RestorOS complements it, doesn't replace it. But RestorOS replaces Encircle + job management + CompanyCam + magicplan.

### Savings Calculator

| Scenario | Before RestorOS | With RestorOS | Monthly Savings |
|----------|----------------|---------------|----------------|
| Solo contractor | $492-714/mo | $149 (Team) | **$343-565/mo** |
| 5-person shop | $692-1,164/mo | $149 (Team) | **$543-1,015/mo** |
| 15-person company | $1,100-2,000+/mo | $299 (Pro) | **$801-1,701/mo** |

---

## Our Strategy to Win

### 1. Lead with the "Magic Moment"

The AI Photo Scope demo sells itself. A contractor uploads a photo of water-damaged drywall. Within seconds, line items appear:

```
WTR DRYOUT  — Structural Drying        — 1 EA  — $480
DRYWLL RR   — Remove & Replace Drywall  — 120 SF — $324
BSBD RR     — Remove & Replace Baseboard — 32 LF  — $86
PLR/STN     — Paint Walls               — 120 SF — $144
```

**No other tool does this.** Every demo should start here.

### 2. Complement Xactimate, Never Compete

99% of insurance carriers require Xactimate. We will never ask a contractor to stop using Xactimate. Instead:

- RestorOS generates Xactimate-compatible line items
- Export in CSV/ESX format for direct import
- Reduce the time from "job site" to "estimate submitted" from days to hours
- **Tagline: "Everything before the estimate, faster."**

### 3. Win on Price for Small Shops

50,000+ restoration businesses in the US have fewer than 20 employees. Most are 1-5 person operations. They can't afford $500-1,500/month in software.

RestorOS at **$49-149/month** (replacing 3-4 tools) is an immediate ROI conversation:
- "How many hours do you spend on scoping per week?" → "What if it took 30 minutes instead of 4 hours?"
- "How many tools are you paying for?" → "What if one tool did all of it?"

### 4. Voice-First for Field Credibility

Restoration techs work in wet, dirty, often hazardous environments. Their hands are gloved, their clothes are PPE. Typing on a phone is impractical.

Voice-guided scoping isn't a nice-to-have — it's the only input method that actually works in the field. This is something only a contractor would know, and it's why the product was originally conceived this way.

### 5. Built by a Restorer

The origin story matters in trades. Contractors trust other contractors, not software companies. The fact that RestorOS was conceived by a working restoration contractor who couldn't find the right tool is a powerful narrative.

**"I built this because nothing on the market worked. I still use it every day."**

---

## Distribution Channels

### Tier 1: High-Impact (Start Here)

| Channel | Why | How | Expected Impact |
|---------|-----|-----|----------------|
| **Restoration Facebook Groups** | Where small contractors actually congregate. Groups like "Water Damage Restoration Pros," "Restoration Nation" have 10,000-50,000+ members | Post 30-second demo videos of AI Photo Scope. Show a real damage photo turning into line items in real-time | Viral potential — contractors share tools that save them time |
| **YouTube / TikTok / Shorts** | Restoration contractors consume video content voraciously | "Watch AI scope this water loss in 30 seconds." Partner with restoration YouTubers (Reets Drying Academy, etc.) | Discovery + trust building |
| **IICRC / RIA Conferences** | Annual gatherings of restoration professionals | Booth + live demo. "Bring your own damage photo" hands-on activation. Contractors try it on their real job photos | High-intent leads, face-to-face credibility |

### Tier 2: Relationship-Driven

| Channel | Why | How |
|---------|-----|-----|
| **Insurance carrier partnerships** | Carriers want faster, standardized documentation. RestorOS reduces claim cycle times | Approach preferred vendor networks (State Farm, Allstate, USAA). Offer carrier-specific compliance templates |
| **Restoration supply distributors** | Aramsco, DKI ProSupply, Jon-Don already sell to every contractor | Bundle RestorOS subscription with equipment purchases or distribute through existing sales channels |
| **Training organizations** | IICRC, Restoration Technical Institute, Reets Drying Academy certify new techs | Integrate RestorOS into certification training so new techs learn on the platform from day one |
| **Franchise networks** | SERVPRO (2,370+), ServiceMaster (800+), Paul Davis (300+) | Enterprise deals — one contract, hundreds of locations |

### Tier 3: Inbound / Growth

| Channel | Strategy |
|---------|----------|
| **SEO** | Target "best restoration software," "Xactimate alternatives," "moisture logging app," "restoration scoping tool" |
| **Content marketing** | Comparison pages (RestorOS vs Encircle, RestorOS vs DASH), industry guides, scoping best practices |
| **Referral program** | 1 free month for each referral that converts. Contractors talk to each other at water losses |
| **Free demo job** | Let any contractor run 1 complete job free (not a time-limited trial — a usage-limited proof of value) |

---

## Defensive Moats (How We Stay Ahead)

### 1. Data Moat
Every AI-scoped job teaches the model. First mover with AI photo scoping accumulates training data (damage types, materials, regional pricing patterns) that later entrants can't replicate quickly. By the time a competitor ships AI scoping, we'll have tens of thousands of real-world scoping examples.

### 2. Workflow Lock-In
Once a contractor's daily operations run through RestorOS (create job → scope → readings → equipment → report → submit), switching cost is high. Their data, their team structure, their workflow habits all live in the platform.

### 3. Xactimate Integration Depth
Build the tightest possible Xactimate integration. Become the "recommended scoping tool" in Xactimate's partner ecosystem. This relationship compounds over time and creates a barrier for competitors.

### 4. Community
Build a contractor community around RestorOS — shared templates, scoping tips, best practices, pricing insights. Encircle does this effectively. Community creates retention that no feature can match.

### 5. Expansion Surface
Start with water → add fire, mold, storm → add plumbing, electrical. Each vertical expansion multiplies the addressable market while leveraging the same core platform. First mover in AI-assisted restoration scoping becomes first mover in AI-assisted contractor scoping broadly.

---

## Expansion Roadmap

| Phase | Vertical | Why | AI Expansion |
|-------|----------|-----|-------------|
| **V1** | Water restoration | Most documentation-heavy, most compliance-driven, largest segment | Photo → water damage line items |
| **V2** | Fire & smoke restoration | Same insurance workflow, same Xactimate dependency, natural extension | Photo → char/smoke/soot damage items |
| **V3** | Mold remediation | Heavily regulated, extensive documentation required, caused by water damage | Photo → mold assessment items |
| **V4** | Contents restoration | High-value segment, cataloging damaged personal property | Photo → contents inventory + replacement costs |
| **V5** | Adjacent trades | Plumbing (referral source), general contractors (reconstruction) | Platform becomes "ContractorOS" |

---

## Risk Assessment

| Risk | Severity | Our Plan |
|------|----------|----------|
| **AI scope accuracy** | Critical | AI suggestions are always "human-verified" — contractors approve/edit/reject every line item. We don't auto-submit to insurance. Build accuracy over time with feedback loop |
| **Encircle adds AI** | High | Speed to market. We ship AI scoping first, build data moat, establish brand. By the time they add it, we're the "AI scoping company" |
| **Xactimate blocks integration** | Medium | Maintain multiple export formats (CSV, ESX, PDF). Build relationship with Xactware team. We make their product more valuable, not less |
| **Contractor tech resistance** | Medium | "If it takes more than 3 taps, they won't use it." Voice-first design eliminates the keyboard. Founder credibility ("I'm a restorer too") overcomes skepticism |
| **Insurance carrier pushback on AI** | Medium | Position as "AI-assisted, human-verified." Every estimate is reviewed by a human before submission. AI is the tool, the contractor is the professional |
| **New well-funded entrant** | Medium | First-mover data advantage + community + Xactimate integration depth create moats. We don't need to be the biggest — we need to be the fastest and most accurate |

---

## Summary: Why RestorOS Wins

| Dimension | RestorOS | Best Alternative |
|-----------|----------|-----------------|
| **AI Photo Scoping** | YES (first to market) | Nobody |
| **Voice-Guided Scoping** | YES | magicplan (announced, not shipped) |
| **All-in-One Platform** | Scoping + docs + readings + equipment + jobs + reports | DASH (but 20yr old, expensive) |
| **Price (small shop)** | $49-149/mo | Albi $55/user + Encircle $270 = $325+ |
| **Mobile-First** | Built for phones in the field | Most are desktop-adapted-to-mobile |
| **Time to Scope** | Minutes (AI-assisted) | Hours (manual) |
| **Setup Cost** | $0 | PSA charges $1,500 |
| **Built by a Contractor** | YES | No competitor was founded by a working restorer |

**The bottom line:** RestorOS is the only tool that makes a restoration contractor's most painful daily task — scoping — dramatically faster through AI. Everything else in the market is a documentation tool. We're a productivity multiplier.

---

*RestorOS — Run your restoration business, not paperwork.*
