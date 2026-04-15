# Spec 01E: Job Type Extensions — Fire/Smoke, Selections, Payments

## Status
| Field | Value |
|-------|-------|
| **Progress** | ░░░░░░░░░░░░░░░░░░░░ 0% (0/3 phases) |
| **State** | Draft |
| **Blocker** | None — Spec 01B (reconstruction) is complete |
| **Branch** | TBD |
| **Issue** | TBD |
| **Depends on** | Spec 01 (Jobs — complete), Spec 01B (Reconstruction — complete) |

## Metrics
| Metric | Value |
|--------|-------|
| Created | 2026-04-14 |
| Started | — |
| Completed | — |
| Sessions | 0 |
| Total Time | — |
| Files Changed | 0 |
| Tests Written | 0 |

## Done When
- [ ] `fire_smoke` added to `job_type` CHECK constraint
- [ ] Fire/Smoke status pipeline works: `new → contracted → in_progress → complete → submitted → collected`
- [ ] `cleaning_logs` table exists with full schema (soot type, method, surfaces, status, room link)
- [ ] `GET/POST/PATCH/DELETE /v1/jobs/{id}/cleaning-logs` endpoints with RLS
- [ ] Fire/Smoke job detail shows correct tabs: Overview | Photos | Cleaning Log | Scope | Schedule
- [ ] Job creation form includes Fire/Smoke option alongside Mitigation and Reconstruction
- [ ] Job list shows `FIRE` badge for fire_smoke jobs
- [ ] `job_selections` table exists with allowance/actual/overage calculation
- [ ] `GET/POST/PATCH/DELETE /v1/jobs/{id}/selections` endpoints with RLS
- [ ] Selections tab on reconstruction job detail — grouped by category, allowance vs actual with overage
- [ ] Selections summary card: total allowance, total actual, total overage
- [ ] `job_payments` table exists with milestone tracking
- [ ] `GET/POST/PATCH/DELETE /v1/jobs/{id}/payments` endpoints with RLS
- [ ] Payments tab on reconstruction job detail — schedule with status badges, summary card
- [ ] Payments summary: total contract, total invoiced, total paid, total remaining
- [ ] All backend endpoints have pytest coverage (minimum 30 new tests)
- [ ] Zero regression on existing mitigation and reconstruction flows
- [ ] Code review approved

## Overview

**Problem:** Crewmatic currently supports two job types (mitigation and reconstruction) but Brett's UI Layout & Navigation Summary v2.0 (April 13, 2026) defines additional tab configurations and features that contractors need:
1. **Fire/Smoke** is a distinct job type with its own workflow — cleaning logs replace moisture readings, and the tab set differs from water mitigation.
2. **Reconstruction jobs** need a Selections tab for tracking material selections, finish choices, and insurance allowance vs actual cost (homeowner overages).
3. **Reconstruction jobs** need a Payments tab for milestone-based payment schedules, invoicing, and collection tracking.

**Solution:** Extend the job system in three phases: (1) add `fire_smoke` as a third job type with a Cleaning Log feature, (2) add a Selections tab for reconstruction jobs, (3) add a Payments tab for reconstruction jobs.

**Source:** Brett's "Crewmatic UI Layout & Navigation Summary v2.0" (April 13, 2026) — filed at `docs/research/layout-summary-v2.pdf`.

**Scope:**
- IN: `fire_smoke` job type, cleaning logs table + CRUD, fire/smoke tab configuration, `job_selections` table + CRUD + overage calculation, Selections tab UI, `job_payments` table + CRUD, Payments tab UI, summary cards, job creation form updates, job list badge
- OUT: Digital contracts / e-signature (tracked in 05-future-features Phase 2), Scope tab (Spec 02A), Schedule tab (Spec 04A Phase 8), property-level sketch ownership (future migration in 01C)

**What this spec does NOT implement:**
- **Contract button** — The always-visible "Contract Needed" / "Contract Signed" button in the job header is tracked separately in 05-future-features Phase 2 (Digital Contracts / E-Signature).
- **Scope tab** — Referenced in Brett's tab sets but covered by Spec 02A (PhotoScope).
- **Schedule tab** — Referenced in Brett's tab sets but covered by Spec 04A Phase 8.
- **Property-level sketch ownership** — Sketch belongs to property, not job; reconstruction inherits from mitigation. This is a data model change that should be addressed in 01C or a future migration.

---

## Evidence Base

All decisions in this spec derive from Brett's "Crewmatic UI Layout & Navigation Summary v2.0" (April 13, 2026), filed at `docs/research/layout-summary-v2.pdf`. This document specifies per-job-type tab configurations and the features described in each tab.

Additional context from Spec 01B reconstruction interview (March 2026): reconstruction jobs have separate invoices, separate P&L (40% vs 30% margins), and need financial tracking that mitigation does not.

---

## Database Schema

### Migration 1: Add fire_smoke to job_type constraint

```sql
-- Expand job_type to include fire_smoke
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_job_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_job_type_check CHECK (
    job_type IN ('mitigation', 'reconstruction', 'fire_smoke')
);

-- Add fire/smoke-specific statuses to the status constraint
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (
    status IN (
        -- Shared statuses (all pipelines)
        'new', 'submitted', 'collected', 'complete',
        -- Mitigation-only
        'contracted', 'mitigation', 'drying',
        -- Reconstruction-only
        'scoping', 'in_progress',
        -- Fire/Smoke (reuses 'contracted' from mitigation + 'in_progress' from reconstruction)
        -- no new statuses needed — fire/smoke uses: new → contracted → in_progress → complete → submitted → collected
    )
);
```

**Fire/Smoke Status Pipeline:**
```
new → contracted → in_progress → complete → submitted → collected
```

- `new` — job created, lead entered
- `contracted` — work authorization signed (shared with mitigation)
- `in_progress` — active cleaning/remediation work (shared with reconstruction)
- `complete` — all work finished (shared)
- `submitted` — scope submitted to carrier (shared)
- `collected` — payment received (shared)

Fire/smoke does NOT use `mitigation` or `drying` statuses. While water is sometimes used to put out fires, the drying phase is rare enough that it does not warrant its own pipeline stage — a tech can note drying work in the cleaning log.

### Migration 2: cleaning_logs table

```sql
CREATE TABLE cleaning_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    room_id         UUID REFERENCES job_rooms(id) ON DELETE SET NULL,

    -- Soot classification (S520 standard)
    soot_type       TEXT CHECK (soot_type IN (
                        'protein', 'synthetic', 'wood', 'oil', 'mixed'
                    )),

    -- Cleaning method applied
    cleaning_method TEXT CHECK (cleaning_method IN (
                        'dry_sponge', 'wet_clean', 'media_blast',
                        'ozone', 'thermal_fog', 'hydroxyl'
                    )),

    -- Surfaces cleaned (array of surface types)
    surfaces_cleaned TEXT[] DEFAULT '{}',
    -- Valid values: 'walls', 'ceiling', 'floor', 'hvac', 'contents', 'structure'

    -- Status tracking
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (
                        status IN ('pending', 'in_progress', 'complete')
                    ),
    notes           TEXT,

    -- Who cleaned and when
    cleaned_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
    cleaned_at      TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_cleaning_logs_job ON cleaning_logs(job_id);
CREATE INDEX idx_cleaning_logs_company ON cleaning_logs(company_id);
CREATE INDEX idx_cleaning_logs_room ON cleaning_logs(room_id) WHERE room_id IS NOT NULL;

-- RLS policies: company isolation (all CRUD operations)
ALTER TABLE cleaning_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY cleaning_logs_select ON cleaning_logs FOR SELECT
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY cleaning_logs_insert ON cleaning_logs FOR INSERT
    WITH CHECK (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY cleaning_logs_update ON cleaning_logs FOR UPDATE
    USING (company_id = current_setting('app.company_id')::uuid)
    WITH CHECK (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY cleaning_logs_delete ON cleaning_logs FOR DELETE
    USING (company_id = current_setting('app.company_id')::uuid);
```

### Migration 3: job_selections table

```sql
CREATE TABLE job_selections (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

    -- Selection details
    category          TEXT NOT NULL CHECK (category IN (
                          'flooring', 'paint', 'countertop', 'cabinet',
                          'tile', 'fixture', 'appliance', 'other'
                      )),
    item_name         TEXT NOT NULL,           -- 'Master Bath Floor Tile'
    selected_option   TEXT,                    -- 'Carrara Marble 12x24'

    -- Financial tracking
    allowance_amount  DECIMAL(10,2),           -- budget from insurance
    actual_cost       DECIMAL(10,2),           -- what was selected
    overage           DECIMAL(10,2) GENERATED ALWAYS AS (
                          GREATEST(COALESCE(actual_cost, 0) - COALESCE(allowance_amount, 0), 0)
                      ) STORED,

    -- Status tracking
    status            TEXT NOT NULL DEFAULT 'pending' CHECK (
                          status IN ('pending', 'selected', 'ordered', 'installed')
                      ),
    notes             TEXT,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_job_selections_job ON job_selections(job_id);
CREATE INDEX idx_job_selections_company ON job_selections(company_id);
CREATE INDEX idx_job_selections_category ON job_selections(job_id, category);

-- RLS policies: company isolation (all CRUD operations)
ALTER TABLE job_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_selections_select ON job_selections FOR SELECT
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_selections_insert ON job_selections FOR INSERT
    WITH CHECK (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_selections_update ON job_selections FOR UPDATE
    USING (company_id = current_setting('app.company_id')::uuid)
    WITH CHECK (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_selections_delete ON job_selections FOR DELETE
    USING (company_id = current_setting('app.company_id')::uuid);
```

### Migration 4: job_payments table

```sql
CREATE TABLE job_payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

    -- Payment details
    payment_type    TEXT NOT NULL CHECK (payment_type IN (
                        'milestone', 'progress', 'final',
                        'supplement', 'change_order'
                    )),
    description     TEXT NOT NULL,             -- 'Demo Complete - 30%', 'Drywall Complete - 25%'
    amount          DECIMAL(10,2) NOT NULL,

    -- Status tracking
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (
                        status IN ('pending', 'invoiced', 'paid', 'overdue')
                    ),

    -- Dates
    due_date        DATE,
    paid_date       DATE,

    -- Invoice tracking
    invoice_number  TEXT,
    notes           TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_job_payments_job ON job_payments(job_id);
CREATE INDEX idx_job_payments_company ON job_payments(company_id);
CREATE INDEX idx_job_payments_status ON job_payments(job_id, status);

-- RLS policies: company isolation (all CRUD operations)
ALTER TABLE job_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_payments_select ON job_payments FOR SELECT
    USING (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_payments_insert ON job_payments FOR INSERT
    WITH CHECK (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_payments_update ON job_payments FOR UPDATE
    USING (company_id = current_setting('app.company_id')::uuid)
    WITH CHECK (company_id = current_setting('app.company_id')::uuid);
CREATE POLICY job_payments_delete ON job_payments FOR DELETE
    USING (company_id = current_setting('app.company_id')::uuid);
```

### New Event Types

```sql
-- Add to event_type enum:
ALTER TYPE event_type ADD VALUE 'cleaning_log_created';
ALTER TYPE event_type ADD VALUE 'cleaning_log_updated';
ALTER TYPE event_type ADD VALUE 'selection_created';
ALTER TYPE event_type ADD VALUE 'selection_updated';
ALTER TYPE event_type ADD VALUE 'payment_created';
ALTER TYPE event_type ADD VALUE 'payment_updated';
ALTER TYPE event_type ADD VALUE 'payment_status_changed';
```

### Data Relationships (updated from 01B)

```
property (physical address — shared across jobs)
├── job (mitigation, job_type='mitigation')
│   ├── floor_plans, job_rooms, photos, moisture_readings, ...  (Spec 01)
│   ├── line_items (Spec 02A — AI scope)
│   └── linked_job_id: NULL
│
├── job (reconstruction, job_type='reconstruction')
│   ├── photos, recon_phases (Spec 01B)
│   ├── job_selections (NEW — Phase 2 of this spec)
│   ├── job_payments (NEW — Phase 3 of this spec)
│   └── linked_job_id: → mitigation job above (optional)
│
├── job (fire/smoke, job_type='fire_smoke')
│   ├── photos (reuses existing photos system)
│   ├── job_rooms (rooms describe where cleaning is needed)
│   ├── cleaning_logs (NEW — Phase 1 of this spec)
│   └── linked_job_id: NULL (fire/smoke jobs are standalone)
│
└── (future: more jobs at same property)
```

**What fire/smoke jobs do NOT have** (mitigation-only features):
- Moisture readings (moisture_readings, moisture_points, dehu_outputs)
- Equipment tracking (air movers, dehus per room)
- Water category/class (loss_category, loss_class)
- GPP calculations
- Floor plan sketch (optional — fire jobs don't typically need room geometry)
- Recon phases (reconstruction-only)

**What fire/smoke jobs share with mitigation:**
- Photos (same upload/organize/tag system)
- Rooms (same job_rooms table — rooms describe where cleaning is needed)
- Tech notes
- Reports / share links
- Event history

---

## API Endpoints

### Phase 1: Cleaning Logs API

#### Schemas (`backend/api/cleaning_logs/schemas.py`)

```python
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime


VALID_SOOT_TYPES = {"protein", "synthetic", "wood", "oil", "mixed"}
VALID_CLEANING_METHODS = {
    "dry_sponge", "wet_clean", "media_blast",
    "ozone", "thermal_fog", "hydroxyl",
}
VALID_SURFACES = {"walls", "ceiling", "floor", "hvac", "contents", "structure"}
VALID_CLEANING_STATUSES = {"pending", "in_progress", "complete"}


class CleaningLogCreate(BaseModel):
    room_id: UUID | None = None
    soot_type: str | None = None
    cleaning_method: str | None = None
    surfaces_cleaned: list[str] = []
    status: str = "pending"
    notes: str | None = None
    cleaned_by: UUID | None = None
    cleaned_at: datetime | None = None


class CleaningLogUpdate(BaseModel):
    room_id: UUID | None = None
    soot_type: str | None = None
    cleaning_method: str | None = None
    surfaces_cleaned: list[str] | None = None
    status: str | None = None
    notes: str | None = None
    cleaned_by: UUID | None = None
    cleaned_at: datetime | None = None


class CleaningLogResponse(BaseModel):
    id: UUID
    company_id: UUID
    job_id: UUID
    room_id: UUID | None
    soot_type: str | None
    cleaning_method: str | None
    surfaces_cleaned: list[str]
    status: str
    notes: str | None
    cleaned_by: UUID | None
    cleaned_at: datetime | None
    created_at: datetime
    updated_at: datetime
```

#### Routes (`backend/api/cleaning_logs/router.py`)

```python
# GET    /v1/jobs/{job_id}/cleaning-logs          — list all cleaning logs for a job
# POST   /v1/jobs/{job_id}/cleaning-logs          — create a cleaning log entry
# GET    /v1/jobs/{job_id}/cleaning-logs/{log_id} — get a single cleaning log
# PATCH  /v1/jobs/{job_id}/cleaning-logs/{log_id} — update a cleaning log
# DELETE /v1/jobs/{job_id}/cleaning-logs/{log_id} — delete a cleaning log
```

**Validation rules:**
- Job must exist and belong to the authenticated company
- Job must be `fire_smoke` type — return 400 if cleaning log is created on mitigation/reconstruction job
- `soot_type` must be in VALID_SOOT_TYPES (if provided)
- `cleaning_method` must be in VALID_CLEANING_METHODS (if provided)
- All values in `surfaces_cleaned` must be in VALID_SURFACES
- `status` must be in VALID_CLEANING_STATUSES
- When status changes to `complete`, auto-set `cleaned_at` to now() if not already set
- `room_id` must reference a room belonging to the same job (if provided)

#### Service (`backend/api/cleaning_logs/service.py`)

```python
async def list_cleaning_logs(job_id: UUID, company_id: UUID) -> list[dict]:
    """List all cleaning logs for a job, ordered by created_at."""

async def get_cleaning_log(log_id: UUID, job_id: UUID, company_id: UUID) -> dict:
    """Get a single cleaning log. Raises 404 if not found."""

async def create_cleaning_log(job_id: UUID, company_id: UUID, data: CleaningLogCreate) -> dict:
    """Create a cleaning log entry. Validates job is fire_smoke type."""

async def update_cleaning_log(log_id: UUID, job_id: UUID, company_id: UUID, data: CleaningLogUpdate) -> dict:
    """Update a cleaning log. Auto-sets cleaned_at when status → complete."""

async def delete_cleaning_log(log_id: UUID, job_id: UUID, company_id: UUID) -> None:
    """Delete a cleaning log entry."""
```

### Phase 1: Job Type Extension

#### Updated `POST /v1/jobs` — accept `fire_smoke` as job_type

```python
class JobCreate(BaseModel):
    job_type: str = "mitigation"  # "mitigation" | "reconstruction" | "fire_smoke"
    # ... existing fields unchanged
```

**Status validation update:**
```python
FIRE_SMOKE_STATUSES = ["new", "contracted", "in_progress", "complete", "submitted", "collected"]

# In status transition validation:
if job.job_type == "fire_smoke" and new_status not in FIRE_SMOKE_STATUSES:
    raise HTTPException(400, f"Status '{new_status}' is not valid for fire/smoke jobs")
```

**Fire/smoke-specific field handling:**
- `loss_type` defaults to `"fire"` when `job_type` is `fire_smoke` (frontend pre-selects)
- `water_category` and `water_class` are hidden in the creation form (irrelevant for fire)
- `loss_type` is still editable — contractor may want to categorize as `"fire"`, `"storm"`, etc.

### Phase 2: Selections API

#### Schemas (`backend/api/selections/schemas.py`)

```python
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from decimal import Decimal


VALID_SELECTION_CATEGORIES = {
    "flooring", "paint", "countertop", "cabinet",
    "tile", "fixture", "appliance", "other",
}
VALID_SELECTION_STATUSES = {"pending", "selected", "ordered", "installed"}


class SelectionCreate(BaseModel):
    category: str
    item_name: str
    selected_option: str | None = None
    allowance_amount: Decimal | None = None
    actual_cost: Decimal | None = None
    status: str = "pending"
    notes: str | None = None


class SelectionUpdate(BaseModel):
    category: str | None = None
    item_name: str | None = None
    selected_option: str | None = None
    allowance_amount: Decimal | None = None
    actual_cost: Decimal | None = None
    status: str | None = None
    notes: str | None = None


class SelectionResponse(BaseModel):
    id: UUID
    company_id: UUID
    job_id: UUID
    category: str
    item_name: str
    selected_option: str | None
    allowance_amount: Decimal | None
    actual_cost: Decimal | None
    overage: Decimal | None          # computed column
    status: str
    notes: str | None
    created_at: datetime
    updated_at: datetime


class SelectionsSummary(BaseModel):
    total_allowance: Decimal
    total_actual: Decimal
    total_overage: Decimal            # homeowner responsibility
    count_by_status: dict[str, int]   # {"pending": 3, "selected": 2, "ordered": 1, "installed": 0}
```

#### Routes (`backend/api/selections/router.py`)

```python
# GET    /v1/jobs/{job_id}/selections              — list all selections (grouped by category)
# GET    /v1/jobs/{job_id}/selections/summary       — summary totals (allowance, actual, overage)
# POST   /v1/jobs/{job_id}/selections               — create a selection
# GET    /v1/jobs/{job_id}/selections/{sel_id}       — get a single selection
# PATCH  /v1/jobs/{job_id}/selections/{sel_id}       — update a selection
# DELETE /v1/jobs/{job_id}/selections/{sel_id}       — delete a selection
```

**Validation rules:**
- Job must exist and belong to the authenticated company
- Job must be `reconstruction` type — return 400 if selection is created on mitigation/fire_smoke job
- `category` must be in VALID_SELECTION_CATEGORIES
- `status` must be in VALID_SELECTION_STATUSES
- `allowance_amount` and `actual_cost` must be >= 0 (if provided)
- `overage` is a generated column — never set by client

#### Service (`backend/api/selections/service.py`)

```python
async def list_selections(job_id: UUID, company_id: UUID) -> list[dict]:
    """List all selections for a job, ordered by category then created_at."""

async def get_selections_summary(job_id: UUID, company_id: UUID) -> dict:
    """Compute summary: total allowance, total actual, total overage, count by status."""

async def get_selection(sel_id: UUID, job_id: UUID, company_id: UUID) -> dict:
    """Get a single selection. Raises 404 if not found."""

async def create_selection(job_id: UUID, company_id: UUID, data: SelectionCreate) -> dict:
    """Create a selection. Validates job is reconstruction type."""

async def update_selection(sel_id: UUID, job_id: UUID, company_id: UUID, data: SelectionUpdate) -> dict:
    """Update a selection."""

async def delete_selection(sel_id: UUID, job_id: UUID, company_id: UUID) -> None:
    """Delete a selection."""
```

### Phase 3: Payments API

#### Schemas (`backend/api/payments/schemas.py`)

```python
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime, date
from decimal import Decimal


VALID_PAYMENT_TYPES = {"milestone", "progress", "final", "supplement", "change_order"}
VALID_PAYMENT_STATUSES = {"pending", "invoiced", "paid", "overdue"}


class PaymentCreate(BaseModel):
    payment_type: str
    description: str
    amount: Decimal
    status: str = "pending"
    due_date: date | None = None
    invoice_number: str | None = None
    notes: str | None = None


class PaymentUpdate(BaseModel):
    payment_type: str | None = None
    description: str | None = None
    amount: Decimal | None = None
    status: str | None = None
    due_date: date | None = None
    paid_date: date | None = None
    invoice_number: str | None = None
    notes: str | None = None


class PaymentResponse(BaseModel):
    id: UUID
    company_id: UUID
    job_id: UUID
    payment_type: str
    description: str
    amount: Decimal
    status: str
    due_date: date | None
    paid_date: date | None
    invoice_number: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class PaymentsSummary(BaseModel):
    total_contract: Decimal       # sum of all payment amounts
    total_invoiced: Decimal       # sum where status in ('invoiced', 'paid')
    total_paid: Decimal           # sum where status = 'paid'
    total_remaining: Decimal      # total_contract - total_paid
    count_by_status: dict[str, int]
```

#### Routes (`backend/api/payments/router.py`)

```python
# GET    /v1/jobs/{job_id}/payments              — list all payments for a job
# GET    /v1/jobs/{job_id}/payments/summary       — summary totals
# POST   /v1/jobs/{job_id}/payments               — create a payment
# GET    /v1/jobs/{job_id}/payments/{pay_id}       — get a single payment
# PATCH  /v1/jobs/{job_id}/payments/{pay_id}       — update a payment
# DELETE /v1/jobs/{job_id}/payments/{pay_id}       — delete a payment
```

**Validation rules:**
- Job must exist and belong to the authenticated company
- Job must be `reconstruction` type — return 400 if payment is created on mitigation/fire_smoke job
- `payment_type` must be in VALID_PAYMENT_TYPES
- `status` must be in VALID_PAYMENT_STATUSES
- `amount` must be > 0
- When status changes to `paid`, auto-set `paid_date` to today if not already set
- When status changes from `paid` to another status, clear `paid_date`
- `due_date` should be in the future when creating (warn but don't block — backdating happens)

#### Service (`backend/api/payments/service.py`)

```python
async def list_payments(job_id: UUID, company_id: UUID) -> list[dict]:
    """List all payments for a job, ordered by due_date then created_at."""

async def get_payments_summary(job_id: UUID, company_id: UUID) -> dict:
    """Compute summary: total contract, invoiced, paid, remaining, count by status."""

async def get_payment(pay_id: UUID, job_id: UUID, company_id: UUID) -> dict:
    """Get a single payment. Raises 404 if not found."""

async def create_payment(job_id: UUID, company_id: UUID, data: PaymentCreate) -> dict:
    """Create a payment. Validates job is reconstruction type."""

async def update_payment(pay_id: UUID, job_id: UUID, company_id: UUID, data: PaymentUpdate) -> dict:
    """Update a payment. Auto-sets paid_date on status → paid."""

async def delete_payment(pay_id: UUID, job_id: UUID, company_id: UUID) -> None:
    """Delete a payment."""
```

---

## Frontend

### TypeScript Types (`web/src/lib/types.ts`)

```typescript
// Update JobType to include fire_smoke
export type JobType = "mitigation" | "reconstruction" | "fire_smoke";

// Fire/Smoke statuses (subset of existing statuses — no new values needed)
export type FireSmokeStatus = "new" | "contracted" | "in_progress" | "complete" | "submitted" | "collected";

// Soot types (S520 standard)
export type SootType = "protein" | "synthetic" | "wood" | "oil" | "mixed";

// Cleaning methods
export type CleaningMethod =
  | "dry_sponge" | "wet_clean" | "media_blast"
  | "ozone" | "thermal_fog" | "hydroxyl";

// Cleanable surfaces
export type CleaningSurface = "walls" | "ceiling" | "floor" | "hvac" | "contents" | "structure";

// Cleaning log status
export type CleaningLogStatus = "pending" | "in_progress" | "complete";

export interface CleaningLog {
  id: string;
  company_id: string;
  job_id: string;
  room_id: string | null;
  soot_type: SootType | null;
  cleaning_method: CleaningMethod | null;
  surfaces_cleaned: CleaningSurface[];
  status: CleaningLogStatus;
  notes: string | null;
  cleaned_by: string | null;
  cleaned_at: string | null;
  created_at: string;
  updated_at: string;
}

// Selection categories
export type SelectionCategory =
  | "flooring" | "paint" | "countertop" | "cabinet"
  | "tile" | "fixture" | "appliance" | "other";

export type SelectionStatus = "pending" | "selected" | "ordered" | "installed";

export interface JobSelection {
  id: string;
  company_id: string;
  job_id: string;
  category: SelectionCategory;
  item_name: string;
  selected_option: string | null;
  allowance_amount: number | null;
  actual_cost: number | null;
  overage: number | null;
  status: SelectionStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SelectionsSummary {
  total_allowance: number;
  total_actual: number;
  total_overage: number;
  count_by_status: Record<SelectionStatus, number>;
}

// Payment types
export type PaymentType = "milestone" | "progress" | "final" | "supplement" | "change_order";
export type PaymentStatus = "pending" | "invoiced" | "paid" | "overdue";

export interface JobPayment {
  id: string;
  company_id: string;
  job_id: string;
  payment_type: PaymentType;
  description: string;
  amount: number;
  status: PaymentStatus;
  due_date: string | null;
  paid_date: string | null;
  invoice_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentsSummary {
  total_contract: number;
  total_invoiced: number;
  total_paid: number;
  total_remaining: number;
  count_by_status: Record<PaymentStatus, number>;
}
```

### Tab Configuration by Job Type

The job detail page reconfigures tabs based on `job.job_type`. This extends the existing pattern from Spec 01B:

| Tab | Mitigation | Reconstruction | Fire/Smoke |
|-----|-----------|---------------|------------|
| Overview | Show | Show | Show |
| Site Log (Rooms + Moisture + Equipment) | Show | Hide | Hide |
| Photos | Show | Show | Show |
| Cleaning Log | Hide | Hide | **Show** |
| Recon Phases | Hide | Show | Hide |
| Selections | Hide | **Show** | Hide |
| Payments | Hide | **Show** | Hide |
| Scope (Spec 02A) | Show | Show (future) | Show (future) |
| Schedule (Spec 04A) | Show (future) | Show (future) | Show (future) |
| Report | Show | Show | Show |

**Brett's specified tab order per type:**
- **Mitigation:** Overview | Photos | Site Log | Scope | Schedule
- **Reconstruction:** Overview | Photos | Selections | Payments | Scope | Schedule
- **Fire/Smoke:** Overview | Photos | Cleaning Log | Scope | Schedule

### Phase 1: Fire/Smoke UI Components

#### Job Creation Form Updates

The job type selector (built in 01B) gains a third card:

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   Water Drop      │  │   Hammer          │  │   Flame           │
│  Mitigation       │  │  Reconstruction   │  │  Fire / Smoke     │
│  Water damage     │  │  Insurance repair  │  │  Fire damage,     │
│  restoration,     │  │  rebuild,          │  │  smoke/soot       │
│  drying,          │  │  restoration       │  │  cleaning          │
│  equipment        │  │                    │  │                    │
└──────────────────┘  └──────────────────┘  └──────────────────┘
 (blue border          (orange border         (red border
  when selected)        when selected)         when selected)
```

**Visual spec for Fire/Smoke card:**
- Selected: border-2 border-[#dc2626] bg-[#fef2f2]
- Icon: flame icon (Lucide `Flame`), 28px
- On mobile (375px): cards stack vertically (3 rows)

**Conditional fields when Fire/Smoke is selected:**
- Water Category and Water Class sections: hidden (same as reconstruction)
- No "Link to Mitigation Job" dropdown (fire/smoke jobs are standalone)
- `loss_type` auto-selects `"fire"` (user can change)

#### Job List Badge

```
FIRE — bg-[#fef2f2] text-[#dc2626] border border-[#fecaca]
```

Same pattern as MIT (blue) and REC (orange) badges.

#### Cleaning Log Tab

Component: `web/src/app/(protected)/jobs/[id]/cleaning-log/page.tsx`

```
┌─────────────────────────────────────────────────────────────┐
│ Cleaning Log                          + Add Entry            │
│                                                              │
│ ┌─ Living Room ──────────────────────────────────────────┐  │
│ │ Soot: Protein    Method: Dry Sponge                     │  │
│ │ Surfaces: Walls, Ceiling, HVAC                          │  │
│ │ Status: ● In Progress                                   │  │
│ │ Notes: Heavy soot on north wall, 2 passes needed        │  │
│ │ Cleaned by: Mike T. · Started Apr 10                    │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ ┌─ Kitchen ──────────────────────────────────────────────┐  │
│ │ Soot: Mixed    Method: Wet Clean                        │  │
│ │ Surfaces: Walls, Ceiling, Floor, Contents               │  │
│ │ Status: ● Complete                                      │  │
│ │ Cleaned by: Sarah K. · Completed Apr 9                  │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ ┌─ Master Bedroom ───────────────────────────────────────┐  │
│ │ Soot: —    Method: —                                    │  │
│ │ Surfaces: —                                             │  │
│ │ Status: ○ Pending                                       │  │
│ └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Visual spec:**
- Each card: border border-[#eae6e1] rounded-xl p-4
- Room name: text-[15px] font-semibold text-[#1a1a1a]
- Labels: text-[12px] text-[#8a847e]
- Values: text-[14px] text-[#1a1a1a]
- Status badge colors:
  - Pending: bg-[#f5f5f4] text-[#8a847e] (hollow circle)
  - In Progress: bg-[#eff6ff] text-[#3b82f6] (filled blue circle)
  - Complete: bg-[#ecfdf5] text-[#2a9d5c] (green checkmark)
- Tap on a card: expands to edit mode with dropdowns for soot type, method, surface checkboxes, notes textarea
- "+ Add Entry" button: opens a form with room selector dropdown (optional), soot type, method, surfaces, notes

**Mobile:**
- Cards stack full-width
- Edit mode uses bottom sheet instead of inline expansion
- Surface checkboxes use a multi-select chip pattern (tappable pills)

### Phase 2: Selections Tab

Component: `web/src/app/(protected)/jobs/[id]/selections/page.tsx`

```
┌─────────────────────────────────────────────────────────────┐
│ Selections                             + Add Selection       │
│                                                              │
│ ┌─ Summary ──────────────────────────────────────────────┐  │
│ │  Allowance        Actual          Overage               │  │
│ │  $24,500.00       $27,200.00      $2,700.00            │  │
│ │                                   ▲ Homeowner           │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ ── Flooring ─────────────────────────────────────────────   │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Master Bath Floor Tile                    SELECTED      │  │
│ │ Carrara Marble 12x24                                    │  │
│ │ Allowance: $3,500   Actual: $4,200   Overage: $700     │  │
│ └────────────────────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Living Room Hardwood                      ORDERED       │  │
│ │ Red Oak 3/4" x 5"                                      │  │
│ │ Allowance: $8,000   Actual: $8,000   Overage: $0       │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ ── Paint ────────────────────────────────────────────────   │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Interior Walls (whole house)              PENDING        │  │
│ │ —                                                       │  │
│ │ Allowance: $4,500   Actual: —            Overage: —     │  │
│ └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Visual spec:**
- Summary card: bg-[#faf9f7] border border-[#eae6e1] rounded-xl p-4, always visible at top
  - Total Allowance: text-[20px] font-semibold text-[#1a1a1a]
  - Total Actual: text-[20px] font-semibold text-[#1a1a1a]
  - Total Overage: text-[20px] font-semibold text-[#dc2626] (red when > 0)
  - "Homeowner" label under overage in text-[11px] text-[#8a847e]
- Category headers: text-[13px] font-semibold text-[#8a847e] uppercase tracking-wide
- Selection cards: border border-[#eae6e1] rounded-lg p-3
  - Item name: text-[15px] font-semibold text-[#1a1a1a]
  - Selected option: text-[14px] text-[#6b6560]
  - Financial row: text-[13px], overage in text-[#dc2626] when > 0
  - Status badge (same pill pattern as job status):
    - Pending: bg-[#f5f5f4] text-[#8a847e]
    - Selected: bg-[#eff6ff] text-[#3b82f6]
    - Ordered: bg-[#fff3ed] text-[#e85d26]
    - Installed: bg-[#ecfdf5] text-[#2a9d5c]
- Tap to edit: inline expansion with form fields
- "+ Add Selection" opens form with category dropdown, item name, selected option, allowance, actual cost, notes

### Phase 3: Payments Tab

Component: `web/src/app/(protected)/jobs/[id]/payments/page.tsx`

```
┌─────────────────────────────────────────────────────────────┐
│ Payments                               + Add Payment         │
│                                                              │
│ ┌─ Summary ──────────────────────────────────────────────┐  │
│ │  Contract        Invoiced        Paid        Remaining  │  │
│ │  $45,000.00      $31,500.00      $22,500.00  $22,500   │  │
│ │                                                         │  │
│ │  ━━━━━━━━━━━━━━━━━━━━━━░░░░░░░░░  50% collected       │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Milestone: Demo Complete - 30%              PAID        │  │
│ │ $13,500.00                                              │  │
│ │ Invoice #1042 · Due Mar 20 · Paid Mar 22               │  │
│ └────────────────────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Milestone: Drywall Complete - 25%           INVOICED    │  │
│ │ $11,250.00                                              │  │
│ │ Invoice #1056 · Due Apr 5                               │  │
│ └────────────────────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Milestone: Flooring Complete - 25%          PENDING     │  │
│ │ $11,250.00                                              │  │
│ │ Due Apr 20                                              │  │
│ └────────────────────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Final: Completion & Walkthrough - 20%       PENDING     │  │
│ │ $9,000.00                                               │  │
│ │ Due May 1                                               │  │
│ └────────────────────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Supplement: HVAC Scope Addition              OVERDUE    │  │
│ │ $2,250.00                                               │  │
│ │ Invoice #1060 · Due Mar 30 · OVERDUE 15 days           │  │
│ └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Visual spec:**
- Summary card: bg-[#faf9f7] border border-[#eae6e1] rounded-xl p-4
  - Four columns: Contract, Invoiced, Paid, Remaining
  - Each: text-[20px] font-semibold text-[#1a1a1a]
  - Remaining: text-[#dc2626] when > 0
  - Progress bar: 4px height, bg-[#eae6e1], fill bg-[#2a9d5c]
  - Percentage: text-[13px] text-[#8a847e]
- Payment cards: border border-[#eae6e1] rounded-lg p-3
  - Type + description: text-[15px] font-semibold text-[#1a1a1a]
  - Amount: text-[16px] font-semibold text-[#1a1a1a]
  - Invoice/date row: text-[13px] text-[#8a847e]
  - Status badges:
    - Pending: bg-[#f5f5f4] text-[#8a847e]
    - Invoiced: bg-[#eff6ff] text-[#3b82f6]
    - Paid: bg-[#ecfdf5] text-[#2a9d5c]
    - Overdue: bg-[#fef2f2] text-[#dc2626]
  - Overdue: days overdue shown in red text-[12px] text-[#dc2626]
- Quick actions on each card: "Mark Invoiced" / "Mark Paid" buttons (contextual based on current status)
- Tap to edit: inline expansion with all fields

**Mobile:**
- Summary card collapses to 2x2 grid
- Payment cards stack full-width
- Quick action buttons become a bottom sheet on tap

---

## Interaction States

| Feature | Loading | Empty | Error | Success |
|---------|---------|-------|-------|---------|
| Fire/Smoke type selector | N/A | N/A | N/A | Red border + bg tint |
| Cleaning log list | 3 skeleton cards | "No cleaning logs yet. Add your first room cleaning entry." | "Failed to load" + retry | Cards render |
| Cleaning log create/update | Spinner on save button | N/A | Toast "Save failed" + retry | Toast "Saved" + card updates |
| Cleaning log status change | Optimistic update | N/A | Toast "Update failed" + revert | Badge color change, cleaned_at auto-set |
| Selections list | 3 skeleton cards | "No selections yet. Track material choices and insurance allowances." | "Failed to load" + retry | Grouped cards render |
| Selections summary | Skeleton numbers | All $0.00 | "Failed to load" + retry | Summary populates |
| Selection create/update | Spinner on save | N/A | Toast "Save failed" | Toast "Saved" + overage recalculates |
| Payments list | 3 skeleton cards | "No payments yet. Set up your milestone payment schedule." | "Failed to load" + retry | Cards render with progress bar |
| Payments summary | Skeleton numbers | All $0.00 | "Failed to load" + retry | Summary + progress bar |
| Payment status change | Optimistic update | N/A | Toast "Update failed" + revert | Badge change, paid_date auto-set |
| Dashboard FIRE pipeline | Skeleton boxes | All "0" | "Failed to load" + retry | Counts populate |

**Empty state for cleaning log (new fire/smoke job):**
- Subtle dashed border container
- Flame icon (32px, #b5b0aa)
- "No cleaning logs yet" — text-[16px] font-semibold text-[#1a1a1a]
- "Track room-by-room cleaning progress — soot type, method, and surfaces." — text-[14px] text-[#8a847e]
- Primary button: "Add Cleaning Entry"

**Empty state for selections (new reconstruction job):**
- Subtle dashed border container
- Grid icon (32px, #b5b0aa)
- "No selections yet" — text-[16px] font-semibold text-[#1a1a1a]
- "Track material choices, finish selections, and insurance allowances vs actual costs." — text-[14px] text-[#8a847e]
- Primary button: "Add Selection"

**Empty state for payments (new reconstruction job):**
- Subtle dashed border container
- Dollar icon (32px, #b5b0aa)
- "No payments yet" — text-[16px] font-semibold text-[#1a1a1a]
- "Set up milestone payments to track invoicing and collections." — text-[14px] text-[#8a847e]
- Primary button: "Add Payment"

---

## Phases & Checklist

### Phase 1: Fire/Smoke Job Type + Cleaning Log
**Backend:**
- [ ] Alembic migration: expand `job_type` CHECK constraint to include `fire_smoke`
- [ ] Alembic migration: update `status` CHECK constraint (fire/smoke reuses `contracted` + `in_progress`)
- [ ] Update backend `VALID_STATUSES` mapping: add fire_smoke pipeline
- [ ] Update status transition validation to enforce fire/smoke pipeline
- [ ] Update `api/jobs/schemas.py` — accept `fire_smoke` as valid job_type
- [ ] Update `api/jobs/service.py` — fire/smoke status validation
- [ ] Alembic migration: create `cleaning_logs` table with indexes + RLS
- [ ] Alembic migration: add `cleaning_log_created`, `cleaning_log_updated` event types
- [ ] Create `api/cleaning_logs/__init__.py`
- [ ] Create `api/cleaning_logs/schemas.py` — Pydantic models (CleaningLogCreate, Update, Response)
- [ ] Create `api/cleaning_logs/service.py` — CRUD with job type validation + auto-set cleaned_at
- [ ] Create `api/cleaning_logs/router.py` — route handlers mounted at `/v1/jobs/{job_id}/cleaning-logs`
- [ ] Register cleaning_logs router in `api/main.py`
- [ ] Update dashboard endpoint — add fire_smoke pipeline counts (if dashboard exists)
- [ ] pytest: create fire_smoke job
- [ ] pytest: fire_smoke status transitions (valid pipeline)
- [ ] pytest: reject invalid status on fire_smoke job (e.g., `drying`, `scoping`)
- [ ] pytest: cleaning log CRUD on fire_smoke job
- [ ] pytest: reject cleaning log on mitigation job (400)
- [ ] pytest: reject cleaning log on reconstruction job (400)
- [ ] pytest: cleaning log room_id validation (must belong to same job)
- [ ] pytest: cleaning log soot_type validation
- [ ] pytest: cleaning log cleaning_method validation
- [ ] pytest: cleaning log surfaces_cleaned validation
- [ ] pytest: cleaning log status → complete auto-sets cleaned_at
- [ ] pytest: fire_smoke job creation defaults loss_type to fire (if frontend sends it)
- [ ] pytest: job_type filter includes fire_smoke (`GET /v1/jobs?job_type=fire_smoke`)

**Frontend:**
- [ ] Update `lib/types.ts` — add `fire_smoke` to JobType, add CleaningLog types
- [ ] Update job type selector — add third card (Flame icon, red border)
- [ ] Update job creation form — hide Water Category/Class for fire_smoke
- [ ] Update job creation form — pre-select `loss_type: "fire"` for fire_smoke
- [ ] Update job list — add FIRE badge (red)
- [ ] Update job detail — tab reconfiguration for fire_smoke (Overview | Photos | Cleaning Log | Scope | Schedule)
- [ ] Create `web/src/app/(protected)/jobs/[id]/cleaning-log/page.tsx` — Cleaning Log tab
- [ ] Create `web/src/lib/hooks/use-cleaning-logs.ts` — TanStack Query hooks (list, create, update, delete)
- [ ] Cleaning log: room-grouped card layout with soot type, method, surfaces, status
- [ ] Cleaning log: add/edit form with dropdowns and multi-select surface chips
- [ ] Cleaning log: status change with optimistic update
- [ ] Cleaning log: empty state
- [ ] Mobile: cleaning log cards full-width, edit via bottom sheet
- [ ] Fire/smoke dashboard pipeline (if dashboard pipeline exists)
- [ ] Update status badge colors/labels for fire/smoke statuses

### Phase 2: Reconstruction Selections Tab
**Backend:**
- [ ] Alembic migration: create `job_selections` table with indexes + RLS
- [ ] Alembic migration: add `selection_created`, `selection_updated` event types
- [ ] Create `api/selections/__init__.py`
- [ ] Create `api/selections/schemas.py` — Pydantic models (SelectionCreate, Update, Response, Summary)
- [ ] Create `api/selections/service.py` — CRUD + summary computation + job type validation
- [ ] Create `api/selections/router.py` — route handlers at `/v1/jobs/{job_id}/selections`
- [ ] Register selections router in `api/main.py`
- [ ] pytest: selection CRUD on reconstruction job
- [ ] pytest: reject selection on mitigation job (400)
- [ ] pytest: reject selection on fire_smoke job (400)
- [ ] pytest: selection category validation
- [ ] pytest: selection status validation
- [ ] pytest: overage computed correctly (actual > allowance)
- [ ] pytest: overage is zero when actual <= allowance
- [ ] pytest: overage handles null allowance and null actual
- [ ] pytest: selections summary totals
- [ ] pytest: selections summary count_by_status

**Frontend:**
- [ ] Add SelectionCategory, SelectionStatus, JobSelection, SelectionsSummary types to `lib/types.ts`
- [ ] Create `web/src/lib/hooks/use-selections.ts` — TanStack Query hooks (list, summary, create, update, delete)
- [ ] Add Selections tab to reconstruction job detail tab set
- [ ] Create `web/src/app/(protected)/jobs/[id]/selections/page.tsx` — Selections tab
- [ ] Selections: summary card at top (allowance, actual, overage)
- [ ] Selections: cards grouped by category
- [ ] Selections: status badges (pending, selected, ordered, installed)
- [ ] Selections: overage highlight in red when > 0
- [ ] Selections: add/edit form with category dropdown, item name, option, financials
- [ ] Selections: empty state
- [ ] Mobile: summary card 2-column layout, selection cards full-width

### Phase 3: Reconstruction Payments Tab
**Backend:**
- [ ] Alembic migration: create `job_payments` table with indexes + RLS
- [ ] Alembic migration: add `payment_created`, `payment_updated`, `payment_status_changed` event types
- [ ] Create `api/payments/__init__.py`
- [ ] Create `api/payments/schemas.py` — Pydantic models (PaymentCreate, Update, Response, Summary)
- [ ] Create `api/payments/service.py` — CRUD + summary computation + job type validation + auto-set paid_date
- [ ] Create `api/payments/router.py` — route handlers at `/v1/jobs/{job_id}/payments`
- [ ] Register payments router in `api/main.py`
- [ ] pytest: payment CRUD on reconstruction job
- [ ] pytest: reject payment on mitigation job (400)
- [ ] pytest: reject payment on fire_smoke job (400)
- [ ] pytest: payment_type validation
- [ ] pytest: payment status validation
- [ ] pytest: amount must be > 0
- [ ] pytest: status → paid auto-sets paid_date
- [ ] pytest: status from paid → pending clears paid_date
- [ ] pytest: payments summary totals (contract, invoiced, paid, remaining)
- [ ] pytest: payments summary count_by_status
- [ ] pytest: payment event logging (payment_status_changed)

**Frontend:**
- [ ] Add PaymentType, PaymentStatus, JobPayment, PaymentsSummary types to `lib/types.ts`
- [ ] Create `web/src/lib/hooks/use-payments.ts` — TanStack Query hooks (list, summary, create, update, delete)
- [ ] Add Payments tab to reconstruction job detail tab set
- [ ] Create `web/src/app/(protected)/jobs/[id]/payments/page.tsx` — Payments tab
- [ ] Payments: summary card with contract/invoiced/paid/remaining + progress bar
- [ ] Payments: card list ordered by due_date
- [ ] Payments: status badges (pending, invoiced, paid, overdue)
- [ ] Payments: overdue days calculation and red highlight
- [ ] Payments: quick action buttons (Mark Invoiced / Mark Paid)
- [ ] Payments: add/edit form
- [ ] Payments: empty state
- [ ] Mobile: summary card 2x2 grid, payment cards full-width, quick actions via bottom sheet

### Phase 4: Testing + Polish
- [ ] End-to-end: create fire_smoke job, add rooms, add cleaning logs, change statuses, generate report
- [ ] End-to-end: create reconstruction job, add selections with overages, verify summary math
- [ ] End-to-end: create reconstruction job, add milestone payments, mark invoiced/paid, verify summary
- [ ] Cross-browser: cleaning log card interactions on desktop + mobile
- [ ] Cross-browser: selection/payment edit forms on desktop + mobile
- [ ] Verify zero regression on all existing mitigation flows
- [ ] Verify zero regression on all existing reconstruction flows (phases, linked jobs)
- [ ] Update API reference docs

---

## Technical Approach

**Pattern reuse:** All three features follow the established CRUD pattern from Spec 01 (photos, moisture readings) and Spec 01B (recon phases): Pydantic schemas, service layer with Supabase client, FastAPI router, TanStack Query hooks on frontend. No new patterns introduced.

**Job type validation:** Each new feature (cleaning logs, selections, payments) validates that the parent job is the correct type. This is a service-layer check, not a database constraint — the DB has no cross-table CHECK constraints. The pattern is:
```python
job = await get_job(job_id, company_id)
if job["job_type"] != "fire_smoke":
    raise HTTPException(400, "Cleaning logs are only available for fire/smoke jobs")
```

**Computed overage:** The `overage` column on `job_selections` is a PostgreSQL GENERATED ALWAYS AS STORED column. It auto-computes on insert/update. The frontend never sends overage — it reads it from the response.

**Summary endpoints:** Selections and Payments each have a `/summary` endpoint that computes totals server-side. This avoids client-side aggregation bugs and ensures the summary is always consistent with the data. The summary is a simple `SELECT SUM(...) ... GROUP BY status` query.

**Event logging:** All create/update operations log events to the existing `job_events` table (Spec 01). Payment status changes get a distinct `payment_status_changed` event type for timeline visibility.

**Dashboard pipeline:** Fire/smoke jobs appear in their own pipeline row on the dashboard (same pattern as mitigation and reconstruction pipelines from 01B). Uses the fire/smoke status values: new, contracted, in_progress, complete, submitted, collected.

**Key files (new):**
- `backend/api/cleaning_logs/` — cleaning log CRUD (router, service, schemas)
- `backend/api/selections/` — selections CRUD (router, service, schemas)
- `backend/api/payments/` — payments CRUD (router, service, schemas)
- `web/src/app/(protected)/jobs/[id]/cleaning-log/` — Cleaning Log tab
- `web/src/app/(protected)/jobs/[id]/selections/` — Selections tab
- `web/src/app/(protected)/jobs/[id]/payments/` — Payments tab
- `web/src/lib/hooks/use-cleaning-logs.ts` — cleaning log hooks
- `web/src/lib/hooks/use-selections.ts` — selections hooks
- `web/src/lib/hooks/use-payments.ts` — payments hooks

**Key files (modified):**
- `backend/api/jobs/schemas.py` — accept `fire_smoke` job_type
- `backend/api/jobs/service.py` — fire/smoke status validation
- `backend/api/main.py` — register new routers
- `web/src/lib/types.ts` — new types
- `web/src/app/(protected)/jobs/[id]/page.tsx` — tab reconfiguration for fire_smoke
- `web/src/app/(protected)/jobs/new/page.tsx` — third job type card
- `web/src/app/(protected)/jobs/page.tsx` — FIRE badge in job list

---

## Quick Resume

```bash
# Resume working on this spec:
cd /Users/lakshman/Workspaces/Crewmatic
# Continue at: Phase 1, Fire/Smoke Job Type + Cleaning Log
# Prerequisite: Spec 01B (reconstruction) must be complete (it is)
# Source doc: docs/research/layout-summary-v2.pdf
```

---

## Session Log

| # | Date | Start | End | Duration | What was done | Phases |
|---|------|-------|-----|----------|--------------|--------|

## Decisions & Notes

- **Fire/Smoke pipeline reuses existing statuses.** No new status values are needed — fire/smoke uses `new → contracted → in_progress → complete → submitted → collected`, which are all already in the CHECK constraint from 01B. This keeps the status system simple.
- **Cleaning logs are fire/smoke-only.** While theoretically any job could have cleaning, Brett's layout doc explicitly assigns the Cleaning Log tab to fire/smoke jobs only. Mitigation has moisture readings; reconstruction has phases. Each job type has its own domain-specific tracking.
- **Selections are reconstruction-only.** Material selections and insurance allowances only apply to reconstruction (insurance repair). Mitigation doesn't have material selections. Fire/smoke cleaning doesn't involve finish choices.
- **Payments are reconstruction-only for V1.** Milestone-based payment schedules are a reconstruction pattern (30% demo, 25% drywall, 25% flooring, 20% final). Mitigation invoicing is simpler (one invoice after job complete). If needed later, payments can be opened to other job types by removing the service-layer validation.
- **Overage is a STORED generated column.** PostgreSQL computes it automatically. No application logic needed. The `GREATEST(..., 0)` ensures overage is never negative (if actual < allowance, overage = 0 — the savings are the contractor's problem, not the homeowner's).
- **Summary endpoints are server-side.** We could compute summaries on the frontend from the list data, but server-side summaries are more reliable and avoid floating-point aggregation issues with JavaScript. The summary query is trivial for PostgreSQL.
- **No Scope or Schedule tabs in this spec.** Brett's tab sets reference Scope and Schedule for every job type, but those are implemented in other specs (02A and 04A). This spec only adds the tabs that are NEW and not covered elsewhere.
- **Property-level sketch ownership noted but not implemented.** Brett's vision is that the floor plan sketch belongs to the property (not the job), so a reconstruction job inherits the sketch from its linked mitigation job. This requires a data model migration (move floor_plans FK from job to property). Tracked for 01C or a future migration — not this spec.
