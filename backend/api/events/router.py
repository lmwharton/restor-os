"""Event history endpoints. Read-only — events are created internally via log_event().

2 endpoints:
- GET /jobs/{job_id}/events — job timeline
- GET /events — company activity feed
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.events.service import list_company_events, list_job_events
from api.shared.database import get_authenticated_client
from api.shared.dependencies import _get_token, get_valid_job

router = APIRouter(tags=["events"])


@router.get("/jobs/{job_id}/events")
async def get_job_events(
    request: Request,
    event_type: str | None = Query(default=None, description="Filter by event type"),
    limit: int = Query(default=50, ge=1, le=200, description="Max items per page"),
    offset: int = Query(default=0, ge=0, description="Number of items to skip"),
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
):
    """Get event timeline for a specific job."""
    client = await get_authenticated_client(_get_token(request))
    return await list_job_events(
        client,
        job_id=UUID(job["id"]),
        company_id=ctx.company_id,
        event_type=event_type,
        limit=limit,
        offset=offset,
    )


@router.get("/events")
async def get_company_events(
    request: Request,
    event_type: str | None = Query(default=None, description="Filter by event type"),
    job_id: UUID | None = Query(default=None, description="Filter by job ID"),
    limit: int = Query(default=50, ge=1, le=200, description="Max items per page"),
    offset: int = Query(default=0, ge=0, description="Number of items to skip"),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Get company-wide activity feed."""
    client = await get_authenticated_client(_get_token(request))
    return await list_company_events(
        client,
        company_id=ctx.company_id,
        event_type=event_type,
        job_id=job_id,
        limit=limit,
        offset=offset,
    )
