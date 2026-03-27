"""Shared FastAPI dependencies for ownership validation and pagination.

These are injected via Depends() in route handlers to validate that
nested resources belong to the authenticated user's company.
"""

from uuid import UUID

from fastapi import Depends, Path, Query, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.shared.database import get_authenticated_client
from api.shared.exceptions import AppException


def _get_token(request: Request) -> str:
    """Extract raw JWT token from Authorization header."""
    auth_header = request.headers.get("authorization", "")
    return auth_header[7:] if auth_header.startswith("Bearer ") else ""


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
    token = _get_token(request) if request else ""
    if not token:
        raise AppException(
            status_code=401,
            detail="Missing authentication token",
            error_code="UNAUTHORIZED",
        )
    client = get_authenticated_client(token)

    result = (
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
    Returns the room row dict."""
    token = _get_token(request) if request else ""
    if not token:
        raise AppException(
            status_code=401,
            detail="Missing authentication token",
            error_code="UNAUTHORIZED",
        )
    client = get_authenticated_client(token)

    result = (
        client.table("job_rooms")
        .select("*")
        .eq("id", str(room_id))
        .eq("job_id", str(job_id))
        .eq("company_id", str(ctx.company_id))
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(status_code=404, detail="Room not found", error_code="ROOM_NOT_FOUND")
    return result.data


async def get_valid_reading(
    reading_id: UUID = Path(..., description="Reading ID"),
    job_id: UUID = Path(..., description="Job ID"),
    ctx: AuthContext = Depends(get_auth_context),
    request: Request = None,
) -> dict:
    """Validate moisture reading exists and belongs to the job + company.
    Returns the reading row dict."""
    token = _get_token(request) if request else ""
    if not token:
        raise AppException(
            status_code=401,
            detail="Missing authentication token",
            error_code="UNAUTHORIZED",
        )
    client = get_authenticated_client(token)

    result = (
        client.table("moisture_readings")
        .select("*")
        .eq("id", str(reading_id))
        .eq("job_id", str(job_id))
        .eq("company_id", str(ctx.company_id))
        .single()
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Reading not found",
            error_code="READING_NOT_FOUND",
        )
    return result.data
