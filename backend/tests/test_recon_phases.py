"""Tests for Recon Phases CRUD endpoints (Spec 01B).

Covers: list, create, update, delete, reorder phases.
Validation: reconstruction-only enforcement, status transitions, timestamps.
"""

from contextlib import contextmanager
from unittest.mock import MagicMock, patch
from uuid import uuid4

from api.config import settings
from tests.conftest import make_mock_supabase

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

NOW_ISO = "2026-04-01T00:00:00Z"


def _phase_row(
    phase_id=None,
    job_id=None,
    company_id=None,
    *,
    phase_name="Drywall",
    status="pending",
    sort_order=0,
    started_at=None,
    completed_at=None,
    notes=None,
):
    return {
        "id": str(phase_id or uuid4()),
        "job_id": str(job_id or uuid4()),
        "company_id": str(company_id or uuid4()),
        "phase_name": phase_name,
        "status": status,
        "sort_order": sort_order,
        "started_at": started_at,
        "completed_at": completed_at,
        "notes": notes,
        "created_at": NOW_ISO,
        "updated_at": NOW_ISO,
    }


def _recon_job_row(job_id=None, company_id=None):
    """Minimal job row for validation queries."""
    return {"id": str(job_id or uuid4()), "job_type": "reconstruction"}


def _mitigation_job_row(job_id=None, company_id=None):
    return {"id": str(job_id or uuid4()), "job_type": "mitigation"}


def _patch_all(jwt_secret, mock_client):
    @contextmanager
    def _ctx():
        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch(
                "api.auth.middleware.get_supabase_admin_client",
                return_value=mock_client,
            ),
            patch(
                "api.recon_phases.service.get_authenticated_client",
                return_value=mock_client,
            ),
            patch(
                "api.shared.events.get_supabase_admin_client",
                return_value=mock_client,
            ),
        ):
            yield

    return _ctx()


# ---------------------------------------------------------------------------
# Tests: List Phases
# ---------------------------------------------------------------------------


class TestListPhases:
    """GET /v1/jobs/{job_id}/recon-phases"""

    def test_list_phases_success(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        job_id = uuid4()
        phases = [
            _phase_row(job_id=job_id, company_id=mock_company_id, phase_name="Demo Verification", sort_order=0),
            _phase_row(job_id=job_id, company_id=mock_company_id, phase_name="Drywall", sort_order=1),
        ]

        call_count = {"n": 0}

        def jobs_handler(mock_table):
            # _validate_recon_job: select().eq().eq().is_().execute()
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .is_.return_value.execute.return_value
            ).data = [_recon_job_row(job_id, mock_company_id)]

        def phases_handler(mock_table):
            # list: select().eq().eq().order().execute()
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .order.return_value.execute.return_value
            ).data = phases

        mock_client = make_mock_supabase(mock_user_row, {
            "jobs": jobs_handler,
            "recon_phases": phases_handler,
        })

        with _patch_all(jwt_secret, mock_client):
            response = client.get(f"/v1/jobs/{job_id}/recon-phases", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["phase_name"] == "Demo Verification"
        assert data[1]["phase_name"] == "Drywall"

    def test_list_phases_empty(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        job_id = uuid4()

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .is_.return_value.execute.return_value
            ).data = [_recon_job_row(job_id, mock_company_id)]

        def phases_handler(mock_table):
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .order.return_value.execute.return_value
            ).data = []

        mock_client = make_mock_supabase(mock_user_row, {
            "jobs": jobs_handler,
            "recon_phases": phases_handler,
        })

        with _patch_all(jwt_secret, mock_client):
            response = client.get(f"/v1/jobs/{job_id}/recon-phases", headers=auth_headers)

        assert response.status_code == 200
        assert response.json() == []


# ---------------------------------------------------------------------------
# Tests: Create Phase
# ---------------------------------------------------------------------------


class TestCreatePhase:
    """POST /v1/jobs/{job_id}/recon-phases"""

    def test_create_phase_success(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        job_id = uuid4()
        phase_id = uuid4()
        row = _phase_row(phase_id=phase_id, job_id=job_id, company_id=mock_company_id, phase_name="Flooring")

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .is_.return_value.execute.return_value
            ).data = [_recon_job_row(job_id, mock_company_id)]

        def phases_handler(mock_table):
            mock_table.insert.return_value.execute.return_value = MagicMock(data=[row])

        mock_client = make_mock_supabase(mock_user_row, {
            "jobs": jobs_handler,
            "recon_phases": phases_handler,
        })

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{job_id}/recon-phases",
                json={"phase_name": "Flooring", "sort_order": 3},
                headers=auth_headers,
            )

        assert response.status_code == 201
        data = response.json()
        assert data["phase_name"] == "Flooring"
        assert data["status"] == "pending"

    def test_create_phase_rejects_mitigation_job(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Phases can only be created on reconstruction jobs."""
        job_id = uuid4()

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .is_.return_value.execute.return_value
            ).data = [_mitigation_job_row(job_id, mock_company_id)]

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{job_id}/recon-phases",
                json={"phase_name": "Flooring"},
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "NOT_RECONSTRUCTION_JOB"

    def test_create_phase_job_not_found(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        job_id = uuid4()

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .is_.return_value.execute.return_value
            ).data = []

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{job_id}/recon-phases",
                json={"phase_name": "Flooring"},
                headers=auth_headers,
            )

        assert response.status_code == 404
        assert response.json()["error_code"] == "JOB_NOT_FOUND"


# ---------------------------------------------------------------------------
# Tests: Update Phase
# ---------------------------------------------------------------------------


class TestUpdatePhase:
    """PATCH /v1/jobs/{job_id}/recon-phases/{phase_id}"""

    def test_update_phase_status(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        job_id = uuid4()
        phase_id = uuid4()
        updated_row = _phase_row(
            phase_id=phase_id, job_id=job_id, company_id=mock_company_id,
            phase_name="Drywall", status="in_progress", started_at=NOW_ISO,
        )

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .is_.return_value.execute.return_value
            ).data = [_recon_job_row(job_id, mock_company_id)]

        def phases_handler(mock_table):
            # For update: update().eq().eq().eq().execute()
            (
                mock_table.update.return_value
                .eq.return_value.eq.return_value
                .eq.return_value.execute.return_value
            ).data = [updated_row]
            # For started_at check: select().eq().single().execute()
            (
                mock_table.select.return_value
                .eq.return_value.single.return_value
                .execute.return_value
            ).data = {"started_at": None}

        mock_client = make_mock_supabase(mock_user_row, {
            "jobs": jobs_handler,
            "recon_phases": phases_handler,
        })

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{job_id}/recon-phases/{phase_id}",
                json={"status": "in_progress"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json()["status"] == "in_progress"

    def test_update_phase_to_complete(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Completing a phase sets completed_at and logs recon_phase_completed event."""
        job_id = uuid4()
        phase_id = uuid4()
        updated_row = _phase_row(
            phase_id=phase_id, job_id=job_id, company_id=mock_company_id,
            phase_name="Paint", status="complete", started_at=NOW_ISO, completed_at=NOW_ISO,
        )

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .is_.return_value.execute.return_value
            ).data = [_recon_job_row(job_id, mock_company_id)]

        def phases_handler(mock_table):
            (
                mock_table.update.return_value
                .eq.return_value.eq.return_value
                .eq.return_value.execute.return_value
            ).data = [updated_row]
            (
                mock_table.select.return_value
                .eq.return_value.single.return_value
                .execute.return_value
            ).data = {"started_at": NOW_ISO}

        mock_client = make_mock_supabase(mock_user_row, {
            "jobs": jobs_handler,
            "recon_phases": phases_handler,
        })

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{job_id}/recon-phases/{phase_id}",
                json={"status": "complete"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "complete"
        assert data["completed_at"] is not None

    def test_update_phase_no_fields_returns_400(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        job_id = uuid4()
        phase_id = uuid4()

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .is_.return_value.execute.return_value
            ).data = [_recon_job_row(job_id, mock_company_id)]

        mock_client = make_mock_supabase(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{job_id}/recon-phases/{phase_id}",
                json={},
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "NO_UPDATES"


# ---------------------------------------------------------------------------
# Tests: Delete Phase
# ---------------------------------------------------------------------------


class TestDeletePhase:
    """DELETE /v1/jobs/{job_id}/recon-phases/{phase_id}"""

    def test_delete_phase_success(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        job_id = uuid4()
        phase_id = uuid4()
        row = _phase_row(phase_id=phase_id, job_id=job_id, company_id=mock_company_id)

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .is_.return_value.execute.return_value
            ).data = [_recon_job_row(job_id, mock_company_id)]

        def phases_handler(mock_table):
            (
                mock_table.delete.return_value
                .eq.return_value.eq.return_value
                .eq.return_value.execute.return_value
            ).data = [row]

        mock_client = make_mock_supabase(mock_user_row, {
            "jobs": jobs_handler,
            "recon_phases": phases_handler,
        })

        with _patch_all(jwt_secret, mock_client):
            response = client.delete(
                f"/v1/jobs/{job_id}/recon-phases/{phase_id}",
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json()["deleted"] is True

    def test_delete_phase_not_found(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        job_id = uuid4()
        phase_id = uuid4()

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .is_.return_value.execute.return_value
            ).data = [_recon_job_row(job_id, mock_company_id)]

        def phases_handler(mock_table):
            (
                mock_table.delete.return_value
                .eq.return_value.eq.return_value
                .eq.return_value.execute.return_value
            ).data = []

        mock_client = make_mock_supabase(mock_user_row, {
            "jobs": jobs_handler,
            "recon_phases": phases_handler,
        })

        with _patch_all(jwt_secret, mock_client):
            response = client.delete(
                f"/v1/jobs/{job_id}/recon-phases/{phase_id}",
                headers=auth_headers,
            )

        assert response.status_code == 404
        assert response.json()["error_code"] == "PHASE_NOT_FOUND"


# ---------------------------------------------------------------------------
# Tests: Reorder Phases
# ---------------------------------------------------------------------------


class TestReorderPhases:
    """POST /v1/jobs/{job_id}/recon-phases/reorder"""

    def test_reorder_phases_success(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        job_id = uuid4()
        p1, p2 = uuid4(), uuid4()
        reordered = [
            _phase_row(phase_id=p2, job_id=job_id, company_id=mock_company_id, phase_name="Paint", sort_order=0),
            _phase_row(phase_id=p1, job_id=job_id, company_id=mock_company_id, phase_name="Drywall", sort_order=1),
        ]

        def jobs_handler(mock_table):
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .is_.return_value.execute.return_value
            ).data = [_recon_job_row(job_id, mock_company_id)]

        def phases_handler(mock_table):
            # reorder update calls + final list query
            (
                mock_table.update.return_value
                .eq.return_value.eq.return_value
                .eq.return_value.execute.return_value
            ).data = [{}]
            (
                mock_table.select.return_value
                .eq.return_value.eq.return_value
                .order.return_value.execute.return_value
            ).data = reordered

        mock_client = make_mock_supabase(mock_user_row, {
            "jobs": jobs_handler,
            "recon_phases": phases_handler,
        })

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                f"/v1/jobs/{job_id}/recon-phases/reorder",
                json={"phases": [
                    {"id": str(p2), "sort_order": 0},
                    {"id": str(p1), "sort_order": 1},
                ]},
                headers=auth_headers,
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["phase_name"] == "Paint"
        assert data[0]["sort_order"] == 0
