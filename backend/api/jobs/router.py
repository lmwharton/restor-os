from uuid import UUID

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.jobs.schemas import (
    JobCompleteRequest,
    JobCompleteResponse,
    JobCreate,
    JobDetailResponse,
    JobListResponse,
    JobReopenRequest,
    JobReopenResponse,
    JobUpdate,
)
from api.jobs.service import (
    complete_job,
    create_job,
    create_linked_recon,
    delete_job,
    get_job,
    list_jobs,
    reopen_job,
    update_job,
)
from api.shared.dependencies import _get_token
from api.shared.exceptions import AppException

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("", status_code=201, response_model=JobDetailResponse)
async def create_job_endpoint(
    body: JobCreate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Create a new job. Auto-generates job_number as JOB-YYYYMMDD-XXX."""
    token = _get_token(request)
    return await create_job(token, ctx.company_id, ctx.user_id, body)


@router.get("", response_model=JobListResponse)
async def list_jobs_endpoint(
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    status: str | None = Query(None, description="Filter by status"),
    loss_type: str | None = Query(None, description="Filter by loss type"),
    job_type: Literal["mitigation", "reconstruction"] | None = Query(None, description="Filter by job type"),
    search: str | None = Query(None, description="Search address or customer name"),
    limit: int = Query(20, ge=1, le=100, description="Max items per page"),
    offset: int = Query(0, ge=0, description="Number of items to skip"),
    sort_by: str = Query("created_at", description="Sort field"),
    sort_dir: str = Query("desc", description="Sort direction: asc or desc"),
):
    """List jobs with filtering, search, pagination, and sorting."""
    token = _get_token(request)
    items, total = await list_jobs(
        token,
        ctx.company_id,
        status=status,
        loss_type=loss_type,
        job_type=job_type,
        search=search,
        limit=limit,
        offset=offset,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    return JobListResponse(items=items, total=total)


@router.get("/{job_id}", response_model=JobDetailResponse)
async def get_job_endpoint(
    job_id: UUID,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Get job detail with computed counts (rooms, photos, floor plans, line items)."""
    token = _get_token(request)
    return await get_job(token, ctx.company_id, job_id)


@router.patch("/{job_id}", response_model=JobDetailResponse)
async def update_job_endpoint(
    job_id: UUID,
    body: JobUpdate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Update job fields. Only send fields to change."""
    token = _get_token(request)
    return await update_job(token, ctx.company_id, ctx.user_id, job_id, body)


@router.post("/{job_id}/create-linked-recon", status_code=201, response_model=JobDetailResponse)
async def create_linked_recon_endpoint(
    job_id: UUID,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Create a reconstruction job linked to this mitigation job. Auto-copies header data and pre-populates phases."""
    token = _get_token(request)
    return await create_linked_recon(token, ctx.company_id, ctx.user_id, job_id)


@router.delete("/{job_id}")
async def delete_job_endpoint(
    job_id: UUID,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Soft delete a job. Owner or admin only."""
    if ctx.role not in ("owner", "admin"):
        raise AppException(
            status_code=403,
            detail="Only owners and admins can delete jobs",
            error_code="FORBIDDEN",
        )
    await delete_job(ctx.company_id, ctx.user_id, job_id)
    return {"deleted": True}


# --- Spec 01H Phase 3 PR-B2: job completion lifecycle ---


@router.post("/{job_id}/complete", response_model=JobCompleteResponse)
async def complete_job_endpoint(
    job_id: UUID,
    body: JobCompleteRequest,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Mark a job complete. Flips status to 'complete', stamps completed_at,
    auto-pulls active equipment placements, appends an audit event.

    Response includes auto_pulled_count so the UI can surface "3 pieces of
    equipment were still running — they've been pulled at completion."
    """
    token = _get_token(request)
    return await complete_job(
        token, ctx.company_id, ctx.user_id, job_id, body.notes
    )


@router.post("/{job_id}/reopen", response_model=JobReopenResponse)
async def reopen_job_endpoint(
    job_id: UUID,
    body: JobReopenRequest,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Reopen a complete job. Owner-only. Reverts status to 'drying',
    clears completed_at/completed_by, stamps reopened_at on the latest
    completion event. Does NOT un-pull equipment (historical pulled_at
    stamps stay).
    """
    token = _get_token(request)
    return await reopen_job(
        token, ctx.company_id, ctx.user_id, ctx.role, job_id, body.reason
    )
