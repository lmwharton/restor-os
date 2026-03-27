"""Tests for event history endpoints (read-only activity feed)."""

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
    return "test-secret-key-for-events-tests"


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


@pytest.fixture
def sample_events(mock_job_id, mock_company_id, mock_user_id):
    return [
        {
            "id": str(uuid4()),
            "company_id": str(mock_company_id),
            "job_id": str(mock_job_id),
            "event_type": "moisture_reading_created",
            "user_id": str(mock_user_id),
            "is_ai": False,
            "event_data": {"reading_id": str(uuid4())},
            "created_at": "2026-03-25T10:00:00Z",
        },
        {
            "id": str(uuid4()),
            "company_id": str(mock_company_id),
            "job_id": str(mock_job_id),
            "event_type": "photo_uploaded",
            "user_id": str(mock_user_id),
            "is_ai": False,
            "event_data": {},
            "created_at": "2026-03-25T09:00:00Z",
        },
    ]


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
    stack.enter_context(patch("api.events.router.get_authenticated_client", return_value=mock_auth))
    stack.enter_context(
        patch("api.shared.events.get_supabase_admin_client", return_value=mock_admin)
    )
    return stack


# ---------------------------------------------------------------------------
# Job events
# ---------------------------------------------------------------------------


class TestJobEvents:
    """Test GET /v1/jobs/{job_id}/events."""

    def test_list_job_events(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        sample_events,
        auth_headers,
    ):
        """GET job events -> 200 with {items, total}."""
        mock_admin = MagicMock()
        mock_auth = MagicMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "event_history":
                t = MagicMock()
                exec_result = MagicMock(data=sample_events, count=2)
                # Chain: select(*,count=exact).eq.eq.order.range.execute
                t.select.return_value.eq.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value = exec_result
                return t
            return MagicMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/events",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert "items" in data
            assert "total" in data
            assert data["total"] == 2

    def test_list_job_events_filter_by_type(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        sample_events,
        auth_headers,
    ):
        """GET job events with event_type filter -> 200 with filtered results."""
        mock_admin = MagicMock()
        mock_auth = MagicMock()

        filtered = [e for e in sample_events if e["event_type"] == "moisture_reading_created"]

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "event_history":
                t = MagicMock()
                exec_result = MagicMock(data=filtered, count=1)
                # With filter: chain adds .eq("event_type", ...)
                t.select.return_value.eq.return_value.eq.return_value.order.return_value.range.return_value.eq.return_value.execute.return_value = exec_result
                return t
            return MagicMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/events?event_type=moisture_reading_created",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["total"] == 1


# ---------------------------------------------------------------------------
# Company events
# ---------------------------------------------------------------------------


class TestCompanyEvents:
    """Test GET /v1/events."""

    def test_list_company_events(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        sample_events,
        auth_headers,
    ):
        """GET company events -> 200 with {items, total}."""
        mock_admin = MagicMock()
        mock_auth = MagicMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "event_history":
                t = MagicMock()
                exec_result = MagicMock(data=sample_events, count=2)
                t.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value = exec_result
                return t
            return MagicMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.get("/v1/events", headers=auth_headers)
            assert response.status_code == 200
            data = response.json()
            assert "items" in data
            assert data["total"] == 2

    def test_list_company_events_filter_by_job(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        sample_events,
        auth_headers,
    ):
        """GET company events with job_id filter -> 200."""
        mock_admin = MagicMock()
        mock_auth = MagicMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "event_history":
                t = MagicMock()
                exec_result = MagicMock(data=sample_events, count=2)
                # With job_id filter: extra .eq in chain
                t.select.return_value.eq.return_value.order.return_value.range.return_value.eq.return_value.execute.return_value = exec_result
                return t
            return MagicMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.get(
                f"/v1/events?job_id={mock_job_id}",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert "items" in data


# ---------------------------------------------------------------------------
# No POST endpoint (events are internal-only)
# ---------------------------------------------------------------------------


class TestEventsNoPost:
    """Verify no public POST endpoint exists for events."""

    def test_events_no_post_endpoint(self, client, auth_headers, jwt_secret):
        """POST /v1/events should return 405 (Method Not Allowed)."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            response = client.post(
                "/v1/events",
                json={"event_type": "test"},
                headers=auth_headers,
            )
            assert response.status_code == 405
