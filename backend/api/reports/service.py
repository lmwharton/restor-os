"""Reports service: track report generation events.

Reports are versioned records of when a user generated a report.
Actual PDF generation happens client-side (browser print-to-PDF).
The backend tracks the event for audit history.
"""

import logging
from datetime import UTC, datetime
from uuid import UUID

from api.reports.schemas import VALID_REPORT_TYPES, ReportCreate
from api.shared.database import get_authenticated_client
from api.shared.events import log_event
from api.shared.exceptions import AppException

logger = logging.getLogger(__name__)


async def create_report(
    *,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    token: str,
    body: ReportCreate,
) -> dict:
    """Record that a report was generated. PDF is created client-side."""
    if body.report_type not in VALID_REPORT_TYPES:
        raise AppException(
            status_code=400,
            detail=f"Invalid report_type. Must be one of: {', '.join(sorted(VALID_REPORT_TYPES))}",
            error_code="INVALID_REPORT_TYPE",
        )

    client = get_authenticated_client(token)

    row = {
        "job_id": str(job_id),
        "company_id": str(company_id),
        "report_type": body.report_type,
        "status": "ready",
        "generated_at": datetime.now(UTC).isoformat(),
    }
    result = client.table("reports").insert(row).execute()
    report = result.data[0]

    await log_event(
        company_id,
        "report_generated",
        job_id=job_id,
        user_id=user_id,
        event_data={"report_id": report["id"], "report_type": body.report_type},
    )

    return report


async def list_reports(
    *,
    job_id: UUID,
    token: str,
) -> list[dict]:
    """List all reports for a job, ordered by created_at DESC."""
    client = get_authenticated_client(token)
    result = (
        client.table("reports")
        .select("*")
        .eq("job_id", str(job_id))
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []
