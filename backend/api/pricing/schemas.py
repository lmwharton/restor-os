"""Schemas for the pricing module (Spec 01I Phase 3)."""

from pydantic import BaseModel, Field


class PricingRowError(BaseModel):
    """Per-row validation failure shape returned to the client.

    ``row`` is the spreadsheet row number, 1-indexed, where row 1 is the
    header. Data rows therefore start at 2 — matches what the user sees
    in Excel and what we surface in the downloadable error CSV.
    """

    row: int = Field(..., ge=1, description="1-indexed spreadsheet row number")
    field: str | None = Field(None, description="Column that failed, or None for row-level errors")
    message: str = Field(..., max_length=500)


class PricingUploadResponse(BaseModel):
    """Result of POST /v1/pricing/upload.

    On success, ``items_loaded`` reflects the number of rows persisted
    and ``errors`` is empty. On failure (one or more bad rows), nothing
    is persisted, ``items_loaded`` is 0, and ``errors`` carries the full
    list. ``run_id`` is a server-generated identifier the frontend can
    pass to GET /v1/pricing/error-report/{run_id} to download a CSV of
    the errors.
    """

    items_loaded: int = Field(..., ge=0)
    tier: str = Field(..., min_length=1, max_length=64)
    errors: list[PricingRowError] = Field(default_factory=list)
    run_id: str | None = Field(
        None,
        description="Set when there are errors so the client can download a report",
    )
