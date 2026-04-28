from typing import Literal
from uuid import UUID

from pydantic import BaseModel

GateLevel = Literal["warn", "acknowledge", "hard_block"]
JobTypeKey = Literal["mitigation", "reconstruction", "fire_smoke", "remodel"]


# --- Settings -------------------------------------------------------------


class CloseoutSetting(BaseModel):
    id: UUID
    company_id: UUID
    job_type: JobTypeKey
    item_key: str
    gate_level: GateLevel


class CloseoutSettingUpdate(BaseModel):
    gate_level: GateLevel


# --- Gates (computed per-job at request time) -----------------------------


class CloseoutGate(BaseModel):
    """A single gate evaluation result for a job at the requested target status."""

    item_key: str
    label: str
    detail: str | None = None
    # ok / warn / acknowledge / hard_block. Failures use the gate_level from
    # the company's closeout_settings (warn/acknowledge/hard_block); pass = "ok".
    status: Literal["ok", "warn", "acknowledge", "hard_block"]


class CloseoutGatesResponse(BaseModel):
    job_id: UUID
    target_status: str
    gates: list[CloseoutGate]
