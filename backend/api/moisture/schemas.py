from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

# --- Moisture Points ---


class MoisturePointCreate(BaseModel):
    location_name: str = Field(..., min_length=1, max_length=200)
    reading_value: Decimal
    meter_photo_url: str | None = None
    sort_order: int = Field(default=0, ge=0)


class MoisturePointUpdate(BaseModel):
    location_name: str | None = Field(default=None, min_length=1, max_length=200)
    reading_value: Decimal | None = None
    meter_photo_url: str | None = None
    sort_order: int | None = Field(default=None, ge=0)


class MoisturePointResponse(BaseModel):
    id: UUID
    reading_id: UUID
    location_name: str
    reading_value: Decimal
    meter_photo_url: str | None
    sort_order: int
    created_at: datetime


# --- Dehu Outputs ---


class DehuOutputCreate(BaseModel):
    dehu_model: str | None = Field(default=None, max_length=200)
    rh_out_pct: Decimal | None = Field(default=None, ge=0, le=100)
    temp_out_f: Decimal | None = Field(default=None, ge=0, le=200)
    sort_order: int = Field(default=0, ge=0)


class DehuOutputUpdate(BaseModel):
    dehu_model: str | None = Field(default=None, max_length=200)
    rh_out_pct: Decimal | None = Field(default=None, ge=0, le=100)
    temp_out_f: Decimal | None = Field(default=None, ge=0, le=200)
    sort_order: int | None = Field(default=None, ge=0)


class DehuOutputResponse(BaseModel):
    id: UUID
    reading_id: UUID
    dehu_model: str | None
    rh_out_pct: Decimal | None
    temp_out_f: Decimal | None
    sort_order: int
    created_at: datetime


# --- Moisture Readings ---


class MoistureReadingCreate(BaseModel):
    reading_date: date
    atmospheric_temp_f: Decimal | None = Field(default=None, ge=0, le=200)
    atmospheric_rh_pct: Decimal | None = Field(default=None, ge=0, le=100)


class MoistureReadingUpdate(BaseModel):
    reading_date: date | None = None
    atmospheric_temp_f: Decimal | None = Field(default=None, ge=0, le=200)
    atmospheric_rh_pct: Decimal | None = Field(default=None, ge=0, le=100)


class MoistureReadingResponse(BaseModel):
    id: UUID
    job_id: UUID
    room_id: UUID
    company_id: UUID
    reading_date: date
    day_number: int | None
    atmospheric_temp_f: Decimal | None
    atmospheric_rh_pct: Decimal | None
    atmospheric_gpp: Decimal | None
    points: list[MoisturePointResponse] = []
    dehus: list[DehuOutputResponse] = []
    created_at: datetime
    updated_at: datetime
