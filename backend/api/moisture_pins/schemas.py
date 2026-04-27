"""Pydantic schemas for moisture pins and their time-series readings.

Pins are spatial; readings are temporal. The pin response is "fat" — it
includes latest_reading, color, and is_regressing so the frontend renders
the canvas in one round trip without per-pin follow-up calls.
"""

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

# Material types that drive dry-standard defaults. "tile" is intentionally
# excluded — it's non-absorbent and has no meaningful moisture reading.
MoistureMaterial = Literal[
    "drywall",
    "wood_subfloor",
    "carpet_pad",
    "concrete",
    "hardwood",
    "osb_plywood",
    "block_wall",
]

# Spec 01H Phase 2 (location split): which surface the pin sits on. Replaces
# the old composed `location_name` along with `position` + `wall_segment_id`.
MoistureSurface = Literal["floor", "wall", "ceiling"]

# Quadrant within the surface. Required for floor today; nullable for
# wall/ceiling (semantics deferred — picker UX will define).
MoisturePosition = Literal["C", "NW", "NE", "SW", "SE"]

PinColor = Literal["red", "amber", "green"]


# --- Pin Readings ------------------------------------------------------------


class MoisturePinReadingCreate(BaseModel):
    reading_value: Decimal = Field(..., ge=0, le=100)
    # Spec 01H Phase 3 Step 3: TIMESTAMPTZ replaces DATE so multiple
    # readings per pin per day are allowed and the Step 4 dry-check trigger
    # has strict ordering.
    taken_at: datetime
    meter_photo_url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)


class MoisturePinReadingUpdate(BaseModel):
    reading_value: Decimal | None = Field(default=None, ge=0, le=100)
    taken_at: datetime | None = None
    meter_photo_url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)


class MoisturePinReadingResponse(BaseModel):
    id: UUID
    pin_id: UUID
    reading_value: Decimal
    taken_at: datetime
    recorded_by: UUID | None
    meter_photo_url: str | None
    notes: str | None
    created_at: datetime


# --- Pins --------------------------------------------------------------------


class MoisturePinCreate(BaseModel):
    """Create a pin and its initial reading in one call.

    If `dry_standard` is omitted, the service layer fills in the default
    for the chosen material (see DRY_STANDARDS in service.py).
    """

    room_id: UUID = Field(
        ...,
        description=(
            "Pin must belong to a room. Whitespace drops are rejected per "
            "the Spec 01H Phase 2 decision: the room is what 'dries out.'"
        ),
    )
    canvas_x: Decimal = Field(..., ge=0, le=10000)
    canvas_y: Decimal = Field(..., ge=0, le=10000)
    # Spec 01H Phase 2 location split: structured fields replace the old
    # composed `location_name`. surface + position are both required for
    # every pin (DB columns are NOT NULL after migration e3c4d5f6a7b8);
    # wall_segment_id is only meaningful when surface == 'wall'. The DB
    # CHECK enforces the wall_segment_id binding (lesson #7); Pydantic
    # mirrors it here so callers see a 422 instead of round-tripping a
    # CHECK violation as a 500.
    surface: MoistureSurface
    position: MoisturePosition
    wall_segment_id: UUID | None = None
    material: MoistureMaterial
    dry_standard: Decimal | None = Field(default=None, ge=0, le=100)
    initial_reading: MoisturePinReadingCreate

    @model_validator(mode="after")
    def _wall_segment_only_on_wall(self) -> "MoisturePinCreate":
        # Mirror the DB CHECK chk_moisture_pin_wall_segment_only_when_wall:
        # wall_segment_id may only be set when surface == 'wall'. Floor or
        # ceiling pins with a stray wall ref are loud-rejected at the API
        # edge so callers don't see a generic CHECK violation 500.
        if self.wall_segment_id is not None and self.surface != "wall":
            raise ValueError(
                "wall_segment_id may only be set when surface == 'wall'"
            )
        return self


class MoisturePinUpdate(BaseModel):
    surface: MoistureSurface | None = None
    position: MoisturePosition | None = None
    wall_segment_id: UUID | None = None
    material: MoistureMaterial | None = None
    dry_standard: Decimal | None = Field(default=None, ge=0, le=100)
    canvas_x: Decimal | None = Field(default=None, ge=0, le=10000)
    canvas_y: Decimal | None = Field(default=None, ge=0, le=10000)
    room_id: UUID | None = None

    @model_validator(mode="after")
    def _wall_segment_only_on_wall(self) -> "MoisturePinUpdate":
        # If surface is being changed to non-wall, the patch must clear
        # wall_segment_id in the same request (set it explicitly to null).
        # Otherwise a stale wall ref would survive the surface flip and
        # trip the DB CHECK as a generic 500. This mirrors the Create-side
        # validator and matches the lesson #7 "never silently drop" rule.
        if (
            self.surface is not None
            and self.surface != "wall"
            and self.wall_segment_id is not None
        ):
            raise ValueError(
                "wall_segment_id must be null when surface is not 'wall' "
                "(send wall_segment_id: null explicitly when changing surface)"
            )
        return self

    @model_validator(mode="after")
    def _position_not_explicit_null(self) -> "MoisturePinUpdate":
        # Position is NOT NULL on the DB column (migration e3c4d5f6a7b8).
        # On PATCH, omitting `position` from the body is fine ("don't
        # change") — but explicit null would attempt to clear it and the
        # DB would reject the UPDATE. Reject at the API edge with a clear
        # message so callers don't get a generic constraint-violation 500.
        # Distinguishes "not in body" (allowed, ignored) from "explicit
        # null in body" (rejected) via Pydantic's set-tracking on the raw
        # __pydantic_fields_set__.
        if "position" in self.model_fields_set and self.position is None:
            raise ValueError(
                "position cannot be cleared (NOT NULL); send a valid "
                "position value or omit the field to leave it unchanged"
            )
        return self


class MoisturePinResponse(BaseModel):
    """Decorated pin response — includes latest reading, color, and regression
    flag so the canvas can render pins in a single round trip."""

    id: UUID
    job_id: UUID
    room_id: UUID | None
    canvas_x: Decimal
    canvas_y: Decimal
    # Spec 01H Phase 2 location split (migrations e2b3c4d5f6a7 + e3c4d5f6a7b8) —
    # surface + position required for every pin (DB columns NOT NULL);
    # wall_segment_id only meaningful when surface == 'wall'. Must be
    # declared on the response model or FastAPI strips them on the wire
    # even when the service dict includes them (lesson #24).
    surface: MoistureSurface
    position: MoisturePosition
    wall_segment_id: UUID | None = None
    material: MoistureMaterial
    dry_standard: Decimal
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime
    # Spec 01H Phase 3 Step 2: "is this pin currently dry" signal. Trigger
    # sets it when the latest reading hits dry_standard; clears on re-wet.
    # Must be declared here or FastAPI's response_model strips it on the
    # wire even if the service dict carries it (lesson #24).
    dry_standard_met_at: datetime | None = None
    # Decorated fields — computed at read time from readings
    latest_reading: MoisturePinReadingResponse | None = None
    color: PinColor | None = None  # null when no readings exist yet
    is_regressing: bool = False
    reading_count: int = 0
    # List-endpoint-only fields. Populated by list_pins_by_job (which
    # embeds both via PostgREST) so the moisture-report view + adjuster
    # portal can render without N+1 queries. Default to None/empty on
    # responses that don't populate them (PATCH / DELETE paths).
    readings: list[MoisturePinReadingResponse] | None = None
    floor_plan_id: UUID | None = None


class MoisturePinListResponse(BaseModel):
    items: list[MoisturePinResponse]
    total: int


class MoisturePinReadingListResponse(BaseModel):
    items: list[MoisturePinReadingResponse]
    total: int
