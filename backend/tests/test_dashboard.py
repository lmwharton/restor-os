"""Tests for the dashboard endpoint (GET /v1/dashboard).

Covers:
- Success: pipeline counts, KPIs, recent events, priority jobs
- Empty state: no jobs, no events
- Auth: missing token, expired token, user not found
- Priority jobs filtering by status
- Jobs this month calculation
"""

from contextlib import ExitStack
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from api.config import settings
from api.main import app
from tests.conftest import AsyncSupabaseMock

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

NOW_ISO = "2026-03-30T12:00:00+00:00"
OLD_ISO = "2026-02-15T12:00:00+00:00"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def jwt_secret():
    return "test-secret-key-for-dashboard"


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
def mock_user_row(mock_user_id, mock_company_id):
    return {
        "id": str(mock_user_id),
        "company_id": str(mock_company_id),
        "role": "owner",
        "is_platform_admin": False,
    }


@pytest.fixture
def sample_jobs(mock_company_id):
    """Sample jobs across different statuses."""
    return [
        {
            "id": str(uuid4()),
            "company_id": str(mock_company_id),
            "job_number": "JOB-20260330-001",
            "address_line1": "123 Main St",
            "city": "Troy",
            "state": "MI",
            "status": "new",
            "customer_name": "John Doe",
            "loss_type": "water",
            "created_at": NOW_ISO,
            "updated_at": NOW_ISO,
        },
        {
            "id": str(uuid4()),
            "company_id": str(mock_company_id),
            "job_number": "JOB-20260330-002",
            "address_line1": "456 Oak Ave",
            "city": "Detroit",
            "state": "MI",
            "status": "mitigation",
            "customer_name": "Jane Smith",
            "loss_type": "fire",
            "created_at": NOW_ISO,
            "updated_at": NOW_ISO,
        },
        {
            "id": str(uuid4()),
            "company_id": str(mock_company_id),
            "job_number": "JOB-20260215-001",
            "address_line1": "789 Elm Blvd",
            "city": "Ann Arbor",
            "state": "MI",
            "status": "job_complete",
            "customer_name": "Bob Wilson",
            "loss_type": "water",
            "created_at": OLD_ISO,
            "updated_at": OLD_ISO,
        },
        {
            "id": str(uuid4()),
            "company_id": str(mock_company_id),
            "job_number": "JOB-20260330-003",
            "address_line1": "321 Pine Rd",
            "city": "Troy",
            "state": "MI",
            "status": "drying",
            "customer_name": "Alice Brown",
            "loss_type": "water",
            "created_at": NOW_ISO,
            "updated_at": NOW_ISO,
        },
    ]


@pytest.fixture
def sample_events(mock_company_id):
    return [
        {
            "id": str(uuid4()),
            "company_id": str(mock_company_id),
            "job_id": str(uuid4()),
            "event_type": "job_created",
            "user_id": str(uuid4()),
            "is_ai": False,
            "event_data": {},
            "created_at": NOW_ISO,
        },
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _users_table_mock(user_row):
    t = AsyncSupabaseMock()
    chain = t.select.return_value.eq.return_value.is_.return_value
    chain.single.return_value.execute.return_value = MagicMock(data=user_row)
    return t


def _jobs_table_mock(jobs_data):
    """Mock for jobs table: select(...).eq(...).is_(...).order(...).execute()"""
    t = AsyncSupabaseMock()
    exec_result = MagicMock(data=jobs_data)
    t.select.return_value.eq.return_value.is_.return_value.order.return_value.execute.return_value = exec_result
    return t


def _events_table_mock(events_data, count):
    """Mock for event_history table used by list_company_events."""
    t = AsyncSupabaseMock()
    exec_result = MagicMock(data=events_data, count=count)
    # list_company_events: select(*,count=exact).eq(company_id).order(...).range(...)
    t.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value = exec_result
    # With filters:
    t.select.return_value.eq.return_value.order.return_value.range.return_value.eq.return_value.execute.return_value = exec_result
    return t


def _build_mocks(user_row, table_configs):
    mock_admin = AsyncSupabaseMock()
    mock_auth = AsyncSupabaseMock()

    def table_router(name):
        if name == "users":
            return _users_table_mock(user_row)
        if name in table_configs:
            return table_configs[name]
        t = AsyncSupabaseMock()
        t.insert.return_value.execute.return_value = AsyncSupabaseMock()
        return t

    mock_auth.table.side_effect = table_router
    mock_admin.table.side_effect = table_router
    return mock_admin, mock_auth


def _patch_all(jwt_secret, mock_admin, mock_auth):
    stack = ExitStack()
    stack.enter_context(patch.object(settings, "supabase_jwt_secret", jwt_secret))
    stack.enter_context(
        patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_admin)
    )
    stack.enter_context(
        patch("api.dashboard.router.get_authenticated_client", return_value=mock_auth)
    )
    return stack


# ---------------------------------------------------------------------------
# GET /v1/dashboard — Success
# ---------------------------------------------------------------------------


class TestDashboardSuccess:
    """Test GET /v1/dashboard with valid data."""

    def test_dashboard_returns_all_sections(
        self, client, jwt_secret, mock_user_row, sample_jobs, sample_events, auth_headers
    ):
        """Dashboard returns pipeline, kpis, recent_events, priority_jobs."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {
                "jobs": _jobs_table_mock(sample_jobs),
                "event_history": _events_table_mock(sample_events, 1),
            },
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/dashboard", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert "pipeline" in data
        assert "kpis" in data
        assert "recent_events" in data
        assert "priority_jobs" in data

    def test_pipeline_has_all_stages(
        self, client, jwt_secret, mock_user_row, sample_jobs, sample_events, auth_headers
    ):
        """Pipeline includes all 7 stages."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {
                "jobs": _jobs_table_mock(sample_jobs),
                "event_history": _events_table_mock(sample_events, 1),
            },
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/dashboard", headers=auth_headers)

        pipeline = resp.json()["pipeline"]
        stages = [p["stage"] for p in pipeline]
        assert stages == [
            "new", "contracted", "mitigation", "drying",
            "job_complete", "submitted", "collected",
        ]

    def test_pipeline_counts_correct(
        self, client, jwt_secret, mock_user_row, sample_jobs, sample_events, auth_headers
    ):
        """Pipeline counts match the sample jobs."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {
                "jobs": _jobs_table_mock(sample_jobs),
                "event_history": _events_table_mock(sample_events, 1),
            },
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/dashboard", headers=auth_headers)

        pipeline = {p["stage"]: p["count"] for p in resp.json()["pipeline"]}
        assert pipeline["new"] == 1
        assert pipeline["mitigation"] == 1
        assert pipeline["drying"] == 1
        assert pipeline["job_complete"] == 1
        assert pipeline["contracted"] == 0
        assert pipeline["submitted"] == 0
        assert pipeline["collected"] == 0

    def test_kpis_active_jobs(
        self, client, jwt_secret, mock_user_row, sample_jobs, sample_events, auth_headers
    ):
        """KPIs active_jobs counts new, contracted, mitigation, drying statuses."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {
                "jobs": _jobs_table_mock(sample_jobs),
                "event_history": _events_table_mock(sample_events, 1),
            },
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/dashboard", headers=auth_headers)

        kpis = resp.json()["kpis"]
        # new(1) + mitigation(1) + drying(1) = 3 active (job_complete is terminal)
        assert kpis["active_jobs"] == 3

    def test_kpis_jobs_this_month(
        self, client, jwt_secret, mock_user_row, sample_jobs, sample_events, auth_headers
    ):
        """KPIs jobs_this_month only counts jobs created in current month."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {
                "jobs": _jobs_table_mock(sample_jobs),
                "event_history": _events_table_mock(sample_events, 1),
            },
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/dashboard", headers=auth_headers)

        kpis = resp.json()["kpis"]
        # 3 jobs from March 2026, 1 from February 2026
        assert kpis["jobs_this_month"] == 3

    def test_priority_jobs_only_actionable(
        self, client, jwt_secret, mock_user_row, sample_jobs, sample_events, auth_headers
    ):
        """Priority jobs only includes new and mitigation status jobs."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {
                "jobs": _jobs_table_mock(sample_jobs),
                "event_history": _events_table_mock(sample_events, 1),
            },
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/dashboard", headers=auth_headers)

        priority = resp.json()["priority_jobs"]
        assert len(priority) == 2
        statuses = {p["status"] for p in priority}
        assert statuses == {"new", "mitigation"}

    def test_recent_events_returned(
        self, client, jwt_secret, mock_user_row, sample_jobs, sample_events, auth_headers
    ):
        """Recent events are included in the response."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {
                "jobs": _jobs_table_mock(sample_jobs),
                "event_history": _events_table_mock(sample_events, 1),
            },
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/dashboard", headers=auth_headers)

        assert len(resp.json()["recent_events"]) == 1


# ---------------------------------------------------------------------------
# GET /v1/dashboard — Empty State
# ---------------------------------------------------------------------------


class TestDashboardEmpty:
    """Test dashboard with no data."""

    def test_empty_dashboard(
        self, client, jwt_secret, mock_user_row, auth_headers
    ):
        """Dashboard returns zero counts when no jobs or events exist."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {
                "jobs": _jobs_table_mock([]),
                "event_history": _events_table_mock([], 0),
            },
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/dashboard", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()

        # All pipeline counts are 0
        for stage in data["pipeline"]:
            assert stage["count"] == 0

        assert data["kpis"]["active_jobs"] == 0
        assert data["kpis"]["jobs_this_month"] == 0
        assert data["recent_events"] == []
        assert data["priority_jobs"] == []


# ---------------------------------------------------------------------------
# Auth Failures
# ---------------------------------------------------------------------------


class TestDashboardAuth:
    """Auth error handling for dashboard endpoint."""

    def test_no_auth_header(self, client):
        """Missing Authorization header returns 401."""
        resp = client.get("/v1/dashboard")
        assert resp.status_code == 401

    def test_invalid_token(self, client):
        """Invalid JWT returns 401."""
        resp = client.get(
            "/v1/dashboard",
            headers={"Authorization": "Bearer garbage-token"},
        )
        assert resp.status_code == 401

    def test_expired_token(self, client, jwt_secret, mock_auth_user_id):
        """Expired JWT returns 401."""
        from datetime import timedelta

        expired = jwt.encode(
            {
                "sub": str(mock_auth_user_id),
                "aud": "authenticated",
                "role": "authenticated",
                "exp": datetime.now(UTC) - timedelta(hours=1),
                "iat": datetime.now(UTC) - timedelta(hours=2),
            },
            jwt_secret,
            algorithm="HS256",
        )
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            resp = client.get(
                "/v1/dashboard",
                headers={"Authorization": f"Bearer {expired}"},
            )
        assert resp.status_code == 401

    def test_user_not_found(self, client, jwt_secret, auth_headers):
        """Valid JWT but user not in DB returns 401."""
        mock_admin = AsyncSupabaseMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(None)
            return AsyncSupabaseMock()

        mock_admin.table.side_effect = table_router
        with ExitStack() as stack:
            stack.enter_context(patch.object(settings, "supabase_jwt_secret", jwt_secret))
            stack.enter_context(
                patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_admin)
            )
            resp = client.get("/v1/dashboard", headers=auth_headers)
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Method Not Allowed
# ---------------------------------------------------------------------------


class TestDashboardMethodNotAllowed:
    """Dashboard only supports GET."""

    def test_post_returns_405(self, client, auth_headers, jwt_secret):
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            resp = client.post("/v1/dashboard", json={}, headers=auth_headers)
        assert resp.status_code == 405

    def test_delete_returns_405(self, client, auth_headers, jwt_secret):
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            resp = client.delete("/v1/dashboard", headers=auth_headers)
        assert resp.status_code == 405
