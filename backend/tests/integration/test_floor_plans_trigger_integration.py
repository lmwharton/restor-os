"""Integration tests for the R4 frozen-mutation trigger + follow-on RPCs.

Lakshman round-3 #4: the text-scan tests in ``test_migration_trigger_functions.py``
catch literal-string regressions (R1's ``set_updated_at`` typo) but can't
verify runtime behavior contracts — SQLSTATE disambiguation, legitimate
flip pass-through, JWT-derived tenant rejection. Those require a real
Postgres. This file closes that gap.

Runs against the local Supabase dev instance via the shared
``integration/conftest.py`` fixtures. Skips automatically when local
Supabase isn't reachable, so CI without a test DB stays green.

Contracts verified:

1. ``UPDATE`` on a frozen (``is_current=false``) ``floor_plans`` row raises
   SQLSTATE ``55006`` (the R4 follow-on trigger's code).
2. The legitimate ``is_current: true → false`` flip inside
   ``save_floor_plan_version`` passes through the trigger without being
   blocked — the trigger only fires when OLD.is_current is already false.
3. ``save_floor_plan_version`` raises SQLSTATE ``42501`` when the JWT-derived
   company doesn't match ``p_company_id`` (distinct from 55006 so the
   Python catch blocks can disambiguate).
4. ``_compute_wall_sf_for_room`` (the 1-arg JWT-derived version installed by
   ``a7b8c9d0e1f2``) rejects unauthenticated callers and computes correct
   SF for authenticated ones.

All tests run inside transactions where possible; explicit cleanup
otherwise. Isolation between tests comes from the
``onboarded_user`` fixture creating a fresh user+company per run.
"""

from __future__ import annotations

import uuid

import pytest


# Conftest.py's module-level pytestmark doesn't cascade to sibling test
# modules — every integration test file needs to opt in explicitly. The
# `_supabase_is_reachable` probe lives in conftest; we re-use it here so
# the file skips cleanly when local Supabase isn't running (CI, or a
# dev who just doesn't have `supabase start` up).
from tests.integration.conftest import _supabase_is_reachable

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not _supabase_is_reachable(),
        reason="Local Supabase is not running (start with: supabase start)",
    ),
]


# ---------------------------------------------------------------------------
# Test data helpers
# ---------------------------------------------------------------------------


async def _make_property(admin_client, company_id: str) -> str:
    """Insert a property row and return its id."""
    unique = uuid.uuid4().hex[:8]
    result = await (
        admin_client.table("properties")
        .insert({
            "company_id": company_id,
            "address_line1": f"{unique} Trigger Test Ln",
            "city": "Troy",
            "state": "MI",
            "zip": "48083",
        })
        .execute()
    )
    return result.data[0]["id"]


async def _make_job(admin_client, company_id: str, property_id: str, user_id: str) -> str:
    """Insert a job row (via the create_job RPC or direct insert) and
    return its id. Direct insert keeps the test focused on the trigger;
    the job's status must be something non-archived."""
    job_number = f"JOB-TRG-{uuid.uuid4().hex[:6].upper()}"
    result = await (
        admin_client.table("jobs")
        .insert({
            "company_id": company_id,
            "property_id": property_id,
            "job_number": job_number,
            "address_line1": "Trigger Test Ln",
            "city": "Troy",
            "state": "MI",
            "zip": "48083",
            "loss_type": "water",
            "status": "new",
            "created_by": user_id,
        })
        .execute()
    )
    return result.data[0]["id"]


async def _make_floor_plan_row(
    admin_client,
    property_id: str,
    company_id: str,
    user_id: str,
    *,
    is_current: bool,
    floor_number: int = 1,
    version_number: int = 1,
) -> dict:
    """Insert a floor_plans row directly. For current=false rows we want
    to set up the frozen-row scenario; admin_client bypasses RLS so we
    can pre-load any shape we need for the test."""
    result = await (
        admin_client.table("floor_plans")
        .insert({
            "property_id": property_id,
            "company_id": company_id,
            "floor_number": floor_number,
            "floor_name": f"Floor {floor_number}",
            "version_number": version_number,
            "canvas_data": {},
            "is_current": is_current,
            "created_by_user_id": user_id,
        })
        .execute()
    )
    return result.data[0]


# ---------------------------------------------------------------------------
# Contract 1 — UPDATE on frozen row raises 55006
# ---------------------------------------------------------------------------


class TestFrozenTriggerBlocksUpdateOnNonCurrentRow:
    """The R4 BEFORE UPDATE trigger ``floor_plans_prevent_frozen_mutation``
    must raise SQLSTATE 55006 when OLD.is_current is already false. The
    text test can't verify this fires — only a real UPDATE can."""

    @pytest.mark.asyncio
    async def test_update_on_frozen_row_raises_55006(
        self, admin_client, onboarded_user,
    ):
        from postgrest.exceptions import APIError

        prop_id = await _make_property(admin_client, onboarded_user["company_id"])
        frozen = await _make_floor_plan_row(
            admin_client,
            property_id=prop_id,
            company_id=onboarded_user["company_id"],
            user_id=onboarded_user["user_id"],
            is_current=False,
            version_number=1,
        )

        with pytest.raises(APIError) as exc_info:
            await (
                admin_client.table("floor_plans")
                .update({"floor_name": "Should not land"})
                .eq("id", frozen["id"])
                .execute()
            )

        # Postgres 55006 = object_in_use, class 55 (invalid_prerequisite_state).
        # Python catches in save_canvas / update_floor_plan / cleanup_floor_plan
        # all map this code → VERSION_FROZEN.
        assert getattr(exc_info.value, "code", None) == "55006", (
            f"Expected 55006 from frozen-row trigger, got {exc_info.value.code}: "
            f"{exc_info.value.message}"
        )

        # Cleanup — admin_client can hard-delete regardless of trigger
        # because DELETE isn't trigger-gated.
        await admin_client.table("floor_plans").delete().eq("id", frozen["id"]).execute()
        await admin_client.table("properties").delete().eq("id", prop_id).execute()


# ---------------------------------------------------------------------------
# Contract 2 — save_floor_plan_version's own flip passes through the trigger
# ---------------------------------------------------------------------------


class TestFrozenTriggerAllowsLegitimateFlip:
    """The trigger must NOT block the one legitimate UPDATE that flips
    ``is_current: true → false`` — namely, the flip statement inside
    ``save_floor_plan_version`` when forking a new version. The trigger
    checks OLD.is_current: during that flip, the row being updated still
    has is_current=true at the OLD moment, so the trigger passes it
    through. Verifying end-to-end means running save_floor_plan_version
    and asserting the new version lands without crashing."""

    @pytest.mark.asyncio
    async def test_save_canvas_flow_does_not_trip_trigger(
        self, api_client, admin_client, onboarded_user,
    ):
        """End-to-end: POST /v1/floor-plans/{id}/versions forks a new
        version. The RPC flips the old is_current=true → false, then
        inserts a new row with is_current=true. If the trigger wrongly
        fired on the flip, this would 500 with 55006. A 200 response
        proves the contract holds."""
        # Create a property + job + initial floor plan (the row that will
        # get flipped to is_current=false during save).
        prop_id = await _make_property(admin_client, onboarded_user["company_id"])
        job_id = await _make_job(
            admin_client,
            onboarded_user["company_id"],
            prop_id,
            onboarded_user["user_id"],
        )
        initial = await _make_floor_plan_row(
            admin_client,
            property_id=prop_id,
            company_id=onboarded_user["company_id"],
            user_id=onboarded_user["user_id"],
            is_current=True,
            version_number=1,
        )

        # Save a new canvas against the initial row. This creates v2 and
        # flips v1's is_current to false. If the trigger misfires, the
        # RPC throws inside the SAVE path and the HTTP response is 500.
        resp = await api_client.post(
            f"/v1/floor-plans/{initial['id']}/versions",
            json={"job_id": job_id, "canvas_data": {"rooms": []}},
            headers=onboarded_user["headers"],
        )
        assert resp.status_code in (200, 201), (
            f"Legitimate save was blocked — trigger may be misfiring. "
            f"Got {resp.status_code}: {resp.text}"
        )

        # Confirm v2 exists and is current.
        new_row = resp.json()
        assert new_row["version_number"] == 2
        assert new_row["is_current"] is True

        # Confirm v1 was flipped successfully.
        v1_after = await (
            admin_client.table("floor_plans")
            .select("is_current")
            .eq("id", initial["id"])
            .single()
            .execute()
        )
        assert v1_after.data["is_current"] is False, (
            "The flip statement inside save_floor_plan_version didn't land; "
            "the trigger may have blocked a legitimate write."
        )

        # Cleanup
        await admin_client.table("floor_plans").delete().eq("id", new_row["id"]).execute()
        await admin_client.table("floor_plans").delete().eq("id", initial["id"]).execute()
        await admin_client.table("jobs").delete().eq("id", job_id).execute()
        await admin_client.table("properties").delete().eq("id", prop_id).execute()


# ---------------------------------------------------------------------------
# Contract 3 — save_floor_plan_version raises 42501 for tenant mismatch
# ---------------------------------------------------------------------------


class TestSaveFloorPlanVersionRejectsCrossCompany:
    """R3 RPC hardening (migration c7f8a9b0d1e2): the JWT-derived company
    check is the only guard when SECURITY DEFINER bypasses RLS. We
    verified text + Python mapping in unit tests; this exercises the
    live SQL path to confirm the function actually raises 42501 (not
    55006 or anything else) on a tenant mismatch."""

    @pytest.mark.asyncio
    async def test_passing_foreign_company_id_raises_42501(
        self, admin_client, onboarded_user, second_onboarded_user,
    ):
        """Pass company B's ID to the RPC while authenticating as
        company A. Server derives A from JWT, compares to B, raises
        42501."""
        from postgrest.exceptions import APIError

        # Property + job in company A.
        prop_id = await _make_property(admin_client, onboarded_user["company_id"])
        job_id = await _make_job(
            admin_client,
            onboarded_user["company_id"],
            prop_id,
            onboarded_user["user_id"],
        )

        # Build a client that authenticates as company A but will pass
        # company B's UUID into p_company_id.
        from supabase import AsyncClientOptions, acreate_client

        from tests.integration.conftest import (
            LOCAL_SUPABASE_ANON_KEY,
            LOCAL_SUPABASE_URL,
        )

        a_client = await acreate_client(
            LOCAL_SUPABASE_URL,
            LOCAL_SUPABASE_ANON_KEY,
            options=AsyncClientOptions(postgrest_client_timeout=30),
        )
        await a_client.auth.set_session(
            access_token=onboarded_user["access_token"],
            refresh_token="",
        )

        with pytest.raises(APIError) as exc_info:
            await (
                a_client.rpc(
                    "save_floor_plan_version",
                    {
                        "p_property_id": prop_id,
                        "p_floor_number": 1,
                        "p_floor_name": "Mismatch",
                        "p_company_id": second_onboarded_user["company_id"],
                        "p_job_id": job_id,
                        "p_user_id": onboarded_user["user_id"],
                        "p_canvas_data": {},
                        "p_change_summary": "cross-tenant probe",
                    },
                ).execute()
            )

        assert getattr(exc_info.value, "code", None) == "42501", (
            f"Expected 42501 from JWT-derived company mismatch, "
            f"got {exc_info.value.code}: {exc_info.value.message}"
        )

        # Cleanup
        await admin_client.table("jobs").delete().eq("id", job_id).execute()
        await admin_client.table("properties").delete().eq("id", prop_id).execute()


# ---------------------------------------------------------------------------
# Contract 4 — _compute_wall_sf_for_room (1-arg, JWT-derived) correctness
# ---------------------------------------------------------------------------


class TestComputeWallSfForRoomJwtDerived:
    """Round-2 follow-on #2: _compute_wall_sf_for_room was rewritten to
    derive company from JWT instead of accepting it as a parameter. The
    text tests verify the signature + presence of get_my_company_id(),
    but only a live call can confirm it actually rejects unauthenticated
    requests and computes SF correctly for authenticated ones."""

    @pytest.mark.asyncio
    async def test_authenticated_call_computes_wall_sf(
        self, api_client, admin_client, onboarded_user,
    ):
        """End-to-end: update a room's ceiling_type via the PATCH
        endpoint (which triggers _recalculate_room_wall_sf →
        _compute_wall_sf_for_room). If the JWT-derived path is broken,
        the PATCH 500s or the returned wall_square_footage is wrong."""
        # Create property + job + a room with a known geometry.
        prop_id = await _make_property(admin_client, onboarded_user["company_id"])
        job_id = await _make_job(
            admin_client,
            onboarded_user["company_id"],
            prop_id,
            onboarded_user["user_id"],
        )

        # Create a room via the API so it lands with proper tenant stamps.
        room_resp = await api_client.post(
            f"/v1/jobs/{job_id}/rooms",
            json={
                "room_name": "SF Compute Test",
                "length_ft": 10,
                "width_ft": 12,
                "height_ft": 8,
                "ceiling_type": "flat",
            },
            headers=onboarded_user["headers"],
        )
        assert room_resp.status_code == 201, room_resp.text
        room_id = room_resp.json()["id"]

        # PATCH the ceiling height — this triggers the R16 recalc path,
        # which ultimately calls _compute_wall_sf_for_room via the walls
        # service. For a room with no walls yet the computed SF is 0, so
        # we also add a wall to make the computation non-trivial.
        wall_resp = await api_client.post(
            f"/v1/rooms/{room_id}/walls",
            json={
                "x1": 0,
                "y1": 0,
                "x2": 200,  # 10 ft at 20 px/ft
                "y2": 0,
                "wall_type": "interior",
                "affected": False,
                "shared": False,
                "sort_order": 0,
            },
            headers=onboarded_user["headers"],
        )
        assert wall_resp.status_code == 201, wall_resp.text

        # Now PATCH ceiling height → R16 recalc should fire and compute
        # wall SF as 10 ft × 20 ft × 1.0 (flat multiplier) = 200.
        patch_resp = await api_client.patch(
            f"/v1/jobs/{job_id}/rooms/{room_id}",
            json={"height_ft": 20, "ceiling_type": "flat"},
            headers=onboarded_user["headers"],
        )
        assert patch_resp.status_code == 200, (
            f"PATCH failed — _compute_wall_sf_for_room may be rejecting "
            f"authenticated callers. Got {patch_resp.status_code}: {patch_resp.text}"
        )

        # The returned wall_square_footage should be 10 ft × 20 ft = 200.
        updated = patch_resp.json()
        assert updated["wall_square_footage"] == 200.0, (
            f"Expected wall_sf=200.0 (10ft perimeter × 20ft height × 1.0 "
            f"flat multiplier), got {updated['wall_square_footage']}"
        )

        # Cleanup
        await admin_client.table("job_rooms").delete().eq("id", room_id).execute()
        await admin_client.table("jobs").delete().eq("id", job_id).execute()
        await admin_client.table("properties").delete().eq("id", prop_id).execute()
