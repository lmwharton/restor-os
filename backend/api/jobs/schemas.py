from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class JobCreate(BaseModel):
    # Required
    address_line1: str
    loss_type: str = "water"

    # Job type — mitigation (default) or reconstruction
    job_type: Literal["mitigation", "reconstruction"] = "mitigation"

    # Optional — link reconstruction job to its mitigation job
    linked_job_id: UUID | None = None

    # Optional — address
    city: str = ""
    state: str = ""
    zip: str = ""

    # Optional — property link
    property_id: UUID | None = None

    # Optional — customer
    customer_name: str | None = None
    customer_phone: str | None = None
    customer_email: str | None = None

    # Optional — loss info
    loss_category: str | None = None
    loss_class: str | None = None
    loss_cause: str | None = None
    loss_date: date | None = None

    # Optional — property age (for lead/asbestos hazmat flagging)
    home_year_built: int | None = Field(None, ge=1600, le=2100)

    # Optional — insurance
    claim_number: str | None = None
    carrier: str | None = None
    adjuster_name: str | None = None
    adjuster_phone: str | None = None
    adjuster_email: str | None = None

    # Optional — geocoding
    latitude: float | None = None
    longitude: float | None = None

    # Optional — notes
    notes: str | None = None
    tech_notes: str | None = None


class JobUpdate(BaseModel):
    status: str | None = None

    # Address
    address_line1: str | None = None
    city: str | None = None
    state: str | None = None
    zip: str | None = None

    # Property link
    property_id: UUID | None = None

    # Customer
    customer_name: str | None = None
    customer_phone: str | None = None
    customer_email: str | None = None

    # Loss info
    loss_type: str | None = None
    loss_category: str | None = None
    loss_class: str | None = None
    loss_cause: str | None = None
    loss_date: date | None = None
    home_year_built: int | None = Field(None, ge=1600, le=2100)

    # Insurance
    claim_number: str | None = None
    carrier: str | None = None
    adjuster_name: str | None = None
    adjuster_phone: str | None = None
    adjuster_email: str | None = None

    # Notes
    notes: str | None = None
    tech_notes: str | None = None


class LinkedJobSummary(BaseModel):
    id: UUID
    job_number: str
    job_type: str
    status: str


class JobResponse(BaseModel):
    id: UUID
    company_id: UUID
    property_id: UUID | None = None
    job_type: str = "mitigation"
    linked_job_id: UUID | None = None
    linked_job_summary: LinkedJobSummary | None = None
    job_number: str
    address_line1: str
    city: str
    state: str
    zip: str
    customer_name: str | None = None
    customer_phone: str | None = None
    customer_email: str | None = None
    claim_number: str | None = None
    carrier: str | None = None
    adjuster_name: str | None = None
    adjuster_phone: str | None = None
    adjuster_email: str | None = None
    loss_type: str
    loss_category: str | None = None
    loss_class: str | None = None
    loss_cause: str | None = None
    loss_date: date | None = None
    home_year_built: int | None = Field(None, ge=1600, le=2100)
    status: str
    floor_plan_id: UUID | None = None
    # Spec 01H Phase 3 (PR-A, Step 1): IANA timezone for distinct-local-
    # calendar-day billing math. Must be declared here or FastAPI's
    # response_model strips it between the service return dict and the
    # HTTP wire, even though the DB column is populated (lesson #24).
    timezone: str = "America/New_York"
    # Spec 01H Phase 3 PR-B2 Step 5: current-completion stamps. NULL while
    # the job is active; set by complete_job RPC; cleared by reopen_job RPC.
    # Historical cycles live in job_completion_events (insert-only log).
    # Declared here so FastAPI's response_model doesn't silently strip them.
    completed_at: datetime | None = None
    completed_by: UUID | None = None
    assigned_to: UUID | None = None
    notes: str | None = None
    tech_notes: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    created_by: UUID | None = None
    updated_by: UUID | None = None
    created_at: datetime
    updated_at: datetime


class JobDetailResponse(JobResponse):
    room_count: int = 0
    photo_count: int = 0
    floor_plan_count: int = 0
    line_item_count: int = 0


class JobListResponse(BaseModel):
    items: list[JobDetailResponse]
    total: int


# --- Spec 01H Phase 3 PR-B2: job completion lifecycle ---


class JobCompleteRequest(BaseModel):
    """Body for POST /v1/jobs/{id}/complete.

    ``notes`` is optional — the tech may add a comment ("customer confirmed
    drying acceptable") that gets stored on the job_completion_events row.
    """

    notes: str | None = None


class JobCompleteResponse(BaseModel):
    """Return payload from complete_job RPC.

    Declared on response_model so all five fields reach the wire (lesson #24).
    ``auto_pulled_count`` surfaces how many active equipment placements the
    RPC auto-pulled — the UI uses it for a confirmation toast.
    """

    job_id: UUID
    completed_at: datetime
    auto_pulled_count: int
    completion_event_id: UUID


class JobReopenRequest(BaseModel):
    """Body for POST /v1/jobs/{id}/reopen.

    ``reason`` is REQUIRED — reopening erases the completion stamp on the
    jobs row (history is preserved in job_completion_events). The reason
    field forces the admin to record WHY so the audit trail is useful.
    Enforced at both the Pydantic layer (min_length=1) and the DB RPC
    (trimmed length > 0).
    """

    reason: str = Field(min_length=1)


class JobReopenResponse(BaseModel):
    """Return payload from reopen_job RPC."""

    job_id: UUID
    reopened_at: datetime
    previous_completed_at: datetime
    completion_event_id: UUID
