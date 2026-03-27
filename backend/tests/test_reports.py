"""Tests for report tracking endpoints."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from api.config import settings
from api.main import app

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def jwt_secret():
    return "test-secret-key-for-reports-tests"


@pytest.fixture
def mock_auth_user_id():
    return uuid4()


@pytest.fixture
def mock_user_id():
    return uuid4()


@pytest.fixture
def mock_company_id():
    return uuid4()


@pytest.fixture
def mock_job_id():
    return uuid4()


@pytest.fixture
def valid_token(mock_auth_user_id, jwt_secret):
    return jwt.encode(
        {"sub": str(mock_auth_user_id), "aud": "authenticated", "role": "authenticated"},
        jwt_secret,
        algorithm="HS256",
    )


@pytest.fixture
def auth_headers(valid_token):
    return {"Authorization": f"Bearer {valid_token}"}


@pytest.fixture
def mock_job_data(mock_job_id, mock_company_id):
    return {
        "id": str(mock_job_id),
        "company_id": str(mock_company_id),
        "status": "active",
        "deleted_at": None,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _users_table_mock(user_id, company_id):
    t = MagicMock()
    chain = t.select.return_value.eq.return_value.is_.return_value
    chain.single.return_value.execute.return_value = MagicMock(
        data={
            "id": str(user_id),
            "company_id": str(company_id),
            "role": "owner",
            "is_platform_admin": False,
        }
    )
    return t


def _jobs_table_mock(job_data):
    t = MagicMock()
    chain = t.select.return_value.eq.return_value.eq.return_value.is_.return_value
    chain.single.return_value.execute.return_value = MagicMock(data=job_data)
    return t


def _event_table_mock():
    t = MagicMock()
    t.insert.return_value.execute.return_value = MagicMock(data=[{}])
    return t


def _patch_all(jwt_secret, mock_admin, mock_auth):
    from contextlib import ExitStack

    stack = ExitStack()
    stack.enter_context(patch.object(settings, "supabase_jwt_secret", jwt_secret))
    stack.enter_context(
        patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_admin)
    )
    stack.enter_context(
        patch("api.shared.dependencies.get_authenticated_client", return_value=mock_auth)
    )
    stack.enter_context(
        patch("api.reports.service.get_authenticated_client", return_value=mock_auth)
    )
    stack.enter_context(
        patch("api.shared.events.get_supabase_admin_client", return_value=mock_admin)
    )
    return stack


# ---------------------------------------------------------------------------
# Create report
# ---------------------------------------------------------------------------


class TestCreateReport:
    """Test POST /v1/jobs/{job_id}/reports."""

    def test_create_report_success(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        auth_headers,
    ):
        """POST report with valid type -> 201, status=ready."""
        mock_admin = MagicMock()
        mock_auth = MagicMock()

        report_id = uuid4()
        now = "2026-03-25T10:00:00Z"
        report_row = {
            "id": str(report_id),
            "job_id": str(mock_job_id),
            "company_id": str(mock_company_id),
            "report_type": "full_report",
            "status": "ready",
            "generated_at": now,
            "created_at": now,
            "updated_at": now,
        }

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "reports":
                t = MagicMock()
                t.insert.return_value.execute.return_value = MagicMock(data=[report_row])
                return t
            if name == "event_history":
                return _event_table_mock()
            return MagicMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/reports",
                json={"report_type": "full_report"},
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["status"] == "ready"
            assert data["report_type"] == "full_report"

    def test_create_report_invalid_type(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        auth_headers,
    ):
        """POST report with invalid type -> 400."""
        mock_admin = MagicMock()
        mock_auth = MagicMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            return MagicMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/reports",
                json={"report_type": "invalid_type"},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "INVALID_REPORT_TYPE"


# ---------------------------------------------------------------------------
# List reports
# ---------------------------------------------------------------------------


class TestListReports:
    """Test GET /v1/jobs/{job_id}/reports."""

    def test_list_reports(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        auth_headers,
    ):
        """GET reports -> 200 with list."""
        mock_admin = MagicMock()
        mock_auth = MagicMock()

        report_id = uuid4()
        now = "2026-03-25T10:00:00Z"
        reports = [
            {
                "id": str(report_id),
                "job_id": str(mock_job_id),
                "company_id": str(mock_company_id),
                "report_type": "full_report",
                "status": "ready",
                "generated_at": now,
                "created_at": now,
                "updated_at": now,
            }
        ]

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "reports":
                t = MagicMock()
                t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=reports)
                )
                return t
            return MagicMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/reports",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 1
            assert data[0]["status"] == "ready"
