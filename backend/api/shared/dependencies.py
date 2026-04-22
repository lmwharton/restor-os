"""Shared FastAPI dependencies for ownership validation and pagination.

These are injected via Depends() in route handlers to validate that
nested resources belong to the authenticated user's company.
"""

from uuid import UUID

from fastapi import Depends, Path, Query, Request

from api.auth.middleware import _extract_token, get_auth_context
from api.auth.schemas import AuthContext
from api.shared.database import get_authenticated_client
from api.shared.exceptions import AppException


def _get_token(request: Request) -> str:
    """Extract raw JWT token from Authorization header.

    Delegates to the canonical _extract_token() in auth.middleware,
    which raises 401 on missing/invalid header.
    """
    return _extract_token(request)


def require_if_match(request: Request) -> str | None:
    """Extract and validate ``If-Match`` header on a mutation endpoint
    that HAS a legitimate first-version creation flow.

    Round-5 (Lakshman P2 #2): enforces INV-1 — every mutating request
    carries an etag or an explicit no-etag marker. Round-5
    follow-up (Lakshman M1): this permissive variant is reserved for
    ``save_canvas_endpoint`` only. Every other mutation route uses
    :func:`require_if_match_strict` (below), which rejects ``*`` — they
    always target an existing row, so there's no legitimate opt-out.

    Return semantics:
    - Header missing → raises 428 ``ETAG_REQUIRED``.
    - Header == ``*`` → returns ``None``. Standard HTTP semantics for
      "any representation." The service layer treats as "skip etag
      check." Only save_canvas honors this (first-save on a freshly
      ensured floor_plan row).
    - Otherwise → returns the etag string.
    """
    header = request.headers.get("If-Match")
    if header is None:
        raise AppException(
            status_code=428,
            detail=(
                "If-Match header is required on this endpoint. Send the "
                "etag you received on your last read of this floor plan, "
                "or 'If-Match: *' to explicitly opt out (creation flow)."
            ),
            error_code="ETAG_REQUIRED",
        )
    if header == "*":
        return None
    return header


def require_if_match_strict(request: Request) -> str:
    """Extract and validate ``If-Match`` on a mutation endpoint with
    NO legitimate creation flow — update / cleanup / rollback all
    target existing rows by definition.

    Round-5 follow-up (Lakshman M1): the permissive
    :func:`require_if_match` was applied uniformly to all 5 mutation
    routes. It accepts ``If-Match: *`` and returns ``None``, which the
    service layer treats as "skip etag check." On save_canvas that's
    legitimate (first-save on a freshly ensured row). On update /
    cleanup / rollback it's a default-allow loophole — a caller with a
    cache miss or a hand-crafted curl silently bypasses the
    precondition and gets last-write-wins semantics on an existing row.

    This strict variant closes the loophole: both a missing header AND
    the ``*`` wildcard raise 428 ``ETAG_REQUIRED``. Only a concrete
    etag string is accepted. Callers of update / cleanup / rollback
    always have a row they're mutating (via GET of the FloorPlan list
    or a specific floor-plan row) — they always have an etag to
    assert. No legitimate reason to send ``*``.

    Return semantics:
    - Missing header → 428 ``ETAG_REQUIRED`` (error_code).
    - ``If-Match: *`` → 428 ``ETAG_REQUIRED`` (error_code).
    - Concrete etag → returned verbatim.
    """
    header = request.headers.get("If-Match")
    if header is None or header == "*":
        raise AppException(
            status_code=428,
            detail=(
                "If-Match header is required on this endpoint and must "
                "carry a concrete etag — the wildcard '*' is not accepted "
                "because this endpoint never operates on a freshly-created "
                "row. Fetch the floor plan first to obtain its etag, then "
                "retry with If-Match set to that value."
            ),
            error_code="ETAG_REQUIRED",
        )
    return header


class PaginationParams:
    """Reusable pagination query parameters."""

    def __init__(
        self,
        limit: int = Query(20, ge=1, le=200, description="Max items per page"),
        offset: int = Query(0, ge=0, description="Number of items to skip"),
    ):
        self.limit = limit
        self.offset = offset


async def get_valid_job(
    job_id: UUID = Path(..., description="Job ID"),
    ctx: AuthContext = Depends(get_auth_context),
    request: Request = None,
) -> dict:
    """Validate job exists, belongs to user's company, and is not deleted.
    Returns the job row dict. Used by 7+ modules."""
    token = _get_token(request)
    client = await get_authenticated_client(token)

    result = await (
        client.table("jobs")
        .select("*")
        .eq("id", str(job_id))
        .eq("company_id", str(ctx.company_id))
        .is_("deleted_at", "null")
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(status_code=404, detail="Job not found", error_code="JOB_NOT_FOUND")
    return result.data


async def get_valid_room(
    room_id: UUID = Path(..., description="Room ID"),
    job_id: UUID = Path(..., description="Job ID"),
    ctx: AuthContext = Depends(get_auth_context),
    request: Request = None,
) -> dict:
    """Validate room exists and belongs to the job + company.

    Uses PostgREST embedded resource syntax to fetch the room WITH its
    parent job in a single query, validating both ownership and existence
    without an extra roundtrip. Returns the room row dict (without the
    nested jobs key).
    """
    token = _get_token(request)
    client = await get_authenticated_client(token)

    result = await (
        client.table("job_rooms")
        .select("*, jobs!inner(id, company_id, deleted_at)")
        .eq("id", str(room_id))
        .eq("job_id", str(job_id))
        .eq("jobs.company_id", str(ctx.company_id))
        .is_("jobs.deleted_at", "null")
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(status_code=404, detail="Room not found", error_code="ROOM_NOT_FOUND")
    # Remove the embedded jobs data before returning — callers expect a flat room dict
    room = {k: v for k, v in result.data.items() if k != "jobs"}
    return room


async def get_valid_reading(
    reading_id: UUID = Path(..., description="Reading ID"),
    job_id: UUID = Path(..., description="Job ID"),
    ctx: AuthContext = Depends(get_auth_context),
    request: Request = None,
) -> dict:
    """Validate moisture reading exists and belongs to the job + company.

    Uses PostgREST embedded resource syntax to fetch the reading WITH its
    parent job in a single query, validating both ownership and existence
    without an extra roundtrip. Returns the reading row dict (without the
    nested jobs key).
    """
    token = _get_token(request)
    client = await get_authenticated_client(token)

    result = await (
        client.table("moisture_readings")
        .select("*, jobs!inner(id, company_id, deleted_at)")
        .eq("id", str(reading_id))
        .eq("job_id", str(job_id))
        .eq("jobs.company_id", str(ctx.company_id))
        .is_("jobs.deleted_at", "null")
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Reading not found",
            error_code="READING_NOT_FOUND",
        )
    # Remove the embedded jobs data before returning — callers expect a flat reading dict
    reading = {k: v for k, v in result.data.items() if k != "jobs"}
    return reading


async def get_valid_property(
    property_id: UUID = Path(..., description="Property ID"),
    ctx: AuthContext = Depends(get_auth_context),
    request: Request = None,
) -> dict:
    """Validate property exists, belongs to user's company, and is not soft-deleted.
    Returns the property row dict."""
    token = _get_token(request)
    client = await get_authenticated_client(token)

    result = await (
        client.table("properties")
        .select("*")
        .eq("id", str(property_id))
        .eq("company_id", str(ctx.company_id))
        .is_("deleted_at", "null")
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Property not found",
            error_code="PROPERTY_NOT_FOUND",
        )
    return result.data


async def get_valid_floor_plan(
    floor_plan_id: UUID = Path(..., description="Floor plan ID"),
    ctx: AuthContext = Depends(get_auth_context),
    request: Request = None,
) -> dict:
    """Validate floor plan exists and belongs to user's company.
    Returns the floor plan row dict."""
    token = _get_token(request)
    client = await get_authenticated_client(token)

    result = await (
        client.table("floor_plans")
        .select("*")
        .eq("id", str(floor_plan_id))
        .eq("company_id", str(ctx.company_id))
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Floor plan not found",
            error_code="FLOOR_PLAN_NOT_FOUND",
        )
    return result.data


async def get_valid_room_standalone(
    room_id: UUID = Path(..., description="Room ID"),
    ctx: AuthContext = Depends(get_auth_context),
    request: Request = None,
) -> dict:
    """Validate room exists and belongs to user's company.

    Unlike get_valid_room, this does NOT require job_id in the URL path.
    Used by wall endpoints where the route is /rooms/{room_id}/walls.

    Embeds the parent job (id, company_id, deleted_at) via inner join so
    the room's ownership is validated transitively through jobs.company_id
    — matches get_valid_room's shape. The archive/status check itself is
    deferred to the service layer (via guards.ensure_job_mutable_for_room)
    because GET reads on archived-job rooms must remain allowed for audit.
    Returns the flat room dict (embedded jobs key stripped).
    """
    token = _get_token(request)
    client = await get_authenticated_client(token)

    result = await (
        client.table("job_rooms")
        .select("*, jobs!inner(id, company_id, status, deleted_at)")
        .eq("id", str(room_id))
        .eq("company_id", str(ctx.company_id))
        .eq("jobs.company_id", str(ctx.company_id))
        .is_("jobs.deleted_at", "null")
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Room not found",
            error_code="ROOM_NOT_FOUND",
        )
    room = {k: v for k, v in result.data.items() if k != "jobs"}
    return room


async def get_valid_wall(
    wall_id: UUID = Path(..., description="Wall segment ID"),
    room_id: UUID = Path(..., description="Room ID"),
    ctx: AuthContext = Depends(get_auth_context),
    request: Request = None,
) -> dict:
    """Validate wall segment exists and belongs to the room + company.
    Returns the wall row dict."""
    token = _get_token(request)
    client = await get_authenticated_client(token)

    result = await (
        client.table("wall_segments")
        .select("*")
        .eq("id", str(wall_id))
        .eq("room_id", str(room_id))
        .eq("company_id", str(ctx.company_id))
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Wall not found",
            error_code="WALL_NOT_FOUND",
        )
    return result.data
