"""Tests for Spec 01K closeout service — fallback path + evaluator voice.

Focus is on the service-layer logic that doesn't need a live Supabase:

  - `get_gates_for_target` falls back to SPEC_DEFAULT_GATES when no
    closeout_settings rows exist for the company × job_type pair (defensive
    against companies seeded before the migration's DO-block ran).
  - Per-company overrides win over defaults when settings DO exist.
  - The 7 evaluator detail strings use the unified contractor's-eye voice.

We bypass the Supabase mock chain entirely by patching `load_snapshot`,
since the snapshot is the only side-effecting boundary in the function
under test. Pattern is intentionally lighter than `tests/test_jobs.py` —
those tests exercise the FastAPI request layer; these exercise the pure
service logic directly.
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from api.closeout.schemas import CloseoutSetting
from api.closeout.service import (
    GATE_EVALUATORS,
    SPEC_DEFAULT_GATES,
    JobStateSnapshot,
    _eval_all_equipment_pulled,
    _eval_all_rooms_dry_standard,
    _eval_certificate_generated,
    _eval_contract_signed,
    _eval_moisture_per_room,
    _eval_photos_final_after,
    _eval_scope_finalized,
    get_gates_for_target,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_setting(
    *,
    company_id,
    job_type: str,
    item_key: str,
    gate_level: str = "warn",
) -> CloseoutSetting:
    return CloseoutSetting(
        id=uuid4(),
        company_id=company_id,
        job_type=job_type,  # type: ignore[arg-type]
        item_key=item_key,
        gate_level=gate_level,  # type: ignore[arg-type]
    )


def _make_snapshot(
    *,
    job_type: str = "mitigation",
    contract_signed_at: str | None = None,
    estimate_last_finalized_at: str | None = None,
    rooms: list[dict] | None = None,
    photos: list[dict] | None = None,
    moisture_readings: list[dict] | None = None,
    settings: list[CloseoutSetting] | None = None,
    has_certificate: bool = False,
) -> JobStateSnapshot:
    """Build a JobStateSnapshot matching what `load_snapshot` returns."""
    return JobStateSnapshot(
        job={
            "id": str(uuid4()),
            "job_type": job_type,
            "contract_signed_at": contract_signed_at,
            "estimate_last_finalized_at": estimate_last_finalized_at,
        },
        rooms=rooms or [],
        photos=photos or [],
        moisture_readings=moisture_readings or [],
        settings=settings or [],
        has_certificate=has_certificate,
    )


# ---------------------------------------------------------------------------
# Spec defaults are consistent with the canonical 7 items
# ---------------------------------------------------------------------------


class TestSpecDefaultGatesShape:
    """Sanity-check the const matches the migration's seed (D1/D2)."""

    def test_mitigation_has_all_seven_items(self):
        keys = [k for k, _ in SPEC_DEFAULT_GATES["mitigation"]]
        assert keys == [
            "contract_signed",
            "photos_final_after",
            "moisture_per_room",
            "all_rooms_dry_standard",
            "all_equipment_pulled",
            "scope_finalized",
            "certificate_generated",
        ]

    def test_reconstruction_has_three_items(self):
        keys = [k for k, _ in SPEC_DEFAULT_GATES["reconstruction"]]
        assert keys == ["contract_signed", "photos_final_after", "scope_finalized"]

    def test_fire_smoke_has_four_items(self):
        keys = [k for k, _ in SPEC_DEFAULT_GATES["fire_smoke"]]
        assert keys == [
            "contract_signed",
            "photos_final_after",
            "scope_finalized",
            "certificate_generated",
        ]

    def test_remodel_is_empty(self):
        # Migration has no seed for `remodel`; defaults mirror that.
        assert SPEC_DEFAULT_GATES["remodel"] == []

    def test_contract_signed_defaults_to_acknowledge(self):
        # D2 — contract_signed is the only "acknowledge" default; the rest
        # are "warn".
        for job_type in ("mitigation", "reconstruction", "fire_smoke"):
            entries = dict(SPEC_DEFAULT_GATES[job_type])
            assert entries["contract_signed"] == "acknowledge"
            for key, level in entries.items():
                if key != "contract_signed":
                    assert level == "warn"

    def test_every_default_item_has_an_evaluator(self):
        for job_type, items in SPEC_DEFAULT_GATES.items():
            for item_key, _ in items:
                assert item_key in GATE_EVALUATORS, (
                    f"{job_type}.{item_key} has no evaluator registered"
                )


# ---------------------------------------------------------------------------
# get_gates_for_target — fallback + override behavior
# ---------------------------------------------------------------------------


def _all_failing_mitigation_snapshot() -> JobStateSnapshot:
    """Snapshot where every mitigation gate fails, so each gate's status
    surfaces its configured gate_level (rather than the always-`ok` pass)."""
    room_id = str(uuid4())
    return _make_snapshot(
        job_type="mitigation",
        # contract_signed_at left None → fails
        # estimate_last_finalized_at left None → fails
        # has_certificate left False → fails
        rooms=[
            # One room with equipment still placed and no moisture reading.
            # This forces all_equipment_pulled, moisture_per_room,
            # all_rooms_dry_standard, photos_final_after to fail.
            {
                "id": room_id,
                "equipment_air_movers": 2,
                "equipment_dehus": 0,
                "room_name": "Living Room",
            }
        ],
        photos=[],
        moisture_readings=[],
    )


@pytest.mark.asyncio
async def test_get_gates_falls_back_to_spec_defaults_when_no_settings_rows(caplog):
    """Pre-migration company w/ zero settings rows → spec defaults still surface."""
    company_id = uuid4()
    job_id = uuid4()

    snap = _all_failing_mitigation_snapshot()
    snap.settings.clear()  # zero settings rows — the defensive fallback path

    with (
        patch(
            "api.closeout.service.load_snapshot",
            AsyncMock(return_value=snap),
        ),
        caplog.at_level("WARNING", logger="api.closeout.service"),
    ):
        resp = await get_gates_for_target(
            token="ignored",
            company_id=company_id,
            job_id=job_id,
            target_status="completed",
        )

    # All 7 mitigation gates surface.
    assert len(resp.gates) == 7
    keys = [g.item_key for g in resp.gates]
    assert keys == [k for k, _ in SPEC_DEFAULT_GATES["mitigation"]]

    # Snapshot is engineered so every gate FAILS, so each gate's status
    # equals its default level. contract_signed defaults to `acknowledge`;
    # the rest are `warn`.
    levels = {g.item_key: g.status for g in resp.gates}
    assert levels["contract_signed"] == "acknowledge"
    for key in (
        "photos_final_after",
        "moisture_per_room",
        "all_rooms_dry_standard",
        "all_equipment_pulled",
        "scope_finalized",
        "certificate_generated",
    ):
        assert levels[key] == "warn"

    # Backfill warning was emitted.
    assert any(
        "closeout_settings empty" in record.message
        and str(company_id) in record.message
        and "mitigation" in record.message
        for record in caplog.records
    ), "expected a warning logging the company that needs backfilling"


@pytest.mark.asyncio
async def test_get_gates_uses_company_overrides_when_settings_exist():
    """When settings rows DO exist, per-company gate_level wins over defaults."""
    company_id = uuid4()
    job_id = uuid4()

    # Mirror the spec defaults but flip `photos_final_after` to hard_block.
    settings = [
        _make_setting(
            company_id=company_id,
            job_type="mitigation",
            item_key=item_key,
            gate_level="hard_block" if item_key == "photos_final_after" else gate_level,
        )
        for item_key, gate_level in SPEC_DEFAULT_GATES["mitigation"]
    ]

    # Use the all-failing snapshot so every gate's gate_level surfaces.
    snap = _all_failing_mitigation_snapshot()
    snap.settings[:] = settings

    with patch(
        "api.closeout.service.load_snapshot",
        AsyncMock(return_value=snap),
    ):
        resp = await get_gates_for_target(
            token="ignored",
            company_id=company_id,
            job_id=job_id,
            target_status="completed",
        )

    assert len(resp.gates) == 7
    levels = {g.item_key: g.status for g in resp.gates}

    # The override took effect — failure status surfaces as `hard_block`.
    assert levels["photos_final_after"] == "hard_block"
    # contract_signed kept its `acknowledge` default.
    assert levels["contract_signed"] == "acknowledge"
    # The rest stayed `warn`.
    for key in (
        "moisture_per_room",
        "all_rooms_dry_standard",
        "all_equipment_pulled",
        "scope_finalized",
        "certificate_generated",
    ):
        assert levels[key] == "warn"


@pytest.mark.asyncio
async def test_get_gates_returns_empty_for_remodel_with_no_settings():
    """Remodel jobs have no defaults per spec — empty response is correct."""
    company_id = uuid4()
    job_id = uuid4()

    snap = _make_snapshot(job_type="remodel", settings=[])

    with patch(
        "api.closeout.service.load_snapshot",
        AsyncMock(return_value=snap),
    ):
        resp = await get_gates_for_target(
            token="ignored",
            company_id=company_id,
            job_id=job_id,
            target_status="completed",
        )

    assert resp.gates == []


@pytest.mark.asyncio
async def test_get_gates_skips_evaluation_for_non_completed_target():
    """Only `target=completed` evaluates — other targets short-circuit."""
    company_id = uuid4()
    job_id = uuid4()

    # load_snapshot should NOT be called when target != 'completed'.
    with patch(
        "api.closeout.service.load_snapshot",
        AsyncMock(),
    ) as mock_load:
        resp = await get_gates_for_target(
            token="ignored",
            company_id=company_id,
            job_id=job_id,
            target_status="invoiced",
        )

    assert resp.gates == []
    mock_load.assert_not_called()


# ---------------------------------------------------------------------------
# Voice consistency — evaluator detail strings
# ---------------------------------------------------------------------------


class TestEvaluatorVoice:
    """Confirms the unified contractor's-eye voice across all 7 evaluators."""

    def test_contract_signed_pass(self):
        snap = _make_snapshot(contract_signed_at="2026-04-01T00:00:00Z")
        passed, detail = _eval_contract_signed(snap)
        assert passed is True
        assert detail == "Contract on file"

    def test_contract_signed_fail(self):
        snap = _make_snapshot(contract_signed_at=None)
        passed, detail = _eval_contract_signed(snap)
        assert passed is False
        assert detail == "Contract not signed"

    def test_photos_final_after_pass(self):
        room_id = str(uuid4())
        snap = _make_snapshot(
            rooms=[{"id": room_id}],
            photos=[{"id": str(uuid4()), "photo_type": "after", "room_id": room_id}],
        )
        passed, detail = _eval_photos_final_after(snap)
        assert passed is True
        assert detail == "Final/After photos tagged"

    def test_photos_final_after_fail_partial(self):
        r1, r2 = str(uuid4()), str(uuid4())
        snap = _make_snapshot(
            rooms=[{"id": r1}, {"id": r2}],
            photos=[{"id": str(uuid4()), "photo_type": "after", "room_id": r1}],
        )
        passed, detail = _eval_photos_final_after(snap)
        assert passed is False
        assert detail == "1 of 2 rooms missing Final/After photos"

    def test_photos_final_after_no_rooms(self):
        # No rooms recorded → fail with the unified "No rooms recorded" msg.
        snap = _make_snapshot(rooms=[])
        passed, detail = _eval_photos_final_after(snap)
        assert passed is False
        assert detail == "No rooms recorded"

    def test_moisture_per_room_pass(self):
        r1, r2 = str(uuid4()), str(uuid4())
        snap = _make_snapshot(
            rooms=[{"id": r1}, {"id": r2}],
            moisture_readings=[
                {"id": str(uuid4()), "room_id": r1},
                {"id": str(uuid4()), "room_id": r2},
            ],
        )
        passed, detail = _eval_moisture_per_room(snap)
        assert passed is True
        assert detail == "2 rooms with readings"

    def test_moisture_per_room_fail(self):
        r1, r2 = str(uuid4()), str(uuid4())
        snap = _make_snapshot(
            rooms=[{"id": r1}, {"id": r2}],
            moisture_readings=[{"id": str(uuid4()), "room_id": r1}],
        )
        passed, detail = _eval_moisture_per_room(snap)
        assert passed is False
        assert detail == "1 of 2 rooms missing readings"

    def test_all_rooms_dry_standard_pass(self):
        r1 = str(uuid4())
        snap = _make_snapshot(
            rooms=[{"id": r1, "equipment_air_movers": 0, "equipment_dehus": 0}],
            moisture_readings=[{"id": str(uuid4()), "room_id": r1}],
        )
        passed, detail = _eval_all_rooms_dry_standard(snap)
        assert passed is True
        assert detail == "All rooms at dry standard"

    def test_all_rooms_dry_standard_fail(self):
        r1, r2 = str(uuid4()), str(uuid4())
        snap = _make_snapshot(
            rooms=[
                {"id": r1, "equipment_air_movers": 0, "equipment_dehus": 0},
                {"id": r2, "equipment_air_movers": 1, "equipment_dehus": 0},
            ],
            moisture_readings=[
                {"id": str(uuid4()), "room_id": r1},
                {"id": str(uuid4()), "room_id": r2},
            ],
        )
        passed, detail = _eval_all_rooms_dry_standard(snap)
        assert passed is False
        assert detail == "1 of 2 rooms not at dry standard"

    def test_all_equipment_pulled_pass(self):
        snap = _make_snapshot(
            rooms=[{"id": str(uuid4()), "equipment_air_movers": 0, "equipment_dehus": 0}],
        )
        passed, detail = _eval_all_equipment_pulled(snap)
        assert passed is True
        assert detail == "All equipment pulled"

    def test_all_equipment_pulled_fail(self):
        snap = _make_snapshot(
            rooms=[
                {"id": str(uuid4()), "equipment_air_movers": 2, "equipment_dehus": 1},
                {"id": str(uuid4()), "equipment_air_movers": 0, "equipment_dehus": 1},
            ],
        )
        passed, detail = _eval_all_equipment_pulled(snap)
        assert passed is False
        assert detail == "4 units still on site"

    def test_scope_finalized_pass(self):
        snap = _make_snapshot(estimate_last_finalized_at="2026-04-15T00:00:00Z")
        passed, detail = _eval_scope_finalized(snap)
        assert passed is True
        assert detail == "Estimate finalized"

    def test_scope_finalized_fail(self):
        snap = _make_snapshot(estimate_last_finalized_at=None)
        passed, detail = _eval_scope_finalized(snap)
        assert passed is False
        assert detail == "Estimate not finalized"

    def test_certificate_generated_pass(self):
        snap = _make_snapshot(has_certificate=True)
        passed, detail = _eval_certificate_generated(snap)
        assert passed is True
        assert detail == "Certificate on file"

    def test_certificate_generated_fail(self):
        snap = _make_snapshot(has_certificate=False)
        passed, detail = _eval_certificate_generated(snap)
        assert passed is False
        assert detail == "Certificate not generated"

    def test_voice_strings_have_no_apologetic_fillers(self):
        """No "yet", "Only", "recommended" softeners — voice spec is firm."""
        snap_all_fail = _make_snapshot()  # everything missing
        for evaluator in (
            _eval_contract_signed,
            _eval_photos_final_after,
            _eval_moisture_per_room,
            _eval_all_rooms_dry_standard,
            _eval_all_equipment_pulled,
            _eval_scope_finalized,
            _eval_certificate_generated,
        ):
            _passed, detail = evaluator(snap_all_fail)
            assert detail is not None
            lowered = detail.lower()
            for banned in (" yet", "only ", "recommended"):
                assert banned not in lowered, (
                    f"{evaluator.__name__} produced banned filler in {detail!r}"
                )
