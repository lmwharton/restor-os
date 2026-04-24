"""Spec 01H Phase 3 PR-B Step 7: billable-day math RPCs.

Two pure-read functions that together are the carrier-defensibility
story for equipment billing.

``compute_placement_billable_days(placement_id)`` → INT
  Returns the billable day count for one placement, bucketed by the
  job's timezone (``jobs.timezone``, PR-A Step 1).

    - per_pin: union of all assignment spans on this placement, count
      distinct local calendar days. A dehu serving 3 pins for 3 days
      gets 3 — not 9 — because assignment spans that overlap in time
      collapse to one billable day.

    - per_room: count distinct local days from placed_at → pulled_at
      (or now() if still on-site). Same math, different span source.

``validate_placement_billable_days(placement_id)`` → TABLE(day, supported, reading_count, has_meter_photo)
  Per-billable-day audit. For each day the compute function would
  count, check whether any reading exists on an attributed pin that
  day. Feeds the carrier-report "drying days not supported by
  moisture logs" warning (TPA rejection trigger #2 per the proposal).

Both functions are SECURITY DEFINER and STABLE. Both derive tenant
from ``get_my_company_id()`` and RAISE 42501 on cross-tenant
(lesson §3 / C4-C5). Both scoped via a 1-row WHERE so there's no
way to probe for billable days on another tenant's placement.

Revision ID: c5e7a9b1d3f6
Revises: a3c5e7b9d1f4
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5e7a9b1d3f6"
down_revision: str | None = "a3c5e7b9d1f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
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

    -- Tenant + placement lookup in one SELECT. Cross-tenant resolves
    -- as 42501 (lesson §3 / C5) rather than silent empty — the caller
    -- must not be able to probe for other tenants' billable totals.
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
        -- Union of assignment spans → distinct local days. The
        -- generate_series per-span expansion lets us DISTINCT across
        -- spans in a single COUNT. Spans that overlap in time collapse
        -- to one day per the billing principle "bill per-unit-per-day,
        -- not per-pin-per-day" (proposal §2.2).
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
        -- per_room: single synthetic span from the placement itself.
        -- Same date-trunc + generate_series shape so per-pin and
        -- per-room days come out in the same units (proposal S7 —
        -- unified math, not different rules per type).
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


-- ---------------------------------------------------------------------------
-- validate_placement_billable_days — per-day audit, feeds carrier report.
-- ---------------------------------------------------------------------------

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

    -- Cross-tenant raises 42501 (lesson CP5 — empty-set return on
    -- cross-tenant is misleading, matches compute_placement_billable_days).
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
        -- Enumerate every billable day (same shape as the compute
        -- function). Then LEFT JOIN the reading counts so days without
        -- a supporting reading surface as supported=false.
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
            -- Review round-1 H2: the join must be time-bounded by the
            -- assignment window. Earlier shape joined any reading on
            -- any pin EVER assigned to this placement, which marked
            -- days supported=true when the reading's pin was NOT
            -- actually being dried by this unit on that day (e.g.,
            -- placement X dried pin A Apr 20-22, then pin B Apr 25-27;
            -- a late reading on pin A on Apr 26 wrongly supported
            -- Apr 26 even though pin B was the active one). That's the
            -- exact over-report shape TPA rejection trigger #2 was
            -- added to catch — a false-positive supported flag is
            -- worse than none.
            --
            -- Bounding the join by (assigned_at, unassigned_at]
            -- restricts the count to readings taken WHILE the pin was
            -- actively attributed to this placement. COALESCE on
            -- unassigned_at covers the still-active assignment case.
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
        -- per_room: no pin attributions, so there's nothing to
        -- validate readings against. Return every day as
        -- supported=false so the carrier-report surface knows there
        -- are no moisture-log entries backing these days (the
        -- per-room evidence chain is a separate follow-up in
        -- 10-reports.md, called out in proposal §8.4).
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
"""


DOWNGRADE_SQL = """
DROP FUNCTION IF EXISTS validate_placement_billable_days(UUID);
DROP FUNCTION IF EXISTS compute_placement_billable_days(UUID);
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
