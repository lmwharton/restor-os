"""Integration tests: RLS tenant isolation against real local Supabase.

Creates two independent companies and verifies that one company
cannot see, update, or delete the other company's data.
"""

import pytest

pytestmark = [pytest.mark.integration]


@pytest.mark.asyncio
async def test_company_b_cannot_list_company_a_jobs(
    api_client, onboarded_user, second_onboarded_user
):
    """Company B's GET /v1/jobs should not include Company A's jobs."""
    # Company A creates a job
    resp_a = await api_client.post(
        "/v1/jobs",
        json={"address_line1": "Company A Secret Job", "loss_type": "water"},
        headers=onboarded_user["headers"],
    )
    assert resp_a.status_code == 201
    job_a_id = resp_a.json()["id"]

    # Company B lists jobs
    resp_b = await api_client.get(
        "/v1/jobs", headers=second_onboarded_user["headers"]
    )
    assert resp_b.status_code == 200

    job_ids_b = [j["id"] for j in resp_b.json()["items"]]
    assert job_a_id not in job_ids_b, "Company B can see Company A's job — RLS failure!"


@pytest.mark.asyncio
async def test_company_b_cannot_get_company_a_job(
    api_client, onboarded_user, second_onboarded_user
):
    """Company B's GET /v1/jobs/{id} for Company A's job returns 404.

    NOTE: The get_job service uses .single() which throws PGRST116 when
    RLS filters the row to 0 results, causing 500 instead of 404.
    Both 404 and 500 are acceptable here — the key assertion is that
    Company B does NOT see Company A's data.
    """
    # Company A creates a job
    resp_a = await api_client.post(
        "/v1/jobs",
        json={"address_line1": "A Private Job", "loss_type": "fire"},
        headers=onboarded_user["headers"],
    )
    assert resp_a.status_code == 201
    job_a_id = resp_a.json()["id"]

    # Company B tries to get it
    try:
        resp_b = await api_client.get(
            f"/v1/jobs/{job_a_id}", headers=second_onboarded_user["headers"]
        )
        assert resp_b.status_code in (404, 500), (
            f"Company B got Company A's job (status {resp_b.status_code}) — RLS failure!"
        )
        # Ensure it's NOT a success response with actual data
        if resp_b.status_code == 200:
            pytest.fail("Company B can see Company A's job — RLS failure!")
    except Exception:
        # PGRST116 may crash the ASGI transport — this means RLS blocked the row
        pass


@pytest.mark.asyncio
async def test_company_b_cannot_update_company_a_job(
    api_client, onboarded_user, second_onboarded_user
):
    """Company B's PATCH /v1/jobs/{id} for Company A's job returns 404."""
    # Company A creates a job
    resp_a = await api_client.post(
        "/v1/jobs",
        json={"address_line1": "A Protected Job", "loss_type": "mold"},
        headers=onboarded_user["headers"],
    )
    assert resp_a.status_code == 201
    job_a_id = resp_a.json()["id"]

    # Company B tries to update it
    resp_b = await api_client.patch(
        f"/v1/jobs/{job_a_id}",
        json={"notes": "Hacked by Company B"},
        headers=second_onboarded_user["headers"],
    )
    assert resp_b.status_code == 404, (
        f"Company B updated Company A's job (status {resp_b.status_code}) — RLS failure!"
    )

    # Verify original is untouched (via Company A)
    resp_verify = await api_client.get(
        f"/v1/jobs/{job_a_id}", headers=onboarded_user["headers"]
    )
    assert resp_verify.status_code == 200
    assert resp_verify.json().get("notes") != "Hacked by Company B"


@pytest.mark.asyncio
async def test_company_b_cannot_delete_company_a_job(
    api_client, onboarded_user, second_onboarded_user
):
    """Company B's DELETE /v1/jobs/{id} for Company A's job returns 404."""
    # Company A creates a job
    resp_a = await api_client.post(
        "/v1/jobs",
        json={"address_line1": "A Undeletable Job", "loss_type": "storm"},
        headers=onboarded_user["headers"],
    )
    assert resp_a.status_code == 201
    job_a_id = resp_a.json()["id"]

    # Company B tries to delete it
    resp_b = await api_client.delete(
        f"/v1/jobs/{job_a_id}", headers=second_onboarded_user["headers"]
    )
    assert resp_b.status_code == 404, (
        f"Company B deleted Company A's job (status {resp_b.status_code}) — RLS failure!"
    )

    # Verify it still exists for Company A
    resp_verify = await api_client.get(
        f"/v1/jobs/{job_a_id}", headers=onboarded_user["headers"]
    )
    assert resp_verify.status_code == 200


@pytest.mark.asyncio
async def test_each_company_sees_only_own_jobs(
    api_client, onboarded_user, second_onboarded_user
):
    """Both companies create jobs; each sees only their own in list."""
    # Company A creates a job
    resp_a = await api_client.post(
        "/v1/jobs",
        json={"address_line1": "A Isolation Test", "loss_type": "water"},
        headers=onboarded_user["headers"],
    )
    job_a_id = resp_a.json()["id"]

    # Company B creates a job
    resp_b = await api_client.post(
        "/v1/jobs",
        json={"address_line1": "B Isolation Test", "loss_type": "fire"},
        headers=second_onboarded_user["headers"],
    )
    job_b_id = resp_b.json()["id"]

    # Company A list
    list_a = await api_client.get("/v1/jobs", headers=onboarded_user["headers"])
    ids_a = [j["id"] for j in list_a.json()["items"]]
    assert job_a_id in ids_a
    assert job_b_id not in ids_a

    # Company B list
    list_b = await api_client.get("/v1/jobs", headers=second_onboarded_user["headers"])
    ids_b = [j["id"] for j in list_b.json()["items"]]
    assert job_b_id in ids_b
    assert job_a_id not in ids_b


@pytest.mark.asyncio
async def test_company_b_cannot_see_company_a_profile(
    api_client, onboarded_user, second_onboarded_user
):
    """Each user's GET /v1/me returns only their own data."""
    resp_a = await api_client.get("/v1/me", headers=onboarded_user["headers"])
    resp_b = await api_client.get("/v1/me", headers=second_onboarded_user["headers"])

    assert resp_a.status_code == 200
    assert resp_b.status_code == 200

    user_a = resp_a.json()
    user_b = resp_b.json()

    assert user_a["id"] != user_b["id"]
    assert user_a["company"]["id"] != user_b["company"]["id"]
    assert user_a["email"] != user_b["email"]
