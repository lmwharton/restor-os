# Crewmatic — Product Design

> **The Operating System for Restoration Contractors**
> Master design document. Single source of truth for what we are building, why, and how.

---

## Vision

Crewmatic is a field-first AI platform for water restoration contractors. It replaces 4-6 fragmented tools (Encircle, CompanyCam, magicplan, DASH, etc.) with a single app that turns damage photos into Xactimate-ready estimates, guides techs through scoping via voice, and automates insurance documentation.

**The core value chain:**

> Tool consolidation → less time documenting → AI finds line items humans miss → more money per job + faster payment.

This is not just "fewer apps." The AI capabilities (photo-to-line-items, auto S500/OSHA justifications) do not exist in any tool on the market today. Crewmatic makes contractors more money on every job by catching the $50 line items that techs forget to bill for — and backs every charge with industry standard citations so adjusters cannot deny them.

**Crewmatic complements Xactimate, never competes with it.** 99% of carriers require Xactimate-formatted estimates. We generate the data that feeds into Xactimate. Tagline: *"Everything before the estimate, faster."*

---

## Market Context

Full competitive analysis: [`docs/research/competitive-analysis.md`](research/competitive-analysis.md)

| Metric | Value |
|--------|-------|
| US restoration businesses | 62,582 (IBISWorld 2025) |
| US restoration services market | $7.2B (2025) |
| Market growth | 4.3% YoY |
| Software TAM (US) | $225M - $600M/year |
| Addressable (small/mid shops) | $180M - $360M/year |
| Current contractor tool spend | $700 - $1,900/month across 4-6 tools |
| Crewmatic price (validated) | $149/month — replaces all of them |
| AI adoption in restoration | Near zero |
| Competitors offering photo-to-line-items | **Zero** |

**Key competitors:** Encircle (CRITICAL threat — shipping AI features as of March 2026), DASH/Mitigate (enterprise incumbent), magicplan (announced AI Capture Mode, not shipped), Albi/DryBook (affordable mid-market), JobSight (validates flat-rate model).

**Our moat:** AI-first architecture from day one. Encircle is bolting AI onto a 10+ year product. We are building around AI as the core capability. Ship fast, build data moat.

---

## The User

**Brett Sodders** — co-founder, water restoration contractor. Runs DryPros in Michigan (3-5 employees, residential and commercial). He is building Crewmatic because he lives this pain daily.

**Target user:** Small restoration shop owner (3-15 employees). Uses Xactimate for insurance billing. Frustrated with tool fragmentation. Currently spends 2-4 hours per job on manual scope entry. Has regressed to paper because juggling 4-6 apps is worse.

**The real competitor is not Encircle — it's "paper + iPhone + prayer."** Brett literally draws sketches by hand and photographs them because the tool stack was so bad he gave up on it.

Full co-founder interview (30 questions + 16 workflow validation answers): [`docs/competitive-analysis.md`, Appendix A](competitive-analysis.md#appendix-a-contractor-interview--brett-sodders-co-founder)

---

## Platform Roadmap

Crewmatic starts with water restoration, then expands into adjacent trades that share the same core engine. Each vertical changes the data model, AI prompts, and document outputs — the platform layer (job management, photo AI, voice input, portals) stays the same.

| Phase | Vertical | Status | Key Differentiator |
|-------|----------|--------|-------------------|
| V1 | Water Restoration (Mitigation) | **Building now** | AI Photo Scope + S500/OSHA justifications |
| V1B | Insurance Repair (Reconstruction) | **Next — spec drafted** | Separate job type, linked to mitigation via claim. Flexible phase tracking, reconstruction scope builder, supplements |
| V3 | Remodeling | Future | Voice-to-proposal, change orders, permit tracking, punch lists |
| V4 | Plumbing | Future | Photo diagnostics, repipe triggers, water heater EOL, source-of-loss referrals |
| V5 | Electrical | Future | Panel photo diagnosis, load calc, EV charger workflows, hazard docs |
| V6 | HVAC | Future | Symptom-to-diagnosis, maintenance contracts, equipment EOL alerts |

**Cross-trade referral network:** Every trade becomes a lead source for every other trade on the platform. This is the network effect moat.

Full research: [`docs/research/multi-trade-expansion.md`](research/multi-trade-expansion.md)

### iOS-Forward Design

Brett's directive: *"I want to operate under the impression that this will one day soon be an app on iOS. So let's not make decisions based on the fact we're web-based."*

**Current strategy:** Build web-first, but make design decisions that translate to native iOS. This means:
- Camera integration patterns that map to native camera APIs
- GPS/location patterns that map to Core Location
- Offline-capable data architecture (local-first sync)
- Touch-first UI (no hover-dependent interactions)
- Future: LiDAR/RoomPlan for auto-generated room sketches with dimensions (iOS native only)

---

## V1 Scope — AI Scope + Job Shell

**Source:** [Approved MVP design doc from office hours](https://github.com) | Status: APPROVED

### MVP Thesis

AI Photo Scope wrapped in a minimal job management shell. The job shell creates stickiness and a data moat. Without it, Photo Scope is a feature demo. With it, it is a product contractors build their workflow around.

### What is in V1

1. **AI Photo Scope** — Upload damage photos, AI generates Xactimate line items with S500/OSHA justifications, contractor reviews/edits/approves, export as branded PDF report.
2. **Job Shell** — Create a job (customer, address, insurance, loss details), upload photos, attach scope, view history.
3. **PDF Report** — Company-branded scope report with line items, justifications, and photo grid.
4. **Auth** — Email + password signup. Single user per company (Brett). No social login in V1.

### What is NOT in V1

- Scheduling / dispatch
- Team management / roles
- Moisture readings / drying logs
- Voice scoping
- Hazmat scanner
- Room sketching / floor plans
- Equipment tracking
- Auto adjuster reports
- ESX file export (V2 priority)
- Offline mode
- Real-time collaboration

### The 4 Screens

**Screen 1: Job List (Home)**
- List of jobs with scope status: Needs Scope | Scoped | Submitted
- Each card: address, water category, room count, date, line item count, estimate total
- "+ New Job" primary action

**Screen 2: Job Detail — Photo Upload**
- Job metadata (address, homeowner, category, date)
- Tabs: Photos | Line Items | Report
- Photo upload zone with grid thumbnails
- Photo selection for AI (damage photos only, ~25 of ~60 total)
- "Run AI Photo Scope" button — the core action
- Photo constraints: JPEG/PNG only, max 100 photos/job, max 10MB/photo

**Screen 3: AI Scope Results**
- List of generated Xactimate line items
- Each item: code, description, quantity/unit, S500/OSHA justification
- Non-obvious items highlighted with orange left border and "AI found this — you might have missed it"
- Inline editing (tap to edit any field), add/delete items
- Export PDF button

**Screen 4: PDF Report**
- Company-branded header (logo, name, phone)
- Job address, date, homeowner name
- Table: Xactimate Code | Description | Qty | Unit | S500/OSHA Justification
- Photo thumbnails grid with captions
- Footer: "Generated by Crewmatic" + page numbers

---

## Architecture

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), shadcn/ui, Tailwind CSS 4, TanStack Query, Zustand |
| Backend | Python FastAPI |
| Database | Supabase (PostgreSQL + Auth + Storage) |
| AI - LLM | Anthropic Claude (photo scoping, voice extraction) |
| AI - STT | Deepgram Nova-2 (voice transcription) — V1.1 |
| Frontend Hosting | Vercel |
| Backend Hosting | Railway |
| PDF Generation | WeasyPrint (HTML-to-PDF with CSS styling) on Railway |

### Database Schema

Full architecture reference: [`docs/research/product-specs/restoros-architecture.md`](research/product-specs/restoros-architecture.md)

#### Enums

```sql
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'tech');
CREATE TYPE job_status AS ENUM ('pending', 'in_progress', 'monitoring', 'completed', 'invoiced', 'closed');
-- 7-stage industry pipeline: new, contracted, mitigation, drying, job_complete, submitted, collected
CREATE TYPE loss_type AS ENUM ('water', 'fire', 'mold', 'storm', 'other');
CREATE TYPE water_category AS ENUM ('1', '2', '3');
CREATE TYPE water_class AS ENUM ('1', '2', '3', '4');
CREATE TYPE scope_source AS ENUM ('voice', 'photo', 'manual');
CREATE TYPE ai_processing_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE report_status AS ENUM ('draft', 'generating', 'ready', 'exported');
```

#### V1 Tables

**companies**
```sql
CREATE TABLE companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    phone           TEXT,
    email           TEXT,
    logo_url        TEXT,
    settings        JSONB NOT NULL DEFAULT '{}',
    subscription_tier    TEXT NOT NULL DEFAULT 'free',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**jobs**
```sql
CREATE TABLE jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    job_number      TEXT NOT NULL,  -- format: JOB-YYYYMMDD-XXX
    address_line1   TEXT NOT NULL,
    city            TEXT NOT NULL,
    state           TEXT NOT NULL,
    zip             TEXT NOT NULL,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    claim_number    TEXT,           -- "can't start without it" per Brett
    carrier         TEXT,
    adjuster_name   TEXT,
    adjuster_phone  TEXT,
    adjuster_email  TEXT,
    loss_type       loss_type NOT NULL DEFAULT 'water',
    loss_category   water_category,
    loss_class      water_class,
    loss_cause      TEXT,           -- e.g., "roof leak", "pipe burst", "sewer backup"
    loss_date       DATE,
    status          TEXT NOT NULL DEFAULT 'new',  -- new | contracted | mitigation | drying | job_complete | submitted | collected
    customer_name   TEXT,
    customer_phone  TEXT,
    customer_email  TEXT,
    room_count      INTEGER DEFAULT 0,
    notes           TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(company_id, job_number)
);
```

**photos**
```sql
CREATE TABLE photos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    room_name       TEXT,
    storage_url     TEXT NOT NULL,
    filename        TEXT,
    caption         TEXT,
    photo_type      TEXT DEFAULT 'damage',
    -- damage | equipment | protection | containment | moisture_reading | before | after
    selected_for_ai BOOLEAN DEFAULT false,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**line_items**
```sql
CREATE TABLE line_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    xactimate_code  TEXT,
    description     TEXT NOT NULL,
    quantity        DECIMAL(10,2) NOT NULL DEFAULT 0,
    unit            TEXT NOT NULL,   -- SF, LF, EA, HR, DA, WK, SY
    unit_price      DECIMAL(10,2),
    justification   TEXT,            -- S500/OSHA citation text
    justifications  JSONB DEFAULT '[]',
    -- [{ "standard": "IICRC S500", "section": "10.3.2", "text": "..." }]
    is_non_obvious  BOOLEAN DEFAULT false,
    source          scope_source NOT NULL DEFAULT 'manual',  -- ai | manual
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**event_history** (replaces scope_runs — full audit trail + AI accuracy tracking)
```sql
CREATE TABLE event_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    job_id          UUID REFERENCES jobs(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,    -- enum: job_created, photo_uploaded, ai_photo_analysis, line_item_accepted, etc.
    user_id         UUID,             -- NULL for AI actions
    is_ai           BOOLEAN DEFAULT false,
    event_data      JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- AI accuracy is derived from events: ai_photo_analysis + line_item_accepted/edited/deleted + ai_feedback_thumbs_up/down
```

#### V2+ Tables (defined in architecture doc)

The full architecture defines 18 tables including: `company_members`, `company_invites`, `job_rooms`, `job_schedules`, `moisture_readings`, `equipment_library`, `equipment_placements`, `voice_notes`, `event_history`, `line_items`, `reports`, `adjuster_reports`, `floor_plans`, `audit_log`. See [`docs/research/product-specs/restoros-architecture.md`, Part 3](research/product-specs/restoros-architecture.md) for complete SQL.

### V1 API Endpoints

**Backend: FastAPI on Railway**

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /v1/auth/signup | None | Create user + company |
| POST | /v1/auth/login | None | Login |
| GET | /v1/company | Member | Get company info |
| PATCH | /v1/company | Owner | Update company (logo, name, phone) |
| GET | /v1/jobs | Member | List jobs (filter/search/paginate) |
| POST | /v1/jobs | Member | Create job |
| GET | /v1/jobs/:id | Member | Job detail |
| PATCH | /v1/jobs/:id | Member | Update job |
| POST | /v1/jobs/:id/photos/upload-url | Member | Get presigned upload URL |
| POST | /v1/jobs/:id/photos/confirm | Member | Confirm upload + process |
| GET | /v1/jobs/:id/photos | Member | Photo gallery |
| POST | /v1/jobs/:id/scope | Member | Trigger AI Photo Scope (SSE) |
| GET | /v1/jobs/:id/scope | Member | Get scope results |
| POST | /v1/jobs/:id/scope/items | Member | Add manual line item |
| PATCH | /v1/jobs/:id/scope/items/:iid | Member | Edit line item |
| DELETE | /v1/jobs/:id/scope/items/:iid | Member | Delete line item |
| POST | /v1/jobs/:id/report | Member | Generate PDF report |
| GET | /v1/jobs/:id/report/download | Member | Download PDF |

Full API reference (50+ endpoints for all features): [`docs/research/product-specs/restoros-architecture.md`, Part 5](research/product-specs/restoros-architecture.md)

### AI Pipeline — Photo Scope

This is the core product capability. No competitor has it.

#### Flow

```
1. Contractor uploads photos to Supabase Storage (presigned URL)
2. Selects damage photos (~25 of ~60 total) for AI analysis
3. POST /v1/jobs/:id/scope
4. FastAPI fetches photos from Supabase Storage
5. Preprocesses: resize to max 1920px longest edge (reduces tokens ~4x)
6. Sends to Claude Vision API with structured prompt containing:
   - Xactimate line item code reference database (docs/xactimate-codes-water.md)
   - S500 standard reference sections
   - OSHA regulation references
   - Hard rules (see below)
   - Job context (loss_cause, water category, etc.)
7. Uses Claude tool-use/function-calling for structured JSON output
8. Parses response into line items with justifications
9. Streams results to client via SSE
10. Contractor reviews, edits, approves
11. Approved items saved to line_items table
12. event_history records created for accuracy tracking
```

#### Batch Processing

- Max 10 photos per Claude API call
- Jobs with >10 photos: split into batches, merge results
- Deduplication: same Xactimate code + same description = merge, keep higher quantity
- 60-second timeout per batch. On timeout: return partial results + retry option.

#### Cost

- ~$0.15-0.30 per job analysis (10 photos x Claude vision pricing after resize)
- Monthly limits by tier: Solo: 50, Team: 200, Pro: 1,000
- Track per-job AI cost in event_history (ai_photo_analysis events)

#### Hard Rules

These rules are embedded in every AI Photo Scope prompt. They come directly from Brett's domain expertise and are non-negotiable.

**Language Rules:**
- NEVER use the word "mold" — use "visible staining," "microbial growth," or "suspect organic growth." Mold is a forbidden word in insurance.

**Auto-Add Rules (non-obvious items the AI must catch):**
- If drywall is being cut/removed → auto-add air scrubber + OSHA aerosol filtration citation
- If air scrubber is in scope → auto-add HEPA filter replacement
- If any equipment is used → auto-add equipment decontamination
- If drywall removal → auto-add baseboard removal (techs' #1 missed item)
- If Cat 2+ water or any demolition → auto-add PPE/Tyvek suit
- If containment built → auto-add zipper door
- If any demolition/work → auto-add floor protection
- If any hands-on work → auto-add gloves/PPE
- If photo shows ceiling damage with fixtures (fans, lights) → add "remove & reset [fixture]"
- Every consumable used = a line item (Tyvek, poly sheeting, tape, antimicrobial — techs forget to bill for consumables)

**Physics Rules:**
- Moisture wicking: 2" water line → moisture wicks to 12-15" → flood cut at that height
- The AI must know this relationship and suggest appropriate flood cut heights

**Output Rules:**
- Items in logical workflow order: assess → demo → protect → clean → dry → monitor → decon
- Target 8-25 line items per job (small=10, large=30 per Brett)
- Every line item MUST have a justification from one of the supported standards — no justification = easy denial by adjuster
- **Supported justification standards** (per Brett, March 2026):
  - **IICRC S500** — Standard for Professional Water Damage Restoration (primary for mitigation)
  - **IICRC S520** — Standard for Professional Mold Remediation
  - **OSHA** — Occupational Safety & Health Administration (workplace safety, PPE, aerosol filtration)
  - **EPA** — Environmental Protection Agency (lead paint, asbestos, environmental hazards)
  - **IRC** — International Residential Code (residential building code — critical for build-backs/reconstruction)
  - **IBC** — International Building Code (commercial building code)
  - **NIOSH** — National Institute for Occupational Safety & Health (respiratory protection, exposure limits)
- V1 focuses on S500 + OSHA (mitigation). V2 adds IRC/IBC (reconstruction/build-back), S520 (mold), EPA, NIOSH.
- Flag non-obvious items with `is_non_obvious: true` and highlight them in the UI
- Core instruction: *"Think about everything you do and how you need to get paid for it"*

**Iterative Scoping:**
- Damage discovery is progressive — contractors find more damage over hours/days
- AI scope supports "re-run" on additional photos
- New items merged with existing scope; duplicates deduplicated

#### Structured Output Schema

```json
{
  "line_items": [
    {
      "xactimate_code": "WTRDRYWLF",
      "description": "Drywall removal - 2' flood cut",
      "unit": "LF",
      "quantity": 24,
      "confidence": 0.85,
      "is_non_obvious": false,
      "justifications": [
        {
          "standard": "IICRC S500",
          "section": "12.2.1",
          "text": "Category 2 or 3 water-damaged gypsum board that has been wet for more than 48 hours should be removed."
        }
      ]
    }
  ]
}
```

#### Xactimate Code Reference

Complete water damage code database: [`docs/research/xactimate-codes-water.md`](research/xactimate-codes-water.md)

50+ codes across categories: WTR (water extraction/remediation), CLN (cleaning), HMR (hazmat remediation), PPE, equipment, consumables. Each with selectors, units, and descriptions.

### Auth

**V1:** Supabase Auth with Google OAuth. Single user per company (Brett). Application-level `WHERE company_id = :user_company_id` on all queries. No database-level RLS in V1.

**V2:** Multi-user with roles (`owner` > `admin` > `tech`). Google OAuth. Full PostgreSQL RLS policies. Team invites. See [`docs/research/product-specs/restoros-architecture.md`, Parts 4 and 8](research/product-specs/restoros-architecture.md) for complete RLS implementation.

---

## Job Lifecycle

Brett's full lifecycle (from [W15.1](competitive-analysis.md#appendix-b-workflow-review--validation-questions)):

| Step | What Happens | Status |
|------|-------------|--------|
| 1. **Call** | Customer/TPA calls. Get name, address, carrier, claim number. | `new` |
| 2. **Contract** | Homeowner signs work authorization. | `contracted` |
| 3. **Mitigation** | Day 1 heavy labor: tear-out, containment, equipment setup. 1-2 techs, full day. | `mitigation` |
| 4. **Drying** | Days 2-4: daily moisture readings, equipment checks. 1 tech, 20-min check-in. | `drying` |
| 5. **Job Complete** | Dry standard met. Equipment pulled, site cleaned. | `job_complete` |
| 6. **Submit** | Scope + report sent to adjuster (PDF). Wait. Get rejected. Resubmit. | `submitted` |
| 7. **Collected** | Payment received, job closed. Active chasing — not passive "paid." | `collected` |

**7-stage industry pipeline:** `new` → `contracted` → `mitigation` → `drying` → `job_complete` → `submitted` → `collected`

**Key insight:** Mitigation and Drying are split because they need different resources. Mitigation = 1-2 techs for a full day of labor. Drying = one tech for a 20-minute check-in. This drives scheduling.

**Two payment paths:**
1. **TPA path** (Alacrity, Code Blue, Sedgwick): Scope → third-party reviewer (strict) → adjuster → fast payment. First submission almost always rejected.
2. **Independent path**: Scope → adjuster directly. Less strict but 1-3 months to payment. Adjusters "delay, deny, defend."

---

## Key Domain Rules

These rules are critical context for anyone building features. They come from Brett's domain expertise and are validated by industry standards.

### Insurance Language
- **"Mold" is a forbidden word.** Always use "visible staining," "microbial growth," or "suspect organic growth." Using "mold" in a scope triggers insurance review complications.

### S500/OSHA Justifications
- **Justifications are a revenue tool, not a compliance checkbox.** They win payment disputes with adjusters. Example: adjuster denies air scrubber on Cat 1 loss → OSHA aerosol filtration regulation → adjuster pays.
- Every AI-generated line item MUST have a justification. No justification = easy denial.
- S500 = IICRC Standard for Professional Water Damage Restoration (the industry bible).

### Equipment Billing
- Adjusters care about **count x days**, not serial numbers. 5 air movers for 3 days = billable.
- Photos must corroborate equipment count — adjusters cross-reference photos with scope.
- Standard ratio: ~1 XL dehu per 7-8 air movers per ~1,000 SF (TPAs challenge this).

### Dry Standard
- **Dry = comparison to unaffected area of same material**, not an absolute number.
- If unaffected stud reads 85, target is 85 for all affected studs. Getting to 90 is "close enough" — equipment is pulled.
- Leaving equipment too long angers adjusters (they pay for equipment days).

### Payment Dynamics
- Insurance jobs are lucrative (high margins) but slow (January job → April payment).
- Clean documentation is the only lever to speed payment.
- First TPA submission is almost always rejected. S500/OSHA justifications are even more critical for TPA work.
- Each carrier has specific rules (ACE guidelines). V2: carrier-specific AI rules.

### Photo Documentation
- **"Photos are the biggest one to get paid."** — Brett
- 5 photos per room: floor, each wall, ceiling. Systematic coverage catches non-obvious items (ceiling fan on damaged ceiling = "remove & reset ceiling fan" line item).
- ~60 photos per job: ~25 damage photos (for AI) + ~35 proof-of-work shots (for report).

### Moisture Physics
- Moisture wicking: 2" water line → drywall shows moisture for 12-15". Flood cut at wicking height.
- GPP (Grains Per Pound): calculated from temperature + humidity. Brett uses a separate app for this — auto-calculating GPP is a clear value-add.
- Dehu reading = outlet air (post-processing), atmospheric = ambient air. Delta shows how hard the dehu is working.

### TPA Guidelines
- TPAs (Alacrity, Code Blue, Sedgwick) enforce carrier-specific rules that are stricter than S500.
- Guidelines are proprietary (embedded in SLAs). Brett can provide his copies.
- Common rejection triggers: oversized equipment, drying days not supported by moisture logs, line items without photo documentation, missing room-by-room breakdown.
- Full TPA research: [`docs/research/tpa-carrier-guidelines.md`](research/tpa-carrier-guidelines.md)

---

## Feature Roadmap

### V1: AI Photo Scope + Job Shell

The narrowest wedge. Ships first. Validates the core thesis.

| Feature | Description |
|---------|-------------|
| AI Photo Scope | Photos → Xactimate line items with S500/OSHA justifications |
| Job CRUD | Create/read/update jobs with customer, insurance, loss details |
| Photo Upload | Upload, grid view, select for AI analysis |
| Line Item Review | Review, edit, approve/reject AI-generated items |
| PDF Report | Company-branded scope report with photos |
| Auth | Email/password, single user |

### V2: Field Operations

| Feature | Description |
|---------|-------------|
| Moisture Tracking | Atmospheric, point, dehu readings. Trend charts. Auto-GPP. |
| Equipment Tracking | Place/remove by room, count x days billing |
| Voice Scoping | AI-guided step-by-step, structured output |
| Scheduling/Dispatch | Calendar board, "My Schedule," push notifications |
| Team Management | Invite techs, roles, job assignment |
| ESX Export | Xactimate native format for direct import |
| Auto Adjuster Reports | Daily auto-send with limited access token |
| Digital Contracts | E-signature for work authorization |
| Room Sketching | Basic dimensions, equipment placement |
| Document Vault | W-9, insurance certs, licenses — "on deck" for new carriers. Per Brett: "Anything to get paid faster." |
| Expanded Justifications | Add IRC, IBC, S520, EPA, NIOSH standards — critical for build-back/reconstruction scoping |

### V2.5: Supplement Engine (Brett's idea, March 2026)

| Feature | Description |
|---------|-------------|
| Supplement Trigger | AI monitors new photos/readings against original scope, detects billable deviations automatically |
| Supplement Draft | Auto-generates supplement request with new line items, Xactimate codes, S500 justifications, and photo evidence |
| Scope Diff View | Side-by-side: original approved scope vs. proposed supplement, with delta highlighted |

*"Monitors job documentation in real-time and auto-drafts a supplement request the moment it detects a billable deviation from the original scope."* — Brett

V1 foundation: iterative scoping (re-run AI on new photos) + event_history tracking (ai_photo_analysis events per job) = supplement detection primitive.

### V3: Intelligence Layer

| Feature | Description |
|---------|-------------|
| Carrier-Specific AI Rules | Per-TPA rule sets in AI pipeline |
| Rejection Predictor | AI flags line items likely to be denied based on carrier history |
| AI Completeness Check | Reviews scope for missing items before submission |
| Hazmat Scanner | Auto-flag asbestos/lead in photos |
| Video Scoping | Walkthrough video → frame extraction → comprehensive line items |
| Crowdsourced Pricing | RS Means + BLS + user data → contractor-owned pricing engine |
| Scope Intelligence Network | Aggregate anonymized scope data across all contractors. Co-occurrence matrix: "92% of contractors add antimicrobial for Cat 2 losses." Surfaces suggestions during Scope Auditor: "Based on 450 similar jobs, contractors who added deodorization got paid 89% of the time." Privacy: 20+ job minimum, percentages only, opt-out available. **This is the network effect moat — every contractor makes every other contractor's scope better.** |
| Scope Intelligence Onboarding | Upload 10 past scope PDFs → AI extracts line items, pricing patterns, identifies where contractor left money on the table → trains Scope Auditor for future jobs |

---

## Success Criteria

1. **Brett uses it on a real job** — not a demo, a real insurance claim — within 2 weeks of launch.
2. **AI generates line items at 80%+ accuracy** on Brett's first 5 jobs. Accuracy = (AI items Brett kept unchanged) / (total items in final submitted scope).
3. **AI finds at least 1 non-obvious line item per job** that Brett would not have caught manually.
4. **Time-to-scope drops below 30 minutes** (from current 2-4 hours of manual Xactimate entry).
5. **Brett submits an AI-generated scope to an adjuster** and it gets approved without excessive pushback.
6. **5 non-Brett contractors** express interest in using the product after seeing Brett's results.

---

## Open Questions

1. **AI accuracy measurement protocol:** How do we measure the 80% accuracy target? Per-line-item accuracy? Per-job completeness? Need a test protocol using Brett's historical jobs.
2. **Photo quality handling:** What happens when photos are blurry, dark, or poorly framed? How does the AI communicate "I need a better photo of this area"?
3. **Pricing model:** $149/mo validated by Brett — but is this per-company or per-user? Per-user at 3-5 users changes the math.
4. **TPA vs independent tracking:** Should the app track which payment path a job is on? Different expectations for each. Carrier-specific AI rules are a V2 feature.
5. **Carrier-specific guidelines:** Brett can provide Alacrity, Code Blue, Sedgwick docs. Getting these into the AI pipeline would improve first-submission approval rates. Research on public availability: [`docs/research/tpa-carrier-guidelines.md`](research/tpa-carrier-guidelines.md)
6. **HEIC photo support:** V1 requires JPEG/PNG (Brett sets iPhone to "Most Compatible"). HEIC conversion needed for V2 to support default iPhone settings.

---

## Dependencies

| Dependency | Status | Blocking? |
|-----------|--------|-----------|
| Supabase project setup | Not provisioned | Yes — V1 |
| Claude API access | Available | Yes — V1 |
| Xactimate code reference data | **RESOLVED** — [`docs/research/xactimate-codes-water.md`](research/xactimate-codes-water.md) | No |
| Sample scope format | **RESOLVED** — standard format documented | No |
| Brett's real job photos | Nice-to-have for validation | No — use public photos for initial testing |
| Carrier guideline docs from Brett | Not yet received | No — V2 feature |
| TPA rules research | **RESOLVED** — [`docs/research/tpa-carrier-guidelines.md`](research/tpa-carrier-guidelines.md) | No |

### The Assignment (Pre-Build Validation)

Before writing production code: get Brett to send photos from his last 3 completed jobs with the final Xactimate scope for each. Run those photos through Claude manually (just the API, not the app). Compare AI output to Brett's actual scope. If accuracy is below 70%, iterate on the AI pipeline before building UI. This is a 2-hour exercise that could save weeks.

---

## References

| Document | Contents |
|----------|----------|
| [`docs/research/competitive-analysis.md`](research/competitive-analysis.md) | Full competitive analysis, feature matrix, pricing, go-to-market, Brett's 30-question interview, 16 workflow validation answers |
| [`docs/research/product-specs/README.md`](research/product-specs/README.md) | Product overview, tech stack, V1 scope, timeline |
| [`docs/research/product-specs/restoros-architecture.md`](research/product-specs/restoros-architecture.md) | 18 database tables (full SQL), 50+ API endpoints, AI pipeline architecture, RLS policies, frontend component tree, testing strategy |
| [`docs/research/product-specs/restoros-consumer-workflows-v1.md`](research/product-specs/restoros-consumer-workflows-v1.md) | 15 end-to-end user workflows with triggers, steps, data schemas, edge cases |
| [`docs/research/xactimate-codes-water.md`](research/xactimate-codes-water.md) | 50+ Xactimate water damage codes with selectors, units, descriptions |
| [`docs/research/tpa-carrier-guidelines.md`](research/tpa-carrier-guidelines.md) | TPA rules, common rejection triggers, documentation requirements |
| [`CLAUDE.md`](../CLAUDE.md) | Repository structure, dev commands, domain terminology |
