"""Wall segments + wall openings endpoints.

Wall segments:
- GET /rooms/{room_id}/walls — list walls for a room
- POST /rooms/{room_id}/walls — create wall
- PATCH /rooms/{room_id}/walls/{wall_id} — update wall
- DELETE /rooms/{room_id}/walls/{wall_id} — delete wall

Wall openings:
- POST /rooms/{room_id}/walls/{wall_id}/openings — create opening
- PATCH /rooms/{room_id}/walls/{wall_id}/openings/{opening_id} — update opening
- DELETE /rooms/{room_id}/walls/{wall_id}/openings/{opening_id} — delete opening
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Path, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.shared.dependencies import (
    _get_token,
    get_valid_room_standalone,
    get_valid_wall,
)
from api.walls.schemas import (
    WallOpeningCreate,
    WallOpeningResponse,
    WallOpeningUpdate,
    WallSegmentCreate,
    WallSegmentListResponse,
    WallSegmentResponse,
    WallSegmentUpdate,
)
from api.walls.service import (
    create_opening,
    create_wall,
    delete_opening,
    delete_wall,
    list_walls,
    update_opening,
    update_wall,
)

router = APIRouter(tags=["walls"])


# ---------------------------------------------------------------------------
# Wall Segments
# ---------------------------------------------------------------------------


@router.get("/rooms/{room_id}/walls", response_model=WallSegmentListResponse)
async def list_walls_endpoint(
    request: Request,
    room: dict = Depends(get_valid_room_standalone),
    ctx: AuthContext = Depends(get_auth_context),
):
    """List all wall segments for a room, with openings nested."""
    token = _get_token(request)
    return await list_walls(
        token=token,
        room_id=room["id"],
        company_id=ctx.company_id,
    )


@router.post(
    "/rooms/{room_id}/walls",
    status_code=201,
    response_model=WallSegmentResponse,
)
async def create_wall_endpoint(
    body: WallSegmentCreate,
    request: Request,
    room: dict = Depends(get_valid_room_standalone),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Create a wall segment for a room."""
    token = _get_token(request)
    return await create_wall(
        token=token,
        room_id=room["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.patch(
    "/rooms/{room_id}/walls/{wall_id}",
    response_model=WallSegmentResponse,
)
async def update_wall_endpoint(
    body: WallSegmentUpdate,
    request: Request,
    wall: dict = Depends(get_valid_wall),
    room: dict = Depends(get_valid_room_standalone),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Update a wall segment."""
    token = _get_token(request)
    return await update_wall(
        token=token,
        wall_id=wall["id"],
        room_id=room["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.delete("/rooms/{room_id}/walls/{wall_id}", status_code=204)
async def delete_wall_endpoint(
    request: Request,
    wall: dict = Depends(get_valid_wall),
    room: dict = Depends(get_valid_room_standalone),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Delete a wall segment. CASCADE handles its openings."""
    token = _get_token(request)
    await delete_wall(
        token=token,
        wall_id=wall["id"],
        room_id=room["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
    )


# ---------------------------------------------------------------------------
# Wall Openings
# ---------------------------------------------------------------------------


@router.post(
    "/rooms/{room_id}/walls/{wall_id}/openings",
    status_code=201,
    response_model=WallOpeningResponse,
)
async def create_opening_endpoint(
    body: WallOpeningCreate,
    request: Request,
    wall: dict = Depends(get_valid_wall),
    room: dict = Depends(get_valid_room_standalone),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Add a door, window, or missing wall to a wall segment."""
    token = _get_token(request)
    return await create_opening(
        token=token,
        wall_id=wall["id"],
        room_id=room["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.patch(
    "/rooms/{room_id}/walls/{wall_id}/openings/{opening_id}",
    response_model=WallOpeningResponse,
)
async def update_opening_endpoint(
    body: WallOpeningUpdate,
    request: Request,
    opening_id: UUID = Path(..., description="Opening ID"),
    wall: dict = Depends(get_valid_wall),
    room: dict = Depends(get_valid_room_standalone),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Update a wall opening."""
    token = _get_token(request)
    return await update_opening(
        token=token,
        opening_id=opening_id,
        wall_id=wall["id"],
        room_id=room["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.delete(
    "/rooms/{room_id}/walls/{wall_id}/openings/{opening_id}",
    status_code=204,
)
async def delete_opening_endpoint(
    request: Request,
    opening_id: UUID = Path(..., description="Opening ID"),
    wall: dict = Depends(get_valid_wall),
    room: dict = Depends(get_valid_room_standalone),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Delete a wall opening."""
    token = _get_token(request)
    await delete_opening(
        token=token,
        opening_id=opening_id,
        wall_id=wall["id"],
        room_id=room["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
    )
