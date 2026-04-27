"""Tests for share link endpoints (create, list, revoke, public view).

Covers:
- POST /v1/jobs/{job_id}/share — create share link
- GET  /v1/jobs/{job_id}/share — list share links for a job
- DELETE /v1/jobs/{job_id}/share/{link_id} — revoke a share link
- GET  /v1/shared/{token} — public read-only view (NO AUTH)

Edge cases: invalid scope, expired links, revoked links, missing token,
scope-based data filtering, PII redaction, signed photo URLs, validation
boundaries, auth requirements on protected endpoints.
"""

import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from api.config import settings
from api.main import app
from api.sharing.service import _hash_token
from tests.conftest import AsyncSupabaseMock

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def jwt_secret():
    return "test-secret-key-for-sharing-tests"


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
def mock_link_id():
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
        "customer_name": "John Smith",
        "customer_phone": "555-1234",
        "customer_email": "john@example.com",
        "claim_number": "CLM-001",
        "address": "123 Main St",
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _users_table_mock(user_id, company_id):
    t = AsyncSupabaseMock()
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
    t = AsyncSupabaseMock()
    chain = t.select.return_value.eq.return_value.eq.return_value.is_.return_value
    chain.single.return_value.execute.return_value = MagicMock(data=job_data)
    return t


def _event_table_mock():
    t = AsyncSupabaseMock()
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
        patch("api.sharing.router.get_authenticated_client", return_value=mock_auth)
    )
    stack.enter_context(
        patch("api.shared.events.get_supabase_admin_client", return_value=mock_admin)
    )
    stack.enter_context(
        patch("api.sharing.service.get_supabase_admin_client", return_value=mock_admin)
    )
    return stack


def _patch_public_only(mock_admin):
    """Patch only the admin client for the public /shared/{token} endpoint."""
    from contextlib import ExitStack

    stack = ExitStack()
    stack.enter_context(
        patch("api.sharing.service.get_supabase_admin_client", return_value=mock_admin)
    )
    return stack


def _make_share_link_data(
    job_id,
    company_id,
    token_hash,
    scope="full",
    expired=False,
    revoked=False,
):
    if expired:
        expires_at = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    else:
        expires_at = (datetime.now(UTC) + timedelta(days=7)).isoformat()
    revoked_at = datetime.now(UTC).isoformat() if revoked else None
    return {
        "id": str(uuid4()),
        "job_id": str(job_id),
        "company_id": str(company_id),
        "token_hash": token_hash,
        "scope": scope,
        "expires_at": expires_at,
        "revoked_at": revoked_at,
        "created_at": "2026-03-25T10:00:00Z",
    }


def _shared_view_table_router(mock_admin, link_data, job_data, photos=None):
    """Configure table router for the public shared view endpoint.

    Args:
        mock_admin: The mock admin Supabase client.
        link_data: Dict for the share_links table row.
        job_data: Dict for the jobs table row.
        photos: Optional list of photo dicts. Defaults to empty.
    """
    photos = photos or []

    def table_router(name):
        if name == "share_links":
            t = AsyncSupabaseMock()
            t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                MagicMock(data=link_data)
            )
            return t
        if name == "jobs":
            t = AsyncSupabaseMock()
            t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                MagicMock(data=job_data)
            )
            return t
        if name == "job_rooms":
            t = AsyncSupabaseMock()
            t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                MagicMock(data=[])
            )
            return t
        if name == "photos":
            t = AsyncSupabaseMock()
            t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                MagicMock(data=photos)
            )
            return t
        if name == "line_items":
            t = AsyncSupabaseMock()
            t.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
            return t
        if name == "companies":
            t = AsyncSupabaseMock()
            t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                MagicMock(data={"name": "DryPros", "phone": "555-0000", "logo_url": None})
            )
            return t
        return AsyncSupabaseMock()

    mock_admin.table.side_effect = table_router


def _shared_view_table_router_with_data(
    mock_admin, link_data, job_data, rooms=None, photos=None,
    line_items=None, moisture_pins=None, floor_plans=None, company=None,
):
    """Fully configurable table router for shared view tests.

    The ``moisture_readings`` kwarg was removed in Spec 01H Phase 2 —
    the sharing service no longer queries that table. Pin-based
    moisture is served via ``moisture_pins`` kwarg (Phase 2C per Brett
    §8.6). Tests that exercise the portal's moisture-report data path
    set ``moisture_pins=[...]`` and ``floor_plans=[<row>, ...]``
    (one row per floor).
    """
    rooms = rooms or []
    photos = photos or []
    line_items = line_items or []
    moisture_pins = moisture_pins or []
    floor_plans = floor_plans or []
    company = company or {"name": "DryPros", "phone": "555-0000", "logo_url": None}

    def table_router(name):
        if name == "share_links":
            t = AsyncSupabaseMock()
            t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                MagicMock(data=link_data)
            )
            return t
        if name == "jobs":
            t = AsyncSupabaseMock()
            t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                MagicMock(data=job_data)
            )
            return t
        if name == "job_rooms":
            t = AsyncSupabaseMock()
            t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                MagicMock(data=rooms)
            )
            return t
        if name == "photos":
            t = AsyncSupabaseMock()
            t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                MagicMock(data=photos)
            )
            return t
        if name == "line_items":
            t = AsyncSupabaseMock()
            t.select.return_value.eq.return_value.execute.return_value = MagicMock(
                data=line_items
            )
            return t
        if name == "moisture_pins":
            # Mirror the service's query shape: .select(…).eq(job_id)
            # .eq(company_id).order("created_at").order(taken_at, foreign_table)
            # .limit(500, foreign_table="readings").execute()
            # The fake just returns whatever moisture_pins was set to;
            # the service unwraps `.data` and passes through. The .limit()
            # was added in round-3 review (finding #9, defensive cap on
            # the readings embed) — without the matching mock link the
            # chain returns a fresh MagicMock and pins silently come
            # back empty.
            t = AsyncSupabaseMock()
            (
                t.select.return_value.eq.return_value.eq.return_value.order
                .return_value.order.return_value.limit.return_value
                .execute.return_value
            ) = MagicMock(data=moisture_pins)
            return t
        if name == "floor_plans":
            # Service queries:
            #   .select(...)
            #   .eq(property_id).eq(company_id).eq(is_current)  # 3 eq()s
            #   .order(floor_number)
            #   .execute()
            # Third eq() is defense-in-depth company_id scoping (added
            # in review round 2). Returns a LIST of rows.
            t = AsyncSupabaseMock()
            (
                t.select.return_value.eq.return_value.eq.return_value
                .eq.return_value.order.return_value.execute.return_value
            ) = MagicMock(data=floor_plans)
            return t
        if name == "companies":
            t = AsyncSupabaseMock()
            t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                MagicMock(data=company)
            )
            return t
        return AsyncSupabaseMock()

    mock_admin.table.side_effect = table_router


# ---------------------------------------------------------------------------
# Unit: _hash_token
# ---------------------------------------------------------------------------


class TestHashToken:
    """Unit tests for the token hashing function."""

    def test_hash_token_deterministic(self):
        """Same input produces same hash."""
        token = "abc123"
        assert _hash_token(token) == _hash_token(token)

    def test_hash_token_matches_sha256(self):
        """Output matches Python's hashlib SHA-256."""
        token = "test-token-value"
        expected = hashlib.sha256(token.encode()).hexdigest()
        assert _hash_token(token) == expected

    def test_hash_token_different_inputs(self):
        """Different tokens produce different hashes."""
        assert _hash_token("token_a") != _hash_token("token_b")

    def test_hash_token_64_char_hex(self):
        """SHA-256 hash is 64 hex characters."""
        result = _hash_token("any-token")
        assert len(result) == 64
        assert all(c in "0123456789abcdef" for c in result)


# ---------------------------------------------------------------------------
# Create share link
# ---------------------------------------------------------------------------


class TestCreateShareLink:
    """Test POST /v1/jobs/{job_id}/share."""

    def test_create_share_link(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        auth_headers,
    ):
        """POST share link -> 201, returns share_url + token."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        link_id = uuid4()
        expires_at = (datetime.now(UTC) + timedelta(days=7)).isoformat()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.insert.return_value.execute.return_value = MagicMock(
                    data=[
                        {
                            "id": str(link_id),
                            "job_id": str(mock_job_id),
                            "company_id": str(mock_company_id),
                            "scope": "full",
                            "expires_at": expires_at,
                        }
                    ]
                )
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/share",
                json={"scope": "full", "expires_days": 7},
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert "share_url" in data
            assert "share_token" in data
            assert "expires_at" in data
            assert len(data["share_token"]) == 32

    def test_create_share_link_default_scope_and_days(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        auth_headers,
    ):
        """POST with empty body uses defaults (scope=full, expires_days=7)."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        link_id = uuid4()
        expires_at = (datetime.now(UTC) + timedelta(days=7)).isoformat()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.insert.return_value.execute.return_value = MagicMock(
                    data=[
                        {
                            "id": str(link_id),
                            "job_id": str(mock_job_id),
                            "company_id": str(mock_company_id),
                            "scope": "full",
                            "expires_at": expires_at,
                        }
                    ]
                )
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/share",
                json={},
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert len(data["share_token"]) == 32
            assert "share_url" in data

    def test_create_share_link_invalid_scope(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        auth_headers,
    ):
        """POST share link with invalid scope -> 400."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/share",
                json={"scope": "invalid_scope"},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "INVALID_SCOPE"

    @pytest.mark.parametrize("scope", ["full", "restoration_only", "photos_only"])
    def test_create_share_link_all_valid_scopes(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        auth_headers,
        scope,
    ):
        """POST with each valid scope succeeds."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        link_id = uuid4()
        expires_at = (datetime.now(UTC) + timedelta(days=7)).isoformat()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.insert.return_value.execute.return_value = MagicMock(
                    data=[
                        {
                            "id": str(link_id),
                            "job_id": str(mock_job_id),
                            "company_id": str(mock_company_id),
                            "scope": scope,
                            "expires_at": expires_at,
                        }
                    ]
                )
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/share",
                json={"scope": scope, "expires_days": 7},
                headers=auth_headers,
            )
            assert response.status_code == 201

    def test_create_share_link_expires_days_boundary_min(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        auth_headers,
    ):
        """POST with expires_days=1 (minimum) succeeds."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        link_id = uuid4()
        expires_at = (datetime.now(UTC) + timedelta(days=1)).isoformat()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.insert.return_value.execute.return_value = MagicMock(
                    data=[
                        {
                            "id": str(link_id),
                            "job_id": str(mock_job_id),
                            "company_id": str(mock_company_id),
                            "scope": "full",
                            "expires_at": expires_at,
                        }
                    ]
                )
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/share",
                json={"scope": "full", "expires_days": 1},
                headers=auth_headers,
            )
            assert response.status_code == 201

    def test_create_share_link_expires_days_boundary_max(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        auth_headers,
    ):
        """POST with expires_days=30 (maximum) succeeds."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        link_id = uuid4()
        expires_at = (datetime.now(UTC) + timedelta(days=30)).isoformat()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.insert.return_value.execute.return_value = MagicMock(
                    data=[
                        {
                            "id": str(link_id),
                            "job_id": str(mock_job_id),
                            "company_id": str(mock_company_id),
                            "scope": "full",
                            "expires_at": expires_at,
                        }
                    ]
                )
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/share",
                json={"scope": "full", "expires_days": 30},
                headers=auth_headers,
            )
            assert response.status_code == 201

    def test_create_share_link_no_auth(self, client, mock_job_id):
        """POST without auth header -> 401."""
        response = client.post(
            f"/v1/jobs/{mock_job_id}/share",
            json={"scope": "full"},
        )
        assert response.status_code == 401

    def test_create_share_link_url_contains_token(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        auth_headers,
    ):
        """The share_url in response contains the share_token."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        link_id = uuid4()
        expires_at = (datetime.now(UTC) + timedelta(days=7)).isoformat()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.insert.return_value.execute.return_value = MagicMock(
                    data=[
                        {
                            "id": str(link_id),
                            "job_id": str(mock_job_id),
                            "company_id": str(mock_company_id),
                            "scope": "full",
                            "expires_at": expires_at,
                        }
                    ]
                )
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/share",
                json={"scope": "full", "expires_days": 7},
                headers=auth_headers,
            )
            data = response.json()
            assert data["share_token"] in data["share_url"]
            assert data["share_url"].endswith(f"/shared/{data['share_token']}")


# ---------------------------------------------------------------------------
# List share links
# ---------------------------------------------------------------------------


class TestListShareLinks:
    """Test GET /v1/jobs/{job_id}/share."""

    def test_list_share_links(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        auth_headers,
    ):
        """GET share links -> 200 with list."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        now = "2026-03-25T10:00:00Z"
        links = [
            {
                "id": str(uuid4()),
                "scope": "full",
                "expires_at": (datetime.now(UTC) + timedelta(days=7)).isoformat(),
                "revoked_at": None,
                "created_at": now,
            }
        ]

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=links)
                )
                return t
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/share",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert "items" in data
            assert "total" in data
            assert len(data["items"]) == 1
            assert data["items"][0]["scope"] == "full"

    def test_list_share_links_empty(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        auth_headers,
    ):
        """GET share links when none exist -> 200 with empty list."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/share",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["items"] == []
            assert data["total"] == 0

    def test_list_share_links_includes_revoked(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_job_data,
        auth_headers,
    ):
        """GET share links returns both active and revoked links."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        now = "2026-03-25T10:00:00Z"
        links = [
            {
                "id": str(uuid4()),
                "scope": "full",
                "expires_at": (datetime.now(UTC) + timedelta(days=7)).isoformat(),
                "revoked_at": None,
                "created_at": now,
            },
            {
                "id": str(uuid4()),
                "scope": "photos_only",
                "expires_at": (datetime.now(UTC) + timedelta(days=3)).isoformat(),
                "revoked_at": "2026-03-26T12:00:00Z",
                "created_at": now,
            },
        ]

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=links)
                )
                return t
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/share",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert len(data["items"]) == 2
            assert data["total"] == 2
            # First is active (revoked_at is None), second is revoked
            assert data["items"][0]["revoked_at"] is None
            assert data["items"][1]["revoked_at"] is not None

    def test_list_share_links_no_auth(self, client, mock_job_id):
        """GET without auth header -> 401."""
        response = client.get(f"/v1/jobs/{mock_job_id}/share")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Revoke share link
# ---------------------------------------------------------------------------


class TestRevokeShareLink:
    """Test DELETE /v1/jobs/{job_id}/share/{link_id}."""

    def test_revoke_share_link(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_link_id,
        mock_job_data,
        auth_headers,
    ):
        """DELETE share link -> 204."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.update.return_value.eq.return_value.eq.return_value.execute.return_value = (
                    MagicMock(
                        data=[
                            {"id": str(mock_link_id), "revoked_at": datetime.now(UTC).isoformat()}
                        ]
                    )
                )
                return t
            if name == "event_history":
                return _event_table_mock()
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/share/{mock_link_id}",
                headers=auth_headers,
            )
            assert response.status_code == 204

    def test_revoke_share_link_not_found(
        self,
        client,
        jwt_secret,
        mock_user_id,
        mock_company_id,
        mock_job_id,
        mock_link_id,
        mock_job_data,
        auth_headers,
    ):
        """DELETE non-existent share link -> 404."""
        mock_admin = AsyncSupabaseMock()
        mock_auth = AsyncSupabaseMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "share_links":
                t = AsyncSupabaseMock()
                # Return empty data to simulate not found
                t.update.return_value.eq.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            return AsyncSupabaseMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/share/{mock_link_id}",
                headers=auth_headers,
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "SHARE_LINK_NOT_FOUND"

    def test_revoke_share_link_no_auth(self, client, mock_job_id, mock_link_id):
        """DELETE without auth header -> 401."""
        response = client.delete(
            f"/v1/jobs/{mock_job_id}/share/{mock_link_id}",
        )
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Public shared view (NO AUTH)
# ---------------------------------------------------------------------------


class TestPublicSharedView:
    """Test GET /v1/shared/{token} (public, no auth required)."""

    def test_public_shared_view(self, client, mock_job_id, mock_company_id, mock_job_data):
        """GET /v1/shared/{token} with valid token -> 200 with scoped data."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "a" * 32
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(mock_job_id, mock_company_id, token_hash)

        _shared_view_table_router(mock_admin, link_data, {**mock_job_data})

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            assert "job" in data
            assert "rooms" in data
            assert "photos" in data
            assert "company" in data

    def test_public_shared_view_expired(self, client, mock_job_id, mock_company_id):
        """GET /v1/shared/{token} with expired token -> 403."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "b" * 32
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(mock_job_id, mock_company_id, token_hash, expired=True)

        def table_router(name):
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data=link_data)
                )
                return t
            return AsyncSupabaseMock()

        mock_admin.table.side_effect = table_router

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 403
            assert response.json()["error_code"] == "SHARE_EXPIRED"

    def test_public_shared_view_revoked(self, client, mock_job_id, mock_company_id):
        """GET /v1/shared/{token} with revoked link -> 403."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "c" * 32
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(mock_job_id, mock_company_id, token_hash, revoked=True)

        def table_router(name):
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data=link_data)
                )
                return t
            return AsyncSupabaseMock()

        mock_admin.table.side_effect = table_router

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 403
            assert response.json()["error_code"] == "SHARE_REVOKED"

    def test_public_shared_view_redacts_sensitive(self):
        """The public-portal redaction is now enforced by PostgREST
        `.select(<allowlist>)` rather than Python `.pop()` (round-3
        review #3 + pr-review-lessons #35 — blacklists default-leak
        every new column). The unit-of-redaction is the allowlist
        string itself, so this test asserts against the exported
        constants directly: every PII / tech-internal column is
        absent from the relevant allowlist, and every column the
        portal genuinely needs is present.

        The previous shape of this test (seed a mock with PII fields,
        assert they're missing from the response) silently passed in
        production but failed here because `AsyncSupabaseMock` doesn't
        honor `.select()` filtering — the redaction lived in Python,
        not the mock. With Python-side `.pop()` removed, the mock
        leaks the PII through. Asserting on the constants is the
        honest contract test.
        """
        from api.sharing.service import (
            _PUBLIC_JOB_COLUMNS,
            _PUBLIC_LINE_ITEM_COLUMNS,
            _PUBLIC_PHOTO_COLUMNS,
            _PUBLIC_ROOM_COLUMNS,
        )

        # Helper — split a comma-separated allowlist string into a set
        # for membership checks that don't get fooled by substrings
        # (e.g. "customer_name" must not match "customer_phone").
        def _cols(allowlist: str) -> set[str]:
            return {c.strip() for c in allowlist.split(",")}

        job_cols = _cols(_PUBLIC_JOB_COLUMNS)
        room_cols = _cols(_PUBLIC_ROOM_COLUMNS)
        photo_cols = _cols(_PUBLIC_PHOTO_COLUMNS)
        line_item_cols = _cols(_PUBLIC_LINE_ITEM_COLUMNS)

        # PII / tech-internal must NOT be in the jobs allowlist.
        assert "customer_phone" not in job_cols
        assert "customer_email" not in job_cols
        assert "claim_number" not in job_cols
        assert "notes" not in job_cols
        assert "tech_notes" not in job_cols
        assert "loss_cause" not in job_cols
        assert "latitude" not in job_cols
        assert "longitude" not in job_cols
        assert "assigned_to" not in job_cols
        assert "created_by" not in job_cols
        assert "updated_by" not in job_cols
        # adjuster_* family — guard each likely column name.
        for col in ("adjuster_name", "adjuster_phone", "adjuster_email"):
            assert col not in job_cols, f"{col} must not be in jobs allowlist"

        # Required for the portal to render anything useful.
        assert "id" in job_cols
        assert "customer_name" in job_cols
        assert "address_line1" in job_cols
        assert "status" in job_cols
        assert "timezone" in job_cols  # round-2 H2 pin

        # Rooms allowlist excludes tech notes + V2 sketch internals.
        assert "notes" not in room_cols
        assert "room_sketch_data" not in room_cols
        assert "created_by" not in room_cols
        assert "room_name" in room_cols
        assert "square_footage" in room_cols

        # Photos allowlist excludes the AI scoping flag and tech-named
        # filename.
        assert "filename" not in photo_cols
        assert "selected_for_ai" not in photo_cols
        assert "created_by" not in photo_cols
        assert "storage_url" in photo_cols
        assert "caption" in photo_cols

        # line_items allowlist documents Spec 02's public contract.
        assert "code" in line_item_cols
        assert "description" in line_item_cols

    def test_public_shared_view_invalid_token(self, client):
        """GET /v1/shared/{token} with unknown token -> 404."""
        mock_admin = AsyncSupabaseMock()

        def table_router(name):
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data=None)
                )
                return t
            return AsyncSupabaseMock()

        mock_admin.table.side_effect = table_router

        with _patch_public_only(mock_admin):
            response = client.get("/v1/shared/nonexistent_token_value_here")
            assert response.status_code == 404
            assert response.json()["error_code"] == "SHARE_NOT_FOUND"

    def test_public_shared_view_photos_only_scope(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """photos_only scope returns empty line_items and excludes moisture."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "e" * 32
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(
            mock_job_id, mock_company_id, token_hash, scope="photos_only"
        )

        # Use the detailed router so we can verify line_items is NOT fetched.
        # moisture was removed from the shared payload in Spec 01H Phase 2 —
        # no longer a key on the response, so no assertion needed here.
        _shared_view_table_router_with_data(
            mock_admin,
            link_data,
            {**mock_job_data},
            rooms=[{"id": str(uuid4()), "name": "Living Room", "sort_order": 1}],
            photos=[{"id": str(uuid4()), "storage_url": None, "created_at": "2026-03-25T10:00:00Z"}],
            line_items=[{"id": str(uuid4()), "code": "WTR DRYOUT"}],
        )

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            # photos_only scope should NOT include line items
            assert data["line_items"] == []
            # But job, rooms, photos, company should still be present
            assert data["job"] is not None
            assert len(data["rooms"]) == 1
            # moisture_readings key no longer in the payload at all
            assert "moisture_readings" not in data

    def test_public_shared_view_restoration_only_scope(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """restoration_only scope includes line items (moisture shipped
        separately via pin-based payload in Phase 2C)."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "f" * 32
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(
            mock_job_id, mock_company_id, token_hash, scope="restoration_only"
        )

        items = [{"id": str(uuid4()), "code": "WTR DRYOUT", "quantity": 1}]

        _shared_view_table_router_with_data(
            mock_admin,
            link_data,
            {**mock_job_data},
            line_items=items,
        )

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            assert len(data["line_items"]) == 1
            assert "moisture_readings" not in data

    def test_public_shared_view_full_scope_includes_all(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """full scope includes line items + rooms (moisture shipped
        separately via pin-based payload in Phase 2C)."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "abcd" * 8
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(
            mock_job_id, mock_company_id, token_hash, scope="full"
        )

        items = [{"id": str(uuid4()), "code": "DRYWLL RR", "quantity": 2}]
        rooms = [{"id": str(uuid4()), "name": "Bedroom", "sort_order": 1}]

        _shared_view_table_router_with_data(
            mock_admin,
            link_data,
            {**mock_job_data},
            rooms=rooms,
            line_items=items,
        )

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            assert len(data["line_items"]) == 1
            assert len(data["rooms"]) == 1
            assert "moisture_readings" not in data

    def test_public_shared_view_with_photos_and_signed_urls(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """Photos with storage_url get signed URLs attached."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "1234" * 8
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(mock_job_id, mock_company_id, token_hash)

        photos = [
            {
                "id": str(uuid4()),
                "storage_url": "photos/job1/photo1.jpg",
                "created_at": "2026-03-25T10:00:00Z",
            },
            {
                "id": str(uuid4()),
                "storage_url": "photos/job1/photo2.jpg",
                "created_at": "2026-03-25T11:00:00Z",
            },
        ]

        def table_router(name):
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data=link_data)
                )
                return t
            if name == "jobs":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data={**mock_job_data})
                )
                return t
            if name == "job_rooms":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            if name == "photos":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=photos)
                )
                return t
            if name == "line_items":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
                return t
            if name == "companies":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data={"name": "DryPros", "phone": "555-0000", "logo_url": None})
                )
                return t
            return AsyncSupabaseMock()

        mock_admin.table.side_effect = table_router

        # Mock storage.from_("photos").create_signed_urls(...)
        mock_storage_bucket = AsyncSupabaseMock()
        mock_storage_bucket.create_signed_urls.return_value = [
            {"path": "photos/job1/photo1.jpg", "signedURL": "https://signed-url-1.com"},
            {"path": "photos/job1/photo2.jpg", "signedURL": "https://signed-url-2.com"},
        ]
        mock_admin.storage.from_.return_value = mock_storage_bucket

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            assert len(data["photos"]) == 2
            assert data["photos"][0]["signed_url"] == "https://signed-url-1.com"
            assert data["photos"][1]["signed_url"] == "https://signed-url-2.com"

    def test_public_shared_view_photos_without_storage_url(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """Photos without storage_url get empty signed_url."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "5678" * 8
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(mock_job_id, mock_company_id, token_hash)

        photos = [
            {
                "id": str(uuid4()),
                "storage_url": None,
                "created_at": "2026-03-25T10:00:00Z",
            },
        ]

        _shared_view_table_router(mock_admin, link_data, {**mock_job_data}, photos=photos)

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            assert len(data["photos"]) == 1
            # No storage_url means signed_url should be empty string
            assert data["photos"][0]["signed_url"] == ""

    def test_public_shared_view_company_info(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """Company response only includes public fields (name, phone, logo_url)."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "9abc" * 8
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(mock_job_id, mock_company_id, token_hash)

        _shared_view_table_router_with_data(
            mock_admin,
            link_data,
            {**mock_job_data},
            company={"name": "TestCo", "phone": "555-9999", "logo_url": "https://logo.png"},
        )

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            company = response.json()["company"]
            assert company["name"] == "TestCo"
            assert company["phone"] == "555-9999"
            assert company["logo_url"] == "https://logo.png"

    def test_public_shared_view_job_not_found(
        self,
        client,
        mock_job_id,
        mock_company_id,
    ):
        """GET /v1/shared/{token} when linked job is missing -> 404."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "dead" * 8
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(mock_job_id, mock_company_id, token_hash)

        def table_router(name):
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data=link_data)
                )
                return t
            if name == "jobs":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data=None)
                )
                return t
            return AsyncSupabaseMock()

        mock_admin.table.side_effect = table_router

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 404
            assert response.json()["error_code"] == "JOB_NOT_FOUND"

    def test_public_shared_view_line_items_table_error_graceful(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """If line_items table raises exception, it is caught gracefully."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "cafe" * 8
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(mock_job_id, mock_company_id, token_hash)

        def table_router(name):
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data=link_data)
                )
                return t
            if name == "jobs":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data={**mock_job_data})
                )
                return t
            if name == "job_rooms":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            if name == "photos":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            if name == "line_items":
                t = AsyncSupabaseMock()
                # Simulate the exact PostgREST shape the narrowed
                # except block tolerates — APIError with code PGRST205
                # ("table not found in schema cache"). Any other
                # exception shape would correctly re-raise now.
                from postgrest.exceptions import APIError

                t.select.return_value.eq.return_value.execute.side_effect = APIError(
                    {
                        "code": "PGRST205",
                        "message": "relation 'line_items' does not exist",
                    }
                )
                return t
            if name == "companies":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data={"name": "DryPros", "phone": "555-0000", "logo_url": None})
                )
                return t
            return AsyncSupabaseMock()

        mock_admin.table.side_effect = table_router

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            # line_items gracefully falls back to empty list
            assert data["line_items"] == []

    def test_public_shared_view_moisture_pins_apierror_unavailable(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """When the moisture_pins query hits a tolerated PGRST table-
        missing code, the response surfaces moisture_access='unavailable'
        rather than collapsing to 'empty'. Pins the discriminant
        precedence (denied → unavailable → empty → present) and gives
        the portal the signal to render the "temporarily unavailable"
        copy instead of "no readings logged yet."
        """
        mock_admin = AsyncSupabaseMock()
        raw_token = "u" * 32
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(
            mock_job_id, mock_company_id, token_hash, scope="restoration_only"
        )

        from postgrest.exceptions import APIError

        def table_router(name):
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data=link_data)
                )
                return t
            if name == "jobs":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data={**mock_job_data})
                )
                return t
            if name == "job_rooms":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            if name == "photos":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            if name == "moisture_pins":
                # Simulate the schema-cache-miss case the narrowed
                # except tolerates. Should NOT raise to the caller;
                # should land moisture_access='unavailable'. Mirrors
                # the service chain including the round-3 .limit() cap.
                t = AsyncSupabaseMock()
                (
                    t.select.return_value.eq.return_value.eq.return_value
                    .order.return_value.order.return_value.limit.return_value
                    .execute.side_effect
                ) = APIError({"code": "PGRST205", "message": "missing"})
                return t
            if name == "line_items":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.execute.return_value = (
                    MagicMock(data=[])
                )
                return t
            if name == "companies":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data={"name": "DryPros", "phone": None, "logo_url": None})
                )
                return t
            return AsyncSupabaseMock()

        mock_admin.table.side_effect = table_router

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            assert data["moisture_access"] == "unavailable"
            assert data["moisture_pins"] == []

    def test_public_shared_view_includes_timezone_top_level(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """Review round-2 H2 regression pin.

        The adjuster portal's local-day bucketing (Day-N axis, snapshot
        filter, firstDryDate) MUST read the job's timezone to match the
        tech-on-site view. If this field silently drops out of the wire
        payload, the portal falls back to browser-local and an Atlanta
        adjuster sees a different Day-5 than the Hawaiian tech does.
        Carrier-rejection material per spec §S7.

        The field is hoisted to the top level (not nested inside `job`)
        because `job: dict` is untyped and the frontend SharedPayload
        type can't safely assert sub-fields. Default matches DB default.
        """
        mock_admin = AsyncSupabaseMock()
        raw_token = "tz" * 16
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(
            mock_job_id, mock_company_id, token_hash, scope="full"
        )
        # Job explicitly carries a non-default TZ so the test proves the
        # service passes it through rather than hard-coding the default.
        _shared_view_table_router_with_data(
            mock_admin,
            link_data,
            {**mock_job_data, "timezone": "America/Los_Angeles"},
        )

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            # Top-level hoist — not nested inside data["job"].
            assert data.get("timezone") == "America/Los_Angeles"

    def test_public_shared_view_timezone_falls_back_to_default(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """Negative pin for the fallback branch. A job row missing
        `timezone` (hypothetical future data shape drift) must still
        produce a renderable payload — the service coalesces to the DB
        default instead of letting the frontend receive `null` and
        crash on `Intl.DateTimeFormat(undefined)`."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "dz" * 16
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(
            mock_job_id, mock_company_id, token_hash, scope="full"
        )
        job_without_tz = {k: v for k, v in mock_job_data.items() if k != "timezone"}
        _shared_view_table_router_with_data(mock_admin, link_data, job_without_tz)

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            assert data.get("timezone") == "America/New_York"

    def test_public_shared_view_photos_only_omits_primary_floor_id(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """primary_floor_id is scope-gated alongside moisture_pins +
        floor_plans. A photos_only adjuster should never see the
        moisture primary-floor pointer, even though the underlying
        UUID is opaque — the field semantically belongs to the
        restoration scope. Pinning this prevents a future regression
        where someone hoists primary_floor_id outside the scope check.
        """
        mock_admin = AsyncSupabaseMock()
        raw_token = "p" * 32
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(
            mock_job_id, mock_company_id, token_hash, scope="photos_only"
        )

        # Job HAS a pinned floor_plan_id — the test verifies it stays
        # OUT of the response, not that it was missing upstream.
        _shared_view_table_router_with_data(
            mock_admin,
            link_data,
            {**mock_job_data, "floor_plan_id": str(uuid4())},
        )

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            assert data["moisture_access"] == "denied"
            assert data["primary_floor_id"] is None

    # ─── Moisture pins scope gating (Brett §8.6 adjuster-portal view) ─

    def test_public_shared_view_photos_only_excludes_moisture_pins(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """photos_only scope returns an empty moisture_pins list and
        empty floor_plans — the portal's moisture-report route should
        404-or-empty on a photos_only share link rather than exposing
        pin data the adjuster wasn't authorized to see."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "m1" * 16
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(
            mock_job_id, mock_company_id, token_hash, scope="photos_only"
        )

        _shared_view_table_router_with_data(
            mock_admin,
            link_data,
            {**mock_job_data, "floor_plan_id": str(uuid4())},
            # Even though pins exist on the job, photos_only scope
            # must not surface them.
            moisture_pins=[
                {
                    "id": str(uuid4()),
                    "surface": "floor",
                    "position": "NW",
                    "wall_segment_id": None,
                    "readings": [],
                },
            ],
            floor_plans=[{"id": str(uuid4()), "canvas_data": {}, "is_current": True}],
        )

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            assert data["moisture_pins"] == []
            assert data["floor_plans"] == []

    def test_public_shared_view_restoration_only_includes_moisture_pins(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """restoration_only scope MUST include moisture_pins +
        floor_plans — without them the adjuster-portal moisture-report
        route has nothing to render (Brett §8.6 "available in the
        adjuster portal without requiring a PDF export"). Multi-floor
        jobs get every floor, not just the pinned one."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "m2" * 16
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(
            mock_job_id, mock_company_id, token_hash, scope="restoration_only"
        )

        fp_id = str(uuid4())
        pins = [
            {
                "id": str(uuid4()),
                # Phase 2 location split (e2b3c4d5f6a7) — structured
                # triple replaces composed location_name.
                "surface": "floor",
                "position": "C",
                "wall_segment_id": None,
                "material": "drywall",
                "dry_standard": 16.0,
                "canvas_x": 100.0,
                "canvas_y": 100.0,
                "readings": [
                    {
                        "id": str(uuid4()),
                        "reading_value": 18,
                        "taken_at": "2026-04-22T12:00:00-04:00",
                    },
                ],
            },
        ]
        _shared_view_table_router_with_data(
            mock_admin,
            link_data,
            {**mock_job_data, "floor_plan_id": fp_id, "property_id": str(uuid4())},
            moisture_pins=pins,
            # Two floors returned (basement + main). Real multi-floor
            # jobs place pins on both — the portal must render each.
            floor_plans=[
                {
                    "id": str(uuid4()),
                    "floor_number": 0,
                    "floor_name": "Basement",
                    "canvas_data": {"rooms": [], "walls": []},
                    "is_current": True,
                    "property_id": "prop-1",
                },
                {
                    "id": fp_id,
                    "floor_number": 1,
                    "floor_name": "Main",
                    "canvas_data": {"rooms": [], "walls": []},
                    "is_current": True,
                    "property_id": "prop-1",
                },
            ],
        )

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            assert len(data["moisture_pins"]) == 1
            # Phase 2 location split (e2b3c4d5f6a7) — public payload now
            # carries the structured triple instead of the composed
            # location_name. The frontend moisture-report wrapper
            # composes the display string via formatPinLocation.
            assert data["moisture_pins"][0]["surface"] == "floor"
            assert data["moisture_pins"][0]["position"] == "C"
            assert data["moisture_pins"][0]["wall_segment_id"] is None
            # Readings survive the round-trip for the report view's
            # per-pin history rendering.
            assert len(data["moisture_pins"][0]["readings"]) == 1
            assert len(data["floor_plans"]) == 2
            # Ordering matches service: sorted by floor_number asc.
            assert [fp["floor_name"] for fp in data["floor_plans"]] == [
                "Basement",
                "Main",
            ]

    def test_public_shared_view_full_includes_moisture_pins(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """full scope is a superset of restoration_only — includes
        moisture_pins + floor_plans + everything else."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "m3" * 16
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(
            mock_job_id, mock_company_id, token_hash, scope="full"
        )

        _shared_view_table_router_with_data(
            mock_admin,
            link_data,
            {**mock_job_data, "floor_plan_id": str(uuid4()), "property_id": "prop-1"},
            moisture_pins=[
                {
                    "id": str(uuid4()),
                    "surface": "wall",
                    "position": "C",
                    "wall_segment_id": None,
                    "readings": [],
                },
                {
                    "id": str(uuid4()),
                    "surface": "floor",
                    "position": "C",
                    "wall_segment_id": None,
                    "readings": [],
                },
            ],
            floor_plans=[
                {"id": str(uuid4()), "canvas_data": {}, "is_current": True, "floor_number": 1},
            ],
        )

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            data = response.json()
            assert len(data["moisture_pins"]) == 2
            assert len(data["floor_plans"]) == 1


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------


class TestShareSchemaValidation:
    """Test Pydantic schema validation for share link models."""

    def test_share_link_create_defaults(self):
        """ShareLinkCreate has correct defaults."""
        from api.sharing.schemas import ShareLinkCreate

        body = ShareLinkCreate()
        assert body.scope == "full"
        assert body.expires_days == 7

    def test_share_link_create_custom_values(self):
        """ShareLinkCreate accepts valid custom values."""
        from api.sharing.schemas import ShareLinkCreate

        body = ShareLinkCreate(scope="photos_only", expires_days=14)
        assert body.scope == "photos_only"
        assert body.expires_days == 14

    def test_share_link_create_expires_days_min(self):
        """ShareLinkCreate rejects expires_days below 1."""
        from pydantic import ValidationError

        from api.sharing.schemas import ShareLinkCreate

        with pytest.raises(ValidationError):
            ShareLinkCreate(expires_days=0)

    def test_share_link_create_expires_days_max(self):
        """ShareLinkCreate rejects expires_days above 30."""
        from pydantic import ValidationError

        from api.sharing.schemas import ShareLinkCreate

        with pytest.raises(ValidationError):
            ShareLinkCreate(expires_days=31)

    def test_valid_scopes_set(self):
        """VALID_SCOPES contains exactly three entries."""
        from api.sharing.schemas import VALID_SCOPES

        assert VALID_SCOPES == {"full", "restoration_only", "photos_only"}


# ---------------------------------------------------------------------------
# Tests: POST /v1/shared/resolve (token in body, not URL path)
# ---------------------------------------------------------------------------


class TestResolveSharedEndpoint:
    """Test POST /v1/shared/resolve endpoint."""

    def test_resolve_shared_success(self, client, mock_job_id, mock_company_id, mock_job_data):
        """POST /v1/shared/resolve with valid token -> 200."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "d" * 32
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(mock_job_id, mock_company_id, token_hash)

        _shared_view_table_router(mock_admin, link_data, {**mock_job_data})

        with _patch_public_only(mock_admin):
            response = client.post("/v1/shared/resolve", json={"token": raw_token})
            assert response.status_code == 200
            data = response.json()
            assert "job" in data
            assert "rooms" in data
            assert "photos" in data
            assert "company" in data

    def test_resolve_shared_expired(self, client, mock_job_id, mock_company_id):
        """POST /v1/shared/resolve with expired token -> 403."""
        mock_admin = AsyncSupabaseMock()
        raw_token = "e" * 32
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(mock_job_id, mock_company_id, token_hash, expired=True)

        def table_router(name):
            if name == "share_links":
                t = AsyncSupabaseMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data=link_data)
                )
                return t
            return AsyncSupabaseMock()

        mock_admin.table.side_effect = table_router

        with _patch_public_only(mock_admin):
            response = client.post("/v1/shared/resolve", json={"token": raw_token})
            assert response.status_code == 403
            assert response.json()["error_code"] == "SHARE_EXPIRED"

    def test_resolve_shared_missing_token(self, client):
        """POST /v1/shared/resolve without token -> 422."""
        response = client.post("/v1/shared/resolve", json={})
        assert response.status_code == 422

    def test_resolve_shared_empty_token(self, client):
        """POST /v1/shared/resolve with empty token -> 422."""
        response = client.post("/v1/shared/resolve", json={"token": ""})
        assert response.status_code == 422
