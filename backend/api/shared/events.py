"""Fire-and-forget event logging. Called by all services on mutations.

Usage:
    from api.shared.events import log_event
    await log_event(
        company_id, "job_created", job_id=job_id, user_id=user_id,
        event_data={"job_number": "JOB-20260326-001"},
    )

Non-transactional pattern (V1):
    Supabase PostgREST does not support multi-table transactions. Our
    current pattern is: primary operation first (raises on failure), then
    fire-and-forget event logging (swallows errors). This is acceptable
    because event_history is an audit trail, not business-critical state.

    If the primary operation succeeds but event logging fails, a warning
    is logged and the user's request still succeeds. The worst case is a
    missing audit entry — not data corruption.

    TODO(Spec-02): For scope_run + line_item creation (AI Photo Scope),
    atomicity IS critical. Use a PostgreSQL RPC function via
    client.rpc("create_scope_run_with_items", {...}) to wrap both inserts
    in a single database transaction.
"""

import logging
import time
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
    start = time.perf_counter()
    try:
        client = await get_supabase_admin_client()
        await client.table("event_history").insert(
            {
                "company_id": str(company_id),
                "job_id": str(job_id) if job_id else None,
                "event_type": event_type,
                "user_id": str(user_id) if user_id else None,
                "is_ai": is_ai,
                "event_data": event_data or {},
            }
        ).execute()
        duration_ms = round((time.perf_counter() - start) * 1000, 1)
        logger.info("event_logged", extra={"extra_data": {
            "event_type": event_type,
            "job_id": str(job_id) if job_id else None,
            "duration_ms": duration_ms,
        }})
    except Exception:
        duration_ms = round((time.perf_counter() - start) * 1000, 1)
        logger.warning("event_log_failed", exc_info=True, extra={"extra_data": {
            "event_type": event_type,
            "duration_ms": duration_ms,
        }})
