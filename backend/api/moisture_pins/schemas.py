"""Pydantic schemas for moisture pins and their time-series readings.

Pins are spatial; readings are temporal. The pin response is "fat" — it
includes latest_reading, color, and is_regressing so the frontend renders
the canvas in one round trip without per-pin follow-up calls.
"""

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

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
    location_name: str = Field(..., min_length=1, max_length=200)
    material: MoistureMaterial
    dry_standard: Decimal | None = Field(default=None, ge=0, le=100)
    initial_reading: MoisturePinReadingCreate


class MoisturePinUpdate(BaseModel):
    location_name: str | None = Field(default=None, min_length=1, max_length=200)
    material: MoistureMaterial | None = None
    dry_standard: Decimal | None = Field(default=None, ge=0, le=100)
    canvas_x: Decimal | None = Field(default=None, ge=0, le=10000)
    canvas_y: Decimal | None = Field(default=None, ge=0, le=10000)
    room_id: UUID | None = None


class MoisturePinResponse(BaseModel):
    """Decorated pin response — includes latest reading, color, and regression
    flag so the canvas can render pins in a single round trip."""

    id: UUID
    job_id: UUID
    room_id: UUID | None
    canvas_x: Decimal
    canvas_y: Decimal
    location_name: str
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
