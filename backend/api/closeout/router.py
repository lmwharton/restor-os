"""Spec 01K Phase 3 — closeout settings + gate evaluation routes."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.closeout.schemas import (
    CloseoutGatesResponse,
    CloseoutSetting,
    CloseoutSettingUpdate,
)
from api.closeout.service import (
    get_gates_for_target,
    list_settings,
    reset_settings_for_job_type,
    update_setting,
)
from api.shared.dependencies import _get_token
from api.shared.exceptions import AppException

router = APIRouter(tags=["closeout"])


# --- Per-job gate evaluation ---------------------------------------------


@router.get("/jobs/{job_id}/closeout-gates", response_model=CloseoutGatesResponse)
async def get_closeout_gates(
    job_id: UUID,
    request: Request,
    target: str = Query("completed", description="Target status the gates evaluate against."),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Evaluate all closeout gates for a job at the given target status.

    Currently only `target=completed` actually evaluates rules — the other
    transitions don't have configurable gates in Spec 01K.
    """
    token = _get_token(request)
    return await get_gates_for_target(token, ctx.company_id, job_id, target)


# --- Per-company settings (admin) ----------------------------------------


def _require_owner_for_company(ctx: AuthContext, company_id: UUID) -> None:
    """Per Spec 01I (`01i_a2`) the only roles are 'owner' and 'tech'.
    Closeout config is owner-only and tenant-scoped. Platform admins (the
    Crewmatic support team account flag) are also allowed — they need to
    debug closeout flows for any company under their support contract."""
    if company_id != ctx.company_id and not ctx.is_platform_admin:
        raise AppException(
            status_code=403,
            detail="Cross-company access denied",
            error_code="FORBIDDEN",
        )
    if ctx.role != "owner" and not ctx.is_platform_admin:
        raise AppException(status_code=403, detail="Owner only", error_code="FORBIDDEN")


@router.get(
    "/companies/{company_id}/closeout-settings",
    response_model=list[CloseoutSetting],
)
async def list_closeout_settings(
    company_id: UUID,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    # Read access is owner-only — matches the admin UI gate. Tech users have
    # no UI surface for these settings, so granting them read access would
    # leak company configuration without a user-facing reason. Match write
    # endpoints' role check.
    _require_owner_for_company(ctx, company_id)
    token = _get_token(request)
    return await list_settings(token, ctx.company_id)


@router.patch(
    "/companies/{company_id}/closeout-settings/{setting_id}",
    response_model=CloseoutSetting,
)
async def update_closeout_setting(
    company_id: UUID,
    setting_id: UUID,
    body: CloseoutSettingUpdate,
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    _require_owner_for_company(ctx, company_id)
    token = _get_token(request)
    return await update_setting(token, ctx.company_id, setting_id, body)


@router.post("/companies/{company_id}/closeout-settings/reset")
async def reset_closeout_settings(
    company_id: UUID,
    job_type: str = Query(
        ..., description="One of mitigation / reconstruction / fire_smoke / remodel"
    ),
    ctx: AuthContext = Depends(get_auth_context),
):
    _require_owner_for_company(ctx, company_id)
    await reset_settings_for_job_type(ctx.company_id, job_type)
    return {"reset": True, "job_type": job_type}
