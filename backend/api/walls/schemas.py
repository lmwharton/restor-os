from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# --- Wall Segments ---


class WallSegmentCreate(BaseModel):
    x1: Decimal = Field(..., description="Start X coordinate (canvas pixels)")
    y1: Decimal = Field(..., description="Start Y coordinate (canvas pixels)")
    x2: Decimal = Field(..., description="End X coordinate (canvas pixels)")
    y2: Decimal = Field(..., description="End Y coordinate (canvas pixels)")
    wall_type: Literal["exterior", "interior"] = "interior"
    wall_height_ft: Decimal | None = Field(default=None, ge=0)
    affected: bool = False
    shared: bool = False
    shared_with_room_id: UUID | None = None
    sort_order: int = 0


class WallSegmentUpdate(BaseModel):
    x1: Decimal | None = None
    y1: Decimal | None = None
    x2: Decimal | None = None
    y2: Decimal | None = None
    wall_type: Literal["exterior", "interior"] | None = None
    wall_height_ft: Decimal | None = Field(default=None, ge=0)
    affected: bool | None = None
    shared: bool | None = None
    shared_with_room_id: UUID | None = None
    sort_order: int | None = None


class WallOpeningResponse(BaseModel):
    id: UUID
    wall_id: UUID
    company_id: UUID
    opening_type: str
    position: Decimal
    width_ft: Decimal
    height_ft: Decimal
    sill_height_ft: Decimal | None
    swing: int | None
    created_at: datetime
    updated_at: datetime


class WallSegmentResponse(BaseModel):
    id: UUID
    room_id: UUID
    company_id: UUID
    x1: Decimal
    y1: Decimal
    x2: Decimal
    y2: Decimal
    wall_type: str
    wall_height_ft: Decimal | None
    affected: bool
    shared: bool
    shared_with_room_id: UUID | None
    sort_order: int
    openings: list[WallOpeningResponse] = []
    created_at: datetime
    updated_at: datetime


class WallSegmentListResponse(BaseModel):
    items: list[WallSegmentResponse]
    total: int


# --- Wall Openings ---


class WallOpeningCreate(BaseModel):
    opening_type: Literal["door", "window", "missing_wall"]
    position: Decimal = Field(..., ge=0, le=1, description="0-1 parametric position along the wall")
    width_ft: Decimal = Field(..., gt=0)
    height_ft: Decimal = Field(..., gt=0)
    sill_height_ft: Decimal | None = Field(default=None, ge=0)
    swing: int | None = Field(default=None, ge=0, le=3)


class WallOpeningUpdate(BaseModel):
    opening_type: Literal["door", "window", "missing_wall"] | None = None
    position: Decimal | None = Field(default=None, ge=0, le=1)
    width_ft: Decimal | None = Field(default=None, gt=0)
    height_ft: Decimal | None = Field(default=None, gt=0)
    sill_height_ft: Decimal | None = Field(default=None, ge=0)
    swing: int | None = Field(default=None, ge=0, le=3)
