# Phase 3 (Revised): Equipment Pins — Attributed to Moisture Pins

**Status:** Draft proposal — amendment to `01H-floor-plan-v2.md` Phase 3
**Author:** Samhith
**Date:** 2026-04-23
**Review bar:** Must pass the gate defined in `docs/pr-review-lessons.md` (invariants brief + sibling-site grep + pinned tests). Brief included in §9 of this doc.

---

## 1. Motivation

Current Phase 3 bills per equipment unit as `pulled_at - placed_at`. This overcharges when equipment sits idle in a room whose pins have already hit dry standard, and gives carriers no audit trail for "why did you run 3 dehus for 8 days?" Carriers increasingly reject equipment days not justified by a moisture-pin drying timeline (see `docs/research/tpa-carrier-guidelines.md`).

Brett's V2 principle — "every feature anchors to the floor plan" — extends naturally: drying equipment should anchor to **the moisture pins it was drying**. Non-drying equipment (air scrubbers, hydroxyl generators, heaters) stays room-anchored because it treats the atmosphere, not specific material pins.

## 2. Model

### 2.1 Billing scope per equipment type

| Equipment type | Billing scope | Attribution | Billing basis |
|---|---|---|---|
| Air mover | `per_pin` | Moisture pins it dries | Union of pin-assignment spans |
| Dehumidifier | `per_pin` | Moisture pins it dries | Union of pin-assignment spans |
| Air scrubber | `per_room` | Room it treats | `pulled_at − placed_at` |
| Hydroxyl generator | `per_room` | Room it treats | `pulled_at − placed_at` |
| Heater | `per_room` | Room it treats | `pulled_at − placed_at` |

Only per-pin equipment uses the new `equipment_pin_assignments` junction. Per-room equipment preserves the original Phase 3 billing exactly.

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
-- Add billing scope so per-room equipment bypasses the junction table entirely.
ALTER TABLE equipment_placements
  ADD COLUMN billing_scope TEXT NOT NULL DEFAULT 'per_pin'
    CHECK (billing_scope IN ('per_pin', 'per_room'));

-- Default derived from equipment_type at insert time (enforced at service layer).
--   air_mover, dehumidifier         → 'per_pin'
--   air_scrubber, hydroxyl_generator, heater → 'per_room'
```

`room_id` stays on `equipment_placements` as **physical location metadata** only. For per-room billing it's authoritative; for per-pin billing it's informational (canvas hints, warehouse tracking) — the pin assignments drive billing.

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
        'equipment_pulled', 'pin_dry_standard_met', 'manual_edit', 'pin_archived'
    )),
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
    p_job_id          UUID,
    p_floor_plan_id   UUID,
    p_room_id         UUID,
    p_equipment_type  TEXT,
    p_quantity        INT,
    p_canvas_x        NUMERIC,
    p_canvas_y        NUMERIC,
    p_moisture_pin_ids UUID[]   -- empty array for per-room equipment
) RETURNS TABLE (placement_id UUID, assignment_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_company_id     UUID := get_my_company_id();   -- tenant from JWT, NOT a param
    v_billing_scope  TEXT;
    v_placement_id   UUID;
    v_count          INT := 0;
BEGIN
    PERFORM ensure_job_mutable(p_job_id);           -- archive guard (§1)

    v_billing_scope := CASE p_equipment_type
        WHEN 'air_mover'     THEN 'per_pin'
        WHEN 'dehumidifier'  THEN 'per_pin'
        ELSE 'per_room'
    END;

    IF v_billing_scope = 'per_room' AND array_length(p_moisture_pin_ids, 1) IS NOT NULL THEN
        RAISE EXCEPTION 'per_room equipment cannot be assigned to moisture pins'
            USING ERRCODE = '22023';                -- invalid_parameter_value
    END IF;

    FOR i IN 1..p_quantity LOOP
        INSERT INTO equipment_placements (
            job_id, room_id, company_id, floor_plan_id, equipment_type,
            billing_scope, canvas_x, canvas_y
        ) VALUES (
            p_job_id, p_room_id, v_company_id, p_floor_plan_id, p_equipment_type,
            v_billing_scope, p_canvas_x, p_canvas_y
        )
        RETURNING id INTO v_placement_id;

        -- Validate every pin is in the same job + not archived, in ONE query.
        PERFORM validate_pins_for_assignment(p_job_id, p_moisture_pin_ids);

        INSERT INTO equipment_pin_assignments (
            equipment_placement_id, moisture_pin_id, job_id, company_id, assigned_by
        )
        SELECT v_placement_id, pin_id, p_job_id, v_company_id, auth.uid()
        FROM   unnest(p_moisture_pin_ids) AS pin_id;

        v_count := v_count + COALESCE(array_length(p_moisture_pin_ids, 1), 0);
    END LOOP;

    RETURN QUERY SELECT v_placement_id, v_count;
END;
$$;
```

The pin-validation helper (`validate_pins_for_assignment`) raises `42501` if any pin belongs to a different `job_id`, archived pin, or cross-tenant pin — closing the cross-job bypass shape flagged in `pr-review-lessons.md` §4.

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

### 6.3 Pin hits dry standard

Phase 2 dry-check job (runs on moisture reading insert) detects the pin has hit standard. The triggering reading's `taken_at` is the authoritative timestamp — not the detection job's run time, not the user prompt time (honest attribution).

Flow:
1. Dry-check job sets `moisture_pins.dry_standard_met_at = <reading.taken_at>`.
2. Tech opens the pin → sees "Dry standard met. Close assignments to Dehu A, Dehu B?"
3. On confirm → `POST /moisture-pins/{pinId}/close-assignments` with `effective_at = dry_standard_met_at`, `reason = 'pin_dry_standard_met'`.
4. Bulk-close closes all active assignments with that `unassigned_at`. Single DB call.

### 6.4 Re-wetting

If a later reading shows the pin above dry-threshold again (leak recurrence, sealed moisture revealed after demo):
- Phase 2 clears `dry_standard_met_at` (existing behavior).
- System prompts: "Pin 1 is wet again. Reassign equipment?"
- On confirm → creates **new** assignment rows (never re-opens closed ones). Audit trail shows: closed Apr 22 (dry), re-opened Apr 26 (re-wet). Two spans, billable days counted with both.

### 6.5 Pin archive

`archive_pin` RPC (Phase 2) already raises if the pin has active assignments, or (by flag) bulk-closes them with `unassign_reason = 'pin_archived'`. This proposal adds the second path; spec amendment to Phase 2's archive RPC is included in §7.

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

### 8.1 Per-pin equipment

Billed by **distinct local calendar days touched by any assignment span**, computed in the **job's timezone** (from `jobs.timezone`).

```python
def billable_days(placement_id: UUID, job_timezone: str) -> int:
    """Number of distinct local calendar days covered by any assignment span."""
    tz = zoneinfo.ZoneInfo(job_timezone)
    spans = fetch_spans(placement_id)   # [(assigned_at, unassigned_at or now()), ...]
    days: set[date] = set()
    for start_utc, end_utc in spans:
        start_local = start_utc.astimezone(tz).date()
        end_local   = end_utc.astimezone(tz).date()
        d = start_local
        while d <= end_local:
            days.add(d)
            d += timedelta(days=1)
    return len(days)

billing_amount = billable_days(placement_id, job_tz) * equipment_rate_per_day
```

This aligns with carrier expectations (calendar days, not 24h buckets) and with `feedback_date_handling.md` / `pr-review-lessons.md` §15: **local wall clock for day counts, UTC for instants**. Helpers consolidated in `web/src/lib/dates.ts` per existing convention.

### 8.2 Per-room equipment

Unchanged from original Phase 3:

```python
duration_days = ceil((pulled_at - placed_at) / timedelta(days=1))
billing_amount = duration_days * equipment_rate_per_day
```

### 8.3 Xactimate line-item emission (Phase 5 contract)

For carrier clarity, line items aggregate by `(equipment_type, billable_days)` pair at job level:

- 6 air movers, all billed 5 days → **1 line item**: `6 units × 5 days @ $35`
- 6 air movers, 4 billed 5 days + 2 billed 3 days → **2 line items**: `4 × 5d`, `2 × 3d`
- An **attribution appendix** on the carrier report lists per-pin timelines under each line item (this is what carriers actually ask for when rejecting).

The appendix data comes from `equipment_pin_assignments` joined to `moisture_pin_readings`. Phase 5 spec should reference this contract.

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

- [ ] `ALTER TABLE equipment_placements ADD COLUMN billing_scope` — new migration
- [ ] `equipment_pin_assignments` table + indexes + RLS
- [ ] `place_equipment_with_pins` plpgsql RPC (atomic, tenant-from-JWT, archive guard)
- [ ] `validate_pins_for_assignment` helper (cross-job + archive check)
- [ ] Amend Phase 2 `archive_moisture_pin` RPC to bulk-close assignments
- [ ] Placement UX: type-aware card (pin multi-select shown only for per-pin types)
- [ ] Bulk-close endpoint for "pin hits dry standard" / archive paths
- [ ] Canvas: tap moisture pin → lists equipment currently serving it; tap equipment → lists pins
- [ ] Canvas: orange "unassigned" warning for per-pin equipment with zero active assignments
- [ ] Re-wet flow: new assignment rows (never reopen closed)
- [ ] Billing calc in job timezone via `web/src/lib/dates.ts` helpers
- [ ] Xactimate line-item aggregation rule (Phase 5 contract stub)
- [ ] All 10 pin-the-invariant tests from §9.3
- [ ] Sibling-site grep checklist from §9.2 — run + paste in PR description

## 11. Migration path

- All changes are additive + one column addition. No backfill: `billing_scope` defaults to `'per_pin'`, which is correct for future rows; existing rows (none in prod) get the default.
- `equipment_placements.placed_at` / `pulled_at` remain as physical on-site metadata (warehouse tracking, photo anchoring). They are the billing source for `per_room` rows only.

## 12. Open questions for manager review

Narrowed to decisions that actually need your input:

1. **Cross-room attribution:** should a per-pin equipment unit be allowed to serve pins across multiple rooms (open floor plans, hallway dehus)? *Proposal leans yes.*
2. **Empty-pin placement:** should per-pin equipment be blockable (hard validation) or warned (canvas orange state)? *Proposal leans warn — real flow is drop-equipment-before-pins.*
3. **Reassignment back-dating:** when a tech forgets and corrects 2 days later, should `assigned_at` be back-datable with audit, or is "correction from now" good enough? *Proposal leans "from now" for simplicity; can be revisited.*

All other questions have been resolved in the body — see §2, §6, §8.

---

## 13. Current vs. proposed (comparison)

| Dimension | Current Phase 3 | Proposed |
|---|---|---|
| Billing basis (drying equipment) | `pulled_at − placed_at` per unit | Distinct local calendar days touched by pin-assignment spans |
| Billing basis (non-drying equipment) | Same as drying | `pulled_at − placed_at` (unchanged) |
| Idle-day handling | Billed | Not billed |
| Carrier justification | Manual cross-check in audit | Structured, queryable per pin; appendix in report |
| Net new tables | 0 | 1 (`equipment_pin_assignments`) |
| Net new columns | 0 | 1 (`equipment_placements.billing_scope`) |
| New RPCs | 0 | 2 (`place_equipment_with_pins`, `validate_pins_for_assignment`) |
| New endpoints | 0 | 3 (assignments add/close, bulk-close by pin) |
| Invariants brief | N/A | Included (§9) |
| Pin-the-invariant tests | N/A | 10 (§9.3) |
