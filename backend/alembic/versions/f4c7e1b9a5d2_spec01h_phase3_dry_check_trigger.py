"""Spec 01H Phase 3 (PR-A, Step 4): dry-check trigger on moisture_pin_readings.

Every INSERT to ``moisture_pin_readings`` fires this trigger, which
maintains the ``moisture_pins.dry_standard_met_at`` column added in
Step 2:

- Reading value drops to or below the pin's ``dry_standard`` AND the pin
  wasn't already marked dry → set ``dry_standard_met_at = NEW.taken_at``.
- Reading value rises back above the pin's ``dry_standard`` AND the pin
  was marked dry → clear ``dry_standard_met_at`` to NULL (re-wet).
- The incoming reading isn't the latest for this pin (out-of-order sync,
  offline-first replay) → skip. We don't retroactively change the pin's
  state from a stale reading.

Uses the pin's own ``dry_standard`` (per-pin override, Spec 01H Phase 2
decision 5) — NOT the material-type default in the service layer. Some
carriers accept higher thresholds for specific materials, and those
overrides must win (lesson C3 from the Phase 3 proposal review).

Out-of-order guard uses ``NEW.taken_at >= COALESCE(MAX(existing), -infinity)``
so the first reading for a pin still fires (no existing readings → max is
NULL → coalesce to ``-infinity`` → comparison always true) while any
strictly-earlier late-sync reading skips.

Why this logic lives in the DB, not Python: Phase 3 equipment pins
(PR-B) need an authoritative "is this pin currently dry" signal the
database can ACT on — auto-closing equipment assignments when the pin
dries, rejecting re-assignment of equipment to an already-dry pin,
emitting a re-wet notification when a dry pin turns wet again. A
trigger keeps the signal in sync atomically with each reading write.
Lesson #4 (atomic composition) — the sync can't live outside the DB.

Frontend coloring stays unchanged. The sparkline's per-date color
computation is a historical rendering concern; this column answers
the different question "right now, operationally, is the pin dry?"

Revision ID: f4c7e1b9a5d2
Revises: e7b9c2f4a8d6
Create Date: 2026-04-24
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f4c7e1b9a5d2"
down_revision: str | None = "e7b9c2f4a8d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
CREATE OR REPLACE FUNCTION moisture_pin_dry_check()
RETURNS TRIGGER AS $$
DECLARE
    v_dry_standard NUMERIC;
    v_current_met  TIMESTAMPTZ;
    v_max_taken_at TIMESTAMPTZ;
BEGIN
    -- Serialize concurrent triggers for the same pin (review round-1 M2).
    -- Under READ COMMITTED, two concurrent INSERTs on the same pin each
    -- see zero other readings via their snapshot and race to UPDATE the
    -- dry_standard_met_at column, possibly landing the wrong winner. Row-
    -- locking the pin here forces serial execution of the trigger body
    -- per-pin while leaving inserts for DIFFERENT pins fully parallel.
    -- FOR NO KEY UPDATE (not FOR UPDATE) is the right strength — we're
    -- reading + updating non-key columns, not touching the primary key.
    PERFORM id
      FROM moisture_pins
     WHERE id = NEW.pin_id
       FOR NO KEY UPDATE;

    -- Read the pin's own dry_standard + current met state. Using the
    -- per-pin override (not the material default) closes lesson C3 —
    -- carrier-accepted custom thresholds would otherwise be ignored.
    SELECT dry_standard, dry_standard_met_at
      INTO v_dry_standard, v_current_met
      FROM moisture_pins
     WHERE id = NEW.pin_id;

    -- Pin gone (FK would normally block this, but defense-in-depth).
    IF v_dry_standard IS NULL THEN
        RETURN NEW;
    END IF;

    -- Out-of-order guard: only act if NEW is the newest reading for
    -- this pin. Excludes NEW.id from the MAX so an AFTER-insert trigger
    -- doesn't compare NEW against itself. COALESCE(-infinity) lets the
    -- FIRST reading for a pin pass the check (prior MAX is NULL).
    SELECT MAX(taken_at) INTO v_max_taken_at
      FROM moisture_pin_readings
     WHERE pin_id = NEW.pin_id
       AND id != NEW.id;

    IF NEW.taken_at < COALESCE(v_max_taken_at, '-infinity'::TIMESTAMPTZ) THEN
        -- Late-sync reading older than what we already have. Skip; the
        -- pin's current state already reflects newer data.
        RETURN NEW;
    END IF;

    -- State machine: four distinguishable cases, two act, two no-op.
    IF NEW.reading_value <= v_dry_standard AND v_current_met IS NULL THEN
        -- Pin just went dry. Stamp with the reading's taken_at (not
        -- now()) so the recorded dry-time matches what the tech says
        -- actually happened in the field.
        UPDATE moisture_pins
           SET dry_standard_met_at = NEW.taken_at,
               updated_at = now()
         WHERE id = NEW.pin_id;
    ELSIF NEW.reading_value > v_dry_standard AND v_current_met IS NOT NULL THEN
        -- Pin was dry, went wet again. Clear the stamp; downstream
        -- consumers (Phase 3 equipment auto-close / re-wet notification)
        -- will see NULL on their next read.
        UPDATE moisture_pins
           SET dry_standard_met_at = NULL,
               updated_at = now()
         WHERE id = NEW.pin_id;
    END IF;
    -- Other cases (still wet, or still dry with a new dry reading) are
    -- no-ops — the state column already reflects the correct answer.

    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog, public;


-- Attach AFTER INSERT so the row is visible in moisture_pin_readings
-- when the UPDATE probes MAX(taken_at). BEFORE INSERT would miss the
-- current row in the MAX and give wrong ordering decisions in the
-- (rare) simultaneous-insert case.
DROP TRIGGER IF EXISTS trg_moisture_pin_dry_check ON moisture_pin_readings;
CREATE TRIGGER trg_moisture_pin_dry_check
    AFTER INSERT ON moisture_pin_readings
    FOR EACH ROW
    EXECUTE FUNCTION moisture_pin_dry_check();
"""


DOWNGRADE_SQL = """
DROP TRIGGER IF EXISTS trg_moisture_pin_dry_check ON moisture_pin_readings;
DROP FUNCTION IF EXISTS moisture_pin_dry_check();
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
