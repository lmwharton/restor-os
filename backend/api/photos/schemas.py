from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

VALID_PHOTO_TYPES = frozenset(
    ["damage", "equipment", "protection", "containment", "moisture_reading", "before", "after"]
)

VALID_CONTENT_TYPES = frozenset(["image/jpeg", "image/png"])


class PhotoUploadUrlRequest(BaseModel):
    filename: str
    content_type: str  # image/jpeg | image/png


class PhotoUploadUrlResponse(BaseModel):
    upload_url: str  # presigned URL — frontend uploads file here
    storage_path: str  # pass back to /confirm


class PhotoConfirm(BaseModel):
    storage_path: str  # from upload-url response
    filename: str | None = None
    room_id: UUID | None = None
    room_name: str | None = None
    photo_type: str = "damage"
    caption: str | None = None


class PhotoUpdate(BaseModel):
    room_id: UUID | None = None
    room_name: str | None = None
    photo_type: str | None = None
    caption: str | None = None
    selected_for_ai: bool | None = None


class PhotoResponse(BaseModel):
    id: UUID
    job_id: UUID
    company_id: UUID
    room_id: UUID | None = None
    room_name: str | None = None
    storage_url: str  # signed URL, 15-min expiry
    filename: str | None = None
    caption: str | None = None
    photo_type: str
    selected_for_ai: bool
    uploaded_at: datetime


class BulkSelectRequest(BaseModel):
    photo_ids: list[UUID] = Field(..., min_length=1)
    selected_for_ai: bool = True


class BulkTagAssignment(BaseModel):
    photo_id: UUID
    room_id: UUID


class BulkTagRequest(BaseModel):
    assignments: list[BulkTagAssignment] = Field(..., min_length=1)


class PhotoGroupItem(BaseModel):
    room_id: UUID | None = None
    room_name: str | None = None
    photos: list[PhotoResponse]


class PhotoListResponse(BaseModel):
    items: list[PhotoResponse]
    total: int


class PhotoGroupedResponse(BaseModel):
    groups: list[PhotoGroupItem]
    total: int


class BulkUpdateResponse(BaseModel):
    updated: int
