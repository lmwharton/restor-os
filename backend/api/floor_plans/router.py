"""Floor plan endpoints — property-scoped CRUD + job-driven versioning.

Property-scoped CRUD:
- POST /properties/{property_id}/floor-plans — create
- GET /properties/{property_id}/floor-plans — list
- PATCH /properties/{property_id}/floor-plans/{floor_plan_id} — update
- DELETE /properties/{property_id}/floor-plans/{floor_plan_id} — delete

Job convenience:
- GET /jobs/{job_id}/floor-plans — list via job's property_id

Versioning:
- GET /floor-plans/{floor_plan_id}/versions — list versions
- GET /floor-plans/{floor_plan_id}/versions/{version_number} — get version
- POST /floor-plans/{floor_plan_id}/versions — save canvas (create/update/fork)
- POST /floor-plans/{floor_plan_id}/versions/{version_number}/rollback — rollback

Sketch cleanup:
- POST /floor-plans/{floor_plan_id}/cleanup — deterministic cleanup
- POST /floor-plans/{floor_plan_id}/edit — AI edit (Spec 02 stub)
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Request
from postgrest.exceptions import APIError

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.floor_plans.schemas import (
    FloorPlanCreate,
    FloorPlanListResponse,
    FloorPlanResponse,
    FloorPlanSaveRequest,
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
    get_version,
    list_floor_plans_by_job,
    list_floor_plans_by_property,
    list_versions,
    rollback_version,
    save_canvas,
    update_floor_plan,
)
from api.shared.dependencies import (
    _get_token,
    get_valid_floor_plan,
    get_valid_job,
    get_valid_property,
)
from api.shared.database import get_authenticated_client
from api.shared.exceptions import AppException
from api.shared.guards import raise_if_archived

logger = logging.getLogger(__name__)

router = APIRouter(tags=["floor-plans"])


# ---------------------------------------------------------------------------
# Property-scoped CRUD
# ---------------------------------------------------------------------------


@router.post(
    "/properties/{property_id}/floor-plans",
    status_code=201,
    response_model=FloorPlanResponse,
)
async def create_floor_plan_endpoint(
    body: FloorPlanCreate,
    request: Request,
    prop: dict = Depends(get_valid_property),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Create a new floor plan for a property."""
    token = _get_token(request)
    return await create_floor_plan(
        token=token,
        property_id=prop["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.get(
    "/properties/{property_id}/floor-plans",
    response_model=FloorPlanListResponse,
)
async def list_floor_plans_by_property_endpoint(
    request: Request,
    prop: dict = Depends(get_valid_property),
    ctx: AuthContext = Depends(get_auth_context),
):
    """List all floor plans for a property, ordered by floor_number."""
    token = _get_token(request)
    return await list_floor_plans_by_property(
        token=token,
        property_id=prop["id"],
        company_id=ctx.company_id,
    )


@router.patch(
    "/properties/{property_id}/floor-plans/{floor_plan_id}",
    response_model=FloorPlanResponse,
)
async def update_floor_plan_endpoint(
    body: FloorPlanUpdate,
    request: Request,
    floor_plan_id: UUID = Path(..., description="Floor plan ID"),
    prop: dict = Depends(get_valid_property),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Update a floor plan (name, floor_number, canvas_data, thumbnail)."""
    token = _get_token(request)
    return await update_floor_plan(
        token=token,
        floor_plan_id=floor_plan_id,
        property_id=prop["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.delete(
    "/properties/{property_id}/floor-plans/{floor_plan_id}",
    status_code=204,
)
async def delete_floor_plan_endpoint(
    request: Request,
    floor_plan_id: UUID = Path(..., description="Floor plan ID"),
    prop: dict = Depends(get_valid_property),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Delete a floor plan. Cascades to versions. Unlinks rooms."""
    token = _get_token(request)
    await delete_floor_plan(
        token=token,
        floor_plan_id=floor_plan_id,
        property_id=prop["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
    )


# ---------------------------------------------------------------------------
# Job convenience — resolves via job.property_id
# ---------------------------------------------------------------------------


@router.get("/jobs/{job_id}/floor-plans", response_model=FloorPlanListResponse)
async def list_floor_plans_by_job_endpoint(
    request: Request,
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """List floor plans for a job's property. Resolves via job.property_id."""
    token = _get_token(request)
    return await list_floor_plans_by_job(
        token=token,
        job_id=job["id"],
        company_id=ctx.company_id,
    )


@router.post(
    "/jobs/{job_id}/floor-plans",
    status_code=201,
    response_model=FloorPlanResponse,
)
async def create_floor_plan_by_job_endpoint(
    body: FloorPlanCreate,
    request: Request,
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Create a floor plan via job — resolves or auto-creates property from job address.

    Stamps the new row with `created_by_job_id=job.id` and pins the job's
    `floor_plan_id` to it so the job's first content save updates v1 in place
    (Case 2 in save_canvas) instead of forking v2.
    """
    # R6 (round 2): archive-job guard — collected jobs cannot create floor
    # plans. get_valid_job only rejects soft-deleted rows; the archived set
    # must be checked explicitly. Matches the guard already wired into
    # walls, rooms, cleanup, and update_floor_plan's content path in C1.
    raise_if_archived(job)

    token = _get_token(request)
    property_id = job.get("property_id")
    client = await get_authenticated_client(token)

    # R9 (round 2): atomic auto-link via the ensure_job_property RPC
    # (migration e9f0a1b2c3d4). The previous read→INSERT→UPDATE sequence
    # raced under concurrent first-saves (mobile double-tap, two tabs),
    # producing orphan properties and mis-pinned jobs. The RPC takes
    # SELECT ... FOR UPDATE on the jobs row so concurrent callers
    # serialize, idempotently returns an already-set property_id on retry,
    # and deduplicates to an existing same-address property when one
    # exists on the caller's company.
    if not property_id:
        # Round-2 follow-on #5: the `ensure_job_property` RPC's FOR UPDATE
        # serializes concurrent callers on the SAME job. But two DIFFERENT
        # jobs at the same address can both race past their respective
        # FOR UPDATE locks and both try to INSERT — the partial unique
        # address index (R9) rejects the loser with 23505. On retry the
        # loser's SELECT finds the winner's row and reuses it (fast path).
        # Without this retry the loser surfaces as a bare 500; with it, the
        # caller's request just takes a few ms longer.
        async def _invoke_ensure():
            r = await client.rpc(
                "ensure_job_property",
                {"p_job_id": str(job["id"])},
            ).execute()
            val = r.data
            if isinstance(val, list):
                val = val[0] if val else None
            return val

        try:
            property_id = await _invoke_ensure()
        except APIError as e:
            if getattr(e, "code", None) == "23505":
                # Same-address race lost — retry once. The winner's row is
                # now visible; the helper's SELECT will return it.
                try:
                    property_id = await _invoke_ensure()
                except APIError as retry_err:
                    # Two-back-to-back 23505s means concurrent writers are
                    # in a pathological loop. Surface as 409 so client retries.
                    if getattr(retry_err, "code", None) == "23505":
                        raise AppException(
                            status_code=409,
                            detail="Concurrent property create — retry",
                            error_code="CONCURRENT_EDIT",
                        )
                    raise
            else:
                raise
        if not property_id:
            raise AppException(
                status_code=500,
                detail="ensure_job_property returned no property id",
                error_code="DB_ERROR",
            )
        # Imports already available at module level; no more inline imports below.

    floor_plan = await create_floor_plan(
        token=token,
        property_id=property_id,
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
        job_id=job["id"],
    )

    # Pin the creating job to this v1 shell. Without this, the next save would
    # see job.floor_plan_id=NULL, fall into Case 1, and fork v2 immediately.
    # Non-fatal if it fails: the floor plan exists with created_by_job_id stamped,
    # so a follow-up save would still hit Case 2 once the pin lands. We log + return
    # so the caller doesn't 500 on a pin failure.
    # Round-2 follow-on #7: scope the pin UPDATE by company_id too — matches the
    # belt-and-suspenders pattern of service.py's update_floor_plan path and
    # removes the silent trust of the embedded get_valid_job dep.
    try:
        await (
            client.table("jobs")
            .update({"floor_plan_id": floor_plan["id"]})
            .eq("id", str(job["id"]))
            .eq("company_id", str(ctx.company_id))
            .execute()
        )
    except APIError as e:
        logger.warning(
            "Failed to pin job %s to new floor plan %s: %s. Auto-Main UX may show null pin until next save.",
            job["id"],
            floor_plan["id"],
            e.message,
        )

    return floor_plan


@router.patch(
    "/jobs/{job_id}/floor-plans/{floor_plan_id}",
    response_model=FloorPlanResponse,
)
async def update_floor_plan_by_job_endpoint(
    body: FloorPlanUpdate,
    request: Request,
    floor_plan_id: UUID = Path(..., description="Floor plan ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Update a floor plan via job — resolves property_id from job."""
    # R6 (round 2): archive-job guard — mirrors the POST endpoint. A
    # collected job must not rename its floor plan (or any other field).
    raise_if_archived(job)

    token = _get_token(request)
    # W3: every job MUST have a property_id — property is the parent entity
    # for all floor-plan data. The previous fallback read property_id from
    # the floor plan row being validated (circular: the row declared its
    # own owner). Reject instead — legacy jobs without property_id must
    # first POST /jobs/{id}/floor-plans which auto-creates + links.
    property_id = job.get("property_id")
    if not property_id:
        raise AppException(
            status_code=400,
            detail=(
                "Job has no property linked. Create a floor plan first via "
                "POST /jobs/{id}/floor-plans to auto-link the property."
            ),
            error_code="JOB_NO_PROPERTY",
        )
    return await update_floor_plan(
        token=token,
        floor_plan_id=floor_plan_id,
        property_id=property_id,
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.delete("/jobs/{job_id}/floor-plans/{floor_plan_id}", status_code=204)
async def delete_floor_plan_by_job_endpoint(
    request: Request,
    floor_plan_id: UUID = Path(..., description="Floor plan ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Delete a floor plan via job — resolves property_id from job."""
    # R6 (round 2): archive-job guard — a collected job cannot delete its
    # floor plan. Mirrors the POST and PATCH companions above.
    raise_if_archived(job)

    token = _get_token(request)
    # W3: mirror the PATCH endpoint. A job without property_id shouldn't
    # be deleting floor plans via the self-declared-owner fallback.
    property_id = job.get("property_id")
    if not property_id:
        raise AppException(
            status_code=400,
            detail="Job has no property linked. Cannot delete floor plan via this job.",
            error_code="JOB_NO_PROPERTY",
        )
    await delete_floor_plan(
        token=token,
        floor_plan_id=floor_plan_id,
        property_id=property_id,
        company_id=ctx.company_id,
        user_id=ctx.user_id,
    )


# ---------------------------------------------------------------------------
# Versioning
# ---------------------------------------------------------------------------


@router.get(
    "/floor-plans/{floor_plan_id}/versions",
    response_model=FloorPlanListResponse,
)
async def list_versions_endpoint(
    request: Request,
    fp: dict = Depends(get_valid_floor_plan),
    ctx: AuthContext = Depends(get_auth_context),
):
    """List all versions for a floor plan, newest first."""
    token = _get_token(request)
    return await list_versions(
        token=token,
        floor_plan_id=fp["id"],
        company_id=ctx.company_id,
    )


@router.get(
    "/floor-plans/{floor_plan_id}/versions/{version_number}",
    response_model=FloorPlanResponse,
)
async def get_version_endpoint(
    request: Request,
    version_number: int = Path(..., ge=1, description="Version number"),
    fp: dict = Depends(get_valid_floor_plan),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Get a specific version by number."""
    token = _get_token(request)
    return await get_version(
        token=token,
        floor_plan_id=fp["id"],
        version_number=version_number,
        company_id=ctx.company_id,
    )


@router.post(
    "/floor-plans/{floor_plan_id}/versions",
    status_code=201,
    response_model=FloorPlanResponse,
)
async def save_canvas_endpoint(
    body: FloorPlanSaveRequest,
    request: Request,
    fp: dict = Depends(get_valid_floor_plan),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Save canvas changes. Auto-creates, updates, or forks a version depending on state."""
    token = _get_token(request)
    return await save_canvas(
        token=token,
        floor_plan_id=fp["id"],
        job_id=body.job_id,
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        canvas_data=body.canvas_data,
        change_summary=body.change_summary,
    )


@router.post(
    "/floor-plans/{floor_plan_id}/versions/{version_number}/rollback",
    response_model=FloorPlanResponse,
)
async def rollback_version_endpoint(
    body: FloorPlanSaveRequest,
    request: Request,
    version_number: int = Path(..., ge=1, description="Version number to rollback to"),
    fp: dict = Depends(get_valid_floor_plan),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Rollback: create a new version from a past version's canvas_data."""
    token = _get_token(request)
    return await rollback_version(
        token=token,
        floor_plan_id=fp["id"],
        version_number=version_number,
        job_id=body.job_id,
        company_id=ctx.company_id,
        user_id=ctx.user_id,
    )


# ---------------------------------------------------------------------------
# Sketch cleanup / edit (kept from Spec 01C, updated for property-scoped)
# ---------------------------------------------------------------------------


@router.post(
    "/floor-plans/{floor_plan_id}/cleanup",
    response_model=SketchCleanupResponse,
)
async def cleanup_endpoint(
    body: SketchCleanupRequest,
    request: Request,
    fp: dict = Depends(get_valid_floor_plan),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Deterministic sketch cleanup — straighten walls, align corners, snap dimensions.

    No AI — uses Shapely geometric operations. Zero cost.
    """
    token = _get_token(request)
    return await cleanup_floor_plan(
        token=token,
        floor_plan_id=fp["id"],
        job_id=body.job_id,
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        client_canvas_data=body.canvas_data,
    )


@router.post(
    "/floor-plans/{floor_plan_id}/edit",
    response_model=SketchEditResponse,
)
async def edit_endpoint(
    body: SketchEditRequest,
    request: Request,
    fp: dict = Depends(get_valid_floor_plan),
    ctx: AuthContext = Depends(get_auth_context),
):
    """AI sketch edit — modify sketch via natural language instruction.

    TODO: Implement when api/ai/ service layer is built (Spec 02).
    """
    from api.shared.events import log_event

    event_id = await log_event(
        ctx.company_id,
        "sketch_edit",
        user_id=ctx.user_id,
        event_data={
            "floor_plan_id": str(fp["id"]),
            "instruction": body.instruction,
            "stub": True,
        },
    )

    return SketchEditResponse(
        canvas_data=fp.get("canvas_data") or {},
        changes_made=["Sketch edit not yet implemented — requires Spec 02 AI pipeline"],
        event_id=event_id or UUID("00000000-0000-0000-0000-000000000000"),
        cost_cents=0,
        duration_ms=0,
    )
