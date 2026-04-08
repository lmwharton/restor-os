# Xactimate + Crewmatic Code Database — Dual Code System, Dependencies & Settings UI

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/5 phases) |
| **State** | ❌ Not Started |
| **Blocker** | Waiting on: Brett's Xactimate Excel export + Crewmatic code design (promised 2026-04-08) |
| **Branch** | TBD |
| **Issue** | TBD |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-08 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] `scope_codes` table exists — unified table supporting both Xactimate and Crewmatic code systems
- [ ] `scope_code_dependencies` table with strength levels + citations
- [ ] Seed migration populates Xactimate codes: Tier A (~150) + Tier B (~350)
- [ ] Seed migration populates Crewmatic codes (pending Brett's design — Phase 5)
- [ ] Dependency chains seeded: ~50+ relationships with reason + citation + strength
- [ ] Non-obvious codes flagged (the "money items" techs always miss)
- [ ] Settings UI: filterable code table grouped by trade category + subcategory
- [ ] Settings UI: CRUD for codes (admin), toggle between Xactimate / Crewmatic views
- [ ] Settings UI: dependency view — see linked codes
- [ ] `GET /v1/scope-codes` — queryable API (filter by system, category, trade, search)
- [ ] `GET /v1/scope-codes/{code}/related` — dependency chain
- [ ] Frontend autocomplete uses code API (for line item editing in 02A)
- [ ] All backend endpoints have pytest coverage
- [ ] Code review approved

## Resolved Questions (from Brett call 2026-04-08)

Questions answered in Brett call (`docs/research/brett-codes-pricing-call-2026-04-08.md`):

### ✅ Q1: Pricing — NOT V1
Brett confirmed: V1 = codes + descriptions + quantities only. No pricing.
- Insurance work: contractor manually enters line items into Xactimate (which applies regional pricing)
- Non-insurance work: contractor uses Crewmatic's estimate output (Claude-generated pricing for now)
- Brett: "at a minimum we can just create the exactimate codes and not even put the pricing"
- **Company pricing table (`company_code_prices`) deferred to V2 — when we build our own estimate/invoice**

### ✅ Q2: Two code systems, not one
Brett wants a toggle:
- **Xactimate mode** — for insurance/restoration work (~90% of contractors)
- **Crewmatic mode** — for non-insurance/remodeling work, and for the ~10% who refuse Xactimate
- Brett: "do we have a toggle where you can click on exactimate categories or crewmatic pricing?"
- Brett designing Crewmatic codes with Claude tonight (2026-04-08)

### ✅ Q3: Xactimate pricing is legally off-limits
- Codes are public knowledge — safe to use
- Pricing is Verisk's proprietary data — cannot copy or redistribute
- Brett understands: "Claude's telling me we can copy all of the codes, but we can't copy their pricing"

### ✅ Q4: RSMeans not useful for restoration
- Brett confirms: no restoration-specific items (dehu, air movers, equipment)
- Only construction/renovation — maybe V2+ partnership for GC work

### ✅ Q5: Brett's Claude estimate is real
- Brett is already using Claude to generate remodeling estimates with made-up codes + AI pricing
- Works for non-insurance. See screenshot of Dry Pros kitchen remodel estimate.
- Brett: "this whole pricing is working for me, like the Claude created"

## Pending from Brett
- [ ] **Xactimate code Excel export** — Brett will export from his Xactimate and send (promised 2026-04-08)
- [ ] **Crewmatic code system design** — Brett working with Claude tonight to design readable codes
- [ ] **Both deliverables become seed data sources for this spec**

## Overview

**Problem:** Xactimate has 27,000+ line item codes. Contractors memorize ~50-100, use printed cheat sheets, and still miss billable items. The dependency chains ("drywall removal requires baseboard removal, antimicrobial, air scrubber...") are tribal knowledge — not documented in Xactimate itself. Actionable Insights charges $162/mo/seat just for code guidance. No tool does photo-to-code with dependency logic.

**Solution:** A dual code system with shared dependency logic:
1. **Xactimate codes** (~500 codes, Tier A + B) — for insurance/restoration work. The industry standard.
2. **Crewmatic codes** (TBD count, designed by Brett) — for non-insurance/remodeling work. More readable, richer encoding.
3. **Dependency chains** — "if you use X, also consider Y" with reasons + citations — the tribal knowledge encoded as data. Works across both code systems.
4. **Toggle in product** — contractor chooses Xactimate or Crewmatic mode when scoping.

This database serves: PhotoScope AI prompt (Claude picks from the menu), auto-add rules engine (dependency chains), frontend autocomplete (line item editing), settings UI (admin management), and eventually the estimate/invoice builder.

**Scope:**
- IN: Unified `scope_codes` table supporting both systems, Xactimate codes (Tier A: 150, Tier B: 350), Crewmatic codes (pending Brett's design), dependency chains, non-obvious flags, S500/OSHA citations, settings CRUD UI, queryable API, frontend autocomplete, code system toggle
- OUT: Pricing (V2), ESX file export (Verisk encrypts ESX — dead end per Brett), Xactware API integration (no public API), regional Xactimate price display (legally can't show Verisk's prices), RSMeans integration (V2+)
- DEFERRED: Company pricing (`company_code_prices` table) to V2 when we build our own estimate/invoice. Crewmatic code seeding to Phase 5 (waiting on Brett's design).

## Background: How Xactimate Codes Actually Work

### The 4 Dimensions of a Code

Every Xactimate line item has four identifiers:

```
Category + Selector + Activity + Unit
  WTR       DRYWLF      &        LF
```

| Dimension | What it is | Example |
|-----------|-----------|---------|
| **Category** | 2-4 letter trade prefix | `WTR` (Water), `DRY` (Drywall), `PNT` (Painting) |
| **Selector** | Operation suffix within category | `DRYWLF` = drywall removal, 2' flood cut |
| **Activity** | Action type (hidden dimension) | `&` = Remove & Replace, `-` = Remove only |
| **Unit** | Measurement type | `SF`, `LF`, `EA`, `HR`, `DA`, `WK`, `SY` |

### Activity Types (same code, different billable actions)

| Symbol | Name | Includes |
|--------|------|----------|
| `+` | Replace | Material + labor + equipment |
| `-` | Remove | Labor + equipment only |
| `R` | Detach & Reset | Uninstall + reinstall same item |
| `&` | Remove & Replace | Remove old + install new |
| `M` | Material Only | No labor |
| `I` | Install Only | No material |

### Selector Suffix Modifiers

| Suffix | Meaning | Example |
|--------|---------|---------|
| `A` | After hours | `WTRDRYWLA` |
| `S` | Category 3 (black water) | `WTRDRYWLS` |
| `G` | Category 2 (gray water) | `WTREXTG` |
| `H` | Hard surface | `WTREXTH` |
| `>`, `>>`, `>>>` | Size progression | `WTRDHM>` (large dehu) |
| `+` | Variant | `WTRDRY+` (axial air mover) |

### The 16 Trade Sections (~500 codes total)

Brett estimates ~500 codes cover full mitigation + reconstruction:

**Mitigation core (Tier A):**
| Category | Prefix | Codes (est.) |
|----------|--------|-------------|
| Water Extraction & Remediation | WTR | ~50 |
| Hazardous Material Remediation | HMR | ~10 |
| HEPA Vacuuming | HEPA | ~5 |
| Cleaning | CLN | ~10 |
| Contents Manipulation | CON | ~5 |
| Demolition | DMO | ~10 |
| Temporary Services | TMP | ~5 |
| Fees & Overhead | FEE/OHP | ~5 |

**Reconstruction (Tier A + B):**
| Category | Prefix | Codes (est.) |
|----------|--------|-------------|
| Drywall | DRY | ~20 |
| Framing | FRM | ~10 |
| Insulation | INS | ~10 |
| Painting | PNT | ~15 |
| Flooring (hardwood, vinyl, tile, carpet) | FLR/FC* | ~40 |
| Cabinetry | CAB | ~20 |
| Countertops | CNT | ~10 |
| Plumbing | PLM | ~15 |
| Electrical | ELC | ~15 |
| Doors & Windows | DOR/WIN | ~20 |
| Finish Carpentry/Trim | FNH | ~15 |
| HVAC | HVAC | ~10 |
| Masonry | MAS | ~5 |
| Roofing | RFG | ~10 |
| General Labor | LAB | ~10 |
| Appliances | APP | ~10 |

**Tier A** (~150): Core codes that cover 80% of typical water/fire jobs. Every contractor gets these.
**Tier B** (~350): Extended codes for kitchens, bathrooms, HVAC, specialty. Contractors activate based on work they do.

### Dependency Chains (Tribal Knowledge — Our Moat)

Xactimate has NO built-in dependency logic. This is contractor expertise:

```
WTRDRYWLF (drywall removal, 2' flood cut)
  ├── ALWAYS ──► WTRBASE (baseboard removal — can't flood-cut without it)
  ├── ALWAYS ──► WTRGRM (antimicrobial — S500 requires treating exposed surfaces)
  ├── ALWAYS ──► WTRINS (insulation removal — wet insulation in exposed cavity)
  ├── ALWAYS ──► WTRDRY + WTRDHM (air movers + dehu — drying the cavity)
  ├── ALWAYS ──► WTRPPE (PPE — required for demolition)
  ├── USUALLY ──► WTRNAFAN (air scrubber — containment during demo)
  └── OFTEN MISSED ──► HEPA filter, floor protection, equipment decon
```

Actionable Insights charges $162/mo for this knowledge. We encode it as data.

### Competitive Context

| Competitor | What they do | Price | Gap |
|-----------|-------------|-------|-----|
| **Actionable Insights** | Real-time plugin inside Xactimate, catches omissions. 3,700+ Insight Sheet templates. | $162/mo/seat | Reactive — only works inside Xactimate |
| **Verisk XactAI** | AI code suggestion + Estimate Builder (NLP → estimate). Line Item Advisor. | $29/mo add-on | Carrier-centric (reduces payouts), text-based not photo-based |
| **LEVLR** | Upload your estimate + adjuster's → line-by-line diff, flags removed/changed items. | $399/mo | Post-estimate comparison, not during scoping |
| **DocuSketch/AiME** | Estimate Grader (upload → completeness score), speech-to-scope via 360AI. | Free grader | No photo-to-code, no dependency logic |
| **Encircle Scope** | AI scoping from photos + notes + moisture readings. | Subscription | No actual Xactimate code output |
| **magicplan** | Floor plans → ESX export, has 27K+ code database in-app. | Subscription | No dependency logic, no AI code suggestion |
| **Crewmatic** | Photo → Xactimate codes with dependency chains + citations. | — | **Nobody does this** |

### ESX Integration — Dead End (Per Brett)

Verisk encrypts ESX files at near-maximum entropy (7.998/8.0). No reverse-engineering possible. The only path is a Verisk Strategic Alliance Partnership — V2+ when Crewmatic has traction and leverage. Excel import to Xactimate only works for XactContents (personal property), NOT structure/mitigation line items.

**V1 strategy:** Crewmatic is the field documentation layer alongside Xactimate. Tech scopes in Crewmatic → structured scope + photos + citations → estimator refines in Xactimate. Long-term: build own estimate/invoice that carriers accept (documentation-first approach).

### Pricing Strategy (Pending Brett Input)

**What we CAN'T do:** Display Xactimate's prices (Verisk EULA, copyright).
**What we CAN do:**
- Use Xactimate code nomenclature (publicly known, not copyrightable like pricing)
- Let contractors set their own pricing per code
- Over time, show "Crewmatic network average" from aggregated contractor data (our moat)
- Reference BLS labor benchmarks, IICRC standards for justification

**RSMeans is NOT suitable** — it covers general construction (85K+ items) but not restoration-specific line items (drying, dehu, antimicrobial, etc.).

**Onboarding concept (from Brett):** Hand contractor a spreadsheet with codes + blank "Your Unit Price" column. They fill in their prices. Upload to Crewmatic. Auto-populates every future estimate.

## Database Schema

### `scope_codes` table (unified — both Xactimate and Crewmatic codes)

```sql
CREATE TABLE scope_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_system     TEXT NOT NULL,              -- 'xactimate' or 'crewmatic'
    code            TEXT NOT NULL,              -- e.g. 'WTRDRYWLF' (xactimate) or 'DEMO-FLR-TILE' (crewmatic)
    category_prefix TEXT NOT NULL,              -- e.g. 'WTR' (xactimate) or 'DEMO' (crewmatic)
    description     TEXT NOT NULL,              -- e.g. 'Drywall removal - 2'' flood cut'
    unit            TEXT NOT NULL,              -- SF, LF, EA, HR, DA, WK, SY
    trade_category  TEXT NOT NULL,              -- mitigation, drywall, painting, demolition, etc.
    subcategory     TEXT NOT NULL,              -- e.g. 'Drywall Removal', 'Water Extraction'
    tier            TEXT NOT NULL DEFAULT 'A',  -- 'A' (core) or 'B' (extended)
    activity_type   TEXT,                       -- '+', '-', 'R', '&', 'M', 'I' (xactimate); NULL for crewmatic
    suffix_modifier TEXT,                       -- 'A' (after hours), 'S' (Cat 3), etc. (xactimate only)
    citation        TEXT,                       -- e.g. 'IICRC S500 Sec 12.3'
    notes           TEXT,                       -- tips, e.g. 'Always pair with baseboard removal'
    is_non_obvious  BOOLEAN NOT NULL DEFAULT false,  -- "money items" techs miss
    is_active       BOOLEAN NOT NULL DEFAULT true,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE UNIQUE INDEX idx_scope_codes_system_code ON scope_codes(code_system, code) WHERE activity_type IS NULL;
CREATE UNIQUE INDEX idx_scope_codes_system_code_activity ON scope_codes(code_system, code, activity_type) WHERE activity_type IS NOT NULL;
CREATE INDEX idx_scope_codes_system ON scope_codes(code_system);
CREATE INDEX idx_scope_codes_category ON scope_codes(category_prefix);
CREATE INDEX idx_scope_codes_trade ON scope_codes(trade_category);
CREATE INDEX idx_scope_codes_tier ON scope_codes(tier);
CREATE INDEX idx_scope_codes_search ON scope_codes USING gin(to_tsvector('english', description || ' ' || code));
```

### `scope_code_dependencies` table

```sql
CREATE TABLE scope_code_dependencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_system     TEXT NOT NULL,              -- 'xactimate' or 'crewmatic' (deps can be system-specific)
    source_code     TEXT NOT NULL,              -- e.g. 'WTRDRYWLF' (the trigger code)
    target_code     TEXT NOT NULL,              -- e.g. 'WTRBASE' (the code to suggest)
    strength        TEXT NOT NULL DEFAULT 'recommended',  -- 'required', 'recommended', 'optional'
    reason          TEXT NOT NULL,              -- e.g. 'Baseboard must be removed before flood cut'
    citation        TEXT,                       -- e.g. 'IICRC S500 Sec 12.3'
    is_non_obvious  BOOLEAN NOT NULL DEFAULT false,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE(code_system, source_code, target_code)
);

CREATE INDEX idx_code_deps_source ON scope_code_dependencies(code_system, source_code);
```

### `company_code_prices` — DEFERRED TO V2

Per Brett call (2026-04-08): V1 has no pricing. Contractors enter line items into Xactimate for insurance work. For non-insurance, pricing is TBD (Brett using Claude-generated pricing currently). Company pricing table will be built when we create our own estimate/invoice feature.

```sql
-- V2: company_code_prices (per-company pricing)
-- CREATE TABLE company_code_prices (
--     id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
--     scope_code_id     UUID NOT NULL REFERENCES scope_codes(id) ON DELETE CASCADE,
--     unit_price        DECIMAL(10,2),
--     is_enabled        BOOLEAN NOT NULL DEFAULT true,
--     notes             TEXT,
--     created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
--     updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
--     UNIQUE(company_id, scope_code_id)
-- );
```

## Phases & Checklist

### Phase 1: Database + Seed Migration — ❌

**Alembic migration (schema):**
- [ ] Create `scope_codes` table with code_system + tier fields
- [ ] Create `scope_code_dependencies` table
- [ ] Full-text search GIN index on description + code
- [ ] Verify migration runs clean: `alembic upgrade head`

**Seed data (Alembic data migration — separate from schema):**
- [ ] Tier A: ~150 codes across mitigation + core reconstruction trades
- [ ] Tier B: ~350 codes for extended reconstruction (cabinets, countertops, HVAC, etc.)
- [ ] Source: `docs/research/xactimate-codes-water.md` + Brett's spreadsheet (if available) + research
- [ ] Each code gets: trade_category, subcategory, unit, tier, citation (where applicable), is_non_obvious
- [ ] Dependency seeds: ~50+ relationships (drywall→baseboard, extraction→drying, demo→PPE, etc.)
- [ ] Seed data reviewable in PR diff

**Example seed rows:**
```python
# Tier A — Mitigation
{"code_system": "xactimate", "code": "WTREXT", "category_prefix": "WTR",
 "description": "Water extraction - carpet wand on carpet",
 "unit": "Per app", "trade_category": "mitigation", "subcategory": "Water Extraction",
 "tier": "A", "is_non_obvious": False, "sort_order": 1},

{"code_system": "xactimate", "code": "WTRDRYWLF", "category_prefix": "WTR",
 "description": "Drywall removal - 2' flood cut",
 "unit": "LF", "trade_category": "mitigation", "subcategory": "Drywall Removal",
 "tier": "A", "citation": "IICRC S500 Sec 12.3", "is_non_obvious": False, "sort_order": 10},

# Tier B — Reconstruction
{"code_system": "xactimate", "code": "CABLOW", "category_prefix": "CAB",
 "description": "Cabinet removal/disposal - lower",
 "unit": "LF", "trade_category": "cabinetry", "subcategory": "Cabinet Removal",
 "tier": "B", "is_non_obvious": False, "sort_order": 200},

# Dependencies
{"code_system": "xactimate", "source_code": "WTRDRYWLF", "target_code": "WTRBASE",
 "strength": "required", "reason": "Baseboard must be removed before drywall flood cut",
 "citation": "IICRC S500 Sec 12.3", "is_non_obvious": True},

{"code_system": "xactimate", "source_code": "WTRDRYWLF", "target_code": "WTRGRM",
 "strength": "required", "reason": "Antimicrobial required on exposed surfaces after demolition",
 "citation": "IICRC S500 Sec 10.3.2", "is_non_obvious": False},

{"code_system": "xactimate", "source_code": "WTRNAFAN", "target_code": "HEPA FLTR",
 "strength": "recommended", "reason": "HEPA filter replacement for air scrubber",
 "citation": "OSHA 29 CFR 1926.1101", "is_non_obvious": True},
```

**Tests:**
- [ ] pytest: migration creates both tables with correct columns and indexes
- [ ] pytest: seed data populates expected row counts (Tier A ~150, Tier B ~350)
- [ ] pytest: unique constraint prevents duplicate codes
- [ ] pytest: full-text search returns relevant results for "drywall", "extraction", etc.
- [ ] pytest: tier filter returns correct subsets

### Phase 2: API Endpoints — ❌

**Pydantic schemas (`api/scope_codes/schemas.py`):**
- [ ] `ScopeCode` — full code model (all fields)
- [ ] `ScopeCodeSummary` — lightweight for autocomplete (code, description, unit, trade_category)
- [ ] `ScopeCodeCreate` — admin create
- [ ] `ScopeCodeUpdate` — admin edit (all fields optional)
- [ ] `CodeDependency` — dependency with reason + citation + strength
- [ ] `CodeWithDependencies` — code + its full dependency chain

**Service layer (`api/scope_codes/service.py`):**
- [ ] `list_codes(filters)` — filter by category_prefix, trade_category, tier, is_active, search query
- [ ] `get_code(code)` — single code by code string
- [ ] `get_code_with_dependencies(code)` — code + all dependencies (joined)
- [ ] `search_codes(query, limit)` — full-text search for autocomplete
- [ ] `get_codes_for_prompt(tier)` — formatted for Claude's context (compact, token-efficient)
- [ ] `create_code(data)` — admin create
- [ ] `update_code(code_id, data)` — admin edit
- [ ] `deactivate_code(code_id)` — soft delete
- [ ] `create_dependency(data)` — admin add
- [ ] `delete_dependency(dep_id)` — admin remove

**API routes (`api/scope_codes/router.py`):**
- [ ] `GET /v1/scope-codes` — list/search (query params: `?category=WTR&trade=mitigation&tier=A&search=drywall`)
- [ ] `GET /v1/scope-codes/{code}` — single code with dependencies
- [ ] `GET /v1/scope-codes/{code}/related` — dependency chain only
- [ ] `POST /v1/scope-codes` — create (admin only)
- [ ] `PATCH /v1/scope-codes/{code_id}` — update (admin only)
- [ ] `DELETE /v1/scope-codes/{code_id}` — deactivate (admin only, soft delete)
- [ ] `POST /v1/scope-codes/dependencies` — create dependency (admin only)
- [ ] `DELETE /v1/scope-codes/dependencies/{dep_id}` — remove dependency (admin only)

**Mount router:**
- [ ] Add to `api/main.py` with `prefix="/v1"`

**Tests:**
- [ ] pytest: list codes returns all active codes
- [ ] pytest: filter by category_prefix, trade_category, tier work correctly
- [ ] pytest: search "drywall" returns drywall-related codes
- [ ] pytest: get code with dependencies returns full chain
- [ ] pytest: create code works, duplicate rejected
- [ ] pytest: deactivate sets is_active=false
- [ ] pytest: dependency CRUD works
- [ ] pytest: admin-only endpoints reject non-admin users
- [ ] pytest: `get_codes_for_prompt()` returns compact formatted string

### Phase 3: Settings UI — Code Management — ❌

**Code table view (`web/src/app/(protected)/settings/xactimate-codes/page.tsx`):**
- [ ] Filter bar: trade category dropdown + subcategory dropdown + tier toggle (A/B/All) + search input
- [ ] Columns: Code (accent), Description, Unit (badge), Trade, Subcategory, Tier (A/B badge), Non-Obvious (tag), Active (toggle)
- [ ] Grouped by trade category with colored headers (same palette as PhotoScope)
- [ ] Click row → expand to show: full details + dependencies + edit form
- [ ] Virtual scroll for 500 rows

**Code detail/edit panel:**
- [ ] All fields editable: code, description, unit, trade_category, subcategory, tier, citation, notes, is_non_obvious
- [ ] Activity type dropdown (+, -, R, &, M, I)
- [ ] Dependencies section: list of related codes with strength badges + reasons
- [ ] "Add Dependency" — search/select code, set strength + reason + citation
- [ ] "Remove Dependency" — delete link
- [ ] Save / Cancel buttons

**Add new code:**
- [ ] "Add Code" button
- [ ] Same form as edit, validate uniqueness

**Settings nav:**
- [ ] Add "Xactimate Codes" to settings sidebar

**TanStack Query hooks (`web/src/hooks/use-scope-codes.ts`):**
- [ ] `useScopeCodes(filters)` — list with filters
- [ ] `useScopeCode(code)` — single code with deps
- [ ] `useCreateCode()`, `useUpdateCode()`, `useDeactivateCode()`
- [ ] `useCreateDependency()`, `useDeleteDependency()`
- [ ] Optimistic updates on mutations

### Phase 4: PhotoScope Integration (02A) — ❌

**Prompt loading:**
- [ ] PhotoScope prompt loads codes from DB via `get_codes_for_prompt()`
- [ ] Only active Tier A codes by default (keep prompt compact)
- [ ] Format: `CODE | Description | Unit | Trade` (compact for token efficiency)
- [ ] ~150 codes × ~15 tokens = ~2,250 tokens — acceptable

**Auto-add rules from dependencies:**
- [ ] Replace hardcoded `rules.py` with DB-driven dependency lookup
- [ ] `get_auto_add_codes(generated_codes)` — given AI-generated codes, return all required/recommended dependencies not already in the list
- [ ] Each dependency includes reason + citation (populates line item's justification field)
- [ ] Non-obvious dependencies flagged for "AI found this" highlighting

**Frontend autocomplete:**
- [ ] Line item edit form uses `GET /v1/scope-codes?search=` for code autocomplete
- [ ] Shows code + description + unit in dropdown
- [ ] Selecting a code auto-fills description + unit

**Validator:**
- [ ] `validate_codes(line_items)` — check each AI-generated code exists in DB
- [ ] Flag invalid codes for manual correction
- [ ] Suggest closest match (Levenshtein distance on code string)

**Tests:**
- [ ] pytest: prompt loader returns formatted string with active Tier A codes
- [ ] pytest: auto-add returns correct dependencies, no duplicates
- [ ] pytest: validator flags non-existent codes, suggests closest match

### Phase 5: Crewmatic Code System — ❌ (BLOCKED on Brett's design)

**⚠️ Waiting for Brett to design Crewmatic code format with Claude (promised 2026-04-08 evening).**

Brett's vision: readable codes that encode what was done + where + material type. Example from his Claude estimate:
- `DEMO-FLR-TILE` = "Remove existing vinyl/tile flooring"
- `DEMO-CAB-BASE` = "Remove & haul existing base cabinets"
- `FLR LVT` = "Furnish & install luxury vinyl tile"

**Once Brett delivers the design:**
- [ ] Define Crewmatic code format rules (prefix pattern, naming conventions)
- [ ] Seed ~150-500 Crewmatic codes (mirroring Xactimate coverage for water + remodeling)
- [ ] Map Crewmatic codes to equivalent Xactimate codes where applicable (for cross-reference)
- [ ] Dependency chains for Crewmatic codes (same logic, different code names)
- [ ] Settings UI: Crewmatic code view (same table, filtered by code_system='crewmatic')
- [ ] PhotoScope: toggle to generate Crewmatic codes instead of Xactimate

**Tests:**
- [ ] pytest: Crewmatic codes seed correctly
- [ ] pytest: API filters by code_system='crewmatic'
- [ ] pytest: dependency chains work for Crewmatic codes

**Future (V2+): Crewmatic Pricing Database — The Long-Term Moat**

See detailed research below in [Pricing Database Research](#pricing-database-research--transparent-real-time-alternative-to-xactimate-pricing).

- [ ] Company pricing (`company_code_prices` table) — when we build estimate/invoice
- [ ] "Network Average" pricing from aggregated contractor data (the moat)
- [ ] Transparent Pricing Engine — every price decomposed into auditable components with sources
- [ ] Cost Defense Report — one-click market rate evidence for supplement negotiations
- [ ] Public data source integrations (Home Depot, BLS, equipment rental APIs)
- [ ] Onboarding spreadsheet: download codes + blank price column → upload with pricing
- [ ] RSMeans integration for GC/construction pricing (limited to non-restoration trades)

## Technical Approach

**Dual code system, unified table:**
1. `scope_codes` — single table with `code_system` column ('xactimate' or 'crewmatic'). All queries filter by system.
2. `scope_code_dependencies` — relationships with `code_system` column. Same dependency logic for both.
3. `company_code_prices` — deferred to V2. No pricing in V1.

**Seed via Alembic data migration.** Schema migration creates tables, data migration inserts ~500 Xactimate codes + ~50 dependencies. Crewmatic codes added in Phase 5 (waiting on Brett). Brett reviews seed in PR diff.

**Full-text search via PostgreSQL `tsvector`.** Contractors search by description ("drywall", "baseboard") not code. GIN index makes it fast.

**Tier A/B split.** Tier A (~150 codes) covers 80% of jobs = loaded into Claude's prompt. Tier B (~350 codes) = autocomplete + settings only (keeps prompt token count down).

**Dependency strength levels:**
- `required` — always auto-add (baseboard removal when doing flood cut)
- `recommended` — suggest, auto-add unless contractor removes
- `optional` — show as suggestion, don't auto-add

**Legal guardrails:** Xactimate code nomenclature = public knowledge (widely published in industry training). Verisk's pricing = proprietary, never stored or displayed. V1 has no pricing at all.

**Code system toggle:** Job-level setting. Insurance jobs → Xactimate codes. Non-insurance → Crewmatic codes. Filters PhotoScope prompt, autocomplete, and settings view.

**Key Files:**
```
backend/api/
├── scope_codes/
│   ├── __init__.py
│   ├── router.py              # API routes (list, search, CRUD)
│   ├── service.py             # Business logic + DB queries
│   └── schemas.py             # Pydantic models
web/src/
├── app/(protected)/settings/
│   └── scope-codes/
│       └── page.tsx           # Settings UI — code table + CRUD
├── hooks/
│   └── use-scope-codes.ts     # TanStack Query hooks
└── components/settings/
    ├── code-table.tsx         # Filterable code table (toggle xactimate/crewmatic)
    ├── code-detail.tsx        # Expand/edit panel + dependencies
    └── code-system-toggle.tsx # Toggle between code systems
```

---

## Pricing Database Research — Transparent, Real-Time Alternative to Xactimate Pricing

### Why Xactimate's Pricing Is Beatable

| Xactimate Weakness | Crewmatic Advantage |
|---|---|
| **Black box** — no one knows how prices are derived | **Transparent** — every price has sourced components |
| **Monthly updates** — lags behind real material/labor costs | **Real-time** — pulls live data from public sources + contractor transactions |
| **Regional, not local** — one price for an entire metro area | **Hyperlocal** — ZIP-code-level granularity from actual job data |
| **Estimated costs** — what insurance *should* pay | **Actual costs** — what contractors *really* pay and charge |
| **No receipt trail** — just a number | **Full audit trail** — every data point traceable to source |

### Pricing Phase 1: Collect Real Transaction Data

Every Crewmatic job already generates the raw data needed:

**Data capture points (built into existing job workflow):**
- **Material receipts** — AI-scan contractor invoices and receipts (photo → line items + prices)
- **Labor hours** — logged per line item per tech during job execution
- **Equipment rental costs** — actual rental invoices from Sunbelt, United Rentals, etc.
- **Subcontractor invoices** — actual sub costs per trade
- **Completed job totals** — what the contractor actually billed and what insurance actually paid

**Anonymization & aggregation:**
- All pricing data anonymized before aggregation (no company/contractor identifiable)
- Aggregated by: ZIP code, line item code, date range
- Minimum threshold: 5+ data points per ZIP per code before publishing a price
- Outlier detection: flag entries >2 standard deviations from mean for manual review

**Contractor opt-in model:**
- Contractors who contribute data get access to the pricing database (give-to-get)
- Contribution is passive — just using Crewmatic for jobs feeds the system
- Clear data policy: "Your job data stays private. Only anonymized pricing aggregates are shared."

### Pricing Phase 2: Supplement with Public Data Sources

| Data Source | What It Provides | Update Frequency | Integration Method |
|---|---|---|---|
| Home Depot / Lowe's | Real-time material pricing by store location | Daily | Product APIs / price scraping |
| BLS (Bureau of Labor Statistics) | Regional wage data by trade (NAICS codes) | Quarterly | Public API |
| Sunbelt Rentals / United Rentals | Equipment rental rates by location | Weekly | API / catalog scraping |
| RS Means (Gordian) | Baseline construction cost references | Annual | Licensed data (paid) |
| Municipal permit databases | Actual project costs filed with permits | Varies | Public records requests / APIs |
| Census / ACS data | Cost of living adjustments by ZIP | Annual | Public API |
| Contractor job postings (Indeed, etc.) | Market labor rates by trade and region | Real-time | Job board APIs |

**Material pricing detail:**
- Track by SKU where possible (not just "drywall" but "5/8" Type X 4x8 sheet")
- Map materials to Xactimate/Crewmatic line item codes
- Regional price variance — same SKU costs different amounts in different markets

### Pricing Phase 3: The Transparent Pricing Engine

**Price composition model — every Crewmatic price is decomposed into auditable components:**

```
Line Item: WTR DRYWLL RR (Drywall Remove & Replace)
Crewmatic Price: $2.43/SF

Breakdown:
├── Material:   $0.62/SF
│   ├── 5/8" Type X drywall: $0.38/SF (Home Depot #78701, updated 2026-04-08)
│   ├── Joint compound: $0.09/SF (Home Depot #78701)
│   ├── Tape + screws: $0.07/SF (Home Depot #78701)
│   └── Primer + paint: $0.08/SF (Sherwin-Williams Austin avg)
│
├── Labor:      $1.45/SF
│   ├── Hang: $0.55/SF (avg 47 jobs, Austin metro, Q1 2026)
│   ├── Tape/mud: $0.50/SF (avg 47 jobs)
│   └── Paint: $0.40/SF (avg 47 jobs)
│
├── Equipment:  $0.18/SF
│   └── Scaffolding, tools, consumables (based on actual rental invoices)
│
└── O&P:        $0.18/SF
    └── Overhead & Profit at 8% (industry standard, adjustable per market)

Data quality: 47 verified transactions | Confidence: HIGH
Last updated: 2026-04-08 | ZIP: 78701 | Radius: 25 miles
```

**Confidence scoring:**

| Confidence Level | Criteria | Display |
|---|---|---|
| HIGH | 20+ data points in ZIP, <90 days old | Green — reliable |
| MEDIUM | 5-19 data points, or 90-180 days old | Yellow — directional |
| LOW | <5 data points, or >180 days old, or extrapolated from nearby ZIP | Red — estimate only |
| SUPPLEMENTAL | No contractor data, using public sources only | Gray — reference |

**Price comparison view (Crewmatic vs. Xactimate):**

```
Line Item              Xactimate    Crewmatic    Delta    Source
WTR DRYWLL RR          $2.15/SF     $2.43/SF     +13%    47 jobs, 78701
WTR DRYOUT (per day)   $48.00/day   $52.30/day   +9%     31 jobs, 78701
WTR DEMOL CARP         $1.80/SF     $1.92/SF     +7%     22 jobs, 78701
```

### Pricing Phase 4: Get Insurance Carriers to Accept It

**Adoption path (don't replace Xactimate — flank it):**

**Stage 1: Supplemental evidence (Day 1)**
- Contractors submit Xactimate estimate + Crewmatic Cost Defense Report
- "Here's what Xactimate says. Here's what the actual market costs are, with sources."
- Useful for supplement negotiations — the #1 contractor pain point

**Stage 2: Public adjuster adoption**
- Public adjusters (who work FOR the homeowner, not the carrier) will adopt first
- They're motivated to prove higher costs — Crewmatic data is their weapon
- PA market is large and underserved

**Stage 3: TPA adoption**
- Smaller TPAs (Third Party Administrators) are more flexible than big carriers
- Pitch: "Transparent pricing reduces disputes, speeds settlements, lowers your admin cost"
- One TPA partnership = credibility for the next

**Stage 4: Carrier pilot programs**
- Progressive carriers run innovation pilots (USAA, Hippo, Lemonade)
- Pitch: "Our pricing reflects actual market costs. Fewer supplements. Faster cycle times."
- Data shows: supplement rate, cycle time, contractor satisfaction

**Stage 5: Industry standard**
- IICRC or RIA endorsement as a "fair market reference"
- Published methodology (unlike Xactimate's black box)
- Academic validation — partner with construction economics researchers

**Regulatory & legal considerations:**
- Do NOT use Xactimate's proprietary pricing data — build entirely from independent sources
- Transparent methodology protects against legal challenge ("we showed our work")
- Contractor data is anonymized and aggregated — no individual pricing exposed
- Comply with state-level prompt payment and fair claims settlement laws

### Pricing Phase 5: Killer Features

**Cost Defense Report (one-click):**
When an adjuster disputes a line item, contractor generates:

> "You're offering $2.15/SF for drywall R&R. Based on 47 verified jobs within 25 miles in the last 90 days, actual market rate is $2.43/SF. Here are the anonymized data points and material price sources."

No contractor has this today. They just argue on the phone.

**Price Trend Alerts:**
- "Lumber prices in your area increased 18% this quarter — your estimates should reflect this"
- "Labor rates for water mitigation techs in 78701 have risen 12% since last year"
- Helps contractors stay ahead of market shifts instead of eating the margin

**Insurance Negotiation Assistant:**
- AI analyzes the gap between Xactimate pricing and Crewmatic market data
- Generates a supplement letter with specific data points and citations
- "Based on 47 recent transactions in your market, the following line items are underpriced by Xactimate..."

**Market Intelligence Dashboard:**
- Contractors see: "You're pricing 8% below market in your ZIP — you could be earning more"
- Regional trends: which trades are getting more expensive, seasonal patterns
- Competitive positioning: where you stand vs. market averages (anonymized)

### Pricing Data Model (V2)

```sql
-- Regional pricing aggregates
CREATE TABLE pricing_market_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_code_id UUID REFERENCES scope_codes(id),
    zip_code VARCHAR(10) NOT NULL,
    unit_type VARCHAR(20) NOT NULL,          -- SF, LF, EA, HR, DAY

    -- Composite price
    total_price_per_unit DECIMAL(10,2),
    material_cost DECIMAL(10,2),
    labor_cost DECIMAL(10,2),
    equipment_cost DECIMAL(10,2),
    overhead_profit DECIMAL(10,2),

    -- Data quality
    sample_size INTEGER NOT NULL,
    confidence_level VARCHAR(10),             -- HIGH, MEDIUM, LOW, SUPPLEMENTAL
    date_range_start DATE,
    date_range_end DATE,
    radius_miles INTEGER DEFAULT 25,

    -- Comparison
    xactimate_price DECIMAL(10,2),           -- for delta calculation
    delta_percent DECIMAL(5,2),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Individual price data points (anonymized)
CREATE TABLE pricing_data_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_code_id UUID REFERENCES scope_codes(id),
    zip_code VARCHAR(10) NOT NULL,

    -- Anonymized source
    source_type VARCHAR(20),                  -- CONTRACTOR_JOB, MATERIAL_API, LABOR_SURVEY, RENTAL_CATALOG

    -- Actual costs
    unit_price DECIMAL(10,2),
    material_cost DECIMAL(10,2),
    labor_cost DECIMAL(10,2),
    labor_hours DECIMAL(6,2),
    equipment_cost DECIMAL(10,2),

    -- Metadata
    job_date DATE,
    verified BOOLEAN DEFAULT false,           -- receipt/invoice verified by AI
    outlier_flagged BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT now()
);
-- No company_id — this table is anonymized by design

-- Material price tracking from public sources
CREATE TABLE pricing_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_name VARCHAR(200) NOT NULL,
    sku VARCHAR(100),
    supplier VARCHAR(100),                    -- Home Depot, Lowe's, etc.
    store_location VARCHAR(100),              -- store ID or ZIP

    unit_price DECIMAL(10,2),
    unit_type VARCHAR(20),                    -- EA, SF, LF, GAL, etc.

    fetched_at TIMESTAMPTZ DEFAULT now(),
    source_url TEXT
);

-- Labor rate tracking
CREATE TABLE pricing_labor_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_category VARCHAR(100),              -- Water Mitigation, Drywall, Painting, etc.
    zip_code VARCHAR(10),

    hourly_rate DECIMAL(8,2),
    source_type VARCHAR(50),                  -- BLS, JOB_POSTING, CONTRACTOR_REPORTED
    sample_size INTEGER,

    period_start DATE,
    period_end DATE,
    fetched_at TIMESTAMPTZ DEFAULT now()
);
```

### Network Effect & Moat

```
More contractors use Crewmatic
        ↓
More real job cost data flows in
        ↓
Pricing database becomes more accurate & granular
        ↓
Contractors win more supplement negotiations
        ↓
Word spreads — more contractors join
        ↓
Carriers see fewer disputes, faster settlements
        ↓
Carriers start accepting Crewmatic pricing
        ↓
Crewmatic becomes the pricing standard
```

**Why competitors can't copy this:**
- Xactimate doesn't have job management — no access to actual contractor costs
- Encircle/CompanyCam are documentation-only — no cost data
- New entrants would need critical mass of contractors (chicken-and-egg problem Crewmatic solves by being the job management tool first)

### Pricing Open Questions
- [ ] RS Means licensing cost and terms — worth it as a baseline, or build from scratch?
- [ ] Home Depot / Lowe's API access — official partner program or scraping?
- [ ] Legal review: can we display "Xactimate price" alongside ours for comparison? (fair use / factual comparison)
- [ ] Minimum contractor count per ZIP before pricing is useful? (hypothesis: 10 active contractors)
- [ ] Brett's input: which line items have the biggest Xactimate vs. reality gap?
- [ ] IICRC/RIA engagement timeline — when to start the standards conversation?

---

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1 (database + seed migration)
# Phases 1-4 can proceed — no blockers
# Phase 5 (company pricing) BLOCKED on Brett's answers to Open Questions
# Phase 4 (PhotoScope integration) happens during/after 02A implementation
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

### Confirmed (Brett call 2026-04-08)

- **Dual code system with toggle.** Xactimate for insurance/restoration. Crewmatic codes for non-insurance/remodeling. Toggle in UI. (~90% of restoration contractors use Xactimate, ~10% refuse it)
- **V1 = codes only, NO pricing.** Insurance: contractor enters line items into Xactimate for pricing. Non-insurance: TBD (Brett using Claude-generated pricing currently). Pricing table deferred to V2.
- **Xactimate codes are public, pricing is proprietary.** Safe to use code nomenclature. Cannot copy/display Verisk's pricing. Brett confirmed: "we can copy all the codes but not their pricing."
- **Brett designing Crewmatic code system.** Working with Claude (2026-04-08 evening). Vision: more readable codes like `DEMO-FLR-TILE`, encode what/where/material in the code itself.
- **RSMeans not useful for restoration.** Confirmed by Brett. No dehu, air movers, equipment pricing. Only construction. Maybe V2+ for GC work.
- **Brett already using Claude for remodeling estimates.** Photos + voice → Claude generates codes + pricing → professional estimate PDF. "Working for me." The 5-minute on-site quote is the magic moment.
- **Some contractors refuse Xactimate.** They send custom estimates → 2-3 week argument with adjuster → eventually get paid. Crewmatic codes serve these contractors.
- **Brett will send Xactimate code Excel export.** Real codes from his Xactimate instance, all activity types.

### Prior decisions (still valid)

- **Unified `scope_codes` table.** Single table with `code_system` column ('xactimate' or 'crewmatic'). Same dependency logic works for both.
- **Tier A (~150) / Tier B (~350).** Tier A = core codes loaded into AI prompt. Tier B = extended for autocomplete + settings.
- **No JSON file.** Seed via Alembic data migration. Brett reviews in PR.
- **No auto-refresh from Xactware.** No public API. Admins add new codes via settings UI.
- **ESX is a dead end.** Verisk encrypts at 7.998/8.0 entropy. Only path is Strategic Alliance Partnership (V2+).
- **Dependency chains are the moat.** Actionable Insights charges $162/mo for this. We encode it as data.
- **This spec is a dependency for 02A (PhotoScope).** Prompt, auto-add rules, validation, autocomplete all read from this DB.
- **Activity types stored but lightly used V1.** Mitigation uses default activity. Reconstruction (01B) uses them more.

### Research references

- `docs/research/brett-codes-pricing-call-2026-04-08.md` — Full call notes with decisions
- `docs/research/xactimate-codes-water.md` — 50+ WTR codes from industry sources
- `docs/research/competitive-analysis.md` — Market context, Brett interview
- Brett's Claude conversation — ESX analysis, pricing strategy, Tier A spreadsheet (150 codes)
- Brett's Dry Pros estimate screenshot — Claude-generated kitchen remodel with `DEMO-*` codes
