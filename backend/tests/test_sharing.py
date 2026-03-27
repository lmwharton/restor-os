"""Tests for share link endpoints (create, list, revoke, public view)."""

import hashlib
from datetime import UTC, datetime, timedelta
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


def _shared_view_table_router(mock_admin, link_data, job_data):
    """Configure table router for the public shared view endpoint."""

    def table_router(name):
        if name == "share_links":
            t = MagicMock()
            t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                MagicMock(data=link_data)
            )
            return t
        if name == "jobs":
            t = MagicMock()
            t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                MagicMock(data=job_data)
            )
            return t
        if name in ("job_rooms", "photos", "moisture_readings"):
            t = MagicMock()
            t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                MagicMock(data=[])
            )
            return t
        if name == "line_items":
            t = MagicMock()
            t.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
            return t
        if name == "companies":
            t = MagicMock()
            t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                MagicMock(data={"name": "DryPros", "phone": "555-0000", "logo_url": None})
            )
            return t
        return MagicMock()

    mock_admin.table.side_effect = table_router


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
        mock_admin = MagicMock()
        mock_auth = MagicMock()

        link_id = uuid4()
        expires_at = (datetime.now(UTC) + timedelta(days=7)).isoformat()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "share_links":
                t = MagicMock()
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
            return MagicMock()

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
                f"/v1/jobs/{mock_job_id}/share",
                json={"scope": "invalid_scope"},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "INVALID_SCOPE"


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
        mock_admin = MagicMock()
        mock_auth = MagicMock()

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
                t = MagicMock()
                t.select.return_value.eq.return_value.order.return_value.execute.return_value = (
                    MagicMock(data=links)
                )
                return t
            return MagicMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/share",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 1
            assert data[0]["scope"] == "full"


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
        mock_admin = MagicMock()
        mock_auth = MagicMock()

        def table_router(name):
            if name == "users":
                return _users_table_mock(mock_user_id, mock_company_id)
            if name == "jobs":
                return _jobs_table_mock(mock_job_data)
            if name == "share_links":
                t = MagicMock()
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
            return MagicMock()

        mock_auth.table.side_effect = table_router
        mock_admin.table.side_effect = table_router

        with _patch_all(jwt_secret, mock_admin, mock_auth):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/share/{mock_link_id}",
                headers=auth_headers,
            )
            assert response.status_code == 204


# ---------------------------------------------------------------------------
# Public shared view (NO AUTH)
# ---------------------------------------------------------------------------


class TestPublicSharedView:
    """Test GET /v1/shared/{token} (public, no auth required)."""

    def test_public_shared_view(self, client, mock_job_id, mock_company_id, mock_job_data):
        """GET /v1/shared/{token} with valid token -> 200 with scoped data."""
        mock_admin = MagicMock()
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
        mock_admin = MagicMock()
        raw_token = "b" * 32
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(mock_job_id, mock_company_id, token_hash, expired=True)

        def table_router(name):
            if name == "share_links":
                t = MagicMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data=link_data)
                )
                return t
            return MagicMock()

        mock_admin.table.side_effect = table_router

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 403
            assert response.json()["error_code"] == "SHARE_EXPIRED"

    def test_public_shared_view_revoked(self, client, mock_job_id, mock_company_id):
        """GET /v1/shared/{token} with revoked link -> 403."""
        mock_admin = MagicMock()
        raw_token = "c" * 32
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(mock_job_id, mock_company_id, token_hash, revoked=True)

        def table_router(name):
            if name == "share_links":
                t = MagicMock()
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = (
                    MagicMock(data=link_data)
                )
                return t
            return MagicMock()

        mock_admin.table.side_effect = table_router

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 403
            assert response.json()["error_code"] == "SHARE_REVOKED"

    def test_public_shared_view_redacts_sensitive(
        self,
        client,
        mock_job_id,
        mock_company_id,
        mock_job_data,
    ):
        """Shared view redacts customer_phone, customer_email, and claim_number."""
        mock_admin = MagicMock()
        raw_token = "d" * 32
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        link_data = _make_share_link_data(mock_job_id, mock_company_id, token_hash)

        job_with_pii = {
            **mock_job_data,
            "customer_phone": "555-SECRET",
            "customer_email": "secret@example.com",
            "claim_number": "CLM-SECRET",
        }
        _shared_view_table_router(mock_admin, link_data, job_with_pii)

        with _patch_public_only(mock_admin):
            response = client.get(f"/v1/shared/{raw_token}")
            assert response.status_code == 200
            job = response.json()["job"]
            assert "customer_phone" not in job
            assert "customer_email" not in job
            assert "claim_number" not in job
            assert job["customer_name"] == "John Smith"
            assert job["address"] == "123 Main St"
