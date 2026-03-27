from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

VALID_REPORT_TYPES = {"full_report", "restoration_invoice"}


class ReportCreate(BaseModel):
    report_type: str = Field(
        default="full_report",
        description="full_report | restoration_invoice",
    )


class ReportResponse(BaseModel):
    id: UUID
    job_id: UUID
    company_id: UUID
    report_type: str
    status: str
    generated_at: datetime | None
    created_at: datetime
    updated_at: datetime
