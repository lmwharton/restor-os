from uuid import UUID

from fastapi import APIRouter, Depends, Path, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.rooms.schemas import RoomCreate, RoomResponse, RoomUpdate
from api.rooms.service import create_room, delete_room, list_rooms, update_room
from api.shared.dependencies import get_valid_job

router = APIRouter(tags=["rooms"])


def _get_token(request: Request) -> str:
    auth_header = request.headers.get("authorization", "")
    return auth_header[7:] if auth_header.startswith("Bearer ") else ""


@router.post("/jobs/{job_id}/rooms", status_code=201, response_model=RoomResponse)
async def create_room_endpoint(
    body: RoomCreate,
    request: Request,
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Create a new room for a job."""
    token = _get_token(request)
    return await create_room(
        token=token,
        job_id=job["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.get("/jobs/{job_id}/rooms", response_model=list[RoomResponse])
async def list_rooms_endpoint(
    request: Request,
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """List all rooms for a job, ordered by sort_order then room_name."""
    token = _get_token(request)
    return await list_rooms(
        token=token,
        job_id=job["id"],
        company_id=ctx.company_id,
    )


@router.patch("/jobs/{job_id}/rooms/{room_id}", response_model=RoomResponse)
async def update_room_endpoint(
    body: RoomUpdate,
    request: Request,
    room_id: UUID = Path(..., description="Room ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Update a room's fields. Re-calculates square_footage if dimensions change."""
    token = _get_token(request)
    return await update_room(
        token=token,
        room_id=room_id,
        job_id=job["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
    )


@router.delete("/jobs/{job_id}/rooms/{room_id}", status_code=204)
async def delete_room_endpoint(
    request: Request,
    room_id: UUID = Path(..., description="Room ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Delete a room. Photos get room_id=NULL, CASCADE handles moisture readings."""
    token = _get_token(request)
    await delete_room(
        token=token,
        room_id=room_id,
        job_id=job["id"],
        company_id=ctx.company_id,
        user_id=ctx.user_id,
    )
