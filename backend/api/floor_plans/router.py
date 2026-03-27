from uuid import UUID

from fastapi import APIRouter, Depends, Path, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.floor_plans.schemas import (
    FloorPlanCreate,
    FloorPlanResponse,
    FloorPlanUpdate,
    SketchAIResponse,
    SketchChatRequest,
    SketchCleanupRequest,
)
from api.floor_plans.service import (
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


@router.post(
    "/jobs/{job_id}/floor-plans/{floor_plan_id}/ai-cleanup",
    response_model=SketchAIResponse,
)
async def ai_cleanup_endpoint(
    body: SketchCleanupRequest,
    floor_plan_id: UUID = Path(..., description="Floor plan ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """AI sketch cleanup — straighten walls, align corners, snap dimensions.

    TODO: Integrate actual AI model for sketch cleanup. Currently returns
    canvas_data unchanged as a stub.
    """
    # TODO: Call AI service to clean up the sketch geometry
    return SketchAIResponse(canvas_data=body.canvas_data)


@router.post(
    "/jobs/{job_id}/floor-plans/{floor_plan_id}/ai-chat",
    response_model=SketchAIResponse,
)
async def ai_chat_endpoint(
    body: SketchChatRequest,
    floor_plan_id: UUID = Path(..., description="Floor plan ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """AI sketch chat — modify sketch via natural language instructions.

    TODO: Integrate actual AI model for sketch modification. Currently returns
    canvas_data unchanged as a stub.
    """
    # TODO: Call AI service to modify sketch based on body.message
    return SketchAIResponse(canvas_data=body.canvas_data)
