from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Request

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.photos.schemas import (
    BulkSelectRequest,
    BulkTagRequest,
    BulkUpdateResponse,
    PhotoConfirm,
    PhotoResponse,
    PhotoUpdate,
    PhotoUploadUrlRequest,
    PhotoUploadUrlResponse,
)
from api.photos.service import (
    bulk_select,
    bulk_tag,
    confirm_photo,
    delete_photo,
    generate_upload_url,
    list_photos,
    update_photo,
)
from api.shared.dependencies import PaginationParams, _get_token, get_valid_job

router = APIRouter(tags=["photos"])


@router.post("/jobs/{job_id}/photos/upload-url", response_model=PhotoUploadUrlResponse)
async def create_upload_url(
    body: PhotoUploadUrlRequest,
    request: Request,
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Get a presigned URL for uploading a photo to Supabase Storage."""
    result = await generate_upload_url(
        company_id=ctx.company_id,
        job_id=UUID(job["id"]),
        filename=body.filename,
        content_type=body.content_type,
        token=_get_token(request),
    )
    return result


@router.post("/jobs/{job_id}/photos/confirm", response_model=PhotoResponse, status_code=201)
async def confirm_upload(
    body: PhotoConfirm,
    request: Request,
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Confirm a photo upload and create the database record."""
    return await confirm_photo(
        company_id=ctx.company_id,
        job_id=UUID(job["id"]),
        user_id=ctx.user_id,
        body=body,
        token=_get_token(request),
    )


@router.get("/jobs/{job_id}/photos")
async def get_photos(
    request: Request,
    room_id: UUID | None = Query(None, description="Filter by room"),
    photo_type: str | None = Query(None, description="Filter by photo type"),
    selected_for_ai: bool | None = Query(None, description="Filter by AI selection"),
    group_by: str | None = Query(None, description="Group by 'room' or omit"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
    pagination: PaginationParams = Depends(),
):
    """List photos for a job with optional filters and grouping."""
    return await list_photos(
        job_id=UUID(job["id"]),
        token=_get_token(request),
        room_id=room_id,
        photo_type=photo_type,
        selected_for_ai=selected_for_ai,
        group_by=group_by,
        limit=pagination.limit,
        offset=pagination.offset,
    )


@router.patch("/jobs/{job_id}/photos/{photo_id}", response_model=PhotoResponse)
async def patch_photo(
    body: PhotoUpdate,
    request: Request,
    photo_id: UUID = Path(..., description="Photo ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Update photo metadata (room, type, caption, selected_for_ai)."""
    return await update_photo(
        photo_id=photo_id,
        job_id=UUID(job["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        body=body,
        token=_get_token(request),
    )


@router.delete("/jobs/{job_id}/photos/{photo_id}", status_code=204)
async def remove_photo(
    request: Request,
    photo_id: UUID = Path(..., description="Photo ID"),
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Delete a photo (removes from storage + soft-deletes DB record)."""
    await delete_photo(
        photo_id=photo_id,
        job_id=UUID(job["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        token=_get_token(request),
    )


@router.post("/jobs/{job_id}/photos/bulk-select", response_model=BulkUpdateResponse)
async def bulk_select_photos(
    body: BulkSelectRequest,
    request: Request,
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Bulk mark/unmark photos as selected_for_ai."""
    updated = await bulk_select(
        job_id=UUID(job["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        photo_ids=body.photo_ids,
        selected_for_ai=body.selected_for_ai,
        token=_get_token(request),
    )
    return {"updated": updated}


@router.post("/jobs/{job_id}/photos/bulk-tag", response_model=BulkUpdateResponse)
async def bulk_tag_photos(
    body: BulkTagRequest,
    request: Request,
    job: dict = Depends(get_valid_job),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Bulk assign rooms to photos."""
    updated = await bulk_tag(
        job_id=UUID(job["id"]),
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        assignments=body.assignments,
        token=_get_token(request),
    )
    return {"updated": updated}
