from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.jobs.schemas import (
    JobBatchCreate,
    JobBatchResponse,
    JobCreate,
    JobDetailResponse,
    JobListResponse,
    JobUpdate,
)
from api.jobs.service import (
    create_job,
    create_jobs_batch,
    create_linked_recon,
    delete_job,
    get_job,
    list_jobs,
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


@router.post("/batch", status_code=201, response_model=JobBatchResponse)
async def create_jobs_batch_endpoint(
    body: JobBatchCreate,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Create up to 10 jobs atomically (Spec 01I Quick Add Active Jobs).

    All-or-nothing: if any row fails to insert (CHECK violation, unique
    conflict, etc.), the whole batch rolls back. Status field accepts
    UI labels (Lead/Scoped/Submitted) or enum values.
    """
    return await create_jobs_batch(ctx.company_id, ctx.user_id, body)


@router.get("", response_model=JobListResponse)
async def list_jobs_endpoint(
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    status: str | None = Query(None, description="Filter by status"),
    loss_type: str | None = Query(None, description="Filter by loss type"),
    job_type: Literal["mitigation", "reconstruction"] | None = Query(
        None, description="Filter by job type"
    ),
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
    """Soft delete a job. Owner only."""
    # Roles are ('owner', 'tech') after Spec 01I migration 01i_a2; the old
    # ('owner', 'admin') check shipped before the rename was dead code.
    if ctx.role != "owner":
        raise AppException(
            status_code=403,
            detail="Only owners can delete jobs",
            error_code="FORBIDDEN",
        )
    await delete_job(ctx.company_id, ctx.user_id, job_id)
    return {"deleted": True}
