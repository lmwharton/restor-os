"""Dashboard response schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class PipelineStage(BaseModel):
    stage: str
    count: int
    total_estimate: float = 0.0


class KPIs(BaseModel):
    active_jobs: int
    jobs_this_month: int
    avg_days_to_complete: float = 0.0


class PriorityJob(BaseModel):
    id: UUID
    job_number: str
    address_line1: str
    city: str
    state: str
    status: str
    customer_name: str | None = None
    loss_type: str
    created_at: datetime


class DashboardResponse(BaseModel):
    pipeline: list[PipelineStage]
    kpis: KPIs
    recent_events: list[dict]
    priority_jobs: list[PriorityJob]
