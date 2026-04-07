"""Notification endpoints.

- GET /notifications — recent events with unread count
- GET /notifications/unread-count — lightweight poll endpoint
- POST /notifications/mark-seen — mark all as read
"""

from fastapi import APIRouter, Depends, Query

from api.auth.middleware import get_auth_context
from api.auth.schemas import AuthContext
from api.notifications.service import (
    get_notifications,
    get_unread_count,
    mark_notifications_seen,
)

router = APIRouter(tags=["notifications"])


@router.get("/notifications")
async def list_notifications(
    limit: int = Query(default=20, ge=1, le=50),
    ctx: AuthContext = Depends(get_auth_context),
):
    """Get recent notifications with unread count."""
    return await get_notifications(
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        last_seen_at=ctx.last_notifications_seen_at,
        limit=limit,
    )


@router.get("/notifications/unread-count")
async def unread_count(ctx: AuthContext = Depends(get_auth_context)):
    """Lightweight endpoint for polling unread count."""
    count = await get_unread_count(
        company_id=ctx.company_id,
        user_id=ctx.user_id,
        last_seen_at=ctx.last_notifications_seen_at,
    )
    return {"unread_count": count}


@router.post("/notifications/mark-seen")
async def mark_seen(ctx: AuthContext = Depends(get_auth_context)):
    """Mark all notifications as seen."""
    marked_at = await mark_notifications_seen(ctx.user_id)
    return {"marked_at": marked_at}
