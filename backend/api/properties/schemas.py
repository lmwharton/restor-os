from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class PropertyCreate(BaseModel):
    address_line1: str = Field(..., min_length=1, max_length=500)
    address_line2: str | None = None
    city: str = Field(..., min_length=1, max_length=100)
    state: str = Field(..., min_length=2, max_length=2)
    zip: str = Field(..., min_length=5, max_length=10)
    latitude: float | None = None
    longitude: float | None = None
    year_built: int | None = Field(None, ge=1600, le=2030)
    property_type: str | None = None  # residential | commercial | multi-family
    total_sqft: int | None = Field(None, ge=0)


class PropertyUpdate(BaseModel):
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    zip: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    year_built: int | None = None
    property_type: str | None = None
    total_sqft: int | None = None


class PropertyResponse(BaseModel):
    id: UUID
    company_id: UUID
    address_line1: str
    address_line2: str | None
    city: str
    state: str
    zip: str
    latitude: float | None
    longitude: float | None
    usps_standardized: str | None
    year_built: int | None
    property_type: str | None
    total_sqft: int | None
    created_at: datetime
    updated_at: datetime
