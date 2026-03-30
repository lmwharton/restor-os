"""Share links service: create, list, revoke, and resolve share tokens.

Tokens are 32-char hex strings. Only the SHA-256 hash is stored in the database.
The raw token is returned once on creation and never stored.
"""

import hashlib
import logging
import secrets
import time
from datetime import UTC, datetime, timedelta
from uuid import UUID

from supabase import AsyncClient

from api.config import settings
from api.shared.database import get_supabase_admin_client
from api.shared.events import log_event
from api.shared.exceptions import AppException
from api.sharing.schemas import VALID_SCOPES, ShareLinkCreate

logger = logging.getLogger(__name__)


def _hash_token(token: str) -> str:
    """SHA-256 hash a share token."""
    return hashlib.sha256(token.encode()).hexdigest()


async def create_share_link(
    client: AsyncClient,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: ShareLinkCreate,
) -> dict:
    """Create a share link with a random token. Returns the raw token (shown once).

    Uses rpc_create_share_link for atomic insert + event logging.
    Falls back to non-atomic path if RPC is not available.
    """
    start = time.perf_counter()

    if body.scope not in VALID_SCOPES:
        raise AppException(
            status_code=400,
            detail=f"Invalid scope. Must be one of: {', '.join(sorted(VALID_SCOPES))}",
            error_code="INVALID_SCOPE",
        )

    raw_token = secrets.token_hex(16)  # 32-char hex
    token_hash = _hash_token(raw_token)
    expires_at = datetime.now(UTC) + timedelta(days=body.expires_days)

    admin = await get_supabase_admin_client()
    try:
        result = await admin.rpc(
            "rpc_create_share_link",
            {
                "p_job_id": str(job_id),
                "p_company_id": str(company_id),
                "p_created_by": str(user_id),
                "p_token_hash": token_hash,
                "p_scope": body.scope,
                "p_expires_at": expires_at.isoformat(),
            },
        ).execute()

        link_data = result.data
        if isinstance(link_data, list):
            link_data = link_data[0] if link_data else {}
        link = link_data if isinstance(link_data, dict) else {}
    except Exception as e:
        error_msg = str(e).lower()
        is_rpc_missing = "rpc_create_share_link" in error_msg and (
            "not found" in error_msg or "does not exist" in error_msg
            or "could not find" in error_msg
        )
        if is_rpc_missing:
            logger.info(
                "rpc_create_share_link not available, falling back to non-atomic path"
            )
            link = await _create_share_link_fallback(
                client, job_id, company_id, user_id, body, token_hash, expires_at
            )
        else:
            raise

    # Build the public share URL
    base_url = getattr(settings, "frontend_url", "https://crewmaticai.vercel.app")
    share_url = f"{base_url}/shared/{raw_token}"

    duration_ms = round((time.perf_counter() - start) * 1000, 1)
    logger.info("share_link_created", extra={"extra_data": {
        "job_id": str(job_id),
        "scope": body.scope,
        "expires_days": body.expires_days,
        "duration_ms": duration_ms,
    }})

    return {
        "share_url": share_url,
        "share_token": raw_token,
        "expires_at": link.get("expires_at", expires_at.isoformat()),
    }


async def _create_share_link_fallback(
    client: AsyncClient,
    job_id: UUID,
    company_id: UUID,
    user_id: UUID,
    body: ShareLinkCreate,
    token_hash: str,
    expires_at: datetime,
) -> dict:
    """Fallback: non-atomic share link creation when RPC is not available."""
    row = {
        "job_id": str(job_id),
        "company_id": str(company_id),
        "created_by": str(user_id),
        "token_hash": token_hash,
        "scope": body.scope,
        "expires_at": expires_at.isoformat(),
    }
    result = await client.table("share_links").insert(row).execute()
    link = result.data[0]

    await log_event(
        company_id,
        "share_link_created",
        job_id=job_id,
        user_id=user_id,
        event_data={"link_id": link["id"], "scope": body.scope, "expires_days": body.expires_days},
    )

    return link


async def list_share_links(
    client: AsyncClient,
    job_id: UUID,
) -> dict:
    """List all share links for a job (including revoked, for audit trail).

    Returns {"items": [...], "total": N}.
    """
    result = await (
        client.table("share_links")
        .select("id, scope, expires_at, revoked_at, created_at", count="exact")
        .eq("job_id", str(job_id))
        .order("created_at", desc=True)
        .execute()
    )
    items = result.data or []
    total = result.count if isinstance(result.count, int) else len(items)
    return {"items": items, "total": total}


async def revoke_share_link(
    client: AsyncClient,
    job_id: UUID,
    link_id: UUID,
    company_id: UUID,
    user_id: UUID,
) -> None:
    """Revoke a share link by setting revoked_at."""
    result = await (
        client.table("share_links")
        .update({"revoked_at": datetime.now(UTC).isoformat()})
        .eq("id", str(link_id))
        .eq("job_id", str(job_id))
        .execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Share link not found",
            error_code="SHARE_LINK_NOT_FOUND",
        )

    await log_event(
        company_id,
        "share_link_revoked",
        job_id=job_id,
        user_id=user_id,
        event_data={"link_id": str(link_id)},
    )


async def get_shared_job(token: str) -> dict:
    """Resolve a share token and return scoped job data.

    Uses admin client because this is a public (no-auth) endpoint.
    Validates the token is not expired or revoked.
    """
    start = time.perf_counter()
    token_hash = _hash_token(token)
    admin = await get_supabase_admin_client()

    # Look up the share link by token hash
    result = await (
        admin.table("share_links").select("*").eq("token_hash", token_hash).single().execute()
    )
    if not result.data:
        raise AppException(
            status_code=404,
            detail="Share link not found",
            error_code="SHARE_NOT_FOUND",
        )

    link = result.data

    # Check revoked
    if link.get("revoked_at"):
        raise AppException(
            status_code=403,
            detail="This share link has been revoked",
            error_code="SHARE_REVOKED",
        )

    # Check expired
    expires_at = datetime.fromisoformat(link["expires_at"].replace("Z", "+00:00"))
    if expires_at < datetime.now(UTC):
        raise AppException(
            status_code=403,
            detail="This share link has expired",
            error_code="SHARE_EXPIRED",
        )

    job_id = link["job_id"]
    company_id = link["company_id"]
    scope = link.get("scope", "full")

    # Fetch job (redact sensitive fields)
    job_result = await admin.table("jobs").select("*").eq("id", job_id).single().execute()
    if not job_result.data:
        raise AppException(status_code=404, detail="Job not found", error_code="JOB_NOT_FOUND")

    job = job_result.data
    # Redact sensitive customer fields
    for field in ("customer_phone", "customer_email", "claim_number"):
        job.pop(field, None)

    # Fetch rooms
    rooms_result = await (
        admin.table("job_rooms").select("*").eq("job_id", job_id).order("sort_order").execute()
    )
    rooms = rooms_result.data or []

    # Fetch photos with signed URLs (batch call to avoid N+1)
    photos_result = await (
        admin.table("photos").select("*").eq("job_id", job_id).order("uploaded_at").execute()
    )
    photos = photos_result.data or []
    storage_paths = [p["storage_url"] for p in photos if p.get("storage_url")]
    if storage_paths:
        signed_results = await admin.storage.from_("photos").create_signed_urls(storage_paths, 3600)
        url_map = {
            item.get("path", ""): item.get("signedURL") or item.get("signedUrl") or ""
            for item in signed_results
        }
    else:
        url_map = {}
    for photo in photos:
        photo["signed_url"] = url_map.get(photo.get("storage_url", ""), "")

    # Fetch moisture readings (if scope allows)
    moisture_readings: list[dict] = []
    if scope in ("full", "restoration_only"):
        readings_result = await (
            admin.table("moisture_readings")
            .select("*")
            .eq("job_id", job_id)
            .order("reading_date")
            .execute()
        )
        moisture_readings = readings_result.data or []

    # Fetch line items (if they exist)
    line_items: list[dict] = []
    if scope in ("full", "restoration_only"):
        try:
            items_result = await (
                admin.table("line_items").select("*").eq("job_id", job_id).execute()
            )
            line_items = items_result.data or []
        except Exception:
            pass  # Table may not exist yet

    # Fetch company info (public fields only)
    company_result = await (
        admin.table("companies")
        .select("name, phone, logo_url")
        .eq("id", company_id)
        .single()
        .execute()
    )
    company = company_result.data or {}

    duration_ms = round((time.perf_counter() - start) * 1000, 1)
    logger.info("share_link_resolved", extra={"extra_data": {
        "job_id": job_id,
        "scope": scope,
        "photo_count": len(photos),
        "duration_ms": duration_ms,
    }})

    return {
        "job": job,
        "rooms": rooms,
        "photos": photos,
        "moisture_readings": moisture_readings,
        "line_items": line_items,
        "company": company,
    }
