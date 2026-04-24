# Phase 3 (Revised): Equipment Pins — Attributed to Moisture Pins

**Status:** Draft proposal — amendment to `01H-floor-plan-v2.md` Phase 3
**Author:** Samhith
**Date:** 2026-04-23
**Review bar:** Must pass the gate defined in `docs/pr-review-lessons.md` (invariants brief + sibling-site grep + pinned tests). Brief included in §9 of this doc.

---

## 0. Reviewer amendments (2026-04-23, Lakshman)

**Updated 2026-04-23 (codex review):** 8 additional fixes applied after `/codex review`. Fixes C1-C5 are P1 blockers (schema references, tenant hardening); C6-C8 are P2. See §0.5 for the fix list.

Amendments applied after a full sweep of `docs/research/*` + cross-spec checks (Phase 1 schema, Phase 2 moisture model, `10-reports.md` report pipeline, `restoros-consumer-workflows-v1.md`). Organized by severity. Section §0.1 lists each change; §0.2 lists Phase 2 schema deltas this forces; §0.3 lists what's explicitly out-of-scope + deferred; §0.5 lists the codex-review fixes.

### 0.1 Amendments

**BLOCKERS (must land in this spec before implementation starts):**

| # | Amendment | Why | Where |
|---|---|---|---|
| B1 | `moisture_pin_readings.reading_date DATE` → `taken_at TIMESTAMPTZ NOT NULL DEFAULT now()`; drop per-day unique index `UNIQUE(pin_id, reading_date)` | Proposal A4 references `reading.taken_at` but the column doesn't exist in Phase 2 schema (`01H-floor-plan-v2.md:622,629`). Brett's workflow also takes multiple readings per pin per day when post-demo reveals wetter material (`competitive-analysis.md:1333,1465`) — unique index rejects the 2nd save. | §0.2 (Phase 2 delta) |
| B2 | Add `jobs.timezone TEXT NOT NULL DEFAULT 'America/New_York'` + populate from property zip at job-create | §8.1 computes billable days in `jobs.timezone` but no migration adds this column. Silent UTC fallback overbills PT/MT/CT jobs by up to a day per span boundary. | §0.2 + spec 01F dependency |
| B3 | Multiple readings per pin per day allowed | Same source as B1. Phase 2 must render N readings per day ordered by `taken_at`; sparkline shows the latest; PDF export lists all. | §0.2 |

**SHOULD-FIX (land now or immediately after Phase 3 ships):**

| # | Amendment | Why | Where |
|---|---|---|---|
| A1 | `equipment_size` column (`std`, `large`, `xl`, `xxl`, NULL) | Xactimate has 4 dehu codes (WTRDHM, WTRDHM>, WTRDHM>>, WTRDHM>>>) + 2 air-mover variants. TPAs explicitly downgrade size in review (`tpa-carrier-guidelines.md:31`). Single `equipment_type` can't map to the right line-item code. | §2.1, §3.1, §3.3, §8.3, §10 |
| A2 (C1) | Harden existing `equipment_placements.floor_plan_id` FK: change `ON DELETE SET NULL` → `ON DELETE RESTRICT`, stamp from `jobs.floor_plan_id` at create, declare immutable. Uses merged `floor_plans` table (Phase 1 migration `e1a7c9b30201` removed `floor_plan_versions`). | Phase 1 pins jobs to a version. Equipment is positional; without immutable stamping, a later plan edit ghost-moves equipment on prior day reports. | §3.1, §3.3, §10 |
| A3 | Move `billable_days` computation to backend (`compute_placement_billable_days` Postgres function + thin `GET /billable-days` wrapper) | Authoritative money math must not live in `web/src/lib/dates.ts`. | §8.1, §10 |
| A4 | Auto-close on `dry_standard_met_at` with 24h undo (no manual tech confirm) | Manual confirm step will silently skip → overbilling. | §6.3, §10 |
| S1 | Daily-reading validator — flag billable-days where an active assignment has no reading on any attributed pin that day | Directly addresses the TPA rule `tpa-carrier-guidelines.md:41` ("Daily moisture readings required to justify each equipment day") and rejection trigger #2 (`:47`). Without this, Phase 3's "carrier defensibility" claim is unenforced. | §8.4 (new), §10 |
| S2 | Equipment move-between-rooms — explicit `move_equipment_placement` RPC (closes pin assignments, updates `room_id` + canvas, reopens new assignments atomically) | Workflow spec (`restoros-consumer-workflows-v1.md:830`) lists this as a core tech action. `room_id` is currently locked as physical-location metadata with no move path. | §6.6 (new), §10 |
| S3 (C1) | `floor_plan_id` FK on `moisture_pins` referencing merged `floor_plans` table (mirror A2) | PDF with `?date=YYYY-MM-DD` ghost-moves pins otherwise. Consistent with A2's premise. | §0.2 (Phase 2 delta) |
| S4 | Wire `meter_photo_url` end-to-end (reading camera flow, sparkline thumbnail, PDF inclusion, "no photo" warning badge) | Brett: *"I take pictures of my moisture readings"* (`competitive-analysis.md:1465`). TPA rejects readings without photo evidence (`:49`). Column exists but unused. | §0.2 + §8.4 |
| S5 (C2, C3) | Dry-standard state transition explicit — Postgres trigger on `moisture_pin_readings` insert sets/clears `moisture_pins.dry_standard_met_at` (column **added** by C2), reads threshold from `moisture_pins.dry_standard` per-pin override (C3), guards against out-of-order inserts | A4 auto-closes on this timestamp, but the trigger that sets/clears it is unspecified. Re-wet detection (§6.4) has no defined signal otherwise. | §0.2 #4-#5, §6.3, §6.4 |
| S6 | `asset_tag TEXT` + `serial_number TEXT` optional columns on `equipment_placements` | Larger tenants (>Brett's 1-man shop) track inventory this way (`competitive-analysis.md:1412`). Hook to future equipment-library table. | §3.1, §10 |
| S7 | Unify billing math — per-room equipment also uses distinct local calendar days in `jobs.timezone` (not `ceil(24h buckets)`) | Same job emitting inconsistent day counts across equipment types is a carrier rejection flag. | §8.2 (rewrite) |

**NICE-TO-HAVE (deferred — noted here so they don't fall off):**

| # | Deferred | Future owner |
|---|---|---|
| A5 | WTREQ (equipment monitoring labor, per `xactimate-codes-water.md:88`) | Separate spec (to create) |
| N1 | Equipment-sizing suggestion engine (S500 calc from room dims) — Brett's explicit competitive-moat ask (`competitive-analysis.md:1425`) | Phase 3.5 or follow-up spec |
| N2 | Orange-flagged placements with zero billable days — exclusion/appendix path in carrier report | Spec `10-reports.md` dependency line |
| N3 | Atmospheric + dehu-output readings interplay with pin readings — explicit statement that existing `moisture_readings` table continues serving atmospheric/dehu path; PDF bundles both | Phase 2 documentation-only delta |

### 0.2 Phase 2 schema deltas this spec forces

Phase 2 (moisture pins + readings) is the prerequisite this proposal builds on. These deltas land *before* Phase 3 implementation, not inside it:

1. **`moisture_pin_readings`:** replace `reading_date DATE` with `taken_at TIMESTAMPTZ NOT NULL DEFAULT now()`; drop `UNIQUE(pin_id, reading_date)`. (B1, B3)
2. **`jobs.timezone`:** add `TEXT NOT NULL DEFAULT 'America/New_York'`, populate from property zip on job-create (resolver in spec 01F or a new utility). (B2)
3. **`moisture_pins.floor_plan_id`:** add `UUID REFERENCES floor_plans(id) ON DELETE RESTRICT`, stamped at pin-create from `jobs.floor_plan_id`, re-stamped on pin-move with an audit row. **C1:** uses `floor_plans` (the merged table from Phase 1 migration `e1a7c9b30201_spec01h_merge_floor_plans_versions.py`), not the removed `floor_plan_versions`. (S3)
4. **`moisture_pins.dry_standard_met_at`:** add `TIMESTAMPTZ` column (nullable — NULL means "still drying"). **C2:** was referenced by A4/S5 but never added to schema. Column only exists after this migration lands. (S5, C2)
5. **Dry-standard trigger:** Postgres trigger `trg_moisture_pin_dry_check` on `moisture_pin_readings` insert — reads `moisture_pins.dry_standard` (the **per-pin overridable** threshold, `01H-floor-plan-v2.md:601`), sets `moisture_pins.dry_standard_met_at = NEW.taken_at` when `NEW.reading_value <= dry_standard`, clears it when `NEW.reading_value > dry_standard`. **C3:** reads from `moisture_pins.dry_standard` (per-pin override), NOT material-type defaults — otherwise pins with carrier-accepted override thresholds would auto-close at the wrong reading. Trigger also guards against out-of-order inserts: only applies if `NEW.taken_at > (SELECT MAX(taken_at) FROM moisture_pin_readings WHERE pin_id = NEW.pin_id AND id != NEW.id)`. (S5)
6. **`meter_photo_url` wiring:** Phase 2 UX must capture on reading entry; Phase 2 PDF export must render thumbnail; Phase 3 appendix cross-links this. (S4)

### 0.5 Codex review fixes (2026-04-23)

After `/codex review` ran against PR #13, eight additional issues were surfaced. All applied:

| # | Severity | Fix | Root cause | Applied |
|---|---|---|---|---|
| C1 | P1 | `floor_plan_versions(id)` → `floor_plans(id)`; `jobs.floor_plan_version_id` → `jobs.floor_plan_id` | Phase 1 migration `e1a7c9b30201_spec01h_merge_floor_plans_versions.py` merged the two tables — `floor_plans` now IS the versioned table, `jobs.floor_plan_id` pins a specific historical row. Original A2/S3 referenced objects that don't exist. | §0.2 #3, §3.1, §3.3 |
| C2 | P1 | Add `moisture_pins.dry_standard_met_at TIMESTAMPTZ` column explicitly in Phase 2 delta | Trigger + A4 auto-close depended on this column, but it was never added to the schema. | §0.2 #4 (new item), §6.3 |
| C3 | P1 | Trigger reads `moisture_pins.dry_standard` (per-pin override), not material-type defaults | Phase 2 schema (`01H-floor-plan-v2.md:601`) stores an overridable threshold per pin. Reading material defaults would auto-close at wrong readings when overrides exist. | §0.2 #5, §6.3 |
| C4 | P1 | `move_equipment_placement` RPC scoped to caller's tenant (`WHERE id = p_placement_id AND company_id = get_my_company_id()`) | SECURITY DEFINER bypasses RLS. Without JWT-derived tenant filter, any authenticated user with a placement UUID could move another company's equipment. Phase 1's `c7f8a9b0d1e2_spec01h_rpc_tenant_hardening.py` explicitly closed this pattern — I reintroduced it. | §6.6 RPC |
| C5 | P1 | `compute_placement_billable_days` + `validate_placement_billable_days` scoped to caller's tenant | Same cross-tenant read leak as C4 for read paths. | §8.1, §8.4 |
| C6 | P2 | `CHECK chk_equipment_size_valid` enforces per-type valid sizes (`axial` only for air_mover; `large`/`xl`/`xxl` only for dehumidifier) | Original CHECK only enforced non-null. Allowed impossible combos like `dehumidifier + axial` that would break Xactimate code mapping. | §3.1 |
| C7 | P2 | `place_equipment_with_pins` validates `array_length(p_asset_tags) IN (NULL, p_quantity)` and same for `p_serial_numbers` | Arrays were silently sliced/padded with NULLs by `generate_series` — inventory metadata could misalign with physical units. | §3.3 RPC |
| C8 | P2 | `validate_pins_for_assignment` rejects pins with `dry_standard_met_at IS NOT NULL` (new SQLSTATE `22P02` for "dry pin") | Previously only checked job/archive/tenant. Tech could re-assign equipment to a dry pin, which would silently bill until the next wet reading. | §3.3 RPC |

### 0.3 Explicitly out-of-scope (with deferral notes)

- WTREQ monitoring labor (A5) — new spec
- AI moisture-meter OCR (Brett `:1473`) — noted in S4, OCR deferred
- Equipment-sizing suggestions (N1) — Phase 3.5 spec
- Carrier-report exclusion path for orange-flagged placements (N2) — dependency on `10-reports.md`
- Atmospheric/GPP/dehu-output documentation-only clarification (N3) — Phase 2 doc delta

### 0.4 Open questions — resolved

1. **Cross-room attribution:** yes, per-pin equipment can serve pins across rooms (open floor plans, hallway dehus).
2. **Empty-pin placement:** warn (canvas orange state) — do not block. Zero billable days until attached.
3. **Reassignment back-dating:** from-now only + add `note TEXT` column on `equipment_pin_assignments` for after-the-fact explanation.

---

## 1. Motivation

Current Phase 3 bills per equipment unit as `pulled_at - placed_at`. This overcharges when equipment sits idle in a room whose pins have already hit dry standard, and gives carriers no audit trail for "why did you run 3 dehus for 8 days?" Carriers increasingly reject equipment days not justified by a moisture-pin drying timeline (see `docs/research/tpa-carrier-guidelines.md`).

Brett's V2 principle — "every feature anchors to the floor plan" — extends naturally: drying equipment should anchor to **the moisture pins it was drying**. Non-drying equipment (air scrubbers, hydroxyl generators, heaters) stays room-anchored because it treats the atmosphere, not specific material pins.

## 2. Model

### 2.1 Billing scope + size per equipment type

| Equipment type | Billing scope | Attribution | Billing basis (unified per S7) | Valid sizes (A1) | Xactimate code |
|---|---|---|---|---|---|
| Air mover | `per_pin` | Moisture pins it dries | Distinct local calendar days touched by any assignment span (in `jobs.timezone`) | `std`, `axial` | WTRDRY, WTRDRY+ |
| Dehumidifier | `per_pin` | Moisture pins it dries | Distinct local calendar days touched by any assignment span | `std` (64-65pt), `large` (70-100pt), `xl` (124-145pt), `xxl` (161-170pt) | WTRDHM, WTRDHM>, WTRDHM>>, WTRDHM>>> |
| Air scrubber | `per_room` | Room it treats | Distinct local calendar days between `placed_at` and `pulled_at` (or now) | NULL | WTRNAFAN |
| Hydroxyl generator | `per_room` | Room it treats | Distinct local calendar days between `placed_at` and `pulled_at` | NULL | (no WTR code — carrier-specific) |
| Heater | `per_room` | Room it treats | Distinct local calendar days between `placed_at` and `pulled_at` | NULL | (no WTR code — carrier-specific) |

Only per-pin equipment uses the `equipment_pin_assignments` junction. Per-room equipment uses one synthetic "span" = `(placed_at, pulled_at ?? now())` for day-counting consistency (S7). **Size is required for dehumidifiers and air movers; NULL for other types** — enforced by CHECK constraint in §3.1.

### 2.2 Billing principle (per-pin equipment)

Equipment is **billed once per physical unit**, regardless of how many pins it serves simultaneously. Pin-assignments only determine **whether the day is billable**, not how many times it's billed.

- Dehu A serves pin 1 + pin 2 simultaneously for 3 days → **3 billable days for Dehu A**, not 6.
- Dehu A serves pin 1 only for 3 days, then pin 2 only for 2 days → **5 billable days** (assuming no overlap).
- Dehu A on-site for 6 days but only assigned to a pin for 3 days → **3 billable days** (3 idle days not billed).

### 2.3 Model characteristics

- A moisture pin can be served by **0..N** per-pin equipment units at any time.
- A per-pin equipment unit can serve **0..N** moisture pins at any time.
- Assignments are **time-sliced**: pin↔equipment relationships have their own `assigned_at` / `unassigned_at` independent of the equipment's `placed_at` / `pulled_at`.
- Re-wetting after dry-standard creates a **new** assignment row (audit trail preserved).

### 2.4 Worked example (3 pins, 2 dehus)

| Pin | Equipment | Dates (job-local) |
|---|---|---|
| Pin 1 (Kitchen subfloor) | Dehu A | Apr 20 – Apr 22 (inclusive, 3 days) |
| Pin 1 | Dehu B | Apr 23 – Apr 25 (inclusive, 3 days) |
| Pin 2 (Living room wall) | Dehu A | Apr 20 – Apr 22 (inclusive, 3 days) |
| Pin 3 (Hallway) | Dehu B | Apr 23 – Apr 25 (inclusive, 3 days) |

**Billing:** Dehu A = 3 days, Dehu B = 3 days — even though each was on-site for 6 days.

## 3. Schema

### 3.1 Modify `equipment_placements`

```sql
-- A1: equipment size (carries Xactimate code mapping)
ALTER TABLE equipment_placements
  ADD COLUMN equipment_size TEXT
    CHECK (equipment_size IN ('std', 'axial', 'large', 'xl', 'xxl'));

-- A2 (C1 fix): floor_plan_id already exists on equipment_placements (see 01H-floor-plan-v2.md:685);
-- the stamp discipline is DOCUMENTED here, not a new column. Phase 1's e1a7c9b30201 migration
-- merged floor_plan_versions INTO floor_plans, so `floor_plans` IS the versioned table.
-- Harden the existing FK: change ON DELETE SET NULL → ON DELETE RESTRICT so the historical stamp
-- cannot be silently nulled when a plan row is deleted.
ALTER TABLE equipment_placements
  DROP CONSTRAINT IF EXISTS equipment_placements_floor_plan_id_fkey;
ALTER TABLE equipment_placements
  ADD CONSTRAINT equipment_placements_floor_plan_id_fkey
    FOREIGN KEY (floor_plan_id) REFERENCES floor_plans(id) ON DELETE RESTRICT;

-- S6: optional inventory hooks (future equipment-library FK)
ALTER TABLE equipment_placements
  ADD COLUMN asset_tag TEXT;
ALTER TABLE equipment_placements
  ADD COLUMN serial_number TEXT;

-- Billing scope so per-room equipment bypasses the junction table entirely.
ALTER TABLE equipment_placements
  ADD COLUMN billing_scope TEXT NOT NULL DEFAULT 'per_pin'
    CHECK (billing_scope IN ('per_pin', 'per_room'));

-- C6: CHECK enforces per-type valid sizes (not just non-null).
-- axial is air-mover-only; large/xl/xxl are dehu-only; std is valid for both; non-drying types must be NULL.
ALTER TABLE equipment_placements
  ADD CONSTRAINT chk_equipment_size_valid CHECK (
    (equipment_type = 'air_mover'    AND equipment_size IN ('std', 'axial'))
    OR
    (equipment_type = 'dehumidifier' AND equipment_size IN ('std', 'large', 'xl', 'xxl'))
    OR
    (equipment_type IN ('air_scrubber', 'hydroxyl_generator', 'heater') AND equipment_size IS NULL)
  );

-- Default billing_scope derived from equipment_type at insert time (enforced at service layer + RPC).
--   air_mover, dehumidifier                   → 'per_pin'
--   air_scrubber, hydroxyl_generator, heater  → 'per_room'

-- Optional: helpful index for inventory lookups by asset tag
CREATE INDEX IF NOT EXISTS idx_equip_asset_tag
  ON equipment_placements(company_id, asset_tag)
  WHERE asset_tag IS NOT NULL;
```

`room_id` stays on `equipment_placements` as **physical location metadata**. For per-room billing it's authoritative; for per-pin billing it's informational (canvas hints, warehouse tracking) — the pin assignments drive billing. Room changes go through the `move_equipment_placement` RPC (§6.6, S2), not bare UPDATE.

`floor_plan_id` is stamped at placement create from `jobs.floor_plan_id` and **never mutated** after create — it captures the floor-plan version the placement was drawn on (each row in `floor_plans` IS a version after Phase 1's merge), so historical exports render correctly (A2). ON DELETE RESTRICT prevents the stamp from being silently nulled (C1).

### 3.2 New table `equipment_pin_assignments`

```sql
CREATE TABLE equipment_pin_assignments (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_placement_id   UUID NOT NULL REFERENCES equipment_placements(id) ON DELETE RESTRICT,
    moisture_pin_id          UUID NOT NULL REFERENCES moisture_pins(id)        ON DELETE RESTRICT,
    job_id                   UUID NOT NULL REFERENCES jobs(id)                 ON DELETE CASCADE,
    company_id               UUID NOT NULL REFERENCES companies(id)            ON DELETE CASCADE,
    assigned_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    unassigned_at            TIMESTAMPTZ,
    assigned_by              UUID REFERENCES users(id),
    unassigned_by            UUID REFERENCES users(id),
    unassign_reason          TEXT CHECK (unassign_reason IN (
        'equipment_pulled', 'pin_dry_standard_met', 'manual_edit', 'pin_archived', 'equipment_moved'
    )),
    note                     TEXT,                -- §0.4 Q3: tech can explain after-the-fact corrections
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_assign_order CHECK (unassigned_at IS NULL OR unassigned_at > assigned_at)
);

-- Prevent duplicate active assignments (same placement + pin active at once).
CREATE UNIQUE INDEX uniq_active_assignment
    ON equipment_pin_assignments(equipment_placement_id, moisture_pin_id)
    WHERE unassigned_at IS NULL;

-- Query patterns:
--   "what's serving pin X right now"  → (moisture_pin_id) WHERE unassigned_at IS NULL
--   "billable span for placement Y"   → (equipment_placement_id)
--   "job-level billing rollup"        → (job_id)
CREATE INDEX idx_epa_pin_active  ON equipment_pin_assignments(moisture_pin_id)        WHERE unassigned_at IS NULL;
CREATE INDEX idx_epa_placement   ON equipment_pin_assignments(equipment_placement_id);
CREATE INDEX idx_epa_job         ON equipment_pin_assignments(job_id);

ALTER TABLE equipment_pin_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY epa_tenant ON equipment_pin_assignments USING (
    company_id = (current_setting('request.jwt.claims')::json->>'company_id')::uuid
);
```

**Key choices (explained):**
- `ON DELETE RESTRICT` on `equipment_placement_id` and `moisture_pin_id` → prevents accidental audit-trail loss. Soft-archive (Phase 2 `archive_pin`) is the expected path; any hard delete must explicitly close assignments first.
- `CHECK (unassigned_at > assigned_at)` (strict `>`, not `>=`) → zero-duration assignments are a misclick, not a real state. Rejected loudly (per `pr-review-lessons.md` §7: "never silently drop").
- `uniq_active_assignment` is partial on `WHERE unassigned_at IS NULL` → historical re-assignments after a closed span are allowed (needed for re-wet case, §6.4).

### 3.3 Atomic placement RPC (required per `pr-review-lessons.md` §4)

Creating N placements + `N × pins_selected` assignments is a multi-write that must succeed atomically. Composing at the Python layer caused the R19 regression; this lives in one plpgsql function.

```sql
CREATE OR REPLACE FUNCTION place_equipment_with_pins(
    p_job_id             UUID,
    p_floor_plan_id      UUID,
    p_room_id            UUID,
    p_equipment_type     TEXT,
    p_equipment_size     TEXT,            -- A1: required for air_mover/dehu, NULL otherwise
    p_quantity           INT,
    p_canvas_x           NUMERIC,
    p_canvas_y           NUMERIC,
    p_moisture_pin_ids   UUID[],          -- empty/NULL for per-room equipment
    p_asset_tags         TEXT[] DEFAULT NULL,   -- S6: optional, length must equal p_quantity if provided
    p_serial_numbers     TEXT[] DEFAULT NULL    -- S6: optional, length must equal p_quantity if provided
) RETURNS TABLE (placement_ids UUID[], assignment_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_company_id         UUID := get_my_company_id();   -- tenant from JWT, NOT a param
    v_billing_scope      TEXT;
    v_floor_plan_id      UUID;
    v_placement_ids      UUID[] := ARRAY[]::UUID[];
    v_count              INT := 0;
BEGIN
    PERFORM ensure_job_mutable(p_job_id);           -- archive guard

    -- C1: snapshot the job's pinned floor_plan_id (Phase 1 merged versions into floor_plans
    -- so jobs.floor_plan_id IS the version pointer).
    SELECT floor_plan_id INTO v_floor_plan_id
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_company_id;              -- tenant check (C4 pattern)
    IF v_floor_plan_id IS NULL THEN
        RAISE EXCEPTION 'job has no pinned floor plan or is not in caller tenant'
            USING ERRCODE = '42501';
    END IF;

    v_billing_scope := CASE p_equipment_type
        WHEN 'air_mover'     THEN 'per_pin'
        WHEN 'dehumidifier'  THEN 'per_pin'
        ELSE 'per_room'
    END;

    -- A1 size gate
    IF v_billing_scope = 'per_pin' AND p_equipment_size IS NULL THEN
        RAISE EXCEPTION 'equipment_size required for air_mover and dehumidifier'
            USING ERRCODE = '22023';
    END IF;
    IF v_billing_scope = 'per_room' AND p_equipment_size IS NOT NULL THEN
        RAISE EXCEPTION 'equipment_size must be NULL for per-room equipment types'
            USING ERRCODE = '22023';
    END IF;
    IF v_billing_scope = 'per_room' AND array_length(p_moisture_pin_ids, 1) IS NOT NULL THEN
        RAISE EXCEPTION 'per_room equipment cannot be assigned to moisture pins'
            USING ERRCODE = '22023';
    END IF;

    -- C7: array length validation for inventory metadata
    IF p_asset_tags IS NOT NULL AND array_length(p_asset_tags, 1) != p_quantity THEN
        RAISE EXCEPTION 'p_asset_tags length must equal p_quantity (got % vs %)',
            array_length(p_asset_tags, 1), p_quantity
            USING ERRCODE = '22023';
    END IF;
    IF p_serial_numbers IS NOT NULL AND array_length(p_serial_numbers, 1) != p_quantity THEN
        RAISE EXCEPTION 'p_serial_numbers length must equal p_quantity (got % vs %)',
            array_length(p_serial_numbers, 1), p_quantity
            USING ERRCODE = '22023';
    END IF;

    -- Validate pins ONCE up front, not per loop iteration (perf).
    -- C8: validate_pins_for_assignment also rejects pins with dry_standard_met_at IS NOT NULL.
    PERFORM validate_pins_for_assignment(p_job_id, p_moisture_pin_ids);

    -- Batch-insert N placements using generate_series (O(1) round trip).
    -- C1: floor_plan_id column is the version stamp (no separate floor_plan_version_id).
    WITH new_placements AS (
        INSERT INTO equipment_placements (
            job_id, room_id, company_id, floor_plan_id,
            equipment_type, equipment_size, billing_scope,
            canvas_x, canvas_y, asset_tag, serial_number, placed_by
        )
        SELECT p_job_id, p_room_id, v_company_id, v_floor_plan_id,
               p_equipment_type, p_equipment_size, v_billing_scope,
               p_canvas_x, p_canvas_y,
               COALESCE(p_asset_tags[i], NULL),
               COALESCE(p_serial_numbers[i], NULL),
               auth.uid()
        FROM generate_series(1, p_quantity) AS i
        RETURNING id
    )
    SELECT array_agg(id) INTO v_placement_ids FROM new_placements;

    -- Assign each new placement to all pins (cartesian expansion)
    IF array_length(p_moisture_pin_ids, 1) IS NOT NULL THEN
        INSERT INTO equipment_pin_assignments (
            equipment_placement_id, moisture_pin_id, job_id, company_id, assigned_by
        )
        SELECT placement_id, pin_id, p_job_id, v_company_id, auth.uid()
        FROM unnest(v_placement_ids) AS placement_id
        CROSS JOIN unnest(p_moisture_pin_ids) AS pin_id;

        v_count := p_quantity * array_length(p_moisture_pin_ids, 1);
    END IF;

    RETURN QUERY SELECT v_placement_ids, v_count;
END;
$$;
```

The pin-validation helper (`validate_pins_for_assignment`) raises `42501` if any pin belongs to a different `job_id`, archived pin, or cross-tenant pin — closing the cross-job bypass shape flagged in `pr-review-lessons.md` §4. **C8:** also raises `22P02` ("dry pin assignment rejected") if any requested pin has `dry_standard_met_at IS NOT NULL` — otherwise a tech could silently re-assign equipment to a dry pin and bill until the next wet reading arrives. **Perf note:** validation runs once before the write block, and placements are inserted in one batch via `generate_series` (O(1) DB round trips regardless of quantity).

**`auth.uid()` in service contexts:** when the RPC is called from a background job (dry-check, re-wet trigger), `auth.uid()` returns NULL. That's acceptable — `placed_by`/`assigned_by` are nullable. Background paths that need an explicit actor should use a dedicated service-role function, not this one.

## 4. API

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/v1/jobs/{jobId}/equipment-placements` | Place equipment (+ optional `moisture_pin_ids`) | Calls `place_equipment_with_pins` RPC |
| POST | `/v1/jobs/{jobId}/equipment-placements/{placementId}/assignments` | Add pin(s) to existing placement | `jobId` verified against placement (cross-job guard, §4) |
| PATCH | `/v1/jobs/{jobId}/equipment-pin-assignments/{id}` | Close one assignment | URL carries `jobId` for binding check |
| POST | `/v1/jobs/{jobId}/moisture-pins/{pinId}/close-assignments` | Bulk-close all active assignments for this pin (dry-standard, archive) | Atomic, one DB round trip |
| POST | `/v1/jobs/{jobId}/equipment-placements/{placementId}/pull` | Pull N units; auto-closes their open assignments | Existing pull endpoint extended |
| GET | `/v1/jobs/{jobId}/moisture-pins/{pinId}/equipment` | Equipment serving this pin (active + historical) | |
| GET | `/v1/jobs/{jobId}/equipment-placements/{id}/billable-days` | Computed billable days + span breakdown | |

Every write endpoint above calls `ensure_job_mutable(jobId)` before touching data (archive guard, `pr-review-lessons.md` §1).

## 5. Placement UX

1. Tech taps Equipment mode → drops pin in a room.
2. Placement card opens:
   - `type` selector (5 options).
   - `quantity` stepper.
   - If `type` is per-pin: **"Serves which moisture pins?"** multi-select appears, pre-checking all active pins in the same room. Tech can add pins from other rooms (open floor plans, hallway dehus) or uncheck all.
   - If `type` is per-room: pin selector is hidden. Card shows "Billed from placement to pull."
3. Submit → single RPC call → creates N placement rows + (for per-pin types) `N × pins_selected` assignment rows.

**Empty-pin placement (per-pin types):** allowed. Canvas shows **orange unassigned warning** until at least one pin is attached. Placements with zero assignments across their lifetime bill **zero days** — this is intentional friction to surface unattributed equipment before carrier review rejects it.

## 6. Lifecycle workflows

### 6.1 Edit assignments (manual)

Tap equipment pin → "Update pins served" sheet. Add pin → new assignment row with `assigned_at = now()`. Remove pin → `unassigned_at = now()`, `unassign_reason = 'manual_edit'`.

### 6.2 Pull equipment

Existing pull flow + closes all open assignments with `unassigned_at = pulled_at`, `unassign_reason = 'equipment_pulled'`. Done in the same RPC as the pull (atomic).

### 6.3 Pin hits dry standard (A4 + S5 — auto-close, no manual confirm)

Phase 2 Postgres trigger (`trg_moisture_pin_dry_check`, §0.2 delta #5) fires on every `moisture_pin_readings` INSERT:
1. **C3:** reads the pin's dry-standard threshold from `moisture_pins.dry_standard` (the per-pin overridable column at `01H-floor-plan-v2.md:601`), NOT from material-type defaults. Otherwise pins with carrier-accepted overrides would auto-close at the wrong reading.
2. Guards against out-of-order inserts: only acts if `NEW.taken_at` is the newest reading for this pin (backfill / late-sync readings don't retroactively close active assignments).
3. If `NEW.reading_value <= moisture_pins.dry_standard` and `moisture_pins.dry_standard_met_at` is NULL → set `dry_standard_met_at = NEW.taken_at`.
4. Immediately auto-closes all active assignments for this pin with `unassigned_at = NEW.taken_at`, `unassign_reason = 'pin_dry_standard_met'`, `unassigned_by = NULL` (service context).

The tech sees a non-blocking notification: **"Dry standard met on Pin 1 (Kitchen subfloor). Equipment auto-released: Dehu A, Dehu B. Undo?"** — with a **24-hour undo window**. The undo path reopens the closed assignments by creating new rows with `note = 'undo: premature dry-close'`, preserving the original closed rows for audit.

Why auto-close + undo instead of manual confirm (original §6.3 behavior): the manual step is silently skipped in real use, equipment keeps running, carrier rejects the over-billed days. Auto-close with undo inverts the default in favor of correct billing.

### 6.4 Re-wetting (S5 — explicit trigger semantics)

The same `trg_moisture_pin_dry_check` trigger handles re-wet: when `NEW.reading_value > moisture_pins.dry_standard` (C3: per-pin override), `NEW.taken_at` is the newest reading (out-of-order guard), and `moisture_pins.dry_standard_met_at IS NOT NULL`:
1. Clear `dry_standard_met_at` (pin is wet again).
2. Emit a realtime notification to the job's active users: *"Pin 1 is wet again. Reassign equipment?"*
3. Do NOT auto-open assignments — re-wet is a human decision (different equipment may be needed, the leak may need investigation first).
4. On tech confirm → create **new** `equipment_pin_assignments` rows (never re-open closed ones). Audit trail shows: closed Apr 22 (dry), new span opens Apr 26 (re-wet). Both spans count.

### 6.5 Pin archive

`archive_pin` RPC (Phase 2) bulk-closes active assignments with `unassign_reason = 'pin_archived'`. Spec amendment in §7.

### 6.6 Move equipment between rooms (S2 — `move_equipment_placement` RPC)

Workflow (`restoros-consumer-workflows-v1.md:830`) treats equipment move as a first-class action. To preserve billing continuity, moving is NOT pull + re-place (which creates a new placement and breaks billable-day attribution). Dedicated RPC:

```sql
CREATE OR REPLACE FUNCTION move_equipment_placement(
    p_placement_id       UUID,
    p_new_room_id        UUID,
    p_new_canvas_x       NUMERIC,
    p_new_canvas_y       NUMERIC,
    p_new_moisture_pin_ids UUID[]         -- pins to serve in the new room
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_company_id UUID := get_my_company_id();    -- C4: tenant from JWT
    v_placement  equipment_placements%ROWTYPE;
BEGIN
    -- C4: scope the SELECT to the caller's tenant. SECURITY DEFINER bypasses RLS,
    -- so without this filter any authenticated caller with a placement UUID could
    -- move another company's equipment. Phase 1's c7f8a9b0d1e2 hardening already
    -- established this pattern — mirror it here.
    SELECT * INTO v_placement
      FROM equipment_placements
     WHERE id = p_placement_id
       AND company_id = v_company_id;

    IF v_placement.id IS NULL THEN
        RAISE EXCEPTION 'placement not found in caller tenant'
            USING ERRCODE = '42501';
    END IF;

    PERFORM ensure_job_mutable(v_placement.job_id);
    PERFORM validate_pins_for_assignment(v_placement.job_id, p_new_moisture_pin_ids);

    -- Close existing pin assignments with 'equipment_moved' reason
    UPDATE equipment_pin_assignments
       SET unassigned_at   = now(),
           unassigned_by   = auth.uid(),
           unassign_reason = 'equipment_moved'
     WHERE equipment_placement_id = p_placement_id
       AND unassigned_at IS NULL;

    -- Update placement location (floor_plan_id stays — the unit is the same, same version stamp)
    UPDATE equipment_placements
       SET room_id  = p_new_room_id,
           canvas_x = p_new_canvas_x,
           canvas_y = p_new_canvas_y
     WHERE id = p_placement_id;

    -- Open new assignments (billing timeline is continuous — no idle day for the move itself)
    IF array_length(p_new_moisture_pin_ids, 1) IS NOT NULL THEN
        INSERT INTO equipment_pin_assignments (
            equipment_placement_id, moisture_pin_id, job_id, company_id, assigned_by
        )
        SELECT p_placement_id, pin_id, v_placement.job_id, v_placement.company_id, auth.uid()
        FROM unnest(p_new_moisture_pin_ids) AS pin_id;
    END IF;
END;
$$;
```

Billing implication: distinct-local-calendar-days math naturally handles the move — if Dehu A is moved mid-day, both the old-room span and new-room span cover that day, which counts once (union semantics).

## 7. Phase 2 archive-RPC delta

Single-line amendment to the Phase 2 `archive_moisture_pin` RPC:

```sql
-- In archive_moisture_pin, after the archive guard and before UPDATE moisture_pins:
UPDATE equipment_pin_assignments
   SET unassigned_at   = now(),
       unassigned_by   = auth.uid(),
       unassign_reason = 'pin_archived'
 WHERE moisture_pin_id = p_pin_id
   AND unassigned_at IS NULL;
```

No change to `ON DELETE RESTRICT`; archive is a soft-delete, the FK stays intact.

## 8. Billing formula

### 8.1 Unified billable-day math (A3 + S7 — server-authoritative, all types)

Every placement — per-pin or per-room — bills by **distinct local calendar days in `jobs.timezone`** covered by its span(s). Implemented as a Postgres function (A3: backend-authoritative, NOT frontend helper).

```sql
CREATE OR REPLACE FUNCTION compute_placement_billable_days(
    p_placement_id UUID
) RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_company_id UUID := get_my_company_id();    -- C5: tenant from JWT
    v_tz         TEXT;
    v_scope      TEXT;
    v_days       INT;
BEGIN
    -- C5: scope read to caller's tenant. SECURITY DEFINER bypasses RLS.
    -- Without this filter, any authenticated caller with a placement UUID could
    -- read another company's billable-day totals.
    SELECT j.timezone, ep.billing_scope
      INTO v_tz, v_scope
      FROM equipment_placements ep
      JOIN jobs j ON j.id = ep.job_id
     WHERE ep.id = p_placement_id
       AND ep.company_id = v_company_id;

    IF v_tz IS NULL THEN
        RAISE EXCEPTION 'placement not found in caller tenant'
            USING ERRCODE = '42501';
    END IF;

    IF v_scope = 'per_pin' THEN
        -- Union of all assignment spans, then count distinct local dates
        SELECT COUNT(DISTINCT d) INTO v_days FROM (
            SELECT generate_series(
                date_trunc('day', assigned_at AT TIME ZONE v_tz)::date,
                date_trunc('day', COALESCE(unassigned_at, now()) AT TIME ZONE v_tz)::date,
                INTERVAL '1 day'
            )::date AS d
            FROM equipment_pin_assignments
            WHERE equipment_placement_id = p_placement_id
        ) s;
    ELSE
        -- per_room: single synthetic span (placed_at → pulled_at or now)
        SELECT COUNT(DISTINCT d) INTO v_days FROM (
            SELECT generate_series(
                date_trunc('day', ep.placed_at AT TIME ZONE v_tz)::date,
                date_trunc('day', COALESCE(ep.pulled_at, now()) AT TIME ZONE v_tz)::date,
                INTERVAL '1 day'
            )::date AS d
            FROM equipment_placements ep
            WHERE ep.id = p_placement_id
        ) s;
    END IF;

    RETURN COALESCE(v_days, 0);
END;
$$;
```

Thin API wrapper: `GET /v1/jobs/{jobId}/equipment-placements/{id}/billable-days` calls this function, returns `{billable_days: int, spans: [...]}`. Frontend **displays**; it never computes billing totals (A3).

Rationale: identical semantics across equipment types → a job emitting air-mover days and scrubber days by different rules is a carrier rejection flag (S7 fix). Calendar-day math matches carrier expectations (not 24h buckets) and `pr-review-lessons.md` §15 (local wall clock for day counts).

### 8.2 Xactimate line-item emission (Phase 5 contract, A1-aware)

Line items aggregate by `(equipment_type, equipment_size, billable_days)` tuple at job level — size is required because each dehu size maps to a distinct Xactimate code (A1, §2.1):

- 6 XL dehus, all billed 5 days → **1 line item**: `6 × WTRDHM>> × 5d`
- 4 large dehus @ 5d + 2 large dehus @ 3d → **2 line items**: `4 × WTRDHM> × 5d`, `2 × WTRDHM> × 3d`
- 6 air movers billed 5d + 3 axial variants billed 5d → **2 line items** (different codes)
- An **attribution appendix** on the carrier report lists per-pin timelines + S4 meter photos under each line item (this is what carriers actually ask for when rejecting).

The appendix data comes from `equipment_pin_assignments` joined to `moisture_pin_readings`. Spec `10-reports.md` owns this contract — dependency line required.

### 8.3 Orange-flagged (unattributed) placements — carrier report path (N2)

Per-pin placements with zero billable days (empty-pin warning, §5) must not silently appear on the carrier report. Options deferred to `10-reports.md`:
- **Option A:** exclude from line-item aggregator entirely (silent).
- **Option B:** include in an "Unattributed equipment (not billed)" appendix with a short reason string.

**Recommendation:** Option B. Transparency > silence. Tech sees the line, adjuster sees why it's zero.

### 8.4 Daily-reading validator (S1 + S4)

Carrier rejection trigger #2 (`tpa-carrier-guidelines.md:47`): "Drying days not supported by moisture logs." To enforce this:

```sql
CREATE OR REPLACE FUNCTION validate_placement_billable_days(
    p_placement_id UUID
) RETURNS TABLE (
    day              DATE,
    supported        BOOLEAN,
    reading_count    INT,
    has_meter_photo  BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
-- C5: scope read to caller tenant via `WHERE ep.company_id = get_my_company_id()`
-- on the opening placement SELECT. Returns empty set on cross-tenant placement UUIDs.
-- Returns one row per billable day; `supported = true` iff ≥1 reading exists on
-- any attributed pin for that day (and S4: flags has_meter_photo = false).
$$;
```

The carrier-report appendix surfaces unsupported days as a warning; the tech clears them before submission. For per-room equipment, this check is skipped (no pin attribution), but the placement must still have ≥1 room-level reading per billable day — call out as a follow-up in `10-reports.md`.

## 9. Invariants brief (`pr-review-lessons.md` gate)

### 9.1 Rules that apply to this task

| # | Rule | Applied where |
|---|---|---|
| 1 | Archive guard (§1 / R6) — every write on job-scoped data calls `ensure_job_mutable` | `place_equipment_with_pins`, bulk-close RPC, assignment PATCH endpoint |
| 2 | Cross-job binding (§4) — URL `jobId` verified against resource's `job_id` | All endpoints carry `jobId` in URL; service layer verifies placement/assignment `job_id` match |
| 3 | Tenant-from-JWT, not params (§3) — RPCs use `get_my_company_id()`, pin `search_path` | `place_equipment_with_pins`, bulk-close, archive amendment |
| 4 | Atomic multi-write (§4) — sequential inserts that must succeed together live in one RPC | `place_equipment_with_pins` wraps N placements + assignments |
| 5 | Calendar-day vs instant (§15) — local wall clock for DATE/day counts, UTC for TIMESTAMPTZ | `billable_days` uses `jobs.timezone`; helpers in `web/src/lib/dates.ts` |
| 6 | SQLSTATE distinctness (§5) — new RAISEs pick codes distinct from sibling catches | `22023` for per-room-with-pins (vs existing `42501` tenant, `55006` frozen) |
| 7 | UX never silently drops (§7) — zero-duration assignments rejected loudly by `chk_assign_order` | Strict `>` in CHECK constraint |
| 8 | Cache-invariant on the hook (§6) — `useEquipmentPlacements` owns invalidation of related query keys | `useEquipmentPlacements`, `useMoisturePins`, `usePinEquipment` all invalidate on assignment mutation |
| 9 | Legacy-accommodation bypass (§8) — no `if x is None: return` skip paths | Validation helpers raise instead of silently skipping |

### 9.2 Sibling-site grep checklist (run before PR)

```bash
# Archive guard present on every new write endpoint
grep -rn "ensure_job_mutable" backend/api/equipment/

# Cross-job binding verified in service layer (not relying on RLS alone)
grep -rn "placement.*job_id" backend/api/equipment/
grep -rn "assignment.*job_id" backend/api/equipment/

# New RPCs use JWT-derived tenant, not param
grep -rn "p_company_id" backend/migrations/              # should be empty in new migrations
grep -rn "get_my_company_id()" backend/migrations/       # must match in new RPCs

# No ON DELETE CASCADE regression on pin audit trail
grep -rn "ON DELETE CASCADE.*moisture_pin_id" backend/migrations/

# Calendar-day helpers reused, not re-invented
grep -rn "toISOString().slice(0,\s*10)" web/src/        # should not grow
grep -rn "from.*@/lib/dates" web/src/components/equipment/

# No silent skip
grep -rn "return.*# legacy\|# silently" backend/api/equipment/
```

### 9.3 Pin-the-invariant tests (must fail on regression, not just on happy-path break)

- `test_place_equipment_when_job_archived_rejected` — archive guard
- `test_assign_pin_from_different_job_rejected_42501` — cross-job bypass
- `test_per_room_equipment_with_pin_ids_rejected_22023` — scope/type mismatch
- `test_rpc_rollback_on_invalid_pin` — one bad pin in array → no placement created, no partial writes
- `test_billable_days_uses_job_timezone` — same UTC spans, different `jobs.timezone` → different day counts
- `test_hard_delete_pin_blocked_by_restrict` — FK prevents audit loss
- `test_zero_duration_assignment_rejected` — `unassigned_at = assigned_at` fails CHECK
- `test_rewet_creates_new_assignment_row` — re-open scenario produces a second row, not a reopened one
- `test_concurrent_assign_same_pin_placement_unique_violation` — partial unique index enforces dedup
- `test_rls_tenant_isolation_assignments` — cross-company read blocked

## 10. Checklist (replaces existing Phase 3 in `01H-floor-plan-v2.md`)

### 10.1 Phase 2 prerequisites (§0.2 deltas — land before Phase 3 starts)

- [ ] **B1:** `moisture_pin_readings.reading_date DATE` → `taken_at TIMESTAMPTZ NOT NULL DEFAULT now()`; drop `UNIQUE(pin_id, reading_date)`
- [ ] **B2:** `ALTER TABLE jobs ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/New_York'`; populate from property zip at job-create (01F hook)
- [ ] **B3:** Phase 2 UX + PDF accept N readings per pin per day ordered by `taken_at`
- [ ] **S3 (C1):** `moisture_pins.floor_plan_id UUID REFERENCES floor_plans(id) ON DELETE RESTRICT` — stamped on create + move (uses the merged `floor_plans` table from Phase 1)
- [ ] **C2:** `moisture_pins.dry_standard_met_at TIMESTAMPTZ` nullable column
- [ ] **S4:** `meter_photo_url` wired into reading entry UI, sparkline thumbnail, PDF export, "no photo" warning flag
- [ ] **S5:** `trg_moisture_pin_dry_check` trigger on `moisture_pin_readings` INSERT — sets/clears `dry_standard_met_at`, auto-closes assignments on dry-met

### 10.2 Phase 3 — equipment + pin attribution

**Schema**
- [ ] `ALTER TABLE equipment_placements ADD COLUMN billing_scope`
- [ ] **A1:** `ADD COLUMN equipment_size` + `CHECK chk_equipment_size_matches_type`
- [ ] **A2 (C1):** harden existing `floor_plan_id` FK — `ON DELETE RESTRICT`, stamped from `jobs.floor_plan_id` at create, immutable
- [ ] **C6:** replace the simple non-null CHECK with per-type valid-sizes CHECK (`chk_equipment_size_valid`)
- [ ] **S6:** `ADD COLUMN asset_tag`, `ADD COLUMN serial_number` + index `idx_equip_asset_tag`
- [ ] `equipment_pin_assignments` table (with `note` column per §0.4 Q3, `equipment_moved` reason per S2) + indexes + RLS

**RPCs**
- [ ] `place_equipment_with_pins` (A1 + A2 + S6 + **C1 (floor_plan_id stamp)** + **C7 (array length check)** params, `generate_series` batch insert, validation-outside-loop)
- [ ] `validate_pins_for_assignment` (cross-job + archive + **C8 (dry-pin rejection, SQLSTATE `22P02`)**)
- [ ] **S2 (C4):** `move_equipment_placement` — tenant-scoped SELECT via `get_my_company_id()`, closes old + reopens new assignments atomically
- [ ] **A3 (C5):** `compute_placement_billable_days` — tenant-scoped read, unified math per-pin + per-room in `jobs.timezone`
- [ ] **S1 (C5):** `validate_placement_billable_days` — SECURITY DEFINER with tenant-scoped read
- [ ] Amend Phase 2 `archive_moisture_pin` RPC to bulk-close assignments (§7)

**API**
- [ ] Placement endpoints (POST/PATCH/DELETE/pull/move/billable-days) + `GET /billable-days` wraps A3 RPC
- [ ] Bulk-close endpoint for pin archive path (dry-standard is now trigger-driven, S5)
- [ ] Listing: equipment-serving-pin + pins-served-by-equipment

**UX (per-pin)**
- [ ] Placement card: type, size selector (A1), quantity, pin multi-select (hidden for per-room)
- [ ] Canvas: tap moisture pin → lists equipment currently serving it
- [ ] Canvas: tap equipment → lists pins served + size badge
- [ ] Canvas: orange "unassigned" warning for per-pin equipment with zero active assignments
- [ ] **A4:** Auto-close toast on dry-standard hit + 24h undo window
- [ ] **S2:** Move-equipment gesture (long-press drag into new room triggers `move_equipment_placement`)

**Tests**
- [ ] All pin-the-invariant tests from §9.3 + new: `test_move_equipment_preserves_billable_day_continuity`, `test_dry_standard_auto_close_and_undo`, `test_equipment_size_required_for_dehu`, `test_floor_plan_id_stamped_immutable_and_restrict_delete` (C1), `test_unified_day_math_per_pin_and_per_room_equivalent`, `test_move_equipment_rejects_cross_tenant_placement_id` (C4), `test_compute_billable_days_rejects_cross_tenant_placement_id` (C5), `test_equipment_size_check_rejects_dehu_plus_axial` (C6), `test_place_rpc_rejects_mismatched_asset_tag_array_length` (C7), `test_validate_pins_rejects_dry_pin_with_22P02` (C8), `test_trigger_reads_per_pin_dry_standard_override` (C3), `test_trigger_ignores_out_of_order_reading_insert` (C3), `test_dry_standard_met_at_column_exists_and_nullable` (C2)
- [ ] Sibling-site grep checklist from §9.2

### 10.3 Cross-spec dependencies (call out in respective specs)

- `10-reports.md`: Xactimate line-item aggregation rule (§8.2), orange-flagged equipment path (§8.3, N2), daily-reading validator surface in carrier appendix (§8.4)
- `01F-create-job-v2.md`: populate `jobs.timezone` from property zip on create (B2)
- Phase 2 section of `01H-floor-plan-v2.md`: rewrite with §0.2 deltas before Phase 3 starts

### 10.4 Explicit deferrals (§0.3)

- **A5:** WTREQ monitoring labor — new spec
- **N1:** Equipment-sizing suggestion engine (S500 calc from room dims) — new spec, Brett's competitive-moat ask
- **N3:** Atmospheric/dehu-output readings — documentation-only delta in Phase 2 confirming co-existence path (not schema work)

## 11. Migration path

All changes additive (column additions + new tables + new RPCs). No backfill for Phase 3 since no prod data exists. Phase 2 deltas (§0.2) **do** require a migration:
- B1 `reading_date → taken_at`: add `taken_at` column, backfill `taken_at = reading_date + '12:00:00'::time AT TIME ZONE 'America/New_York'`, drop old column + unique index.
- B2 `jobs.timezone`: default + backfill via property zip lookup.
- S3/C1 `moisture_pins.floor_plan_id`: add `UUID REFERENCES floor_plans(id) ON DELETE RESTRICT`, backfill from pin's `jobs.floor_plan_id`.
- C2 `moisture_pins.dry_standard_met_at`: add nullable `TIMESTAMPTZ`. No backfill (NULL = still drying, correct default for any existing rows).

`equipment_placements.placed_at` / `pulled_at` remain as physical on-site metadata. Per unified §8.1 math, they are the span boundary for `per_room` rows only.

## 12. Open questions — answered

All three originally-flagged open questions are resolved in §0.4. No open questions remain; any surfaced during implementation should be added as follow-up amendments, not resolved silently.

---

## 13. Current vs. proposed (comparison)

| Dimension | Current Phase 3 | Proposed |
|---|---|---|
| Billing basis (drying equipment) | `pulled_at − placed_at` per unit | Distinct local calendar days touched by pin-assignment spans (S7 unifies this to per-room too) |
| Billing basis (non-drying equipment) | `ceil((pulled_at − placed_at) / 1 day)` | Same calendar-day math as drying — unified (S7) |
| Idle-day handling | Billed | Not billed |
| Carrier justification | Manual cross-check | Structured per-pin appendix (§8.2) + daily-reading validator (S1) |
| Xactimate-code mapping | Ambiguous (single `equipment_type`) | Explicit via `(type, size)` tuple (A1) |
| Floor-plan version stamping | None | `equipment_placements.floor_plan_id` immutable + RESTRICT (A2, C1); `moisture_pins.floor_plan_id` (S3, C1) — both reference merged `floor_plans` table |
| Equipment move between rooms | Undefined (pull + re-place splits billing) | `move_equipment_placement` RPC preserves billing continuity (S2) |
| Dry-standard closing | Manual confirm | Trigger-driven auto-close with 24h undo (A4 + S5) |
| Meter-photo evidence | Column exists, unused | Required UX; warning badge on missing (S4) |
| Inventory hooks | None | `asset_tag`, `serial_number` optional columns (S6) |
| Billing authority | N/A | Backend Postgres function `compute_placement_billable_days` (A3) |
| Daily-reading validator | None | `validate_placement_billable_days` + carrier-appendix warning (S1) |
| Net new tables | 0 | 1 (`equipment_pin_assignments`) |
| Net new columns on `equipment_placements` | 0 | 4 (`billing_scope`, `equipment_size`, `asset_tag`, `serial_number`) — existing `floor_plan_id` FK is hardened, not added (C1) |
| Phase 2 column changes forced | 0 | 4 (`readings.taken_at` replaces `reading_date`, `pins.floor_plan_id`, `pins.dry_standard_met_at` (C2), `jobs.timezone`) |
| New RPCs | 0 | 5 (`place_equipment_with_pins`, `validate_pins_for_assignment`, `move_equipment_placement`, `compute_placement_billable_days`, `validate_placement_billable_days`) + 1 trigger (`trg_moisture_pin_dry_check`). All SECURITY DEFINER RPCs scoped to caller tenant via `get_my_company_id()` (C4, C5). |
| New endpoints | 0 | 8 |
| Invariants brief | N/A | §9 |
| Pin-the-invariant tests | N/A | 24 (§9.3 base 10 + 5 original + 9 codex-fix tests in §10.2) |
