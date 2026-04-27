"""Pin-the-invariant schema tests for the Phase 2 location split.

Mirrors the DB CHECKs at the API edge so a caller hitting an invalid
combination gets a clean 422 with a readable message instead of round-
tripping a Postgres CHECK violation back as a 500. Each test corresponds
to one rule in ``docs/pr-review-lessons.md``:

- Lesson #7 (never silently drop) — bidirectional binding: floor/ceiling
  pin with stray wall_segment_id is loud-rejected.
- Lesson #2 (raise, don't swallow) — wall pin without a picked segment
  is ALLOWED (draft state per spec) — explicit positive test guards
  against an over-zealous future tightening.
- Lesson #24 (response_model strips undeclared) — surface, position,
  wall_segment_id are explicitly declared on MoisturePinResponse.

Pure schema tests: no DB, no fake client, no asyncio.
"""

from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import ValidationError

from api.moisture_pins.schemas import (
    MoisturePinCreate,
    MoisturePinReadingCreate,
    MoisturePinResponse,
    MoisturePinUpdate,
)


def _valid_initial_reading() -> MoisturePinReadingCreate:
    return MoisturePinReadingCreate(
        reading_value=Decimal("15"),
        taken_at="2026-04-26T12:00:00-04:00",
    )


# --- Create-side bidirectional binding --------------------------------------


def test_create_floor_pin_with_wall_segment_id_rejected_422():
    # Lesson #7: floor (or ceiling) pin with a stray wall_segment_id is
    # silent-drop hole if accepted. Caller gets a clear 422 instead of
    # a confusing CHECK violation 500 from the DB.
    with pytest.raises(ValidationError) as exc:
        MoisturePinCreate(
            room_id=uuid4(),
            canvas_x=Decimal("100"),
            canvas_y=Decimal("100"),
            surface="floor",
            position="C",
            wall_segment_id=uuid4(),  # invalid for surface=floor
            material="drywall",
            initial_reading=_valid_initial_reading(),
        )
    assert "wall_segment_id may only be set when surface == 'wall'" in str(exc.value)


def test_create_ceiling_pin_with_wall_segment_id_rejected_422():
    # Same lesson #7 invariant — both non-wall surfaces enforce it.
    with pytest.raises(ValidationError):
        MoisturePinCreate(
            room_id=uuid4(),
            canvas_x=Decimal("100"),
            canvas_y=Decimal("100"),
            surface="ceiling",
            position=None,
            wall_segment_id=uuid4(),
            material="drywall",
            initial_reading=_valid_initial_reading(),
        )


def test_create_wall_pin_with_segment_accepted():
    # Wall + segment = canonical happy path (post-picker world).
    pin = MoisturePinCreate(
        room_id=uuid4(),
        canvas_x=Decimal("100"),
        canvas_y=Decimal("100"),
        surface="wall",
        position="C",
        wall_segment_id=uuid4(),
        material="drywall",
        initial_reading=_valid_initial_reading(),
    )
    assert pin.surface == "wall"
    assert pin.wall_segment_id is not None


def test_create_wall_pin_without_segment_accepted():
    # Lesson #2 cousin — wall pin in DRAFT state (no segment picked yet)
    # must be allowed; the wall_segment_id CHECK is one-directional. This
    # test guards against a future "tighten the rule" change that would
    # make the picker-less placement flow break before its UI ships.
    pin = MoisturePinCreate(
        room_id=uuid4(),
        canvas_x=Decimal("100"),
        canvas_y=Decimal("100"),
        surface="wall",
        position="C",
        wall_segment_id=None,  # draft — picker UX hasn't shipped
        material="drywall",
        initial_reading=_valid_initial_reading(),
    )
    assert pin.surface == "wall"
    assert pin.wall_segment_id is None


def test_create_pin_without_position_rejected():
    # Phase 2 follow-up (migration e3c4d5f6a7b8) — position is now
    # required for every surface (DB column NOT NULL). Pydantic rejects
    # a missing/null position with 422 instead of round-tripping a
    # 22023 from the RPC NULL guard. Cover all three surfaces so a
    # future relaxation has to fail this test deliberately.
    for surface in ("floor", "wall", "ceiling"):
        with pytest.raises(ValidationError):
            MoisturePinCreate(
                room_id=uuid4(),
                canvas_x=Decimal("100"),
                canvas_y=Decimal("100"),
                surface=surface,
                position=None,
                material="drywall",
                initial_reading=_valid_initial_reading(),
            )


def test_update_explicit_null_position_rejected():
    # PATCH semantics: omitting position means "don't change" — that's
    # fine. But explicit `null` would attempt to clear the NOT NULL
    # column. Reject at the API edge with a clear message rather than
    # letting the DB rejection surface as a generic 500.
    with pytest.raises(ValidationError) as exc:
        MoisturePinUpdate(position=None)
    assert "position cannot be cleared" in str(exc.value)


def test_update_position_omitted_accepted():
    # Sibling positive test for the rule above — leaving position out
    # of the patch leaves it untouched, which is the common case.
    patch = MoisturePinUpdate(material="hardwood")
    assert patch.position is None  # default
    assert "position" not in patch.model_fields_set


def test_create_invalid_surface_value_rejected():
    # Literal type guard — only floor/wall/ceiling accepted.
    with pytest.raises(ValidationError):
        MoisturePinCreate(
            room_id=uuid4(),
            canvas_x=Decimal("100"),
            canvas_y=Decimal("100"),
            surface="window",  # not a valid surface
            position=None,
            material="drywall",
            initial_reading=_valid_initial_reading(),
        )


def test_create_invalid_position_value_rejected():
    # Literal type guard — only C/NW/NE/SW/SE accepted.
    with pytest.raises(ValidationError):
        MoisturePinCreate(
            room_id=uuid4(),
            canvas_x=Decimal("100"),
            canvas_y=Decimal("100"),
            surface="floor",
            position="up",  # not a valid position
            material="drywall",
            initial_reading=_valid_initial_reading(),
        )


# --- Update-side surface flip with stale wall_segment_id --------------------


def test_update_surface_flip_to_floor_with_stale_wall_segment_id_rejected():
    # Lesson #7 — surface flip wall→floor MUST clear wall_segment_id in
    # the same patch. Auto-clearing is the silent-coerce pattern lesson
    # #2 warns against. Reject and force the client to send both fields
    # together.
    with pytest.raises(ValidationError) as exc:
        MoisturePinUpdate(
            surface="floor",
            wall_segment_id=uuid4(),  # stale — surface no longer wall
        )
    assert "wall_segment_id must be null when surface is not 'wall'" in str(exc.value)


def test_update_surface_flip_to_floor_with_explicit_null_wall_segment_id_accepted():
    # The "send both fields explicitly" path. Caller knows the rule;
    # this is the contract.
    patch = MoisturePinUpdate(surface="floor", wall_segment_id=None)
    assert patch.surface == "floor"
    assert patch.wall_segment_id is None


def test_update_surface_unchanged_with_wall_segment_id_change_accepted():
    # Setting a NEW wall_segment_id without changing surface (already
    # wall) is the re-tap-to-fix-wall flow. Should be accepted.
    patch = MoisturePinUpdate(wall_segment_id=uuid4())
    assert patch.wall_segment_id is not None
    assert patch.surface is None  # untouched


def test_update_clear_position_only_accepted():
    # Updating position alone (e.g., correcting a tap from C to NW)
    # should pass the validator with no surface in the patch.
    patch = MoisturePinUpdate(position="NW")
    assert patch.position == "NW"


# --- Response model shape (lesson #24) --------------------------------------


def test_response_model_includes_surface_position_wall_segment_id():
    # Lesson #24: FastAPI's response_model silently strips undeclared
    # fields. If the response model didn't declare these, the service
    # could put them in the dict and the wire format would still be the
    # pre-change shape — debugging that takes hours. Pin the field set.
    fields = MoisturePinResponse.model_fields
    assert "surface" in fields
    assert "position" in fields
    assert "wall_segment_id" in fields


def test_response_model_drops_location_name():
    # Negative — make sure the old field doesn't linger on the response
    # shape. If a service somewhere still puts it in the dict, the
    # response model should drop it on the wire (matches the DB schema
    # post-migration).
    fields = MoisturePinResponse.model_fields
    assert "location_name" not in fields
