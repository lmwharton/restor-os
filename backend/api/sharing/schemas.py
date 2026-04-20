from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

VALID_SCOPES = {"full", "restoration_only", "photos_only"}


class ShareLinkCreate(BaseModel):
    scope: str = Field(default="full", description="full | restoration_only | photos_only")
    expires_days: int = Field(default=7, ge=1, le=30)


class ShareLinkResponse(BaseModel):
    share_url: str
    share_token: str
    expires_at: datetime


class ShareLinkListItem(BaseModel):
    id: UUID
    scope: str
    expires_at: datetime
    revoked_at: datetime | None
    created_at: datetime


class ShareLinkListResponse(BaseModel):
    items: list[ShareLinkListItem]
    total: int


class SharedJobResponse(BaseModel):
    job: dict
    rooms: list[dict]
    photos: list[dict]
    # moisture_readings removed in Spec 01H Phase 2 — pin-based moisture
    # view returns via a separate endpoint (coming in Phase 2C).
    line_items: list[dict]
    company: dict


class ShareResolveRequest(BaseModel):
    """Request body for POST /shared/resolve -- token in body, not URL path."""

    token: str = Field(..., min_length=1, max_length=128)
