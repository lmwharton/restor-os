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
    # Spec 01K — generic PATCH /v1/jobs/{id} no longer accepts status.
    # Status changes go through the dedicated PATCH /v1/jobs/{id}/status
    # endpoint so transition validation, optimistic locking, gate checks,
    # and event_history audit are guaranteed atomic.

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
    assigned_to: UUID | None = None
    notes: str | None = None
    tech_notes: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    created_by: UUID | None = None
    updated_by: UUID | None = None
    created_at: datetime
    updated_at: datetime

    # Spec 01K — lifecycle timestamps + reason fields + lead source.
    # All optional / nullable; populated when the relevant transition fires.
    active_at: datetime | None = None
    completed_at: datetime | None = None
    invoiced_at: datetime | None = None
    disputed_at: datetime | None = None
    dispute_resolved_at: datetime | None = None
    paid_at: datetime | None = None
    cancelled_at: datetime | None = None
    on_hold_reason: str | None = None
    on_hold_resume_date: date | None = None
    cancel_reason: str | None = None
    cancel_reason_other: str | None = None
    dispute_reason: str | None = None
    dispute_count: int = 0
    contract_signed_at: datetime | None = None
    estimate_last_finalized_at: datetime | None = None
    lead_source: str | None = None
    lead_source_other: str | None = None


# ---------------------------------------------------------------------------
# Spec 01K — Status update body (atomic transition with optimistic locking)
# ---------------------------------------------------------------------------


class StatusUpdateBody(BaseModel):
    """Body for PATCH /v1/jobs/{job_id}/status — the only path to change status.

    `expected_current_status` enables optimistic-locking. The server compares
    against the row's current status and returns 409 Conflict if stale,
    so the UI can refetch instead of blindly overwriting.
    """

    status: Literal[
        "active", "on_hold", "completed", "invoiced",
        "disputed", "paid", "cancelled", "lost",
    ]
    expected_current_status: Literal[
        "lead", "active", "on_hold", "completed", "invoiced",
        "disputed", "paid", "cancelled", "lost",
    ]
    # Required for on_hold / cancelled / lost / disputed (validated server-side).
    reason: str | None = Field(None, max_length=2000)
    # Only meaningful for on_hold.
    resume_date: date | None = None
    # Closeout gate overrides — list of item_keys the user explicitly accepted.
    # When non-null, the resulting `status_changed` event_history row gets
    # `override_gates` + `override_reason` keys in its event_data payload, so
    # audits can filter via:
    #   WHERE event_type = 'status_changed' AND event_data ? 'override_gates'
    override_gates: list[str] | None = None
    override_reason: str | None = Field(None, max_length=2000)
    # Cancel reason — split shape per Spec 01K D-impl-1 (one populated, never both).
    cancel_reason: str | None = None
    cancel_reason_other: str | None = None


class JobDetailResponse(JobResponse):
    room_count: int = 0
    photo_count: int = 0
    floor_plan_count: int = 0
    line_item_count: int = 0


class JobListResponse(BaseModel):
    items: list[JobDetailResponse]
    total: int


# ---------------------------------------------------------------------------
# Spec 01I — Quick Add Active Jobs (batch import)
# ---------------------------------------------------------------------------


class JobBatchItem(BaseModel):
    """A single row in POST /v1/jobs/batch.

    Required: address_line1.

    Status field accepts either the friendly UI label ('Lead', 'Active',
    'Invoiced') or the underlying enum value — the service maps friendly
    labels to enum values so the frontend can show contractor-facing copy
    without a separate enum.
    """

    address_line1: str = Field(..., min_length=1)
    city: str = ""
    state: str = ""
    zip: str = ""

    customer_name: str | None = None
    customer_phone: str | None = None

    # 'water' default mirrors POST /v1/jobs.
    loss_type: str = "water"

    # Mitigation/reconstruction; defaults to mitigation since most active
    # jobs imported on day 1 are existing mit jobs.
    job_type: Literal["mitigation", "reconstruction"] = "mitigation"

    # Optional. Either the UI label or the enum string. Defaults to 'new'
    # at the SQL layer when omitted.
    status: str | None = None


class JobBatchCreate(BaseModel):
    """Request body for POST /v1/jobs/batch (Spec 01I)."""

    jobs: list[JobBatchItem] = Field(..., min_length=1, max_length=10)


class JobBatchSummary(BaseModel):
    """A single created job's identity, returned in JobBatchResponse."""

    job_id: UUID
    job_number: str


class JobBatchResponse(BaseModel):
    created: int
    jobs: list[JobBatchSummary]
