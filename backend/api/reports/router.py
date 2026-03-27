"""Report generation and download endpoints.

3 endpoints:
- POST /jobs/{job_id}/reports — create/generate report
- GET /jobs/{job_id}/reports — list reports (poll for status)
- GET /jobs/{job_id}/reports/{report_id}/download — get signed download URL
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Path, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.reports.schemas import ReportCreate, ReportDownloadResponse, ReportResponse
from api.reports.service import create_report, get_download_url, list_reports
from api.shared.database import get_authenticated_client
from api.shared.dependencies import get_valid_job

router = APIRouter(tags=["reports"])


def _get_token(request: Request) -> str:
    auth_header = request.headers.get("authorization", "")
    return auth_header[7:] if auth_header.startswith("Bearer ") else ""


@router.post(
    "/jobs/{job_id}/reports",
    response_model=ReportResponse,
    status_code=201,
)
async def generate_report(
    body: ReportCreate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
):
    """Create a report for a job. Status starts as 'generating'."""
    client = get_authenticated_client(_get_token(request))
    return await create_report(
        client,
        job_id=UUID(job["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
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
    """List all reports for a job. Poll this to check generation status."""
    client = get_authenticated_client(_get_token(request))
    return await list_reports(client, job_id=UUID(job["id"]))


@router.get(
    "/jobs/{job_id}/reports/{report_id}/download",
    response_model=ReportDownloadResponse,
)
async def download_report(
    request: Request,
    report_id: UUID = Path(..., description="Report ID"),
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
):
    """Get a signed download URL for a ready report (15-min expiry)."""
    client = get_authenticated_client(_get_token(request))
    url = await get_download_url(client, job_id=UUID(job["id"]), report_id=report_id)
    return {"download_url": url}
