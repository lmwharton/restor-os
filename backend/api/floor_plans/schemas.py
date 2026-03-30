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


class FloorPlanListResponse(BaseModel):
    items: list[FloorPlanResponse]
    total: int


# --- Sketch Cleanup (deterministic, no AI) ---


class SketchCleanupRequest(BaseModel):
    """Optional client-supplied canvas_data for cleaning unsaved edits.
    If omitted, server fetches from the saved floor plan record."""

    canvas_data: dict | None = None


class SketchCleanupResponse(BaseModel):
    """Response from deterministic sketch cleanup. No AI cost."""

    canvas_data: dict
    changes_made: list[str] = []
    event_id: UUID


# --- Sketch Edit (Claude AI, Spec 02) ---


class SketchEditRequest(BaseModel):
    """Natural language instruction to modify the sketch."""

    instruction: str = Field(..., min_length=1, max_length=2000)


class SketchEditResponse(BaseModel):
    """Response from AI sketch edit. Includes cost tracking."""

    canvas_data: dict
    changes_made: list[str] = []
    event_id: UUID
    cost_cents: int = 0
    duration_ms: int = 0
