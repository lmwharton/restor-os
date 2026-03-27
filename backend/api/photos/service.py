"""Photos service — upload URL generation, CRUD, bulk operations.

Uses admin client for storage operations (service role needed for presigned URLs).
Uses authenticated client for DB queries (RLS enforces tenant isolation).
"""

import uuid as _uuid
from uuid import UUID

from api.photos.schemas import (
    VALID_CONTENT_TYPES,
    VALID_PHOTO_TYPES,
    BulkTagAssignment,
    PhotoConfirm,
    PhotoResponse,
    PhotoUpdate,
)
from api.shared.database import get_authenticated_client, get_supabase_admin_client
from api.shared.events import log_event
from api.shared.exceptions import AppException

MAX_PHOTOS_PER_JOB = 100
SIGNED_URL_EXPIRY_SECONDS = 15 * 60  # 15 minutes
STORAGE_BUCKET = "photos"


def _validate_photo_type(photo_type: str) -> None:
    if photo_type not in VALID_PHOTO_TYPES:
        raise AppException(
            status_code=400,
            detail=f"Invalid photo_type '{photo_type}'. "
            f"Must be one of: {', '.join(sorted(VALID_PHOTO_TYPES))}",
            error_code="INVALID_PHOTO_TYPE",
        )


def _validate_content_type(content_type: str) -> None:
    if content_type not in VALID_CONTENT_TYPES:
        raise AppException(
            status_code=400,
            detail="Only image/jpeg and image/png are allowed",
            error_code="INVALID_FILE_TYPE",
        )


def _file_extension(content_type: str) -> str:
    return "jpg" if content_type == "image/jpeg" else "png"


def _build_photo_response(row: dict, signed_url: str) -> PhotoResponse:
    return PhotoResponse(
        id=row["id"],
        job_id=row["job_id"],
        company_id=row["company_id"],
        room_id=row.get("room_id"),
        room_name=row.get("room_name"),
        storage_url=signed_url,
        filename=row.get("filename"),
        caption=row.get("caption"),
        photo_type=row["photo_type"],
        selected_for_ai=row.get("selected_for_ai", False),
        uploaded_at=row["uploaded_at"],
    )


def _get_signed_url(storage_path: str) -> str:
    """Generate a signed URL for a storage path using the admin client."""
    admin = get_supabase_admin_client()
    result = admin.storage.from_(STORAGE_BUCKET).create_signed_url(
        storage_path, SIGNED_URL_EXPIRY_SECONDS
    )
    if isinstance(result, dict) and result.get("signedURL"):
        return result["signedURL"]
    # Supabase Python client may return an object with signedURL attribute
    if hasattr(result, "signed_url"):
        return result.signed_url
    if isinstance(result, dict) and result.get("signed_url"):
        return result["signed_url"]
    # Fallback: return empty string rather than crashing
    return ""


async def generate_upload_url(
    *,
    company_id: UUID,
    job_id: UUID,
    filename: str,
    content_type: str,
    token: str,
) -> dict:
    """Generate a presigned upload URL. Validates file type and photo count limit."""
    _validate_content_type(content_type)

    # Check photo count for this job
    client = get_authenticated_client(token)
    count_result = (
        client.table("photos")
        .select("id", count="exact")
        .eq("job_id", str(job_id))
        .execute()
    )
    current_count = count_result.count if count_result.count is not None else 0
    if current_count >= MAX_PHOTOS_PER_JOB:
        raise AppException(
            status_code=400,
            detail=f"Photo limit reached ({MAX_PHOTOS_PER_JOB} per job)",
            error_code="PHOTO_LIMIT_REACHED",
        )

    ext = _file_extension(content_type)
    photo_uuid = str(_uuid.uuid4())
    storage_path = f"{company_id}/{job_id}/{photo_uuid}.{ext}"

    # Generate presigned upload URL using admin client (service role needed)
    admin = get_supabase_admin_client()
    result = admin.storage.from_(STORAGE_BUCKET).create_signed_upload_url(storage_path)

    # Extract the upload URL from the response
    upload_url = ""
    if isinstance(result, dict):
        upload_url = result.get("signedURL") or result.get("signed_url") or result.get("url", "")
    elif hasattr(result, "signed_url"):
        upload_url = result.signed_url
    elif hasattr(result, "path"):
        # Some versions return path-based response
        upload_url = result.path

    return {"upload_url": upload_url, "storage_path": storage_path}


async def confirm_photo(
    *,
    company_id: UUID,
    job_id: UUID,
    user_id: UUID,
    body: PhotoConfirm,
    token: str,
) -> PhotoResponse:
    """Create photo record after successful upload to storage."""
    _validate_photo_type(body.photo_type)

    client = get_authenticated_client(token)
    row = (
        client.table("photos")
        .insert(
            {
                "job_id": str(job_id),
                "company_id": str(company_id),
                "storage_url": body.storage_path,
                "filename": body.filename,
                "room_id": str(body.room_id) if body.room_id else None,
                "room_name": body.room_name,
                "photo_type": body.photo_type,
                "caption": body.caption,
                "selected_for_ai": False,
            }
        )
        .execute()
    )
    if not row.data:
        raise AppException(
            status_code=500,
            detail="Failed to create photo record",
            error_code="PHOTO_CREATE_FAILED",
        )

    photo = row.data[0]
    signed_url = _get_signed_url(photo["storage_url"]) if photo.get("storage_url") else ""

    await log_event(
        company_id,
        "photo_uploaded",
        job_id=job_id,
        user_id=user_id,
        event_data={"photo_id": photo["id"], "filename": body.filename},
    )

    return _build_photo_response(photo, signed_url)


async def list_photos(
    *,
    job_id: UUID,
    token: str,
    room_id: UUID | None = None,
    photo_type: str | None = None,
    selected_for_ai: bool | None = None,
    group_by: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """List photos for a job with optional filters. Returns signed URLs."""
    if photo_type:
        _validate_photo_type(photo_type)

    client = get_authenticated_client(token)
    query = (
        client.table("photos")
        .select("*", count="exact")
        .eq("job_id", str(job_id))
        .order("uploaded_at", desc=True)
    )

    if room_id:
        query = query.eq("room_id", str(room_id))
    if photo_type:
        query = query.eq("photo_type", photo_type)
    if selected_for_ai is not None:
        query = query.eq("selected_for_ai", selected_for_ai)

    # For grouped response, fetch all matching photos (no pagination on the outer query)
    if group_by == "room":
        result = query.execute()
    else:
        result = query.range(offset, offset + limit - 1).execute()

    rows = result.data or []
    total = result.count if result.count is not None else len(rows)

    # Generate signed URLs for all photos
    photos = []
    for row in rows:
        signed_url = _get_signed_url(row["storage_url"]) if row.get("storage_url") else ""
        photos.append(_build_photo_response(row, signed_url))

    if group_by == "room":
        # Group by room_id
        groups_map: dict[str | None, dict] = {}
        for photo in photos:
            key = str(photo.room_id) if photo.room_id else None
            if key not in groups_map:
                groups_map[key] = {
                    "room_id": photo.room_id,
                    "room_name": photo.room_name,
                    "photos": [],
                }
            groups_map[key]["photos"].append(photo)

        return {"groups": list(groups_map.values()), "total": total}

    return {"items": photos, "total": total}


async def update_photo(
    *,
    photo_id: UUID,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: PhotoUpdate,
    token: str,
) -> PhotoResponse:
    """Update photo metadata (room, type, caption, selected_for_ai)."""
    if body.photo_type is not None:
        _validate_photo_type(body.photo_type)

    client = get_authenticated_client(token)

    # Build update dict with only non-None fields
    updates: dict = {}
    if body.room_id is not None:
        updates["room_id"] = str(body.room_id)
        # Auto-resolve room_name from job_rooms if not explicitly provided
        if body.room_name is None:
            room_result = (
                client.table("job_rooms")
                .select("room_name")
                .eq("id", str(body.room_id))
                .single()
                .execute()
            )
            if room_result.data:
                updates["room_name"] = room_result.data["room_name"]
    if body.room_name is not None:
        updates["room_name"] = body.room_name
    if body.photo_type is not None:
        updates["photo_type"] = body.photo_type
    if body.caption is not None:
        updates["caption"] = body.caption
    if body.selected_for_ai is not None:
        updates["selected_for_ai"] = body.selected_for_ai

    if not updates:
        raise AppException(
            status_code=400,
            detail="No fields to update",
            error_code="NO_UPDATE_FIELDS",
        )

    result = (
        client.table("photos")
        .update(updates)
        .eq("id", str(photo_id))
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Photo not found",
            error_code="PHOTO_NOT_FOUND",
        )

    photo = result.data[0]
    signed_url = _get_signed_url(photo["storage_url"]) if photo.get("storage_url") else ""

    await log_event(
        company_id,
        "photo_updated",
        job_id=job_id,
        user_id=user_id,
        event_data={"photo_id": str(photo_id), "updates": list(updates.keys())},
    )

    return _build_photo_response(photo, signed_url)


async def delete_photo(
    *,
    photo_id: UUID,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    token: str,
) -> None:
    """Delete photo from storage and remove the DB record."""
    client = get_authenticated_client(token)

    # Fetch the photo to get storage_url
    fetch = (
        client.table("photos")
        .select("id, storage_url")
        .eq("id", str(photo_id))
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .single()
        .execute()
    )
    if not fetch.data:
        raise AppException(
            status_code=404,
            detail="Photo not found",
            error_code="PHOTO_NOT_FOUND",
        )

    storage_url = fetch.data.get("storage_url")

    # Remove file from storage (admin client needed)
    if storage_url:
        try:
            admin = get_supabase_admin_client()
            admin.storage.from_(STORAGE_BUCKET).remove([storage_url])
        except Exception:
            pass  # Storage deletion is best-effort

    # Hard delete the DB record
    client.table("photos").delete().eq("id", str(photo_id)).execute()

    await log_event(
        company_id,
        "photo_deleted",
        job_id=job_id,
        user_id=user_id,
        event_data={"photo_id": str(photo_id), "storage_url": storage_url},
    )


async def bulk_select(
    *,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    photo_ids: list[UUID],
    selected_for_ai: bool,
    token: str,
) -> int:
    """Bulk update selected_for_ai for multiple photos. Returns count of updated rows."""
    client = get_authenticated_client(token)

    ids_str = [str(pid) for pid in photo_ids]
    result = (
        client.table("photos")
        .update({"selected_for_ai": selected_for_ai})
        .in_("id", ids_str)
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .execute()
    )

    updated = len(result.data) if result.data else 0

    await log_event(
        company_id,
        "photos_bulk_selected",
        job_id=job_id,
        user_id=user_id,
        event_data={
            "photo_ids": ids_str,
            "selected_for_ai": selected_for_ai,
            "updated": updated,
        },
    )

    return updated


async def bulk_tag(
    *,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    assignments: list[BulkTagAssignment],
    token: str,
) -> int:
    """Bulk assign rooms to photos. Returns count of updated rows."""
    client = get_authenticated_client(token)
    updated = 0

    # Fetch room names for the assigned room_ids (for denormalized room_name)
    room_ids = list({str(a.room_id) for a in assignments})
    rooms_result = (
        client.table("job_rooms")
        .select("id, room_name")
        .in_("id", room_ids)
        .eq("job_id", str(job_id))
        .execute()
    )
    room_names: dict[str, str] = {}
    if rooms_result.data:
        room_names = {r["id"]: r["room_name"] for r in rooms_result.data}

    for assignment in assignments:
        room_name = room_names.get(str(assignment.room_id))
        result = (
            client.table("photos")
            .update(
                {
                    "room_id": str(assignment.room_id),
                    "room_name": room_name,
                }
            )
            .eq("id", str(assignment.photo_id))
            .eq("job_id", str(job_id))
            .eq("company_id", str(company_id))
            .execute()
        )
        if result.data:
            updated += 1

    await log_event(
        company_id,
        "photos_bulk_tagged",
        job_id=job_id,
        user_id=user_id,
        event_data={
            "assignments": [
                {"photo_id": str(a.photo_id), "room_id": str(a.room_id)} for a in assignments
            ],
            "updated": updated,
        },
    )

    return updated
