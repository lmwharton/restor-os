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
    floor_plan_version_id: UUID | None = None
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
