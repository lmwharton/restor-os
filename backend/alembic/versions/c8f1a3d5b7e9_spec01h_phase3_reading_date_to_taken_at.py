"""Spec 01H Phase 3 (PR-A, Step 3): moisture_pin_readings.reading_date (DATE) -> taken_at (TIMESTAMPTZ).

Two load-bearing changes:

1. Column swap: ``reading_date DATE`` is replaced with ``taken_at TIMESTAMPTZ``.
   Sub-day precision unlocks two downstream requirements:
   - Multiple readings per pin per day (Brett's post-demo re-inspection
     workflow silently drops the 2nd save today because of the unique index
     below).
   - Strict ordering for Step 4's dry-check trigger (DATE alone can't decide
     "which of today's two readings is the latest?").

2. Unique index drop: ``idx_pin_reading_date`` on (pin_id, reading_date) goes
   away. The 409-on-duplicate-date logic in the service layer was the wrong
   contract — it was masking data loss, not enforcing business invariants.

Backfill semantics: existing readings get ``taken_at = reading_date +
'12:00:00'::time AT TIME ZONE 'America/New_York'`` — noon on the logged day,
in US Eastern. Noon keeps the row inside its local calendar day regardless
of the viewer's timezone (no midnight-boundary rounding), and Eastern is the
``jobs.timezone`` default set in Step 1. Every pre-existing reading
preserves its logged day; only sub-day precision is synthesized.

RPC signature change: ``create_moisture_pin_with_reading`` swaps
``p_reading_date DATE`` for ``p_taken_at TIMESTAMPTZ``. Lesson #23 (PostgREST
schema-cache drift) applies — after ``alembic upgrade head`` in a live
environment, the cache must be reloaded once via
``NOTIFY pgrst, 'reload schema';``.

Downgrade asymmetry (round-1 critical review H1):
The forward direction's explicit purpose is to allow multiple readings per
pin per day (Brett's post-demo re-inspection workflow, §0.2 B1/B3). The
downgrade restores a NON-unique ``idx_pin_reading_date`` rather than the
original UNIQUE. Restoring UNIQUE would crash with 23505 on any pin that
exercised the forward feature, leaving the DB half-rolled-back. Per
lesson #10's spirit, downgrade must succeed against any lawful forward
state — so we accept the one-way ratchet on uniqueness and document it.
If a rollback lands on a DB where no re-inspection readings exist, the
index lookup performance is identical (single-row-per-day-per-pin is
still the common case); if re-inspection readings exist, they flow
through cleanly with no data loss.

Revision ID: c8f1a3d5b7e9
Revises: b2d4e6f8a1c3
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8f1a3d5b7e9"
down_revision: str | None = "b2d4e6f8a1c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ============================================================================
-- Step 1: drop the unique-per-day index. Multiple readings per pin per day
-- are now a real use case (Brett post-demo re-inspection).
-- ============================================================================

DROP INDEX IF EXISTS idx_pin_reading_date;

-- ============================================================================
-- Step 2: add taken_at as nullable first so the backfill has room to write.
-- We'll flip it NOT NULL after the UPDATE lands.
-- ============================================================================

ALTER TABLE moisture_pin_readings
    ADD COLUMN taken_at TIMESTAMPTZ;

-- ============================================================================
-- Step 3: backfill. reading_date + noon Eastern preserves every row's local
-- calendar day. Using noon (not midnight) avoids any near-boundary rounding
-- if the viewer's timezone shifts the rendered day.
-- ============================================================================

UPDATE moisture_pin_readings
   SET taken_at = (reading_date::text || ' 12:00:00')::timestamp
                  AT TIME ZONE 'America/New_York';

-- ============================================================================
-- Step 4: flip NOT NULL now that every row is populated, and default now()
-- so future inserts without an explicit value use server wall-clock.
-- ============================================================================

ALTER TABLE moisture_pin_readings
    ALTER COLUMN taken_at SET NOT NULL,
    ALTER COLUMN taken_at SET DEFAULT now();

-- ============================================================================
-- Step 5: helpful non-unique index on (pin_id, taken_at DESC) for the
-- "latest reading per pin" queries + sparkline ordering.
-- ============================================================================

CREATE INDEX idx_pin_reading_taken_at
    ON moisture_pin_readings(pin_id, taken_at DESC);

-- ============================================================================
-- Step 6: drop the old reading_date column. Every service + frontend consumer
-- migrates in the same commit — no cross-layer transition window.
-- ============================================================================

ALTER TABLE moisture_pin_readings
    DROP COLUMN reading_date;

-- ============================================================================
-- Step 7: replace create_moisture_pin_with_reading RPC. Signature genuinely
-- changes (p_reading_date DATE -> p_taken_at TIMESTAMPTZ), so we DROP the
-- old form explicitly before CREATE to avoid leaving two overloads around.
-- ============================================================================

DROP FUNCTION IF EXISTS create_moisture_pin_with_reading(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, UUID,
    NUMERIC, DATE, TEXT, TEXT
);

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
       OR p_location_name IS NULL OR p_material IS NULL
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

    SELECT floor_plan_id INTO v_floor_plan_id
      FROM job_rooms
     WHERE id = p_room_id
       AND company_id = v_caller_company;

    INSERT INTO moisture_pins (
        job_id, room_id, company_id,
        canvas_x, canvas_y, location_name,
        material, dry_standard, created_by,
        floor_plan_id
    ) VALUES (
        p_job_id, p_room_id, p_company_id,
        p_canvas_x, p_canvas_y, p_location_name,
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

GRANT EXECUTE ON FUNCTION create_moisture_pin_with_reading(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, UUID,
    NUMERIC, TIMESTAMPTZ, TEXT, TEXT
) TO authenticated, service_role;
"""


DOWNGRADE_SQL = """
-- Reverse order: restore the old RPC signature first (so any in-flight caller
-- between downgrade and completion sees a consistent function), then add back
-- reading_date with data synthesized from taken_at, drop taken_at, restore
-- the unique index.

DROP FUNCTION IF EXISTS create_moisture_pin_with_reading(
    UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, UUID,
    NUMERIC, TIMESTAMPTZ, TEXT, TEXT
);

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
    v_floor_plan_id  UUID;
    v_pin            moisture_pins%ROWTYPE;
    v_reading        moisture_pin_readings%ROWTYPE;
BEGIN
    IF p_job_id IS NULL OR p_room_id IS NULL OR p_company_id IS NULL
       OR p_canvas_x IS NULL OR p_canvas_y IS NULL
       OR p_location_name IS NULL OR p_material IS NULL
       OR p_dry_standard IS NULL
       OR p_reading_value IS NULL OR p_reading_date IS NULL
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

    SELECT floor_plan_id INTO v_floor_plan_id
      FROM job_rooms
     WHERE id = p_room_id
       AND company_id = v_caller_company;

    INSERT INTO moisture_pins (
        job_id, room_id, company_id,
        canvas_x, canvas_y, location_name,
        material, dry_standard, created_by,
        floor_plan_id
    ) VALUES (
        p_job_id, p_room_id, p_company_id,
        p_canvas_x, p_canvas_y, p_location_name,
        p_material, p_dry_standard, p_created_by,
        v_floor_plan_id
    )
    RETURNING * INTO v_pin;

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

-- Restore reading_date from taken_at's local Eastern date. Nullable first
-- so the column add succeeds, then backfill, then NOT NULL.
ALTER TABLE moisture_pin_readings
    ADD COLUMN reading_date DATE;

UPDATE moisture_pin_readings
   SET reading_date = (taken_at AT TIME ZONE 'America/New_York')::date;

ALTER TABLE moisture_pin_readings
    ALTER COLUMN reading_date SET NOT NULL;

DROP INDEX IF EXISTS idx_pin_reading_taken_at;

ALTER TABLE moisture_pin_readings
    DROP COLUMN taken_at;

-- Intentionally NON-unique (review H1): the forward direction allows
-- multiple readings per pin per day, and a UNIQUE restore here crashes
-- with 23505 on any pin that exercised that workflow. See migration
-- docstring for the lesson #10 reasoning.
CREATE INDEX idx_pin_reading_date
    ON moisture_pin_readings(pin_id, reading_date);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
