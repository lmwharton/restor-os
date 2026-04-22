from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, computed_field, field_validator

from api.shared.etag import etag_from_updated_at
from api.shared.validators import validate_json_size


# Two-layer canvas_data size cap. The request boundary (Pydantic validator)
# enforces what the CLIENT is allowed to send; the save path separately
# enforces what lands in the DB row — which includes the R19 relational
# snapshot that the service enriches after validation.
#
# - W6 (round 1): cap incoming canvas_data at 500KB to prevent 10MB+ JSON
#   blobs from ever reaching server-side code. 500KB is plenty for a real
#   floor plan (tens of thousands of walls + openings).
# - R19 follow-on F7 (round 2): save_canvas enriches canvas_data with a
#   server-side ``_relational_snapshot`` before insert. On a complex floor
#   plan the snapshot adds ~5-20KB; worst case ~100KB. Without a
#   post-enrichment cap, a 497KB incoming canvas + snapshot would silently
#   exceed the 500KB contract. MAX_STORED_CANVAS_DATA_BYTES is the DB-row
#   ceiling applied after enrichment. If the enriched payload exceeds it,
#   save raises 413 CANVAS_TOO_LARGE so "canvas_data ≤ 500KB incoming /
#   ≤ 600KB stored" stays an honest invariant.
# R11 (round 2) moved the helper into api/shared/validators.py so the
# same size-cap rule can be applied to rooms/schemas.py JSONB fields.
_MAX_CANVAS_DATA_BYTES = 500_000
MAX_INCOMING_CANVAS_DATA_BYTES = _MAX_CANVAS_DATA_BYTES  # alias for clarity
MAX_STORED_CANVAS_DATA_BYTES = 600_000


def _validate_canvas_data_size(v: dict | None) -> dict | None:
    return validate_json_size(v, max_bytes=_MAX_CANVAS_DATA_BYTES, field_name="canvas_data")


class FloorPlanCreate(BaseModel):
    floor_number: int = Field(default=1, ge=0, le=10, description="0=basement, 1-10=above ground")
    floor_name: str = Field(default="Floor 1", max_length=50)
    canvas_data: dict | None = None

    @field_validator("canvas_data")
    @classmethod
    def _cap_canvas_size(cls, v: dict | None) -> dict | None:
        return _validate_canvas_data_size(v)


class FloorPlanUpdate(BaseModel):
    """Metadata-only updates. Content changes (canvas_data) must go through
    POST /floor-plans/{id}/versions (save_canvas) so the versioning state
    machine and the archive-job gate are the single write surface for content.
    """

    floor_number: int | None = Field(default=None, ge=0, le=10)
    floor_name: str | None = Field(default=None, max_length=50)
    thumbnail_url: str | None = None


class FloorPlanResponse(BaseModel):
    """Unified floor plan response — each row IS a versioned snapshot after
    the container/versions merge (see Alembic e1a7c9b30201).

    Round 3: exposes ``etag`` (derived from ``updated_at``) so clients can
    send it back as ``If-Match`` on saves. Backend rejects writes whose
    etag is stale with 412 VERSION_STALE, preventing silent lost-updates
    when two users edit concurrently.
    """

    id: UUID
    property_id: UUID
    company_id: UUID
    floor_number: int
    floor_name: str
    version_number: int
    canvas_data: dict | None
    created_by_job_id: UUID | None = None
    created_by_user_id: UUID | None = None
    change_summary: str | None = None
    is_current: bool = False
    thumbnail_url: str | None = None
    created_at: datetime
    updated_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def etag(self) -> str | None:
        """Opaque version tag for conditional writes.

        Round 3 (second critical review): previously this coerced ``None``
        to ``""``, which broke the frontend's truthy-check (``opts.etag ?
        headers : undefined``) — an empty string is falsy, so the If-Match
        header was silently skipped. Return ``None`` directly so the wire
        JSON is ``"etag": null`` and the frontend can reason about
        "missing etag" explicitly.
        """
        return etag_from_updated_at(self.updated_at)


class FloorPlanListResponse(BaseModel):
    items: list[FloorPlanResponse]
    total: int


# --- Canvas save (job-driven versioning, single endpoint) ---


class FloorPlanSaveRequest(BaseModel):
    """Save canvas changes. Service layer handles create-vs-update-vs-fork logic."""

    job_id: UUID = Field(..., description="Which job is saving (needed for version ownership)")
    canvas_data: dict = Field(..., description="Canvas state to save")
    change_summary: str | None = Field(default=None, max_length=500)

    @field_validator("canvas_data")
    @classmethod
    def _cap_canvas_size(cls, v: dict) -> dict:
        return _validate_canvas_data_size(v)


# --- Sketch Cleanup (deterministic, no AI) ---


class SketchCleanupRequest(BaseModel):
    """Optional client-supplied canvas_data for cleaning unsaved edits.
    If omitted, server fetches from the saved floor plan record.

    `job_id` is required: cleanup writes back to canvas_data on the
    is_current row, so running it against a collected job's pinned version
    would break the "frozen once collected" contract. Requiring job_id
    lets the server always enforce the archive-job gate (C1) with no
    conditional bypass path."""

    job_id: UUID
    canvas_data: dict | None = None

    @field_validator("canvas_data")
    @classmethod
    def _cap_canvas_size(cls, v: dict | None) -> dict | None:
        return _validate_canvas_data_size(v)


class SketchCleanupResponse(BaseModel):
    """Response from deterministic sketch cleanup. No AI cost."""

    canvas_data: dict
    changes_made: list[str] = []
    event_id: UUID


# --- Sketch Edit (Claude AI, Spec 02) ---


class SketchEditRequest(BaseModel):
    """Natural language instruction to modify the sketch."""

    instruction: str = Field(..., min_length=1, max_length=2000)


class SketchEditResponse(BaseModel):
    """Response from AI sketch edit. Includes cost tracking."""

    canvas_data: dict
    changes_made: list[str] = []
    event_id: UUID
    cost_cents: int = 0
    duration_ms: int = 0
