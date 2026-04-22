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
from api.shared.database import get_authenticated_client
from api.shared.dependencies import (
    _get_token,
    get_valid_floor_plan,
    get_valid_job,
    get_valid_property,
    require_if_match,
    require_if_match_strict,
)
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
    """Update a floor plan (name, floor_number, canvas_data, thumbnail).

    Round 3: forwards the If-Match header for etag optimistic-concurrency
    protection. Round 5 (Lakshman P2 #2): If-Match is now REQUIRED — missing
    header returns 428 ETAG_REQUIRED. Round-5 follow-up (Lakshman M1): uses
    require_if_match_strict, which ALSO rejects `If-Match: *` — this endpoint
    always targets an existing row, there's no legitimate creation flow to
    opt out of, and accepting `*` here reopens the default-allow loophole.
    """
    token = _get_token(request)
    return await update_floor_plan(
        token=token,
        floor_plan_id=floor_plan_id,
        property_id=prop["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
        if_match=require_if_match_strict(request),
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
    client = await get_authenticated_client(token)

    # Round 3: atomic auto-link via the ensure_job_property RPC
    # (migration e9f0a1b2c3d4). The previous read→INSERT→UPDATE sequence
    # raced under concurrent first-saves (mobile double-tap, two tabs),
    # producing orphan properties and mis-pinned jobs. The RPC takes
    # SELECT ... FOR UPDATE on the jobs row so concurrent callers
    # serialize, idempotently returns an already-set property_id on retry,
    # and deduplicates to an existing same-address property when one
    # exists on the caller's company.
    #
    # Round-2 follow-on #5: retry once on 23505 (two DIFFERENT jobs
    # racing at the same address past their per-job FOR UPDATE locks,
    # losing against the partial unique address index). The retry lands
    # in the RPC's idempotent fast path and returns the winner's row.
    if not job.get("property_id"):
        async def _invoke_ensure_property():
            r = await client.rpc(
                "ensure_job_property",
                {"p_job_id": str(job["id"])},
            ).execute()
            val = r.data
            if isinstance(val, list):
                val = val[0] if val else None
            return val

        try:
            property_id = await _invoke_ensure_property()
        except APIError as e:
            err_code = getattr(e, "code", None)
            if err_code == "23505":
                try:
                    property_id = await _invoke_ensure_property()
                except APIError as retry_err:
                    retry_code = getattr(retry_err, "code", None)
                    if retry_code == "23505":
                        raise AppException(
                            status_code=409,
                            detail="Concurrent property create — retry",
                            error_code="CONCURRENT_EDIT",
                        )
                    if retry_code == "42501":
                        raise AppException(
                            status_code=403,
                            detail="Cannot resolve property for this job",
                            error_code="JOB_NOT_MUTABLE",
                        )
                    if retry_code == "P0002":
                        raise AppException(
                            status_code=404,
                            detail="Job not accessible",
                            error_code="JOB_NOT_FOUND",
                        )
                    raise
            # Round 3 (post-review): mirror the ensure_job_floor_plan error
            # mapping below. The sibling RPC raises the same 42501 (no JWT
            # company) and P0002 (job not found) codes — leaving them as
            # bare re-raises propagated as opaque 500s, so a legacy job
            # without JWT company would confuse the caller. Same codes →
            # same mapped errors, same shape.
            elif err_code == "42501":
                raise AppException(
                    status_code=403,
                    detail="Cannot resolve property for this job",
                    error_code="JOB_NOT_MUTABLE",
                )
            elif err_code == "P0002":
                raise AppException(
                    status_code=404,
                    detail="Job not accessible",
                    error_code="JOB_NOT_FOUND",
                )
            else:
                raise
        if not property_id:
            raise AppException(
                status_code=500,
                detail="ensure_job_property returned no property id",
                error_code="DB_ERROR",
            )

    # Round 3: idempotent floor-plan create via ensure_job_floor_plan RPC
    # (migration b8c9d0e1f2a3). Replaces the old try-create / catch-409 /
    # pick-plans[0] fallback — that pattern silently picked the "wrong"
    # existing floor plan on race, and the round-3 reviewer flagged the
    # fallback branch as regressing the R12 cache reconciliation fix.
    #
    # The RPC runs "return existing or create new" inside one plpgsql
    # function with FOR UPDATE on the jobs row. Both racing callers get
    # the same floor_plan row back. No 409 to catch.
    #
    # Retry-once on 23505: if two DIFFERENT jobs on the same property
    # race past their FOR UPDATE locks on the jobs table, the partial
    # unique index idx_floor_plans_current_unique catches the loser at
    # INSERT time. The retry lands in the RPC's same-floor-reuse branch
    # and returns the winner's row.
    async def _invoke_ensure_floor_plan():
        r = await client.rpc(
            "ensure_job_floor_plan",
            {
                "p_job_id": str(job["id"]),
                "p_floor_number": body.floor_number,
                "p_floor_name": body.floor_name,
                "p_user_id": str(ctx.user_id),
            },
        ).execute()
        val = r.data
        if isinstance(val, list):
            val = val[0] if val else None
        return val

    # Round 3 (post-review) — MEDIUM #4: the RPC now raises distinct
    # SQLSTATEs per prerequisite state so the catch blocks below can
    # disambiguate (42501 = no JWT company, 55006 = archived/frozen,
    # 23502 = null property). Same mapping is used on first call AND
    # on retry — the previous retry handler caught only 23505 and
    # bare-raised 42501/P0002, which FastAPI then translated to opaque
    # 500s. Factored into a shared helper so retry path can't drift.
    def _map_ensure_floor_plan_error(api_err: APIError) -> AppException:
        code = getattr(api_err, "code", None)
        if code == "23505":
            return AppException(
                status_code=409,
                detail="Concurrent floor plan create — retry",
                error_code="CONCURRENT_EDIT",
            )
        if code == "42501":
            # Caller identity issue — JWT didn't resolve to a company.
            return AppException(
                status_code=403,
                detail="Cannot create floor plan: caller has no company",
                error_code="JOB_NOT_MUTABLE",
            )
        if code == "55006":
            # Row / job not in a mutable state (archived job). Same
            # SQLSTATE as the frozen-version trigger, which matches
            # the semantic: the precondition for mutation isn't met.
            return AppException(
                status_code=403,
                detail="Cannot create floor plan for an archived job",
                error_code="JOB_ARCHIVED",
            )
        if code == "23502":
            # Required prerequisite missing (job has no property_id).
            # Surface as 409 because the caller can self-heal by first
            # calling ensure_job_property to auto-link; a 400 would
            # suggest malformed input when the input was fine.
            return AppException(
                status_code=409,
                detail="Job has no property — link a property first",
                error_code="JOB_NO_PROPERTY",
            )
        if code == "P0002":
            return AppException(
                status_code=404,
                detail="Job not accessible",
                error_code="JOB_NOT_FOUND",
            )
        logger.error(
            "ensure_job_floor_plan RPC failed: job=%s error=%s code=%s",
            job["id"], api_err.message, code,
        )
        return AppException(
            status_code=500,
            detail=f"Failed to create floor plan: {api_err.message}",
            error_code="DB_ERROR",
        )

    try:
        floor_plan = await _invoke_ensure_floor_plan()
    except APIError as e:
        err_code = getattr(e, "code", None)
        if err_code == "23505":
            # Same-floor-number race lost — retry once against the
            # now-visible winner row. RPC's reuse branch picks it up.
            # Any APIError on retry (even non-23505) goes through the
            # same mapper so JWT rotations / job archiving mid-retry
            # surface as structured 403/404 instead of opaque 500s.
            try:
                floor_plan = await _invoke_ensure_floor_plan()
            except APIError as retry_err:
                raise _map_ensure_floor_plan_error(retry_err)
        else:
            raise _map_ensure_floor_plan_error(e)

    if not floor_plan:
        raise AppException(
            status_code=500,
            detail="ensure_job_floor_plan returned no row",
            error_code="DB_ERROR",
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
        # Round-5 follow-up (Lakshman M1): strict variant — rejects
        # both missing and `*`. Update-by-job is never a creation flow.
        if_match=require_if_match_strict(request),
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
    # Round 5 (Lakshman P2 #2): If-Match is REQUIRED. Missing → 428
    # ETAG_REQUIRED. `If-Match: *` is the explicit opt-out for the
    # first-save-on-a-fresh-row creation flow (no prior etag exists to
    # assert). Round-5 follow-up (Lakshman M1): this endpoint is the
    # ONLY one that uses the permissive `require_if_match` (accepts
    # `*`). Every other mutation route uses `require_if_match_strict`
    # because they always target an existing row. The distinction
    # matters: `*` here means "I'm creating v1 on a freshly-ensured
    # row" — a legitimate state; on update / cleanup / rollback there
    # is no legitimate `*` semantic so those routes reject it.
    if_match = require_if_match(request)
    return await save_canvas(
        token=token,
        floor_plan_id=fp["id"],
        job_id=body.job_id,
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        canvas_data=body.canvas_data,
        change_summary=body.change_summary,
        if_match=if_match,
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
    """Rollback: create a new version from a past version's canvas_data.

    Round 5 (Lakshman P2 #2): If-Match is REQUIRED — missing → 428
    ETAG_REQUIRED. `If-Match: *` accepted as opt-out marker. The
    round-3 advisory-only behavior allowed a rollback to race past a
    concurrent save with no guard; now the precondition is enforced.
    """
    token = _get_token(request)
    return await rollback_version(
        token=token,
        floor_plan_id=fp["id"],
        version_number=version_number,
        job_id=body.job_id,
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        # Round-5 follow-up (Lakshman M1): strict — rollback always
        # targets an existing row the caller just read. No `*` opt-out.
        if_match=require_if_match_strict(request),
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

    Round 5 (Lakshman P2 #2): If-Match is REQUIRED. Missing → 428
    ETAG_REQUIRED. Cleanup overwrites canvas_data, so a stale caller
    without a precondition header could silently wipe another editor's
    in-flight work — closing that with the required precondition.
    """
    token = _get_token(request)
    return await cleanup_floor_plan(
        token=token,
        floor_plan_id=fp["id"],
        job_id=body.job_id,
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        client_canvas_data=body.canvas_data,
        # Round-5 follow-up (Lakshman M1): strict — cleanup always
        # targets an existing sketch. No creation flow here.
        if_match=require_if_match_strict(request),
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
