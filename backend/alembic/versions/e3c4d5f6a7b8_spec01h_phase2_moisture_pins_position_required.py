"""Spec 01H Phase 2 follow-up: make moisture_pins.position NOT NULL.

Tightens the position contract introduced by ``e2b3c4d5f6a7``. Previously
``position`` was nullable because the original migration backfilled
wall + ceiling rows with NULL on the (now-revoked) "position semantics
deferred for non-floor surfaces" reasoning. The placement sheet
also force-nulled position for non-floor surfaces — both fixed in the
post-landing 2026-04-26 patch.

Now that every code path emits a position regardless of surface,
the schema should match: position is required for every pin.

Order of operations:

1. Backfill any row still carrying ``position IS NULL`` (only legacy
   wall/ceiling rows from the prior migration's backfill rule) to
   ``'C'`` (Center). Safest neutral default — if the tech later edits
   it, the audit trail captures the change.
2. ``ALTER COLUMN position SET NOT NULL`` — fails loud if step 1 missed
   a row.
3. Replace ``create_moisture_pin_with_reading`` to add ``p_position`` to
   the NULL guard. DROP-before-CREATE on signature change is unnecessary
   here (signature unchanged) but the body re-adds it inside the
   required-params check.

The DB CHECK ``chk_moisture_pin_position`` (added in e2b3c4d5f6a7)
already constrains the value enum (`C/NW/NE/SW/SE`); adding NOT NULL
is the orthogonal "must be present" half. Both together = "must be
one of these five values, no exceptions."

Downgrade:

1. Restore the prior RPC body (position is allowed NULL inside the
   required-params guard).
2. ``ALTER COLUMN position DROP NOT NULL``.

We intentionally do NOT re-NULL the backfilled rows on downgrade —
``'C'`` is a valid position value, and reverting it to NULL would
change observable application state on rollback. Lesson #10's spirit
("downgrade succeeds against any lawful forward state") favors
preserving the data.

Revision ID: e3c4d5f6a7b8
Revises: e2b3c4d5f6a7
Create Date: 2026-04-26
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e3c4d5f6a7b8"
down_revision: str | None = "e2b3c4d5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ============================================================================
-- Step 1: backfill any row with NULL position to 'C' (Center).
-- Only the legacy wall + ceiling rows from e2b3c4d5f6a7's backfill
-- rule should still carry NULL — every post-fix INSERT writes a real
-- position. Safe baseline — tech can re-edit afterwards.
-- ============================================================================

UPDATE moisture_pins
   SET position = 'C'
 WHERE position IS NULL;

-- ============================================================================
-- Step 2: flip position NOT NULL. Fails loud if any row didn't backfill
-- (would surface a malformed legacy state we'd want to know about).
-- ============================================================================

ALTER TABLE moisture_pins
    ALTER COLUMN position SET NOT NULL;

-- ============================================================================
-- Step 3: replace create_moisture_pin_with_reading. Signature unchanged
-- (15 args, same shape) so CREATE OR REPLACE is sufficient. The body's
-- required-params NULL guard now also rejects p_position IS NULL with
-- the same 22023 SQLSTATE.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_moisture_pin_with_reading(
    p_job_id          UUID,
    p_room_id         UUID,
    p_company_id      UUID,
    p_canvas_x        NUMERIC,
    p_canvas_y        NUMERIC,
    p_surface         TEXT,
    p_position        TEXT,
    p_wall_segment_id UUID,
    p_material        TEXT,
    p_dry_standard    NUMERIC,
    p_created_by      UUID,
    p_reading_value   NUMERIC,
    p_taken_at        TIMESTAMPTZ,
    p_meter_photo_url TEXT,
    p_notes           TEXT
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_floor_plan_id  UUID;
    v_pin            moisture_pins%ROWTYPE;
    v_reading        moisture_pin_readings%ROWTYPE;
BEGIN
    -- NULL-required guards. p_position is now in the required set
    -- (Phase 2 follow-up e3c4d5f6a7b8) — every pin carries a position.
    IF p_job_id IS NULL OR p_room_id IS NULL OR p_company_id IS NULL
       OR p_canvas_x IS NULL OR p_canvas_y IS NULL
       OR p_surface IS NULL OR p_position IS NULL OR p_material IS NULL
       OR p_dry_standard IS NULL
       OR p_reading_value IS NULL OR p_taken_at IS NULL
    THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;
    IF v_caller_company <> p_company_id THEN
        RAISE EXCEPTION 'Company mismatch'
              USING ERRCODE = '42501',
                    MESSAGE = 'p_company_id does not match caller company';
    END IF;

    -- Cross-room wall binding (lesson #30) — preserved from e2b3c4d5f6a7.
    IF p_wall_segment_id IS NOT NULL THEN
        PERFORM 1 FROM wall_segments
         WHERE id = p_wall_segment_id
           AND room_id = p_room_id
           AND company_id = v_caller_company;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Wall segment does not belong to this room or tenant'
                  USING ERRCODE = 'P0002';
        END IF;
    END IF;

    SELECT floor_plan_id INTO v_floor_plan_id
      FROM job_rooms
     WHERE id = p_room_id
       AND company_id = v_caller_company;

    INSERT INTO moisture_pins (
        job_id, room_id, company_id,
        canvas_x, canvas_y,
        surface, position, wall_segment_id,
        material, dry_standard, created_by,
        floor_plan_id
    ) VALUES (
        p_job_id, p_room_id, p_company_id,
        p_canvas_x, p_canvas_y,
        p_surface, p_position, p_wall_segment_id,
        p_material, p_dry_standard, p_created_by,
        v_floor_plan_id
    )
    RETURNING * INTO v_pin;

    INSERT INTO moisture_pin_readings (
        pin_id, company_id, reading_value, taken_at,
        recorded_by, meter_photo_url, notes
    ) VALUES (
        v_pin.id, p_company_id, p_reading_value, p_taken_at,
        p_created_by, p_meter_photo_url, p_notes
    )
    RETURNING * INTO v_reading;

    RETURN jsonb_build_object(
        'pin', to_jsonb(v_pin),
        'reading', to_jsonb(v_reading)
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;
"""


# Symmetric downgrade. Restore the prior RPC body (position allowed NULL
# inside the required-params guard) and DROP NOT NULL on the column.
# Backfilled rows keep their `'C'` value — reverting them to NULL would
# change observable application state on rollback (lesson #10 spirit).
DOWNGRADE_SQL = """
-- ============================================================================
-- Step 1: restore the prior RPC body (position omitted from the NULL
-- guard — matches e2b3c4d5f6a7's body byte-for-byte).
-- ============================================================================

CREATE OR REPLACE FUNCTION create_moisture_pin_with_reading(
    p_job_id          UUID,
    p_room_id         UUID,
    p_company_id      UUID,
    p_canvas_x        NUMERIC,
    p_canvas_y        NUMERIC,
    p_surface         TEXT,
    p_position        TEXT,
    p_wall_segment_id UUID,
    p_material        TEXT,
    p_dry_standard    NUMERIC,
    p_created_by      UUID,
    p_reading_value   NUMERIC,
    p_taken_at        TIMESTAMPTZ,
    p_meter_photo_url TEXT,
    p_notes           TEXT
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_floor_plan_id  UUID;
    v_pin            moisture_pins%ROWTYPE;
    v_reading        moisture_pin_readings%ROWTYPE;
BEGIN
    IF p_job_id IS NULL OR p_room_id IS NULL OR p_company_id IS NULL
       OR p_canvas_x IS NULL OR p_canvas_y IS NULL
       OR p_surface IS NULL OR p_material IS NULL
       OR p_dry_standard IS NULL
       OR p_reading_value IS NULL OR p_taken_at IS NULL
    THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;
    IF v_caller_company <> p_company_id THEN
        RAISE EXCEPTION 'Company mismatch'
              USING ERRCODE = '42501',
                    MESSAGE = 'p_company_id does not match caller company';
    END IF;

    IF p_wall_segment_id IS NOT NULL THEN
        PERFORM 1 FROM wall_segments
         WHERE id = p_wall_segment_id
           AND room_id = p_room_id
           AND company_id = v_caller_company;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Wall segment does not belong to this room or tenant'
                  USING ERRCODE = 'P0002';
        END IF;
    END IF;

    SELECT floor_plan_id INTO v_floor_plan_id
      FROM job_rooms
     WHERE id = p_room_id
       AND company_id = v_caller_company;

    INSERT INTO moisture_pins (
        job_id, room_id, company_id,
        canvas_x, canvas_y,
        surface, position, wall_segment_id,
        material, dry_standard, created_by,
        floor_plan_id
    ) VALUES (
        p_job_id, p_room_id, p_company_id,
        p_canvas_x, p_canvas_y,
        p_surface, p_position, p_wall_segment_id,
        p_material, p_dry_standard, p_created_by,
        v_floor_plan_id
    )
    RETURNING * INTO v_pin;

    INSERT INTO moisture_pin_readings (
        pin_id, company_id, reading_value, taken_at,
        recorded_by, meter_photo_url, notes
    ) VALUES (
        v_pin.id, p_company_id, p_reading_value, p_taken_at,
        p_created_by, p_meter_photo_url, p_notes
    )
    RETURNING * INTO v_reading;

    RETURN jsonb_build_object(
        'pin', to_jsonb(v_pin),
        'reading', to_jsonb(v_reading)
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

-- ============================================================================
-- Step 2: drop NOT NULL on position. Backfilled rows keep their 'C'
-- value — re-NULLing them would change application state on rollback
-- (lesson #10 spirit: downgrade preserves any lawful forward data).
-- ============================================================================

ALTER TABLE moisture_pins
    ALTER COLUMN position DROP NOT NULL;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
