"""Notification service: unread count + mark-seen."""

from datetime import UTC, datetime
from uuid import UUID

from api.shared.database import get_supabase_admin_client


async def get_notifications(
    company_id: UUID,
    user_id: UUID,
    last_seen_at: datetime | None,
    limit: int = 20,
) -> dict:
    """Get recent company events with unread count.

    Includes both team activity (other users) and AI/system events.
    Excludes the current user's own actions.
    """
    client = await get_supabase_admin_client()

    # Get recent events: other users' actions + AI/system events (user_id IS NULL).
    # PostgREST .neq() excludes NULLs, so we use .or_() to include both cases.
    result = await (
        client.table("event_history")
        .select("*")
        .eq("company_id", str(company_id))
        .or_(f"user_id.neq.{user_id},user_id.is.null")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    items = result.data or []

    # Collect unique user_ids and job_ids for batch lookup
    user_ids = {item["user_id"] for item in items if item.get("user_id")}
    job_ids = {item["job_id"] for item in items if item.get("job_id")}

    # Batch fetch user names and job numbers
    user_names: dict[str, str] = {}
    job_numbers: dict[str, str] = {}

    if user_ids:
        users_result = await (
            client.table("users")
            .select("id, name")
            .in_("id", [str(uid) for uid in user_ids])
            .execute()
        )
        user_names = {u["id"]: u["name"] for u in (users_result.data or [])}

    if job_ids:
        jobs_result = await (
            client.table("jobs")
            .select("id, job_number")
            .in_("id", [str(jid) for jid in job_ids])
            .execute()
        )
        job_numbers = {j["id"]: j["job_number"] for j in (jobs_result.data or [])}

    # Count unread (events newer than last_seen_at)
    last_seen_iso = last_seen_at.isoformat() if last_seen_at else None
    if last_seen_iso:
        unread_count = sum(1 for item in items if item["created_at"] > last_seen_iso)
    else:
        unread_count = len(items)

    # Format items with is_unread flag and resolved names
    formatted = []
    for item in items:
        is_unread = not last_seen_iso or item["created_at"] > last_seen_iso
        formatted.append({
            "id": item["id"],
            "event_type": item["event_type"],
            "user_id": item.get("user_id"),
            "user_name": user_names.get(item["user_id"]) if item.get("user_id") else None,
            "is_ai": item.get("is_ai", False),
            "job_id": item.get("job_id"),
            "job_number": job_numbers.get(item["job_id"]) if item.get("job_id") else None,
            "event_data": item.get("event_data", {}),
            "created_at": item["created_at"],
            "is_unread": is_unread,
        })

    return {"unread_count": unread_count, "items": formatted}


async def get_unread_count(
    company_id: UUID,
    user_id: UUID,
    last_seen_at: datetime | None,
) -> int:
    """Get just the unread count (lightweight for polling)."""
    client = await get_supabase_admin_client()

    query = (
        client.table("event_history")
        .select("id", count="exact")
        .eq("company_id", str(company_id))
        .or_(f"user_id.neq.{user_id},user_id.is.null")
    )

    if last_seen_at:
        query = query.gt("created_at", last_seen_at.isoformat())

    result = await query.execute()
    return result.count or 0


async def mark_notifications_seen(user_id: UUID) -> str:
    """Update last_notifications_seen_at to now. Returns the timestamp."""
    client = await get_supabase_admin_client()
    now = datetime.now(UTC).isoformat()

    await (
        client.table("users")
        .update({"last_notifications_seen_at": now})
        .eq("id", str(user_id))
        .execute()
    )

    return now
