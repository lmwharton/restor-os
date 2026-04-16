from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# Shared type aliases for the 13 room types, 4 ceiling types, 4 floor levels
RoomType = Literal[
    "living_room",
    "kitchen",
    "bathroom",
    "bedroom",
    "basement",
    "hallway",
    "laundry_room",
    "garage",
    "dining_room",
    "office",
    "closet",
    "utility_room",
    "other",
]
CeilingType = Literal["flat", "vaulted", "cathedral", "sloped"]
FloorLevel = Literal["basement", "main", "upper", "attic"]


class RoomCreate(BaseModel):
    room_name: str = Field(..., min_length=1, max_length=100)
    floor_plan_id: UUID | None = None
    length_ft: Decimal | None = Field(default=None, ge=0)
    width_ft: Decimal | None = Field(default=None, ge=0)
    height_ft: Decimal | None = Field(default=Decimal("8.0"), ge=0)
    # V2 fields (Spec 01H)
    room_type: RoomType | None = None
    ceiling_type: CeilingType = "flat"
    floor_level: FloorLevel | None = None
    affected: bool = False
    material_flags: list[str] = Field(default_factory=list)
    room_polygon: list[dict] | None = None
    floor_openings: list[dict] = Field(default_factory=list)
    custom_wall_sf: Decimal | None = Field(default=None, ge=0)
    # Existing fields
    water_category: str | None = None
    water_class: str | None = None
    dry_standard: Decimal | None = Field(default=None, ge=0)
    equipment_air_movers: int = Field(default=0, ge=0)
    equipment_dehus: int = Field(default=0, ge=0)
    room_sketch_data: dict | None = None
    notes: str | None = None
    sort_order: int = 0


class RoomUpdate(BaseModel):
    room_name: str | None = Field(default=None, min_length=1, max_length=100)
    floor_plan_id: UUID | None = None
    length_ft: Decimal | None = Field(default=None, ge=0)
    width_ft: Decimal | None = Field(default=None, ge=0)
    height_ft: Decimal | None = Field(default=None, ge=0)
    # V2 fields (Spec 01H)
    room_type: RoomType | None = None
    ceiling_type: CeilingType | None = None
    floor_level: FloorLevel | None = None
    affected: bool | None = None
    material_flags: list[str] | None = None
    room_polygon: list[dict] | None = None
    floor_openings: list[dict] | None = None
    custom_wall_sf: Decimal | None = Field(default=None, ge=0)
    # Existing fields
    water_category: str | None = None
    water_class: str | None = None
    dry_standard: Decimal | None = Field(default=None, ge=0)
    equipment_air_movers: int | None = Field(default=None, ge=0)
    equipment_dehus: int | None = Field(default=None, ge=0)
    room_sketch_data: dict | None = None
    notes: str | None = None
    sort_order: int | None = None


class RoomResponse(BaseModel):
    id: UUID
    job_id: UUID
    company_id: UUID
    floor_plan_id: UUID | None
    room_name: str
    length_ft: Decimal | None
    width_ft: Decimal | None
    height_ft: Decimal | None
    square_footage: Decimal | None
    # V2 fields (Spec 01H)
    room_type: str | None = None
    ceiling_type: str = "flat"
    floor_level: str | None = None
    affected: bool = False
    material_flags: list | None = None
    wall_square_footage: Decimal | None = None
    custom_wall_sf: Decimal | None = None
    room_polygon: list | None = None
    floor_openings: list | None = None
    # Existing fields
    water_category: str | None
    water_class: str | None
    dry_standard: Decimal | None
    equipment_air_movers: int
    equipment_dehus: int
    room_sketch_data: dict | None
    notes: str | None
    sort_order: int
    reading_count: int = 0
    latest_reading_date: date | None = None
    created_at: datetime
    updated_at: datetime


class RoomListResponse(BaseModel):
    items: list[RoomResponse]
    total: int
