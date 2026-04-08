"""Reconstruction phase schemas — data shapes for request/response."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class PhaseCreate(BaseModel):
    """Request body for creating a new phase."""
    phase_name: str
    status: Literal["pending", "in_progress", "on_hold", "complete"] = "pending"
    sort_order: int = 0
    notes: str | None = None


class PhaseUpdate(BaseModel):
    """Request body for updating a phase. Only send fields to change."""
    phase_name: str | None = None
    status: Literal["pending", "in_progress", "on_hold", "complete"] | None = None
    notes: str | None = None


class PhaseReorderItem(BaseModel):
    """A single item in a reorder request."""
    id: UUID
    sort_order: int


class PhaseReorderRequest(BaseModel):
    """Request body for bulk reordering phases."""
    phases: list[PhaseReorderItem]


class PhaseResponse(BaseModel):
    """Response shape for a single phase."""
    id: UUID
    job_id: UUID
    company_id: UUID
    phase_name: str
    status: str
    sort_order: int
    started_at: datetime | None = None
    completed_at: datetime | None = None
    notes: str | None = None
    created_at: datetime
    updated_at: datetime
