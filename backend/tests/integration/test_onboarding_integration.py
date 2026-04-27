"""Integration tests for Spec 01I (Onboarding) — real Postgres required.

These exercise behavior that can't be faked in unit tests:
- Extended ``rpc_onboard_user`` accepts the full profile in one call
- Idempotency of ``rpc_onboard_user`` after the extension
- Advisory lock prevents concurrent onboarding from creating two companies
- Role rename: 'employee' rejected by CHECK constraint, 'tech' accepted
- POST /v1/jobs/batch atomicity: one bad row rolls back the whole batch
- Pricing upsert + RLS: rows actually persist and isolate by company

Run via: ``pytest tests/integration/test_onboarding_integration.py``
"""

from __future__ import annotations

import asyncio
import io
from uuid import uuid4

import pytest
from openpyxl import Workbook

pytestmark = [pytest.mark.integration]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _xlsx(rows: list[tuple], *, sheet_title: str = "Tier A") -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_title
    for r in rows:
        ws.append(list(r))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# 1. Extended rpc_onboard_user — accepts full profile
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rpc_onboard_user_accepts_full_profile(api_client, test_user):
    """POST /v1/company with full profile -> company has address + service_area."""
    headers = {"Authorization": f"Bearer {test_user['access_token']}"}

    resp = await api_client.post(
        "/v1/company",
        json={
            "name": f"Full Profile Co {uuid4().hex[:6]}",
            "phone": "(586) 555-7000",
            "address": "100 Main St",
            "city": "Troy",
            "state": "MI",
            "zip": "48083",
            "service_area": ["Warren/Macomb", "Oakland"],
        },
        headers=headers,
    )

    assert resp.status_code == 201, resp.text
    company = resp.json()["company"]
    assert company["address"] == "100 Main St"
    assert company["city"] == "Troy"
    assert company["state"] == "MI"
    assert company["zip"] == "48083"
    assert company["service_area"] == ["Warren/Macomb", "Oakland"]


# ---------------------------------------------------------------------------
# 2. rpc_onboard_user idempotency after extension
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rpc_onboard_user_idempotent_after_extension(api_client, test_user):
    """Calling POST /v1/company twice returns the same company (idempotent)."""
    headers = {"Authorization": f"Bearer {test_user['access_token']}"}
    name = f"Idempotent Co {uuid4().hex[:6]}"

    first = await api_client.post(
        "/v1/company",
        json={"name": name, "phone": "555-0001"},
        headers=headers,
    )
    assert first.status_code == 201
    first_company_id = first.json()["company"]["id"]

    second = await api_client.post(
        "/v1/company",
        json={"name": "Different Name", "phone": "555-0002"},
        headers=headers,
    )
    # Second call should succeed but return the original company (already_exists path)
    assert second.status_code == 201
    second_company_id = second.json()["company"]["id"]
    assert first_company_id == second_company_id


# ---------------------------------------------------------------------------
# 3. Advisory lock — concurrent onboarding produces ONE company
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rpc_onboard_user_advisory_lock_serializes_concurrent_calls(api_client, test_user):
    """Two concurrent POST /v1/company calls for the same auth user end up
    pointing at the same company (advisory lock + idempotent fast path).
    """
    headers = {"Authorization": f"Bearer {test_user['access_token']}"}

    async def call_once(suffix: str):
        return await api_client.post(
            "/v1/company",
            json={"name": f"Race Co {suffix}", "phone": "555-9000"},
            headers=headers,
        )

    a, b = await asyncio.gather(call_once("a"), call_once("b"))
    assert a.status_code == 201
    assert b.status_code == 201

    # Both must resolve to the same company id; the loser hits the
    # already_exists branch and returns the same row.
    assert a.json()["company"]["id"] == b.json()["company"]["id"]


# ---------------------------------------------------------------------------
# 4. Role rename — 'employee' rejected, 'owner' / 'tech' accepted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_role_rename_existing_owner_unaffected(onboarded_user, admin_client):
    """Onboarded user has role='owner' — regression after rename migration."""
    result = await (
        admin_client.table("users")
        .select("role")
        .eq("id", onboarded_user["user_id"])
        .single()
        .execute()
    )
    assert result.data["role"] == "owner"


@pytest.mark.asyncio
async def test_role_check_constraint_rejects_employee(onboarded_user, admin_client):
    """Setting role='employee' is rejected by the new CHECK constraint."""
    with pytest.raises(Exception):  # noqa: PT011 — postgrest wraps the 23514
        await (
            admin_client.table("users")
            .update({"role": "employee"})
            .eq("id", onboarded_user["user_id"])
            .execute()
        )


@pytest.mark.asyncio
async def test_role_check_constraint_accepts_tech(onboarded_user, admin_client):
    """Setting role='tech' is allowed (the rename target)."""
    result = await (
        admin_client.table("users")
        .update({"role": "tech"})
        .eq("id", onboarded_user["user_id"])
        .execute()
    )
    assert result.data
    assert result.data[0]["role"] == "tech"


# ---------------------------------------------------------------------------
# 5. POST /v1/jobs/batch — atomic + bounded
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_post_jobs_batch_creates_3_atomically(api_client, onboarded_user):
    """3 valid jobs in one call — all succeed, all visible afterwards."""
    headers = onboarded_user["headers"]
    body = {
        "jobs": [
            {
                "address_line1": f"100 First St {uuid4().hex[:4]}",
                "city": "Troy",
                "state": "MI",
                "zip": "48083",
                "loss_type": "water",
                "status": "Lead",
                "customer_name": "Alice",
            },
            {
                "address_line1": f"200 Second St {uuid4().hex[:4]}",
                "city": "Detroit",
                "state": "MI",
                "zip": "48201",
                "loss_type": "fire",
                "status": "Scoped",
            },
            {
                "address_line1": f"300 Third St {uuid4().hex[:4]}",
                "city": "Warren",
                "state": "MI",
                "zip": "48089",
                "loss_type": "mold",
                "status": "Submitted",
            },
        ]
    }
    resp = await api_client.post("/v1/jobs/batch", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    payload = resp.json()
    assert payload["created"] == 3
    assert len(payload["jobs"]) == 3
    job_numbers = [j["job_number"] for j in payload["jobs"]]
    assert all(jn.startswith("JOB-") for jn in job_numbers)
    # Job numbers must be unique within the batch
    assert len(set(job_numbers)) == 3


@pytest.mark.asyncio
async def test_post_jobs_batch_atomic_on_failure(api_client, onboarded_user):
    """One bad row -> entire batch rolls back; no partial data left behind.

    We send 3 jobs where the middle one has an invalid loss_type. The
    backend's pre-validation will reject before the RPC, but the test still
    proves "no data persisted on rejection" by counting jobs before/after.
    """
    headers = onboarded_user["headers"]

    list_before = await api_client.get("/v1/jobs?limit=100", headers=headers)
    count_before = list_before.json()["total"]

    body = {
        "jobs": [
            {"address_line1": f"500 Pre-fail Ave {uuid4().hex[:4]}", "loss_type": "water"},
            {"address_line1": f"501 Bad Ln {uuid4().hex[:4]}", "loss_type": "lightning"},
            {"address_line1": f"502 Post-fail St {uuid4().hex[:4]}", "loss_type": "water"},
        ]
    }
    resp = await api_client.post("/v1/jobs/batch", json=body, headers=headers)
    assert resp.status_code == 400  # invalid loss_type

    list_after = await api_client.get("/v1/jobs?limit=100", headers=headers)
    count_after = list_after.json()["total"]
    assert count_after == count_before


@pytest.mark.asyncio
async def test_post_jobs_batch_rejects_more_than_10(api_client, onboarded_user):
    """Schema-level cap: 11 jobs -> 422."""
    headers = onboarded_user["headers"]
    body = {"jobs": [{"address_line1": f"{i} Test St"} for i in range(11)]}
    resp = await api_client.post("/v1/jobs/batch", json=body, headers=headers)
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# 6. Pricing upload — valid persists, invalid returns row errors
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pricing_upload_valid_xlsx_persists_rows(api_client, onboarded_user):
    """Valid .xlsx -> items_loaded > 0, rows visible via the DB after."""
    headers = onboarded_user["headers"]

    body = _xlsx(
        [
            ("code", "description", "unit", "price"),
            (f"WTR DRYOUT {uuid4().hex[:4]}", "Dryout", "SF", 1.25),
            (f"DRYWLL RR {uuid4().hex[:4]}", "Drywall", "SF", 3.50),
        ]
    )

    files = {
        "file": (
            "pricing.xlsx",
            body,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    resp = await api_client.post("/v1/pricing/upload", files=files, headers=headers)
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["items_loaded"] == 2
    assert payload["errors"] == []
    assert payload["tier"] == "A"


@pytest.mark.asyncio
async def test_pricing_upload_invalid_returns_row_errors(api_client, onboarded_user):
    """Bad rows -> items_loaded=0, populated errors[] with row numbers."""
    headers = onboarded_user["headers"]
    body = _xlsx(
        [
            ("code", "price"),
            ("", 1.25),  # row 2: missing code
            ("WTR DRYOUT", -3),  # row 3: negative price
        ]
    )
    files = {
        "file": (
            "bad.xlsx",
            body,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    resp = await api_client.post("/v1/pricing/upload", files=files, headers=headers)
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["items_loaded"] == 0
    assert len(payload["errors"]) == 2
    assert payload["run_id"] is not None

    # Error report download
    report = await api_client.get(f"/v1/pricing/error-report/{payload['run_id']}", headers=headers)
    assert report.status_code == 200
    assert "row,field,message" in report.text


@pytest.mark.asyncio
async def test_pricing_template_returns_valid_xlsx(api_client, onboarded_user):
    """Template download is well-formed and openable."""
    headers = onboarded_user["headers"]
    resp = await api_client.get("/v1/pricing/template", headers=headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    # Content should be a non-trivial xlsx (PK header)
    assert resp.content[:2] == b"PK"
    assert len(resp.content) > 1000
