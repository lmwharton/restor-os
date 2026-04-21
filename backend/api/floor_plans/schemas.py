from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class FloorPlanCreate(BaseModel):
    floor_number: int = Field(default=1, ge=0, le=10, description="0=basement, 1-10=above ground")
    floor_name: str = Field(default="Floor 1", max_length=50)
    canvas_data: dict | None = None


class FloorPlanUpdate(BaseModel):
    """Metadata-only updates. Content changes (canvas_data) must go through
    POST /floor-plans/{id}/versions (save_canvas) so the versioning state
    machine and the archive-job gate are the single write surface for content.
    """

    floor_number: int | None = Field(default=None, ge=0, le=10)
    floor_name: str | None = Field(default=None, max_length=50)
    thumbnail_url: str | None = None


class FloorPlanResponse(BaseModel):
    """Unified floor plan response — each row IS a versioned snapshot after
    the container/versions merge (see Alembic e1a7c9b30201)."""

    id: UUID
    property_id: UUID
    company_id: UUID
    floor_number: int
    floor_name: str
    version_number: int
    canvas_data: dict | None
    created_by_job_id: UUID | None = None
    created_by_user_id: UUID | None = None
    change_summary: str | None = None
    is_current: bool = False
    thumbnail_url: str | None = None
    created_at: datetime
    updated_at: datetime


class FloorPlanListResponse(BaseModel):
    items: list[FloorPlanResponse]
    total: int


# --- Canvas save (job-driven versioning, single endpoint) ---


class FloorPlanSaveRequest(BaseModel):
    """Save canvas changes. Service layer handles create-vs-update-vs-fork logic."""

    job_id: UUID = Field(..., description="Which job is saving (needed for version ownership)")
    canvas_data: dict = Field(..., description="Canvas state to save")
    change_summary: str | None = Field(default=None, max_length=500)


# --- Sketch Cleanup (deterministic, no AI) ---


class SketchCleanupRequest(BaseModel):
    """Optional client-supplied canvas_data for cleaning unsaved edits.
    If omitted, server fetches from the saved floor plan record.

    `job_id` is required: cleanup writes back to canvas_data on the
    is_current row, so running it against a collected job's pinned version
    would break the "frozen once collected" contract. Requiring job_id
    lets the server always enforce the archive-job gate (C1) with no
    conditional bypass path."""

    job_id: UUID
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
