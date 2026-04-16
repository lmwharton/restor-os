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
    Returns the room row dict.
    """
    token = _get_token(request)
    client = await get_authenticated_client(token)

    result = await (
        client.table("job_rooms")
        .select("*")
        .eq("id", str(room_id))
        .eq("company_id", str(ctx.company_id))
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Room not found",
            error_code="ROOM_NOT_FOUND",
        )
    return result.data


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
