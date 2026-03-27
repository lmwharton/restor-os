"""Event history queries. Events are created internally via log_event(),
so this module only exposes read operations."""

from uuid import UUID

from supabase import Client


async def list_job_events(
    client: Client,
    job_id: UUID,
    company_id: UUID,
    event_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """List events for a specific job (job timeline). Returns {items, total}."""
    query = (
        client.table("event_history")
        .select("*", count="exact")
        .eq("job_id", str(job_id))
        .eq("company_id", str(company_id))
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if event_type:
        query = query.eq("event_type", event_type)

    result = query.execute()
    return {"items": result.data or [], "total": result.count or 0}


async def list_company_events(
    client: Client,
    company_id: UUID,
    event_type: str | None = None,
    job_id: UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """List events for the company (activity feed). Returns {items, total}."""
    query = (
        client.table("event_history")
        .select("*", count="exact")
        .eq("company_id", str(company_id))
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if event_type:
        query = query.eq("event_type", event_type)
    if job_id:
        query = query.eq("job_id", str(job_id))

    result = query.execute()
    return {"items": result.data or [], "total": result.count or 0}
