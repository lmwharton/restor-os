"""Recon phases endpoints — nested under /jobs/{job_id}/recon-phases.

This is the router — it maps URLs to functions, like Next.js route files.
Each endpoint extracts the auth context (who's making the request),
then delegates to the service layer.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.recon_phases.schemas import (
    PhaseCreate,
    PhaseReorderRequest,
    PhaseResponse,
    PhaseUpdate,
)
from api.recon_phases.service import (
    create_phase,
    delete_phase,
    list_phases,
    reorder_phases,
    update_phase,
)
from api.shared.dependencies import _get_token

router = APIRouter(prefix="/jobs/{job_id}/recon-phases", tags=["recon-phases"])


@router.get("", response_model=list[PhaseResponse])
async def list_phases_endpoint(
    job_id: UUID,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """List all phases for a reconstruction job, ordered by sort_order."""
    token = _get_token(request)
    return await list_phases(token, job_id, ctx.company_id)


@router.post("", status_code=201, response_model=PhaseResponse)
async def create_phase_endpoint(
    job_id: UUID,
    body: PhaseCreate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Create a new phase on a reconstruction job."""
    token = _get_token(request)
    return await create_phase(token, job_id, ctx.company_id, ctx.user_id, body)


@router.patch("/{phase_id}", response_model=PhaseResponse)
async def update_phase_endpoint(
    job_id: UUID,
    phase_id: UUID,
    body: PhaseUpdate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Update a phase (name, status, notes). Auto-sets timestamps on status changes."""
    token = _get_token(request)
    return await update_phase(token, job_id, ctx.company_id, ctx.user_id, phase_id, body)


@router.delete("/{phase_id}")
async def delete_phase_endpoint(
    job_id: UUID,
    phase_id: UUID,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Delete a phase."""
    token = _get_token(request)
    await delete_phase(token, job_id, ctx.company_id, ctx.user_id, phase_id)
    return {"deleted": True}


@router.post("/reorder", response_model=list[PhaseResponse])
async def reorder_phases_endpoint(
    job_id: UUID,
    body: PhaseReorderRequest,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Bulk reorder phases. Send all phase IDs with their new sort_order."""
    token = _get_token(request)
    return await reorder_phases(token, job_id, ctx.company_id, ctx.user_id, body.phases)
