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


def require_if_match(request: Request) -> str:
    """Extract and validate ``If-Match`` on the save_canvas endpoint.

    Paired with :func:`require_if_match_strict` (used by update /
    cleanup / rollback). The split exists for a narrow reason: this
    variant forwards the ``*`` wildcard as a literal so
    ``save_canvas``'s service-layer gate returns 412
    ``WILDCARD_ON_EXISTING`` instead of the strict variant's 428
    ``ETAG_REQUIRED``. The 412 carries ``current_etag`` in the error
    body and is caught by the frontend's ``STALE_CONFLICT_ERROR_CODES``
    handler (banner + conflict-draft persistence + reload). The 428
    isn't — it would fall into the generic retry loop.

    Round-6 final closure (user-flagged escape-hatch): save_canvas
    rejects ``*`` UNIFORMLY regardless of row state. There is no
    reachable "creation opt-out" path anymore — the schema invariant
    (``floor_plans.updated_at NOT NULL DEFAULT now()``, pinned by
    ``TestRound5EtagContractInvariants::test_floor_plans_updated_at_is_not_null``)
    guarantees ``target_updated_at`` is always set by the time
    save_canvas reads the target row. The ``*`` semantic at this
    helper is therefore "route wildcards to a user-recoverable 412
    shape," not "permit wildcards."

    Historical note (kept for reviewers tracking the round-4→round-6
    evolution): round-5 M1 introduced a split where this helper
    returned ``None`` for ``*`` so the service could fall through its
    etag check — that coerced the wildcard into the same default-allow
    loophole round-4 P2 #2 had just closed. Round 6 made this helper
    return ``"*"`` literally AND added a service gate that rejected
    ``*`` on existing rows. A later user-flagged follow-up hardened
    the service gate to reject ``*`` on any row, closing the
    "target_updated_at IS NULL" fallthrough escape hatch (pattern #25
    in the lessons doc).

    Return semantics (current):
    - Header missing → raises 428 ``ETAG_REQUIRED``.
    - Header == ``*`` → returns the literal ``"*"``. save_canvas
      service layer rejects this with 412 ``WILDCARD_ON_EXISTING``;
      returning ``*`` (instead of raising here) is what gets the
      recoverable error shape to the frontend.
    - Otherwise → returns the etag string for the service's atomic
      etag compare.

    Naming note: "permissive" is no longer accurate (no wildcard path
    succeeds anymore). A future rename to something like
    ``require_if_match_with_recoverable_wildcard`` or folding both
    variants into one helper with a flag would be cleaner —
    acknowledged as a follow-up tidy-up; not this-round-blocking.
    """
    header = request.headers.get("If-Match")
    if header is None:
        raise AppException(
            status_code=428,
            detail=(
                "If-Match header is required on this endpoint. Send the "
                "etag from your last read of this floor plan."
            ),
            error_code="ETAG_REQUIRED",
        )
    return header


def require_if_match_strict(request: Request) -> str:
    """Extract and validate ``If-Match`` on update / cleanup / rollback
    endpoints — routes that ALWAYS target an existing row and therefore
    have no legitimate wildcard use case.

    Paired with :func:`require_if_match` (used by save_canvas). Both
    reject missing / wildcard headers; the split controls which HTTP
    status surfaces: 428 ``ETAG_REQUIRED`` here (hard reject — the
    client shouldn't be sending wildcard to these routes at all) vs
    412 ``WILDCARD_ON_EXISTING`` via save_canvas's service-layer gate
    (which carries ``current_etag`` in the body for frontend recovery).

    Historical context (round-5 follow-up on Lakshman M1): the
    permissive :func:`require_if_match` was originally applied
    uniformly to all 5 mutation routes. It returned ``None`` for
    ``*``, which the service's etag gate treated as "skip every
    check" — reopening the round-4 P2 #2 default-allow loophole for
    any caller that sent the wildcard. This strict variant was
    introduced to eliminate the wildcard path entirely on endpoints
    that never need it. In round 6 the permissive variant also became
    a reject-only path (for save_canvas) — the two differ only in
    which HTTP status and error_code shape the client receives.

    Return semantics:
    - Missing header → 428 ``ETAG_REQUIRED``.
    - ``If-Match: *`` → 428 ``ETAG_REQUIRED``.
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
