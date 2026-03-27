"""Share link endpoints for sharing job data with adjusters/clients.

4 endpoints:
- POST /jobs/{job_id}/share — create share link
- GET /jobs/{job_id}/share — list share links
- DELETE /jobs/{job_id}/share/{link_id} — revoke share link
- GET /shared/{token} — public read-only view (NO AUTH)
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Path, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.shared.database import get_authenticated_client
from api.shared.dependencies import get_valid_job
from api.sharing.schemas import (
    SharedJobResponse,
    ShareLinkCreate,
    ShareLinkListItem,
    ShareLinkResponse,
)
from api.sharing.service import (
    create_share_link,
    get_shared_job,
    list_share_links,
    revoke_share_link,
)

router = APIRouter(tags=["sharing"])


def _get_token(request: Request) -> str:
    auth_header = request.headers.get("authorization", "")
    return auth_header[7:] if auth_header.startswith("Bearer ") else ""


@router.post(
    "/jobs/{job_id}/share",
    response_model=ShareLinkResponse,
    status_code=201,
)
async def create_job_share_link(
    body: ShareLinkCreate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
):
    """Create a share link for a job. Returns the raw token (shown once)."""
    client = get_authenticated_client(_get_token(request))
    return await create_share_link(
        client,
        job_id=UUID(job["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.get(
    "/jobs/{job_id}/share",
    response_model=list[ShareLinkListItem],
)
async def list_job_share_links(
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
):
    """List all share links for a job (including revoked)."""
    client = get_authenticated_client(_get_token(request))
    return await list_share_links(client, job_id=UUID(job["id"]))


@router.delete(
    "/jobs/{job_id}/share/{link_id}",
    status_code=204,
)
async def revoke_job_share_link(
    request: Request,
    link_id: UUID = Path(..., description="Share link ID"),
    ctx: AuthContext = Depends(get_auth_context),
    job: dict = Depends(get_valid_job),
):
    """Revoke a share link (sets revoked_at, link stops working)."""
    client = get_authenticated_client(_get_token(request))
    await revoke_share_link(
        client,
        job_id=UUID(job["id"]),
        link_id=link_id,
        company_id=ctx.company_id,
        user_id=ctx.user_id,
    )


@router.get(
    "/shared/{token}",
    response_model=SharedJobResponse,
)
async def get_shared_job_data(
    token: str = Path(..., description="Share token"),
):
    """Public read-only view of a shared job. NO AUTH required."""
    return await get_shared_job(token)
