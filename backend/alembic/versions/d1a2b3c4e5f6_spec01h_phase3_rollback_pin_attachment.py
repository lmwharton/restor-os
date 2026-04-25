"""Spec 01H Phase 3 PR-B2 Step 1: roll back the pin-attachment layer.

Context for the unwinding:

PR-B shipped a pin-attached equipment-billing model on the premise that
air movers / dehumidifiers should bill per-pin ("bill until the material
is dry"). Brett's call clarified that equipment is tied to ROOMS only —
techs place equipment randomly in a room, pause or restart individual
units, and billing is simply sum-of-on-site-days per unit. No
equipment→pin attribution anywhere.

What this migration rolls back (one atomic unit so we never land in a
broken partial state where RPCs reference a dropped table):

  1. DROP FUNCTION place_equipment_with_pins (full 10-arg signature)
     — superseded by ``place_equipment`` in PR-B2 Step 3.
  2. DROP FUNCTION validate_pins_for_assignment(UUID, UUID[])
     — dead code; no caller after (1) is dropped.
  3. DROP TABLE equipment_pin_assignments CASCADE
     — the junction. CASCADE drops the partial + access indexes and
     the ``epa_tenant`` RLS policy in one statement.
  4. ALTER TABLE equipment_placements DROP COLUMN billing_scope
     — every row is per-room now. The column (and its inline CHECK
     constraint) is dead weight + would mislead a later reader.
  5. CREATE OR REPLACE FUNCTION move_equipment_placement
     — simplified body: no pin-reassignment. Only updates ``room_id``
     + canvas coords + re-stamps ``floor_plan_id``.
  6. CREATE OR REPLACE FUNCTION compute_placement_billable_days
     — single formula: ``placed_at → COALESCE(pulled_at, now())``
     in distinct local calendar days at ``jobs.timezone``.
     Per-pin/per-room branching is gone.
  7. CREATE OR REPLACE FUNCTION validate_placement_billable_days
     — per-room-style output only (no pin joins). Kept so PR-C and the
     carrier-report can call a consistent signature.

What we INTENTIONALLY keep:

- ``equipment_placements`` table itself (``room_id``, ``placed_at``,
  ``pulled_at``, ``floor_plan_id`` all still valid — per-room billing
  rides on these columns).
- ``ensure_job_mutable`` twin (PR-B Step 1) — still used; Step 7 adds
  a stricter ``ensure_equipment_mutable`` but the twin stays as the
  base guard.
- ``save_floor_plan_version`` fork-restamp of ``equipment_placements``
  (PR-B Step 8 / migration ``b7d9f1a3c5e8``). The column still exists,
  still needs restamping on fork — lesson #29 invariant holds.
- ``moisture_pins.dry_standard_met_at`` column + ``trg_moisture_pin_dry_check``
  trigger (PR-A Steps 2+4). They govern pin color transitions which
  are still a real feature; they never touched equipment anyway.

Downgrade restores everything dropped here so ``alembic downgrade -1``
returns the DB to the exact pre-rollback shape. Each restored function
body is the byte-exact copy from its original migration — a text-scan
test compares the two so future edits stay in sync (lesson #10).

Revision ID: d1a2b3c4e5f6
Revises: b7d9f1a3c5e8
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1a2b3c4e5f6"
down_revision: str | None = "b7d9f1a3c5e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ============================================================================
-- (1) Drop place_equipment_with_pins (full signature — lesson #10).
-- ============================================================================
DROP FUNCTION IF EXISTS place_equipment_with_pins(
    UUID, UUID, TEXT, TEXT, INT, NUMERIC, NUMERIC, UUID[], TEXT[], TEXT[]
);

-- ============================================================================
-- (2) Drop validate_pins_for_assignment (two-arg signature).
-- ============================================================================
DROP FUNCTION IF EXISTS validate_pins_for_assignment(UUID, UUID[]);

-- ============================================================================
-- (3) Drop the junction table. CASCADE drops its indexes + policy.
-- ============================================================================
DROP TABLE IF EXISTS equipment_pin_assignments CASCADE;

-- ============================================================================
-- (4) Drop billing_scope column. Inline CHECK on the column goes with it.
--     Column COMMENT also goes with it automatically.
-- ============================================================================
ALTER TABLE equipment_placements DROP COLUMN IF EXISTS billing_scope;

-- ============================================================================
-- (5) Replace move_equipment_placement with the simplified body.
--     No pin-reassignment. No billing_scope check. Just:
--       - archive guard
--       - cross-job room binding check (lesson #30)
--       - floor_plan re-stamp from jobs (in case fork happened since placed)
--       - UPDATE room_id + canvas_x + canvas_y
--
--     Signature shrinks from 6 params → 5 (removes p_new_moisture_pin_ids).
--     Postgres doesn't allow CREATE OR REPLACE across signature changes or
--     param renames, so DROP the old signature first. Lesson #10 — full
--     signature on the DROP so we don't leave a stale overload alongside.
-- ============================================================================
DROP FUNCTION IF EXISTS move_equipment_placement(
    UUID, UUID, NUMERIC, NUMERIC, UUID[], TEXT
);

CREATE OR REPLACE FUNCTION move_equipment_placement(
    p_placement_id  UUID,
    p_new_room_id   UUID,
    p_new_canvas_x  NUMERIC,
    p_new_canvas_y  NUMERIC,
    p_note          TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_placement      equipment_placements%ROWTYPE;
    v_floor_plan_id  UUID;
BEGIN
    IF p_placement_id IS NULL OR p_new_room_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_placement_id and p_new_room_id are required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company';
    END IF;

    -- Lock + fetch the placement scoped to the caller's tenant.
    SELECT * INTO v_placement
      FROM equipment_placements
     WHERE id = p_placement_id
       AND company_id = v_caller_company
       FOR UPDATE;
    IF v_placement.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Placement not found or not accessible';
    END IF;

    -- Archive guard inside the transaction.
    PERFORM ensure_job_mutable(v_placement.job_id);

    -- Lesson #30 — cross-job binding on the target room. The FK to
    -- job_rooms only validates existence; we must explicitly check
    -- the target room belongs to this placement's job.
    PERFORM 1
      FROM job_rooms
     WHERE id = p_new_room_id
       AND job_id = v_placement.job_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Target room not found on this job or not accessible';
    END IF;

    -- Re-stamp floor_plan_id from the job. Fork-restamp already keeps
    -- this in sync for job_rooms + moisture_pins + equipment_placements
    -- on save, but a move mid-job still benefits from freshening via
    -- the jobs.floor_plan_id of the moment (lesson §3).
    SELECT floor_plan_id INTO v_floor_plan_id
      FROM jobs
     WHERE id = v_placement.job_id
       AND company_id = v_caller_company;
    IF v_floor_plan_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Job has no pinned floor plan or is not accessible';
    END IF;

    UPDATE equipment_placements
       SET room_id       = p_new_room_id,
           canvas_x      = p_new_canvas_x,
           canvas_y      = p_new_canvas_y,
           floor_plan_id = v_floor_plan_id,
           notes         = COALESCE(p_note, notes),
           updated_at    = now()
     WHERE id = p_placement_id;

    RETURN jsonb_build_object(
        'placement_id',  p_placement_id,
        'room_id',       p_new_room_id,
        'floor_plan_id', v_floor_plan_id
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION move_equipment_placement(
    UUID, UUID, NUMERIC, NUMERIC, TEXT
) TO authenticated, service_role;

COMMENT ON FUNCTION move_equipment_placement(UUID, UUID, NUMERIC, NUMERIC, TEXT) IS
    'Move a placement to a new room / canvas coord. Re-stamps floor_plan_id '
    'from the job in case a fork happened since placement. Spec 01H Phase 3 '
    'PR-B2 Step 1 (rolled back pin-reassignment logic).';


-- ============================================================================
-- (6) Replace compute_placement_billable_days with the unified formula.
--     Single path: placed_at → COALESCE(pulled_at, now()), counted as
--     distinct local calendar days at jobs.timezone.
--     The chain concept (restarted_from_placement_id, added in PR-B2
--     Step 2) is TRANSPARENT to this function — each row contributes
--     its own window; chain membership has no effect on billing math.
-- ============================================================================
CREATE OR REPLACE FUNCTION compute_placement_billable_days(
    p_placement_id UUID
) RETURNS INT AS $$
DECLARE
    v_caller_company UUID;
    v_tz             TEXT;
    v_days           INT;
BEGIN
    IF p_placement_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_placement_id is required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company';
    END IF;

    -- Tenant-scoped lookup in one SELECT. Cross-tenant → 42501, never
    -- silent empty (lesson §3 / C5).
    SELECT j.timezone
      INTO v_tz
      FROM equipment_placements ep
      JOIN jobs j ON j.id = ep.job_id
     WHERE ep.id = p_placement_id
       AND ep.company_id = v_caller_company;
    IF v_tz IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Placement not found or not accessible';
    END IF;

    -- Single span per row. generate_series + date_trunc at the job's
    -- timezone gives distinct local calendar days. Matches the PR-B
    -- per_room body byte-for-byte intentionally — that was the only
    -- formula we needed all along.
    SELECT COUNT(DISTINCT d) INTO v_days
      FROM (
          SELECT generate_series(
              date_trunc('day', ep.placed_at AT TIME ZONE v_tz)::date,
              date_trunc('day', COALESCE(ep.pulled_at, now()) AT TIME ZONE v_tz)::date,
              INTERVAL '1 day'
          )::date AS d
            FROM equipment_placements ep
           WHERE ep.id = p_placement_id
      ) s;

    RETURN COALESCE(v_days, 0);
END;
$$ LANGUAGE plpgsql
   STABLE
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION compute_placement_billable_days(UUID)
    TO authenticated, service_role;


-- ============================================================================
-- (7) Replace validate_placement_billable_days with the per-row-only
--     shape. No pin attribution to check against; every day is
--     surfaced with ``supported=false`` so the carrier report shows
--     that per-room equipment has no moisture-log backing (which is
--     correct — scrubbers, heaters, and hydroxyl generators don't dry
--     specific pins). Kept in the schema so PR-C's consumer code
--     continues to resolve a stable function signature.
-- ============================================================================
CREATE OR REPLACE FUNCTION validate_placement_billable_days(
    p_placement_id UUID
) RETURNS TABLE (
    day              DATE,
    supported        BOOLEAN,
    reading_count    INT,
    has_meter_photo  BOOLEAN
) AS $$
DECLARE
    v_caller_company UUID;
    v_tz             TEXT;
BEGIN
    IF p_placement_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_placement_id is required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company';
    END IF;

    SELECT j.timezone
      INTO v_tz
      FROM equipment_placements ep
      JOIN jobs j ON j.id = ep.job_id
     WHERE ep.id = p_placement_id
       AND ep.company_id = v_caller_company;
    IF v_tz IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Placement not found or not accessible';
    END IF;

    RETURN QUERY
    SELECT d AS day,
           false AS supported,
           0     AS reading_count,
           false AS has_meter_photo
      FROM (
          SELECT generate_series(
              date_trunc('day', ep.placed_at AT TIME ZONE v_tz)::date,
              date_trunc('day', COALESCE(ep.pulled_at, now()) AT TIME ZONE v_tz)::date,
              INTERVAL '1 day'
          )::date AS d
            FROM equipment_placements ep
           WHERE ep.id = p_placement_id
      ) s
     ORDER BY day;
END;
$$ LANGUAGE plpgsql
   STABLE
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION validate_placement_billable_days(UUID)
    TO authenticated, service_role;
"""


# ==========================================================================
# Downgrade restores every dropped object to its pre-rollback state.
# Bodies are copied byte-for-byte from the original migrations
# (c2e4a6b8d0f3, d4f6b8a0c2e5, e6a8c0b2d4f7, f2a4c6e8b0d3, a3c5e7b9d1f4,
# c5e7a9b1d3f6). Any drift between the copy below and those originals
# is caught by text-scan test.
# ==========================================================================
DOWNGRADE_SQL = """
-- Restore billing_scope column with original DEFAULT + inline CHECK.
ALTER TABLE equipment_placements
    ADD COLUMN IF NOT EXISTS billing_scope TEXT NOT NULL DEFAULT 'per_pin'
        CHECK (billing_scope IN ('per_pin', 'per_room'));

-- Restore equipment_pin_assignments junction table (from d4f6b8a0c2e5).
CREATE TABLE IF NOT EXISTS equipment_pin_assignments (
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
        'equipment_pulled',
        'pin_dry_standard_met',
        'manual_edit',
        'pin_archived',
        'equipment_moved'
    )),
    note                     TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_assign_order CHECK (
        unassigned_at IS NULL OR unassigned_at > assigned_at
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_assignment
    ON equipment_pin_assignments(equipment_placement_id, moisture_pin_id)
    WHERE unassigned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_epa_pin_active  ON equipment_pin_assignments(moisture_pin_id)
    WHERE unassigned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_epa_placement   ON equipment_pin_assignments(equipment_placement_id);
CREATE INDEX IF NOT EXISTS idx_epa_job         ON equipment_pin_assignments(job_id);

ALTER TABLE equipment_pin_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS epa_tenant ON equipment_pin_assignments;
CREATE POLICY epa_tenant ON equipment_pin_assignments USING (
    company_id = get_my_company_id()
);

-- Restore validate_pins_for_assignment (from e6a8c0b2d4f7).
CREATE OR REPLACE FUNCTION validate_pins_for_assignment(
    p_job_id            UUID,
    p_moisture_pin_ids  UUID[]
) RETURNS VOID AS $$
DECLARE
    v_caller_company UUID;
    v_invalid_count  INT;
    v_dry_count      INT;
BEGIN
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id is required';
    END IF;

    IF p_moisture_pin_ids IS NULL OR array_length(p_moisture_pin_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company';
    END IF;

    SELECT COUNT(*) INTO v_invalid_count
      FROM unnest(p_moisture_pin_ids) AS requested_id
     WHERE NOT EXISTS (
         SELECT 1 FROM moisture_pins mp
          WHERE mp.id = requested_id
            AND mp.company_id = v_caller_company
            AND mp.job_id = p_job_id
     );
    IF v_invalid_count > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'One or more pins not found on this job or not accessible to caller';
    END IF;

    PERFORM 1
      FROM moisture_pins
     WHERE id = ANY(p_moisture_pin_ids)
       FOR SHARE;

    SELECT COUNT(*) INTO v_dry_count
      FROM moisture_pins
     WHERE id = ANY(p_moisture_pin_ids)
       AND dry_standard_met_at IS NOT NULL;
    IF v_dry_count > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22P02',
                    MESSAGE = 'Cannot assign equipment to a pin that already met dry standard';
    END IF;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION validate_pins_for_assignment(UUID, UUID[])
    TO authenticated, service_role;

-- Restore place_equipment_with_pins (from f2a4c6e8b0d3).
CREATE OR REPLACE FUNCTION place_equipment_with_pins(
    p_job_id            UUID,
    p_room_id           UUID,
    p_equipment_type    TEXT,
    p_equipment_size    TEXT,
    p_quantity          INT,
    p_canvas_x          NUMERIC,
    p_canvas_y          NUMERIC,
    p_moisture_pin_ids  UUID[] DEFAULT NULL,
    p_asset_tags        TEXT[] DEFAULT NULL,
    p_serial_numbers    TEXT[] DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_caller_user    UUID;
    v_billing_scope  TEXT;
    v_floor_plan_id  UUID;
    v_placement_ids  UUID[] := ARRAY[]::UUID[];
    v_assignments    INT := 0;
BEGIN
    IF p_job_id IS NULL OR p_room_id IS NULL OR p_equipment_type IS NULL
       OR p_quantity IS NULL OR p_quantity < 1 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'Required parameter missing or p_quantity < 1';
    END IF;

    PERFORM ensure_job_mutable(p_job_id);

    v_caller_company := get_my_company_id();

    PERFORM 1
      FROM job_rooms
     WHERE id = p_room_id
       AND job_id = p_job_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Room not found on this job or not accessible';
    END IF;

    SELECT id INTO v_caller_user
      FROM users
     WHERE auth_user_id = auth.uid()
       AND company_id = v_caller_company
       AND deleted_at IS NULL;

    v_billing_scope := CASE p_equipment_type
        WHEN 'air_mover'    THEN 'per_pin'
        WHEN 'dehumidifier' THEN 'per_pin'
        ELSE 'per_room'
    END;

    IF v_billing_scope = 'per_pin' AND p_equipment_size IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'equipment_size required for air_mover and dehumidifier';
    END IF;
    IF v_billing_scope = 'per_room' AND p_equipment_size IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'equipment_size must be NULL for per-room equipment types';
    END IF;
    IF v_billing_scope = 'per_room' AND p_moisture_pin_ids IS NOT NULL
       AND array_length(p_moisture_pin_ids, 1) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'per_room equipment cannot be assigned to moisture pins';
    END IF;

    IF p_asset_tags IS NOT NULL
       AND array_length(p_asset_tags, 1) <> p_quantity THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_asset_tags length must equal p_quantity';
    END IF;
    IF p_serial_numbers IS NOT NULL
       AND array_length(p_serial_numbers, 1) <> p_quantity THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_serial_numbers length must equal p_quantity';
    END IF;

    SELECT floor_plan_id INTO v_floor_plan_id
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company;
    IF v_floor_plan_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Job has no pinned floor plan or is not accessible';
    END IF;

    PERFORM validate_pins_for_assignment(p_job_id, p_moisture_pin_ids);

    WITH new_placements AS (
        INSERT INTO equipment_placements (
            job_id, room_id, company_id, floor_plan_id,
            equipment_type, equipment_size, billing_scope,
            canvas_x, canvas_y,
            asset_tag, serial_number,
            placed_by
        )
        SELECT p_job_id, p_room_id, v_caller_company, v_floor_plan_id,
               p_equipment_type, p_equipment_size, v_billing_scope,
               p_canvas_x, p_canvas_y,
               p_asset_tags[g.i], p_serial_numbers[g.i],
               v_caller_user
          FROM generate_series(1, p_quantity) AS g(i)
        RETURNING id
    )
    SELECT array_agg(id) INTO v_placement_ids FROM new_placements;

    IF array_length(p_moisture_pin_ids, 1) IS NOT NULL THEN
        INSERT INTO equipment_pin_assignments (
            equipment_placement_id, moisture_pin_id,
            job_id, company_id, assigned_by
        )
        SELECT placement_id, pin_id,
               p_job_id, v_caller_company, v_caller_user
          FROM unnest(v_placement_ids)    AS placement_id
          CROSS JOIN (
              SELECT DISTINCT pin_id FROM unnest(p_moisture_pin_ids) AS pin_id
          ) deduped;

        v_assignments := p_quantity * (
            SELECT COUNT(DISTINCT pin_id) FROM unnest(p_moisture_pin_ids) AS pin_id
        );
    END IF;

    RETURN jsonb_build_object(
        'placement_ids',    v_placement_ids,
        'placement_count',  p_quantity,
        'assignment_count', v_assignments,
        'billing_scope',    v_billing_scope,
        'floor_plan_id',    v_floor_plan_id
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION place_equipment_with_pins(
    UUID, UUID, TEXT, TEXT, INT, NUMERIC, NUMERIC, UUID[], TEXT[], TEXT[]
) TO authenticated, service_role;

-- Restore compute_placement_billable_days with per_pin branch (c5e7a9b1d3f6).
CREATE OR REPLACE FUNCTION compute_placement_billable_days(
    p_placement_id UUID
) RETURNS INT AS $$
DECLARE
    v_caller_company UUID;
    v_tz             TEXT;
    v_scope          TEXT;
    v_days           INT;
BEGIN
    IF p_placement_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_placement_id is required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company';
    END IF;

    SELECT j.timezone, ep.billing_scope
      INTO v_tz, v_scope
      FROM equipment_placements ep
      JOIN jobs j ON j.id = ep.job_id
     WHERE ep.id = p_placement_id
       AND ep.company_id = v_caller_company;
    IF v_tz IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Placement not found or not accessible';
    END IF;

    IF v_scope = 'per_pin' THEN
        SELECT COUNT(DISTINCT d) INTO v_days
          FROM (
              SELECT generate_series(
                  date_trunc('day', assigned_at AT TIME ZONE v_tz)::date,
                  date_trunc('day', COALESCE(unassigned_at, now()) AT TIME ZONE v_tz)::date,
                  INTERVAL '1 day'
              )::date AS d
                FROM equipment_pin_assignments
               WHERE equipment_placement_id = p_placement_id
          ) s;
    ELSE
        SELECT COUNT(DISTINCT d) INTO v_days
          FROM (
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
$$ LANGUAGE plpgsql
   STABLE
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION compute_placement_billable_days(UUID)
    TO authenticated, service_role;

-- Restore validate_placement_billable_days with per_pin branch (c5e7a9b1d3f6).
CREATE OR REPLACE FUNCTION validate_placement_billable_days(
    p_placement_id UUID
) RETURNS TABLE (
    day              DATE,
    supported        BOOLEAN,
    reading_count    INT,
    has_meter_photo  BOOLEAN
) AS $$
DECLARE
    v_caller_company UUID;
    v_tz             TEXT;
    v_scope          TEXT;
BEGIN
    IF p_placement_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_placement_id is required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company';
    END IF;

    SELECT j.timezone, ep.billing_scope
      INTO v_tz, v_scope
      FROM equipment_placements ep
      JOIN jobs j ON j.id = ep.job_id
     WHERE ep.id = p_placement_id
       AND ep.company_id = v_caller_company;
    IF v_tz IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'Placement not found or not accessible';
    END IF;

    IF v_scope = 'per_pin' THEN
        RETURN QUERY
        WITH billable_days AS (
            SELECT DISTINCT d AS day
              FROM (
                  SELECT generate_series(
                      date_trunc('day', assigned_at AT TIME ZONE v_tz)::date,
                      date_trunc('day', COALESCE(unassigned_at, now()) AT TIME ZONE v_tz)::date,
                      INTERVAL '1 day'
                  )::date AS d
                    FROM equipment_pin_assignments
                   WHERE equipment_placement_id = p_placement_id
              ) s
        ),
        readings_per_day AS (
            SELECT (mpr.taken_at AT TIME ZONE v_tz)::date AS day,
                   COUNT(*)::int AS reading_count,
                   BOOL_OR(mpr.meter_photo_url IS NOT NULL) AS has_photo
              FROM moisture_pin_readings mpr
              JOIN equipment_pin_assignments epa
                ON epa.moisture_pin_id = mpr.pin_id
               AND epa.equipment_placement_id = p_placement_id
               AND mpr.taken_at >= epa.assigned_at
               AND mpr.taken_at <= COALESCE(epa.unassigned_at, now())
             GROUP BY (mpr.taken_at AT TIME ZONE v_tz)::date
        )
        SELECT bd.day,
               COALESCE(rpd.reading_count, 0) > 0 AS supported,
               COALESCE(rpd.reading_count, 0)     AS reading_count,
               COALESCE(rpd.has_photo, false)     AS has_meter_photo
          FROM billable_days bd
          LEFT JOIN readings_per_day rpd ON rpd.day = bd.day
         ORDER BY bd.day;
    ELSE
        RETURN QUERY
        SELECT d AS day,
               false AS supported,
               0 AS reading_count,
               false AS has_meter_photo
          FROM (
              SELECT generate_series(
                  date_trunc('day', ep.placed_at AT TIME ZONE v_tz)::date,
                  date_trunc('day', COALESCE(ep.pulled_at, now()) AT TIME ZONE v_tz)::date,
                  INTERVAL '1 day'
              )::date AS d
                FROM equipment_placements ep
               WHERE ep.id = p_placement_id
          ) s
         ORDER BY day;
    END IF;
END;
$$ LANGUAGE plpgsql
   STABLE
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION validate_placement_billable_days(UUID)
    TO authenticated, service_role;

-- Restore move_equipment_placement's original pin-aware body from
-- a3c5e7b9d1f4. Signature grows from 5 params → 6 (adds back
-- p_new_moisture_pin_ids) + renames p_note → p_new_moisture_pin_ids
-- position; Postgres requires DROP before CREATE for both changes.
-- Lesson #10 — full signature on the DROP.
DROP FUNCTION IF EXISTS move_equipment_placement(
    UUID, UUID, NUMERIC, NUMERIC, TEXT
);

CREATE OR REPLACE FUNCTION move_equipment_placement(
    p_placement_id          UUID,
    p_new_room_id           UUID,
    p_new_canvas_x          NUMERIC,
    p_new_canvas_y          NUMERIC,
    p_new_moisture_pin_ids  UUID[] DEFAULT NULL,
    p_note                  TEXT   DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_caller_company  UUID;
    v_caller_user     UUID;
    v_placement       equipment_placements%ROWTYPE;
    v_floor_plan_id   UUID;
    v_closed_count    INT := 0;
    v_opened_count    INT := 0;
    v_unique_pin_ids  UUID[];
BEGIN
    IF p_placement_id IS NULL OR p_new_room_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'p_placement_id and p_new_room_id are required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
                    MESSAGE = 'No authenticated company';
    END IF;

    SELECT * INTO v_placement
      FROM equipment_placements
     WHERE id = p_placement_id
       AND company_id = v_caller_company
       FOR UPDATE;
    IF v_placement.id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Placement not found or not accessible';
    END IF;

    PERFORM ensure_job_mutable(v_placement.job_id);

    PERFORM 1
      FROM job_rooms
     WHERE id = p_new_room_id
       AND job_id = v_placement.job_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002',
                    MESSAGE = 'Target room not found on this job or not accessible';
    END IF;

    IF v_placement.billing_scope = 'per_room' AND p_new_moisture_pin_ids IS NOT NULL
       AND array_length(p_new_moisture_pin_ids, 1) > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
                    MESSAGE = 'per_room equipment cannot be assigned to moisture pins';
    END IF;

    SELECT id INTO v_caller_user
      FROM users
     WHERE auth_user_id = auth.uid()
       AND company_id = v_caller_company
       AND deleted_at IS NULL;

    SELECT floor_plan_id INTO v_floor_plan_id
      FROM jobs
     WHERE id = v_placement.job_id
       AND company_id = v_caller_company;

    UPDATE equipment_placements
       SET room_id       = p_new_room_id,
           canvas_x      = p_new_canvas_x,
           canvas_y      = p_new_canvas_y,
           floor_plan_id = v_floor_plan_id,
           notes         = COALESCE(p_note, notes),
           updated_at    = now()
     WHERE id = p_placement_id;

    IF v_placement.billing_scope = 'per_pin' THEN
        IF p_new_moisture_pin_ids IS NOT NULL THEN
            PERFORM validate_pins_for_assignment(v_placement.job_id, p_new_moisture_pin_ids);

            SELECT ARRAY(SELECT DISTINCT pin_id FROM unnest(p_new_moisture_pin_ids) AS pin_id)
              INTO v_unique_pin_ids;

            WITH closed AS (
                UPDATE equipment_pin_assignments
                   SET unassigned_at   = now(),
                       unassigned_by   = v_caller_user,
                       unassign_reason = 'equipment_moved'
                 WHERE equipment_placement_id = p_placement_id
                   AND unassigned_at IS NULL
                   AND (v_unique_pin_ids IS NULL
                        OR moisture_pin_id <> ALL(v_unique_pin_ids))
                RETURNING 1
            )
            SELECT COUNT(*) INTO v_closed_count FROM closed;

            IF v_unique_pin_ids IS NOT NULL AND array_length(v_unique_pin_ids, 1) > 0 THEN
                WITH opened AS (
                    INSERT INTO equipment_pin_assignments (
                        equipment_placement_id, moisture_pin_id,
                        job_id, company_id, assigned_by
                    )
                    SELECT p_placement_id, pin_id,
                           v_placement.job_id, v_caller_company, v_caller_user
                      FROM unnest(v_unique_pin_ids) AS pin_id
                     WHERE NOT EXISTS (
                         SELECT 1 FROM equipment_pin_assignments epa
                          WHERE epa.equipment_placement_id = p_placement_id
                            AND epa.moisture_pin_id = pin_id
                            AND epa.unassigned_at IS NULL
                     )
                    RETURNING 1
                )
                SELECT COUNT(*) INTO v_opened_count FROM opened;
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'placement_id',    p_placement_id,
        'room_id',         p_new_room_id,
        'floor_plan_id',   v_floor_plan_id,
        'closed_count',    v_closed_count,
        'opened_count',    v_opened_count
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION move_equipment_placement(
    UUID, UUID, NUMERIC, NUMERIC, UUID[], TEXT
) TO authenticated, service_role;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
