from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class EventResponse(BaseModel):
    id: UUID
    company_id: UUID
    job_id: UUID | None
    event_type: str
    user_id: UUID | None
    is_ai: bool
    event_data: dict
    created_at: datetime
