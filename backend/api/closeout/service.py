"""Spec 01K Phase 3 — closeout settings + gate evaluators.

Gate evaluators are pure functions over a `JobStateSnapshot`. Snapshot is
loaded once per request (no N+1) and passed to each evaluator.

Item keys are stable identifiers shared with the frontend's STATUS_META.
Per Spec 01K D1 the canonical 7 items are:

  contract_signed
  photos_final_after
  moisture_per_room      (mitigation only)
  all_rooms_dry_standard (mitigation only)
  all_equipment_pulled   (mitigation only)
  scope_finalized
  certificate_generated  (mitigation + fire/smoke; n/a for reconstruction)
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from uuid import UUID

from api.closeout.schemas import (
    CloseoutGate,
    CloseoutGatesResponse,
    CloseoutSetting,
    CloseoutSettingUpdate,
)
from api.shared.database import get_authenticated_client, get_supabase_admin_client
from api.shared.exceptions import AppException

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Snapshot
# ---------------------------------------------------------------------------


@dataclass
class JobStateSnapshot:
    """Pre-fetched job + room data the gate evaluators run against."""

    job: dict
    rooms: list[dict]
    photos: list[dict]
    moisture_readings: list[dict]
    settings: list[CloseoutSetting]
    has_certificate: bool


async def load_snapshot(token: str, company_id: UUID, job_id: UUID) -> JobStateSnapshot:
    client = await get_authenticated_client(token)

    # Fetch job
    job_res = await (
        client.table("jobs")
        .select("*")
        .eq("id", str(job_id))
        .eq("company_id", str(company_id))
        .is_("deleted_at", "null")
        .single()
        .execute()
    )
    if not job_res.data:
        raise AppException(status_code=404, detail="Job not found", error_code="JOB_NOT_FOUND")

    # Rooms
    rooms_res = await (
        client.table("job_rooms")
        .select("*")
        .eq("job_id", str(job_id))
        .execute()
    )

    # Photos (only the type field — keep payload small)
    photos_res = await (
        client.table("photos")
        .select("id, photo_type, room_id")
        .eq("job_id", str(job_id))
        .execute()
    )

    # Moisture readings (just need counts per room)
    readings_res = await (
        client.table("moisture_readings")
        .select("id, room_id")
        .eq("job_id", str(job_id))
        .execute()
    )

    # Closeout settings for the job's company
    settings_res = await (
        client.table("closeout_settings")
        .select("*")
        .eq("company_id", str(company_id))
        .execute()
    )
    settings = [CloseoutSetting.model_validate(s) for s in (settings_res.data or [])]

    # Certificate of completion presence — best-effort. The reports table
    # might not yet exist or might not have rows for this job. Don't blow
    # up if the query fails; just treat it as missing.
    has_cert = False
    try:
        cert_res = await (
            client.table("reports")
            .select("id, report_type, status")
            .eq("job_id", str(job_id))
            .eq("report_type", "full_report")
            .in_("status", ["ready", "generated"])
            .limit(1)
            .execute()
        )
        has_cert = bool(cert_res.data)
    except Exception as e:
        logger.warning("certificate lookup failed for job %s: %s", job_id, e)

    return JobStateSnapshot(
        job=job_res.data,
        rooms=rooms_res.data or [],
        photos=photos_res.data or [],
        moisture_readings=readings_res.data or [],
        settings=settings,
        has_certificate=has_cert,
    )


# ---------------------------------------------------------------------------
# Gate evaluators
# ---------------------------------------------------------------------------


# Each evaluator returns either:
#   - (True, detail)  → gate passed (status=ok)
#   - (False, detail) → gate failed (status determined from settings.gate_level)


def _eval_contract_signed(snap: JobStateSnapshot) -> tuple[bool, str | None]:
    if snap.job.get("contract_signed_at"):
        return True, "Signed and on file"
    return False, "No contract signed yet"


def _eval_photos_final_after(snap: JobStateSnapshot) -> tuple[bool, str | None]:
    rooms_with_after = {p.get("room_id") for p in snap.photos if p.get("photo_type") == "after"}
    rooms_with_after.discard(None)
    total_rooms = len(snap.rooms)
    if total_rooms == 0:
        return True, "No rooms recorded yet"
    if rooms_with_after.issuperset({r["id"] for r in snap.rooms}):
        return True, f"{total_rooms} of {total_rooms} rooms"
    have = len(rooms_with_after)
    return False, f"Only {have} of {total_rooms} rooms have a Final/After photo"


def _eval_moisture_per_room(snap: JobStateSnapshot) -> tuple[bool, str | None]:
    rooms_with_reading = {r.get("room_id") for r in snap.moisture_readings}
    rooms_with_reading.discard(None)
    total_rooms = len(snap.rooms)
    if total_rooms == 0:
        return True, "No rooms"
    missing = total_rooms - len({r["id"] for r in snap.rooms} & rooms_with_reading)
    if missing == 0:
        return True, f"All {total_rooms} rooms have at least one reading"
    return False, f"{missing} room{'s' if missing != 1 else ''} missing a moisture reading"


def _eval_all_rooms_dry_standard(snap: JobStateSnapshot) -> tuple[bool, str | None]:
    # Heuristic: a room is "at dry standard" if it has at least one moisture
    # reading AND no equipment placed. Mirrors the frontend's
    # countRoomsAtDryStandard helper. Future: wire to a real dry-standard
    # column once it lands.
    rooms_with_reading = {r.get("room_id") for r in snap.moisture_readings}
    not_yet = []
    for room in snap.rooms:
        rid = room["id"]
        equip = (room.get("equipment_air_movers") or 0) + (room.get("equipment_dehus") or 0)
        if rid not in rooms_with_reading or equip > 0:
            not_yet.append(room.get("room_name") or rid[:6])
    if not not_yet:
        return True, f"{len(snap.rooms)} rooms at dry standard"
    return False, f"Not yet at dry standard: {', '.join(not_yet[:3])}"


def _eval_all_equipment_pulled(snap: JobStateSnapshot) -> tuple[bool, str | None]:
    am = sum((r.get("equipment_air_movers") or 0) for r in snap.rooms)
    de = sum((r.get("equipment_dehus") or 0) for r in snap.rooms)
    if am == 0 and de == 0:
        return True, "All equipment pulled"
    parts = []
    if am > 0:
        parts.append(f"{am} air mover{'s' if am != 1 else ''}")
    if de > 0:
        parts.append(f"{de} dehu{'s' if de != 1 else ''}")
    return False, f"{' · '.join(parts)} still placed"


def _eval_scope_finalized(snap: JobStateSnapshot) -> tuple[bool, str | None]:
    if snap.job.get("estimate_last_finalized_at"):
        return True, "Estimate finalized"
    return False, "Estimate not yet finalized"


def _eval_certificate_generated(snap: JobStateSnapshot) -> tuple[bool, str | None]:
    if snap.has_certificate:
        return True, "Generated and on file"
    # Default gate level for this item is `warn` (per migration 01k_a1
    # closeout_settings seed), so the copy is "recommended" not "required".
    # Companies that flip the gate to `hard_block` will see this item block
    # closeout — but the language stays soft because the seed mentioned
    # generating one is best-practice, not a strict prerequisite.
    return False, "Not generated yet — recommended before closeout"


GATE_EVALUATORS: dict[str, Callable[[JobStateSnapshot], tuple[bool, str | None]]] = {
    "contract_signed":         _eval_contract_signed,
    "photos_final_after":      _eval_photos_final_after,
    "moisture_per_room":       _eval_moisture_per_room,
    "all_rooms_dry_standard":  _eval_all_rooms_dry_standard,
    "all_equipment_pulled":    _eval_all_equipment_pulled,
    "scope_finalized":         _eval_scope_finalized,
    "certificate_generated":   _eval_certificate_generated,
}


# Friendly labels surfaced to the UI checklist + the admin settings page.
GATE_LABELS: dict[str, str] = {
    "contract_signed":         "Contract signed",
    "photos_final_after":      "Photos tagged Final / After",
    "moisture_per_room":       "All rooms have moisture reading",
    "all_rooms_dry_standard":  "All rooms at dry standard",
    "all_equipment_pulled":    "All equipment pulled",
    "scope_finalized":         "Scope finalized",
    "certificate_generated":   "Certificate of Completion",
}


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------


async def get_gates_for_target(
    token: str, company_id: UUID, job_id: UUID, target_status: str
) -> CloseoutGatesResponse:
    """Evaluate all configured gates for a job at the given target status.

    For now we only evaluate gates when target_status == 'completed' — the
    other transitions don't have configurable gates in spec 01K. If the
    target is anything else, return an empty list (no gates apply).
    """
    if target_status != "completed":
        return CloseoutGatesResponse(job_id=job_id, target_status=target_status, gates=[])

    snap = await load_snapshot(token, company_id, job_id)
    job_type = snap.job.get("job_type") or "mitigation"

    # The settings list scopes per-company-per-job_type. Filter to the right
    # rows. If a setting doesn't exist for an item × job_type, the item is
    # n/a and we skip it.
    relevant = [s for s in snap.settings if s.job_type == job_type]
    if not relevant:
        # Nothing configured for this job type — no gates surface.
        return CloseoutGatesResponse(job_id=job_id, target_status=target_status, gates=[])

    gates: list[CloseoutGate] = []
    for setting in relevant:
        evaluator = GATE_EVALUATORS.get(setting.item_key)
        if not evaluator:
            # Unknown item_key — skip silently. Future items can be added
            # without a migration; just register an evaluator here.
            continue
        passed, detail = evaluator(snap)
        gates.append(CloseoutGate(
            item_key=setting.item_key,
            label=GATE_LABELS.get(setting.item_key, setting.item_key),
            detail=detail,
            status="ok" if passed else setting.gate_level,
        ))

    return CloseoutGatesResponse(job_id=job_id, target_status=target_status, gates=gates)


async def list_settings(token: str, company_id: UUID) -> list[CloseoutSetting]:
    client = await get_authenticated_client(token)
    res = await (
        client.table("closeout_settings")
        .select("*")
        .eq("company_id", str(company_id))
        .order("job_type")
        .order("item_key")
        .execute()
    )
    return [CloseoutSetting.model_validate(r) for r in (res.data or [])]


async def update_setting(
    token: str, company_id: UUID, setting_id: UUID, body: CloseoutSettingUpdate
) -> CloseoutSetting:
    client = await get_authenticated_client(token)
    res = await (
        client.table("closeout_settings")
        .update({"gate_level": body.gate_level})
        .eq("id", str(setting_id))
        .eq("company_id", str(company_id))
        .execute()
    )
    if not res.data:
        raise AppException(
            status_code=404, detail="Setting not found", error_code="SETTING_NOT_FOUND"
        )
    return CloseoutSetting.model_validate(res.data[0])


async def reset_settings_for_job_type(
    company_id: UUID, job_type: str
) -> None:
    """Delete all settings rows for a job_type, then re-seed defaults via the RPC.

    Uses admin client to bypass the closeout_settings_delete RLS policy
    (which is FOR DELETE USING (false) — only this service-side path can wipe).
    """
    valid_types = {"mitigation", "reconstruction", "fire_smoke", "remodel"}
    if job_type not in valid_types:
        raise AppException(
            status_code=400,
            detail=f"Invalid job_type: {job_type}",
            error_code="INVALID_JOB_TYPE",
        )

    admin = await get_supabase_admin_client()
    await (
        admin.table("closeout_settings")
        .delete()
        .eq("company_id", str(company_id))
        .eq("job_type", job_type)
        .execute()
    )
    # Re-seed (the RPC inserts ALL job_types, but ON CONFLICT DO NOTHING means
    # the other types' existing rows aren't disturbed).
    await admin.rpc("rpc_seed_closeout_settings", {"p_company_id": str(company_id)}).execute()
