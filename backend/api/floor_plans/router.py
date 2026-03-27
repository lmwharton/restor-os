"""Floor plan CRUD + sketch cleanup/edit endpoints.

6 endpoints:
- POST /jobs/{job_id}/floor-plans — create
- GET /jobs/{job_id}/floor-plans — list
- PATCH /jobs/{job_id}/floor-plans/{floor_plan_id} — update
- DELETE /jobs/{job_id}/floor-plans/{floor_plan_id} — delete
- POST /jobs/{job_id}/floor-plans/{floor_plan_id}/cleanup — deterministic sketch cleanup
- POST /jobs/{job_id}/floor-plans/{floor_plan_id}/edit — AI sketch edit (Spec 02 stub)
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Path, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.floor_plans.schemas import (
    FloorPlanCreate,
    FloorPlanResponse,
    FloorPlanUpdate,
    SketchCleanupRequest,
    SketchCleanupResponse,
    SketchEditRequest,
    SketchEditResponse,
)
from api.floor_plans.service import (
    cleanup_floor_plan,
    create_floor_plan,
    delete_floor_plan,
    list_floor_plans,
    update_floor_plan,
)
from api.shared.dependencies import _get_token, get_valid_job

router = APIRouter(tags=["floor-plans"])


@router.post("/jobs/{job_id}/floor-plans", status_code=201, response_model=FloorPlanResponse)
async def create_floor_plan_endpoint(
    body: FloorPlanCreate,
    request: Request,
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Create a new floor plan for a job."""
    token = _get_token(request)
    return await create_floor_plan(
        token=token,
        job_id=job["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.get("/jobs/{job_id}/floor-plans", response_model=list[FloorPlanResponse])
async def list_floor_plans_endpoint(
    request: Request,
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """List all floor plans for a job, ordered by floor_number."""
    token = _get_token(request)
    return await list_floor_plans(
        token=token,
        job_id=job["id"],
        company_id=ctx.company_id,
    )


@router.patch(
    "/jobs/{job_id}/floor-plans/{floor_plan_id}",
    response_model=FloorPlanResponse,
)
async def update_floor_plan_endpoint(
    body: FloorPlanUpdate,
    request: Request,
    floor_plan_id: UUID = Path(..., description="Floor plan ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Update a floor plan (name, floor_number, canvas_data, thumbnail)."""
    token = _get_token(request)
    return await update_floor_plan(
        token=token,
        floor_plan_id=floor_plan_id,
        job_id=job["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.delete("/jobs/{job_id}/floor-plans/{floor_plan_id}", status_code=204)
async def delete_floor_plan_endpoint(
    request: Request,
    floor_plan_id: UUID = Path(..., description="Floor plan ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Delete a floor plan. Unlinks associated rooms (sets floor_plan_id=NULL)."""
    token = _get_token(request)
    await delete_floor_plan(
        token=token,
        floor_plan_id=floor_plan_id,
        job_id=job["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
    )


async def _do_cleanup(
    body: SketchCleanupRequest,
    request: Request,
    floor_plan_id: UUID,
    job: dict,
    ctx: AuthContext,
) -> dict:
    """Shared cleanup logic for both /cleanup and /ai-cleanup paths."""
    token = _get_token(request)
    return await cleanup_floor_plan(
        token=token,
        floor_plan_id=floor_plan_id,
        job_id=job["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        client_canvas_data=body.canvas_data,
    )


@router.post(
    "/jobs/{job_id}/floor-plans/{floor_plan_id}/cleanup",
    response_model=SketchCleanupResponse,
)
async def cleanup_endpoint(
    request: Request,
    body: SketchCleanupRequest = SketchCleanupRequest(),
    floor_plan_id: UUID = Path(..., description="Floor plan ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Deterministic sketch cleanup — straighten walls, align corners, snap dimensions.

    If canvas_data is provided in the request body, cleans the client's unsaved sketch.
    If omitted, fetches the saved canvas_data from the floor plan record.
    No AI — uses Shapely geometric operations. Zero cost.
    """
    return await _do_cleanup(body, request, floor_plan_id, job, ctx)


@router.post(
    "/jobs/{job_id}/floor-plans/{floor_plan_id}/ai-cleanup",
    response_model=SketchCleanupResponse,
    include_in_schema=False,
)
async def cleanup_endpoint_alias(
    request: Request,
    body: SketchCleanupRequest = SketchCleanupRequest(),
    floor_plan_id: UUID = Path(..., description="Floor plan ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Backwards-compatible alias for /cleanup. Hidden from OpenAPI docs."""
    return await _do_cleanup(body, request, floor_plan_id, job, ctx)


@router.post(
    "/jobs/{job_id}/floor-plans/{floor_plan_id}/edit",
    response_model=SketchEditResponse,
)
async def edit_endpoint(
    body: SketchEditRequest,
    request: Request,
    floor_plan_id: UUID = Path(..., description="Floor plan ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """AI sketch edit — modify sketch via natural language instruction.

    canvas_data is fetched server-side. Claude Sonnet 4 modifies based on instruction.
    TODO: Implement when api/ai/ service layer is built (Spec 02).
    """
    # Stub — returns current canvas_data unchanged until Spec 02
    from api.shared.events import log_event

    token = _get_token(request)

    # Fetch current floor plan
    from api.shared.database import get_authenticated_client

    client = get_authenticated_client(token)
    result = (
        client.table("floor_plans")
        .select("*")
        .eq("id", str(floor_plan_id))
        .eq("job_id", str(job["id"]))
        .eq("company_id", str(ctx.company_id))
        .single()
        .execute()
    )
    if not result.data:
        from api.shared.exceptions import AppException

        raise AppException(
            status_code=404,
            detail="Floor plan not found",
            error_code="FLOOR_PLAN_NOT_FOUND",
        )

    event_id = await log_event(
        ctx.company_id,
        "sketch_edit",
        job_id=UUID(job["id"]),
        user_id=ctx.user_id,
        event_data={
            "floor_plan_id": str(floor_plan_id),
            "instruction": body.instruction,
            "stub": True,
        },
    )

    return SketchEditResponse(
        canvas_data=result.data.get("canvas_data") or {},
        changes_made=["Sketch edit not yet implemented — requires Spec 02 AI pipeline"],
        event_id=event_id or UUID("00000000-0000-0000-0000-000000000000"),
        cost_cents=0,
        duration_ms=0,
    )
