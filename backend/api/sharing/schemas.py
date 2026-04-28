from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

VALID_SCOPES = {"full", "restoration_only", "photos_only"}

# Discriminant for the portal's moisture-report empty-state branching.
# "denied"      — scope excludes moisture data (photos_only); portal
#                 shows "ask the sender for a link with restoration or
#                 full access."
# "unavailable" — scope includes moisture data, but a backend query
#                 hit a tolerated "table missing" code (pre-migration
#                 DB, schema cache miss); portal shows "temporarily
#                 unavailable — try again later" so the adjuster
#                 isn't told nothing was logged when the real state
#                 is a backend misconfiguration.
# "empty"       — scope includes moisture data, but the job has no
#                 pins or no floor plans yet; portal shows "no
#                 readings logged yet."
# "present"     — data is included and non-empty; portal renders the
#                 view.
MoistureAccess = Literal["denied", "unavailable", "empty", "present"]


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
    line_items: list[dict]
    # Pin-based moisture data (replaces the legacy moisture_readings
    # list dropped in Phase 2). Scope-gated: included on `full` +
    # `restoration_only`, excluded on `photos_only`. Each pin carries
    # its full `readings` array (DESC by reading_date) so the
    # adjuster-portal moisture-report view renders without needing
    # per-pin follow-up queries (Brett §8.6).
    moisture_pins: list[dict]
    company: dict
    # All current floor_plans rows for the job's property, ordered
    # by floor_number. Multi-floor jobs render one canvas per floor
    # in the moisture-report view; serving only the job's pinned
    # floor would silently drop pins on the other floors.
    floor_plans: list[dict]
    # Three-state discriminant so the portal can distinguish "you
    # don't have permission" from "tech hasn't logged anything yet"
    # from "ready to render" — all three previously collapsed into
    # `moisture_pins: []` and got the wrong empty-state copy.
    moisture_access: MoistureAccess
    # job.floor_plan_id, hoisted onto the top-level response so the
    # portal can pick the same primary floor as the tech view. Without
    # this, the portal defaulted to floor_plans[0] (usually the
    # basement) while the tech saw the job's pinned floor — same job,
    # two different starting screens.
    primary_floor_id: UUID | None = None


class ShareResolveRequest(BaseModel):
    """Request body for POST /shared/resolve -- token in body, not URL path."""

    token: str = Field(..., min_length=1, max_length=128)
