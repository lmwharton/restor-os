"""Fire-and-forget event logging. Called by all services on mutations.

Usage:
    from api.shared.events import log_event
    await log_event(
        company_id, "job_created", job_id=job_id, user_id=user_id,
        event_data={"job_number": "JOB-20260326-001"},
    )
"""

import logging
from uuid import UUID

from api.shared.database import get_supabase_admin_client

logger = logging.getLogger(__name__)


async def log_event(
    company_id: UUID,
    event_type: str,
    *,
    job_id: UUID | None = None,
    user_id: UUID | None = None,
    is_ai: bool = False,
    event_data: dict | None = None,
) -> None:
    """Log an event to event_history. Never raises — swallows errors
    to avoid failing the primary operation.

    Uses admin client because event inserts must succeed regardless of
    which user triggered them (including system/AI actions).
    """
    try:
        client = get_supabase_admin_client()
        client.table("event_history").insert(
            {
                "company_id": str(company_id),
                "job_id": str(job_id) if job_id else None,
                "event_type": event_type,
                "user_id": str(user_id) if user_id else None,
                "is_ai": is_ai,
                "event_data": event_data or {},
            }
        ).execute()
    except Exception:
        logger.warning("Failed to log event %s", event_type, exc_info=True)
