"""Tests for event history endpoints (read-only activity feed) and log_event helper.

Covers:
- GET /v1/jobs/{job_id}/events  (job timeline)
- GET /v1/events               (company activity feed)
- log_event() shared helper     (fire-and-forget event logging)
- Auth flows: no token, expired token, user not found
- Validation: pagination bounds, filter combinations
- Edge cases: empty results, zero count
"""

import logging
from contextlib import ExitStack
from unittest.mock import MagicMock, patch

from tests.conftest import AsyncSupabaseMock
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from api.config import settings
from api.main import app

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

MOCK_NOW = "2026-03-25T10:00:00Z"


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
def mock_user_row(mock_user_id, mock_company_id):
    return {
        "id": str(mock_user_id),
        "company_id": str(mock_company_id),
        "role": "owner",
        "is_platform_admin": False,
    }


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
        {
            "id": str(uuid4()),
            "company_id": str(mock_company_id),
            "job_id": str(mock_job_id),
            "event_type": "job_created",
            "user_id": str(mock_user_id),
            "is_ai": False,
            "event_data": {"job_number": "JOB-001"},
            "created_at": "2026-03-25T08:00:00Z",
        },
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _users_table_mock(user_row):
    """Build a mock table that returns user_row for the auth middleware lookup."""
    t = AsyncSupabaseMock()
    chain = t.select.return_value.eq.return_value.is_.return_value
    # Auth middleware uses .maybe_single() (commit 7423ce2).
    chain.maybe_single.return_value.execute.return_value = MagicMock(data=user_row)
    return t


def _jobs_table_mock(job_data):
    """Build a mock table for job validation (get_valid_job dependency)."""
    t = AsyncSupabaseMock()
    chain = t.select.return_value.eq.return_value.eq.return_value.is_.return_value
    chain.single.return_value.execute.return_value = MagicMock(data=job_data)
    return t


def _events_table_mock(events_data, count):
    """Build a mock table for event_history select queries.

    The MagicMock chaining approach means any .eq/.order/.range chain
    eventually returns the same execute result. This works because
    MagicMock auto-creates attributes for any access pattern.
    """
    t = AsyncSupabaseMock()
    exec_result = MagicMock(data=events_data, count=count)
    # The service builds: select(*,count=exact).eq(...).eq(...).order(...).range(...)
    # Then optionally .eq(...) for filters. MagicMock chains all resolve to execute().
    t.select.return_value.eq.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value = exec_result
    # With one additional .eq filter (event_type on job events):
    t.select.return_value.eq.return_value.eq.return_value.order.return_value.range.return_value.eq.return_value.execute.return_value = exec_result
    # Company events: select.eq.order.range (no second .eq for company_id + job_id before order):
    t.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value = exec_result
    # Company events with one filter:
    t.select.return_value.eq.return_value.order.return_value.range.return_value.eq.return_value.execute.return_value = exec_result
    # Company events with two filters (event_type + job_id):
    t.select.return_value.eq.return_value.order.return_value.range.return_value.eq.return_value.eq.return_value.execute.return_value = exec_result
    return t


def _patch_all(jwt_secret, mock_admin, mock_auth):
    """Create an ExitStack patching all dependencies for events endpoints."""
    stack = ExitStack()
    stack.enter_context(patch.object(settings, "supabase_jwt_secret", jwt_secret))
    stack.enter_context(
        patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_admin)
    )
    stack.enter_context(
        patch("api.shared.dependencies.get_authenticated_client", return_value=mock_auth)
    )
    stack.enter_context(
        patch("api.events.router.get_authenticated_client", return_value=mock_auth)
    )
    stack.enter_context(
        patch("api.shared.events.get_supabase_admin_client", return_value=mock_admin)
    )
    return stack


def _build_mocks(user_row, table_configs):
    """Build admin and auth mock clients from a table config dict.

    table_configs: dict mapping table_name -> MagicMock table
    """
    mock_admin = AsyncSupabaseMock()
    mock_auth = AsyncSupabaseMock()

    def table_router(name):
        if name == "users":
            return _users_table_mock(user_row)
        if name in table_configs:
            return table_configs[name]
        # Default: event_history insert for log_event (fire-and-forget)
        t = AsyncSupabaseMock()
        t.insert.return_value.execute.return_value = AsyncSupabaseMock()
        return t

    mock_auth.table.side_effect = table_router
    mock_admin.table.side_effect = table_router
    return mock_admin, mock_auth


# ---------------------------------------------------------------------------
# GET /v1/jobs/{job_id}/events  -- Job Timeline
# ---------------------------------------------------------------------------


class TestJobEvents:
    """Test GET /v1/jobs/{job_id}/events."""

    def test_list_job_events_success(
        self, client, jwt_secret, mock_user_row, mock_job_id, mock_job_data, sample_events, auth_headers
    ):
        """Returns 200 with {items, total} for a valid job."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {
                "jobs": _jobs_table_mock(mock_job_data),
                "event_history": _events_table_mock(sample_events, 3),
            },
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get(f"/v1/jobs/{mock_job_id}/events", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert data["total"] == 3
        assert len(data["items"]) == 3

    def test_list_job_events_filter_by_event_type(
        self, client, jwt_secret, mock_user_row, mock_job_id, mock_job_data, sample_events, auth_headers
    ):
        """Filtering by event_type returns matching events only."""
        filtered = [e for e in sample_events if e["event_type"] == "moisture_reading_created"]
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {
                "jobs": _jobs_table_mock(mock_job_data),
                "event_history": _events_table_mock(filtered, 1),
            },
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get(
                f"/v1/jobs/{mock_job_id}/events?event_type=moisture_reading_created",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert len(data["items"]) == 1

    def test_list_job_events_empty_results(
        self, client, jwt_secret, mock_user_row, mock_job_id, mock_job_data, auth_headers
    ):
        """Returns empty items and total=0 when no events exist."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {
                "jobs": _jobs_table_mock(mock_job_data),
                "event_history": _events_table_mock([], 0),
            },
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get(f"/v1/jobs/{mock_job_id}/events", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_job_events_custom_pagination(
        self, client, jwt_secret, mock_user_row, mock_job_id, mock_job_data, sample_events, auth_headers
    ):
        """Pagination params limit and offset are accepted."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {
                "jobs": _jobs_table_mock(mock_job_data),
                "event_history": _events_table_mock(sample_events[:1], 3),
            },
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get(
                f"/v1/jobs/{mock_job_id}/events?limit=1&offset=0",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["total"] == 3  # total count is still full count

    def test_list_job_events_pagination_validation_limit_too_high(
        self, client, jwt_secret, mock_user_row, mock_job_id, mock_job_data, auth_headers
    ):
        """limit > 200 returns 422 validation error."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {"jobs": _jobs_table_mock(mock_job_data)},
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get(
                f"/v1/jobs/{mock_job_id}/events?limit=999",
                headers=auth_headers,
            )

        assert resp.status_code == 422

    def test_list_job_events_pagination_validation_limit_zero(
        self, client, jwt_secret, mock_user_row, mock_job_id, mock_job_data, auth_headers
    ):
        """limit=0 returns 422 (minimum is 1)."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {"jobs": _jobs_table_mock(mock_job_data)},
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get(
                f"/v1/jobs/{mock_job_id}/events?limit=0",
                headers=auth_headers,
            )

        assert resp.status_code == 422

    def test_list_job_events_pagination_validation_negative_offset(
        self, client, jwt_secret, mock_user_row, mock_job_id, mock_job_data, auth_headers
    ):
        """Negative offset returns 422."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {"jobs": _jobs_table_mock(mock_job_data)},
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get(
                f"/v1/jobs/{mock_job_id}/events?offset=-1",
                headers=auth_headers,
            )

        assert resp.status_code == 422

    def test_list_job_events_job_not_found(
        self, client, jwt_secret, mock_user_row, auth_headers
    ):
        """Returns 404 when job does not exist."""
        fake_job_id = uuid4()
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {"jobs": _jobs_table_mock(None)},  # job not found
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get(f"/v1/jobs/{fake_job_id}/events", headers=auth_headers)

        assert resp.status_code == 404

    def test_list_job_events_invalid_job_id_format(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        """Returns 422 when job_id is not a valid UUID."""
        mock_admin, mock_auth = _build_mocks(mock_user_row, {})
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/jobs/not-a-uuid/events", headers=auth_headers)

        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /v1/events  -- Company Activity Feed
# ---------------------------------------------------------------------------


class TestCompanyEvents:
    """Test GET /v1/events."""

    def test_list_company_events_success(
        self, client, jwt_secret, mock_user_row, sample_events, auth_headers
    ):
        """Returns 200 with {items, total}."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {"event_history": _events_table_mock(sample_events, 3)},
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/events", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert data["total"] == 3
        assert len(data["items"]) == 3

    def test_list_company_events_filter_by_job_id(
        self, client, jwt_secret, mock_user_row, mock_job_id, sample_events, auth_headers
    ):
        """Filtering by job_id returns matching events."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {"event_history": _events_table_mock(sample_events, 3)},
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get(f"/v1/events?job_id={mock_job_id}", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data

    def test_list_company_events_filter_by_event_type(
        self, client, jwt_secret, mock_user_row, sample_events, auth_headers
    ):
        """Filtering by event_type returns matching events."""
        filtered = [e for e in sample_events if e["event_type"] == "job_created"]
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {"event_history": _events_table_mock(filtered, 1)},
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/events?event_type=job_created", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1

    def test_list_company_events_combined_filters(
        self, client, jwt_secret, mock_user_row, mock_job_id, sample_events, auth_headers
    ):
        """Combining job_id + event_type filters works."""
        filtered = [e for e in sample_events if e["event_type"] == "photo_uploaded"]
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {"event_history": _events_table_mock(filtered, 1)},
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get(
                f"/v1/events?job_id={mock_job_id}&event_type=photo_uploaded",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1

    def test_list_company_events_empty_results(
        self, client, jwt_secret, mock_user_row, auth_headers
    ):
        """Returns empty items and total=0 when no events exist."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {"event_history": _events_table_mock([], 0)},
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/events", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_company_events_custom_pagination(
        self, client, jwt_secret, mock_user_row, sample_events, auth_headers
    ):
        """Pagination params are accepted and forwarded."""
        mock_admin, mock_auth = _build_mocks(
            mock_user_row,
            {"event_history": _events_table_mock(sample_events[:2], 3)},
        )
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/events?limit=2&offset=0", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["total"] == 3

    def test_list_company_events_pagination_validation_limit_too_high(
        self, client, jwt_secret, mock_user_row, auth_headers
    ):
        """limit > 200 returns 422."""
        mock_admin, mock_auth = _build_mocks(mock_user_row, {})
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/events?limit=500", headers=auth_headers)

        assert resp.status_code == 422

    def test_list_company_events_pagination_validation_negative_offset(
        self, client, jwt_secret, mock_user_row, auth_headers
    ):
        """Negative offset returns 422."""
        mock_admin, mock_auth = _build_mocks(mock_user_row, {})
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/events?offset=-5", headers=auth_headers)

        assert resp.status_code == 422

    def test_list_company_events_invalid_job_id_format(
        self, client, jwt_secret, mock_user_row, auth_headers
    ):
        """Invalid UUID for job_id query param returns 422."""
        mock_admin, mock_auth = _build_mocks(mock_user_row, {})
        with _patch_all(jwt_secret, mock_admin, mock_auth):
            resp = client.get("/v1/events?job_id=not-a-uuid", headers=auth_headers)

        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Auth Failures (both endpoints)
# ---------------------------------------------------------------------------


class TestEventsAuth:
    """Auth error handling for events endpoints."""

    def test_no_auth_header_job_events(self, client, mock_job_id):
        """Missing Authorization header returns 401."""
        resp = client.get(f"/v1/jobs/{mock_job_id}/events")
        assert resp.status_code == 401

    def test_no_auth_header_company_events(self, client):
        """Missing Authorization header returns 401."""
        resp = client.get("/v1/events")
        assert resp.status_code == 401

    def test_invalid_token_job_events(self, client, mock_job_id):
        """Invalid JWT returns 401."""
        resp = client.get(
            f"/v1/jobs/{mock_job_id}/events",
            headers={"Authorization": "Bearer garbage-token"},
        )
        assert resp.status_code == 401

    def test_invalid_token_company_events(self, client):
        """Invalid JWT returns 401."""
        resp = client.get(
            "/v1/events",
            headers={"Authorization": "Bearer garbage-token"},
        )
        assert resp.status_code == 401

    def test_expired_token(self, client, jwt_secret, mock_auth_user_id):
        """Expired JWT returns 401."""
        from datetime import UTC, datetime, timedelta

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
                "/v1/events",
                headers={"Authorization": f"Bearer {expired}"},
            )

        assert resp.status_code == 401

    def test_user_not_found_in_db(self, client, jwt_secret, auth_headers):
        """Valid JWT but user not in users table returns 401."""
        mock_admin = AsyncSupabaseMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(None)  # user not found
            return AsyncSupabaseMock()

        mock_admin.table.side_effect = table_router
        with ExitStack() as stack:
            stack.enter_context(patch.object(settings, "supabase_jwt_secret", jwt_secret))
            stack.enter_context(
                patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_admin)
            )
            resp = client.get("/v1/events", headers=auth_headers)

        assert resp.status_code == 401

    def test_user_no_company(self, client, jwt_secret, mock_user_id, auth_headers):
        """User exists but has no company_id returns 401."""
        user_no_company = {
            "id": str(mock_user_id),
            "company_id": None,
            "role": "owner",
            "is_platform_admin": False,
        }
        mock_admin = AsyncSupabaseMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(user_no_company)
            return AsyncSupabaseMock()

        mock_admin.table.side_effect = table_router
        with ExitStack() as stack:
            stack.enter_context(patch.object(settings, "supabase_jwt_secret", jwt_secret))
            stack.enter_context(
                patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_admin)
            )
            resp = client.get("/v1/events", headers=auth_headers)

        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# No POST/PUT/DELETE endpoints (events are internal-only)
# ---------------------------------------------------------------------------


class TestEventsMethodNotAllowed:
    """Verify no mutation endpoints exist for events."""

    def test_post_events_returns_405(self, client, auth_headers, jwt_secret):
        """POST /v1/events should return 405."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            resp = client.post("/v1/events", json={"event_type": "test"}, headers=auth_headers)
        assert resp.status_code == 405

    def test_put_events_returns_405(self, client, auth_headers, jwt_secret):
        """PUT /v1/events should return 405."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            resp = client.put("/v1/events", json={"event_type": "test"}, headers=auth_headers)
        assert resp.status_code == 405

    def test_delete_events_returns_405(self, client, auth_headers, jwt_secret):
        """DELETE /v1/events should return 405."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            resp = client.delete("/v1/events", headers=auth_headers)
        assert resp.status_code == 405

    def test_post_job_events_returns_405(self, client, auth_headers, jwt_secret, mock_job_id):
        """POST /v1/jobs/{job_id}/events should return 405."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            resp = client.post(
                f"/v1/jobs/{mock_job_id}/events",
                json={"event_type": "test"},
                headers=auth_headers,
            )
        assert resp.status_code == 405


# ---------------------------------------------------------------------------
# log_event() shared helper
# ---------------------------------------------------------------------------


class TestLogEvent:
    """Test the fire-and-forget log_event() helper used by all modules."""

    @pytest.mark.asyncio
    async def test_log_event_success(self, mock_company_id, mock_job_id, mock_user_id):
        """log_event inserts a row into event_history via admin client."""
        from api.shared.events import log_event

        mock_admin = AsyncSupabaseMock()
        mock_table = AsyncSupabaseMock()
        mock_admin.table.return_value = mock_table

        with patch("api.shared.events.get_supabase_admin_client", return_value=mock_admin):
            await log_event(
                mock_company_id,
                "job_created",
                job_id=mock_job_id,
                user_id=mock_user_id,
                event_data={"job_number": "JOB-001"},
            )

        mock_admin.table.assert_called_once_with("event_history")
        mock_table.insert.assert_called_once()
        inserted = mock_table.insert.call_args[0][0]
        assert inserted["company_id"] == str(mock_company_id)
        assert inserted["job_id"] == str(mock_job_id)
        assert inserted["user_id"] == str(mock_user_id)
        assert inserted["event_type"] == "job_created"
        assert inserted["is_ai"] is False
        assert inserted["event_data"] == {"job_number": "JOB-001"}

    @pytest.mark.asyncio
    async def test_log_event_ai_flag(self, mock_company_id, mock_job_id):
        """log_event correctly sets is_ai=True for AI-generated events."""
        from api.shared.events import log_event

        mock_admin = AsyncSupabaseMock()
        mock_table = AsyncSupabaseMock()
        mock_admin.table.return_value = mock_table

        with patch("api.shared.events.get_supabase_admin_client", return_value=mock_admin):
            await log_event(
                mock_company_id,
                "ai_scope_generated",
                job_id=mock_job_id,
                is_ai=True,
                event_data={"line_items": 5},
            )

        inserted = mock_table.insert.call_args[0][0]
        assert inserted["is_ai"] is True
        assert inserted["user_id"] is None  # no user for AI events

    @pytest.mark.asyncio
    async def test_log_event_minimal_params(self, mock_company_id):
        """log_event works with only required params (company_id + event_type)."""
        from api.shared.events import log_event

        mock_admin = AsyncSupabaseMock()
        mock_table = AsyncSupabaseMock()
        mock_admin.table.return_value = mock_table

        with patch("api.shared.events.get_supabase_admin_client", return_value=mock_admin):
            await log_event(mock_company_id, "company_updated")

        inserted = mock_table.insert.call_args[0][0]
        assert inserted["company_id"] == str(mock_company_id)
        assert inserted["event_type"] == "company_updated"
        assert inserted["job_id"] is None
        assert inserted["user_id"] is None
        assert inserted["is_ai"] is False
        assert inserted["event_data"] == {}  # defaults to empty dict

    @pytest.mark.asyncio
    async def test_log_event_swallows_exceptions(self, mock_company_id, caplog):
        """log_event never raises -- swallows errors to avoid failing the primary operation."""
        from api.shared.events import log_event

        mock_admin = AsyncSupabaseMock()
        mock_admin.table.side_effect = Exception("DB connection failed")

        with patch("api.shared.events.get_supabase_admin_client", return_value=mock_admin):
            with caplog.at_level(logging.WARNING, logger="api.shared.events"):
                # This should NOT raise
                await log_event(mock_company_id, "job_created")

        # Verify warning was logged
        assert any("event_log_failed" in record.message for record in caplog.records)

    @pytest.mark.asyncio
    async def test_log_event_swallows_insert_execute_error(self, mock_company_id, caplog):
        """log_event handles errors from .execute() call."""
        from api.shared.events import log_event

        mock_admin = AsyncSupabaseMock()
        mock_table = AsyncSupabaseMock()
        mock_admin.table.return_value = mock_table
        mock_table.insert.return_value.execute.side_effect = Exception("Insert failed")

        with patch("api.shared.events.get_supabase_admin_client", return_value=mock_admin):
            with caplog.at_level(logging.WARNING, logger="api.shared.events"):
                await log_event(mock_company_id, "job_created")

        assert any("event_log_failed" in record.message for record in caplog.records)

    @pytest.mark.asyncio
    async def test_log_event_swallows_admin_client_error(self, mock_company_id, caplog):
        """log_event handles errors from get_supabase_admin_client()."""
        from api.shared.events import log_event

        with patch(
            "api.shared.events.get_supabase_admin_client",
            side_effect=Exception("Admin client init failed"),
        ):
            with caplog.at_level(logging.WARNING, logger="api.shared.events"):
                await log_event(mock_company_id, "test_event")

        assert any("event_log_failed" in record.message for record in caplog.records)


# ---------------------------------------------------------------------------
# EventResponse schema validation
# ---------------------------------------------------------------------------


class TestEventResponseSchema:
    """Test the EventResponse Pydantic model."""

    def test_valid_event_response(self):
        """EventResponse accepts valid data."""
        from api.events.schemas import EventResponse

        data = {
            "id": str(uuid4()),
            "company_id": str(uuid4()),
            "job_id": str(uuid4()),
            "event_type": "moisture_reading_created",
            "user_id": str(uuid4()),
            "is_ai": False,
            "event_data": {"reading_id": str(uuid4())},
            "created_at": "2026-03-25T10:00:00Z",
        }
        event = EventResponse(**data)
        assert event.event_type == "moisture_reading_created"
        assert event.is_ai is False

    def test_event_response_nullable_fields(self):
        """EventResponse accepts None for job_id and user_id."""
        from api.events.schemas import EventResponse

        data = {
            "id": str(uuid4()),
            "company_id": str(uuid4()),
            "job_id": None,
            "event_type": "company_updated",
            "user_id": None,
            "is_ai": False,
            "event_data": {},
            "created_at": "2026-03-25T10:00:00Z",
        }
        event = EventResponse(**data)
        assert event.job_id is None
        assert event.user_id is None

    def test_event_response_missing_required_field(self):
        """EventResponse rejects data missing required fields."""
        from pydantic import ValidationError

        from api.events.schemas import EventResponse

        with pytest.raises(ValidationError):
            EventResponse(
                id=str(uuid4()),
                # missing company_id
                event_type="test",
                is_ai=False,
                event_data={},
                created_at="2026-03-25T10:00:00Z",
            )
