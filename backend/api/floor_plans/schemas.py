from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class FloorPlanCreate(BaseModel):
    floor_number: int = Field(default=1, ge=0, le=10, description="0=basement, 1-10=above ground")
    floor_name: str = Field(default="Floor 1", max_length=50)
    canvas_data: dict | None = None


class FloorPlanUpdate(BaseModel):
    floor_number: int | None = Field(default=None, ge=0, le=10)
    floor_name: str | None = Field(default=None, max_length=50)
    canvas_data: dict | None = None
    thumbnail_url: str | None = None


class FloorPlanResponse(BaseModel):
    id: UUID
    job_id: UUID
    company_id: UUID
    floor_number: int
    floor_name: str
    canvas_data: dict | None
    thumbnail_url: str | None
    created_at: datetime
    updated_at: datetime


class SketchCleanupRequest(BaseModel):
    canvas_data: dict


class SketchChatRequest(BaseModel):
    canvas_data: dict
    message: str = Field(..., min_length=1, max_length=2000)


class SketchAIResponse(BaseModel):
    canvas_data: dict
