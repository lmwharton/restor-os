"""Spec 01H Phase 2 follow-up: enforce moisture_pins.wall_segment_id ↔ room_id binding via trigger.

Closes the lesson-#32 paired-write asymmetry surfaced in critical
review of the Phase 2 location-split branch. Background:

* The atomic ``create_moisture_pin_with_reading`` RPC (introduced in
  ``e2b3c4d5f6a7``) carries the lesson-#30 cross-room wall binding
  check inside its body — ``PERFORM 1 FROM wall_segments WHERE id =
  p_wall_segment_id AND room_id = p_room_id AND company_id =
  v_caller_company`` runs atomically before the INSERT lands.
* The PATCH path (``api/moisture_pins/service.py::update_pin``) does
  the equivalent check at the **Python layer** — `.select("id").eq(...)`
  followed by a separate `.update({...})`. Two statements, with a
  TOCTOU window between them, and any caller bypassing the FastAPI
  service (admin tooling, direct PostgREST writes, future RPCs)
  inherits no enforcement at all.

Lesson #32 verbatim ("paired-write asymmetry"): "closing out an RPC in
a write family (place+move, create+update, open+close) → list
invariants explicitly + check every sibling has them all. Silent-drop
on one + loud-reject on other = split-brain."

Fix: pull the invariant down to the table level via a BEFORE INSERT OR
UPDATE row trigger that runs on every write to ``moisture_pins``,
regardless of code path. The trigger fires when ``wall_segment_id`` is
non-NULL (no-op otherwise) and validates the same three predicates the
RPC checks: wall exists, lives in the named room, owned by the same
company. Raises ``P0002`` (no_data_found) on mismatch — same SQLSTATE
the RPC uses, so any catch site already handles it.

The existing RPC body's PERFORM block becomes redundant but is kept
intact: it gives a clearer error message at the API edge before the
INSERT ever reaches the trigger, and removing it would require another
migration that swaps the RPC body — extra churn for zero behavioral
gain. Two layers of the same check is the etag-style defense-in-depth
pattern (lesson #15: every write path enforces the contract atomically
at the DB layer).

Why a trigger and not a CHECK constraint: CHECKs cannot reference
other tables in PostgreSQL. The binding has to be enforced
imperatively against ``wall_segments`` rows.

Revision ID: e4d5f6a7b8c9
Revises: e3c4d5f6a7b8
Create Date: 2026-04-26
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4d5f6a7b8c9"
down_revision: str | None = "e3c4d5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_SQL = """
-- ============================================================================
-- Trigger function: validate that NEW.wall_segment_id (when non-NULL)
-- references a wall_segments row whose room_id + company_id match the
-- pin's. Mirrors the lesson-#30 PERFORM block in the create RPC.
--
-- SECURITY DEFINER not used — the trigger runs as the row's writer,
-- which is the right boundary: the wall_segments lookup uses the
-- caller's RLS so a tenant can only verify against walls they can see.
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_moisture_pin_wall_segment_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Skip when no wall is referenced. The chk_moisture_pin_wall_segment_only_when_wall
    -- CHECK already enforces "NULL or surface='wall'", so a non-NULL
    -- wall_segment_id implies surface='wall' — no extra guard needed here.
    IF NEW.wall_segment_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Lesson #30: FK only validates wall existence. Parent-room +
    -- tenant binding are separate invariants. EXISTS (instead of
    -- PERFORM 1) reads cleaner inside an IF.
    IF NOT EXISTS (
        SELECT 1
          FROM wall_segments
         WHERE id = NEW.wall_segment_id
           AND room_id = NEW.room_id
           AND company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'Wall segment does not belong to this pin''s room or tenant'
              USING ERRCODE = 'P0002';
    END IF;

    RETURN NEW;
END;
$$;

-- BEFORE so the trigger blocks the write rather than racing to repair
-- it after the row lands. INSERT covers the create path (defense-in-
-- depth alongside the RPC's PERFORM); UPDATE is the path the original
-- review surfaced as Python-only.

DROP TRIGGER IF EXISTS trg_moisture_pin_wall_segment_binding ON moisture_pins;

CREATE TRIGGER trg_moisture_pin_wall_segment_binding
    BEFORE INSERT OR UPDATE OF wall_segment_id, room_id ON moisture_pins
    FOR EACH ROW
    EXECUTE FUNCTION validate_moisture_pin_wall_segment_binding();

COMMENT ON TRIGGER trg_moisture_pin_wall_segment_binding ON moisture_pins IS
    'Enforces wall_segment_id.room_id == moisture_pins.room_id AND '
    'wall_segment_id.company_id == moisture_pins.company_id whenever '
    'wall_segment_id is non-NULL. Closes lesson #32 paired-write '
    'asymmetry — create RPC carried this check inline; update path '
    'previously enforced in Python only. Spec 01H Phase 2 follow-up '
    'e4d5f6a7b8c9.';
"""


DOWNGRADE_SQL = """
DROP TRIGGER IF EXISTS trg_moisture_pin_wall_segment_binding ON moisture_pins;
DROP FUNCTION IF EXISTS validate_moisture_pin_wall_segment_binding();
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
