"""Spec 01H Phase 2 (M3): atomic create_moisture_pin_with_reading RPC.

Closes a silent-failure window in ``api.moisture_pins.service.create_pin``:

The Python code used to do two sequential writes — INSERT pin, then
INSERT its initial reading — with a compensating DELETE on the pin if
the second INSERT raised. That compensation is itself un-guarded:
a transient error inside the DELETE (RLS reject, network flake, row
already vacuumed by a concurrent cleanup) leaves a pin alive with no
readings. Frontend then renders the orphan as a grey "no reading yet"
dot on canvas — looks identical to a freshly-placed pin waiting for
its first save, so the tech can't tell the real state apart.

Pr-review-lessons #4 (atomic → non-atomic composition regression) ruled
exactly this shape out during Phase 1 Round 4, with save_floor_plan_version
as the canonical example. Same pattern applied here: one plpgsql
function, one transaction, INSERT-then-INSERT, atomic rollback on any
failure inside the function.

Tenancy: SECURITY DEFINER bypasses RLS inside the function. We derive
the caller's company from the JWT via get_my_company_id() and assert
it matches p_company_id — exact shape as c7f8a9b0d1e2 R3 for
save_floor_plan_version. Client-supplied p_company_id is never trusted
on its own.

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-04-23
"""

from collections.abc import Sequence

from alembic import op


revision: str = "e1f2a3b4c5d6"
down_revision: str | tuple[str, ...] | None = "d0e1f2a3b4c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE OR REPLACE FUNCTION create_moisture_pin_with_reading(
    p_job_id          UUID,
    p_room_id         UUID,
    p_company_id      UUID,
    p_canvas_x        NUMERIC,
    p_canvas_y        NUMERIC,
    p_location_name   TEXT,
    p_material        TEXT,
    p_dry_standard    NUMERIC,
    p_created_by      UUID,
    p_reading_value   NUMERIC,
    p_reading_date    DATE,
    p_meter_photo_url TEXT,
    p_notes           TEXT
) RETURNS JSONB AS $$
DECLARE
    v_caller_company UUID;
    v_pin            moisture_pins%ROWTYPE;
    v_reading        moisture_pin_readings%ROWTYPE;
BEGIN
    -- NULL param guards. We never accept NULL for fields that are
    -- NOT NULL in the schema; failing fast here gives a cleaner error
    -- than waiting for the INSERT to raise a 23502.
    IF p_job_id IS NULL OR p_room_id IS NULL OR p_company_id IS NULL
       OR p_canvas_x IS NULL OR p_canvas_y IS NULL
       OR p_location_name IS NULL OR p_material IS NULL
       OR p_dry_standard IS NULL
       OR p_reading_value IS NULL OR p_reading_date IS NULL
    THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023';
    END IF;

    -- Tenancy: derive the caller's company from the JWT, never trust
    -- the client-supplied p_company_id on its own. Same shape as
    -- save_floor_plan_version R3 hardening.
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

    -- INSERT the pin. Any failure here raises out naturally.
    INSERT INTO moisture_pins (
        job_id, room_id, company_id,
        canvas_x, canvas_y, location_name,
        material, dry_standard, created_by
    ) VALUES (
        p_job_id, p_room_id, p_company_id,
        p_canvas_x, p_canvas_y, p_location_name,
        p_material, p_dry_standard, p_created_by
    )
    RETURNING * INTO v_pin;

    -- INSERT the initial reading. If this raises — 23505 unique
    -- violation on (pin_id, reading_date), RLS reject, anything — the
    -- enclosing function-level transaction rolls back the pin insert
    -- above atomically. No orphan pin survives.
    INSERT INTO moisture_pin_readings (
        pin_id, company_id, reading_value, reading_date,
        recorded_by, meter_photo_url, notes
    ) VALUES (
        v_pin.id, p_company_id, p_reading_value, p_reading_date,
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

GRANT EXECUTE ON FUNCTION create_moisture_pin_with_reading(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, UUID,
    NUMERIC, DATE, TEXT, TEXT
) TO authenticated, service_role;
"""


DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS create_moisture_pin_with_reading(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, UUID,
    NUMERIC, DATE, TEXT, TEXT
);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
