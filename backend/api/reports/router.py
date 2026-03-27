"""Report tracking endpoints.

PDF generation happens client-side (browser print-to-PDF).
These endpoints track report generation events for audit history.

2 endpoints:
- POST /jobs/{job_id}/reports — record that a report was generated
- GET /jobs/{job_id}/reports — list report history
"""

from fastapi import APIRouter, Depends, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.reports.schemas import ReportCreate, ReportResponse
from api.reports.service import create_report, list_reports
from api.shared.dependencies import _get_token, get_valid_job

router = APIRouter(tags=["reports"])


@router.post(
    "/jobs/{job_id}/reports",
    response_model=ReportResponse,
    status_code=201,
)
async def record_report(
    body: ReportCreate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
):
    """Record that a report was generated (PDF created client-side)."""
    from uuid import UUID

    return await create_report(
        job_id=UUID(job["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        token=_get_token(request),
        body=body,
    )


@router.get(
    "/jobs/{job_id}/reports",
    response_model=list[ReportResponse],
)
async def get_job_reports(
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
):
    """List all reports for a job (version history)."""
    from uuid import UUID

    return await list_reports(
        job_id=UUID(job["id"]),
        token=_get_token(request),
    )
