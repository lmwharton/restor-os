"""Dashboard endpoint — pre-computed metrics for the frontend."""

from fastapi import APIRouter, Depends, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.dashboard.schemas import DashboardResponse
from api.dashboard.service import get_dashboard
from api.shared.database import get_authenticated_client
from api.shared.dependencies import _get_token

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard_endpoint(
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Get pre-computed dashboard metrics.

    Returns pipeline stage counts, KPIs, recent events, and priority jobs.
    All data is scoped to the authenticated user's company via RLS.
    """
    client = await get_authenticated_client(_get_token(request))
    return await get_dashboard(client, ctx.company_id)
