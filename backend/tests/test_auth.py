"""Tests for auth endpoints (Spec 00 — Bootstrap)."""

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
def mock_auth_user_id():
    return uuid4()


@pytest.fixture
def mock_user_id():
    return uuid4()


@pytest.fixture
def mock_company_id():
    return uuid4()


@pytest.fixture
def jwt_secret():
    return "test-secret-key-for-jwt-signing"


@pytest.fixture
def valid_token(mock_auth_user_id, jwt_secret):
    return jwt.encode(
        {"sub": str(mock_auth_user_id), "aud": "authenticated", "role": "authenticated"},
        jwt_secret,
        algorithm="HS256",
    )


@pytest.fixture
def expired_token(mock_auth_user_id, jwt_secret):
    import time

    return jwt.encode(
        {
            "sub": str(mock_auth_user_id),
            "aud": "authenticated",
            "role": "authenticated",
            "exp": int(time.time()) - 3600,
        },
        jwt_secret,
        algorithm="HS256",
    )


# ---------------------------------------------------------------------------
# Auth middleware tests
# ---------------------------------------------------------------------------


class TestAuthMiddleware:
    """Test JWT validation on protected endpoints."""

    def test_missing_auth_header(self, client):
        """Request without Authorization header -> 401."""
        response = client.get("/v1/me")
        assert response.status_code == 401

    def test_expired_token(self, client, expired_token, jwt_secret):
        """Expired JWT -> 401 with AUTH_TOKEN_EXPIRED."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            response = client.get(
                "/v1/me", headers={"Authorization": f"Bearer {expired_token}"}
            )
            assert response.status_code == 401
            data = response.json()
            assert data["error_code"] == "AUTH_TOKEN_EXPIRED"

    def test_bearer_prefix_required(self, client):
        """Authorization header without 'Bearer ' prefix -> 401."""
        response = client.get("/v1/company", headers={"Authorization": "Token abc123"})
        assert response.status_code == 401

    # GET /v1/jobs moved to api/jobs/router.py (Spec 01) — test will be in test_jobs.py

    def test_auth_required_on_me_endpoint(self, client):
        """GET /v1/me without auth -> 401."""
        response = client.get("/v1/me")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# GET /v1/me — user profile with company
# ---------------------------------------------------------------------------


class TestGetMe:
    """Test GET /v1/me endpoint."""

    def test_get_me_user_not_found(self, client, valid_token, jwt_secret, mock_auth_user_id):
        """GET /v1/me with valid JWT but user not in DB -> 401."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            mock_client = MagicMock()

            # Auth context lookup: user not found
            (
                mock_client.table.return_value.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = None

            with patch(
                "api.auth.middleware.get_supabase_admin_client",
                return_value=mock_client,
            ):
                response = client.get(
                    "/v1/me",
                    headers={"Authorization": f"Bearer {valid_token}"},
                )
                assert response.status_code == 401


# ---------------------------------------------------------------------------
# POST /v1/company — onboarding (create company + user)
# ---------------------------------------------------------------------------


class TestCreateCompany:
    """Test POST /v1/company endpoint."""

    def test_create_company_success(
        self,
        client,
        valid_token,
        jwt_secret,
        mock_auth_user_id,
        mock_company_id,
        mock_user_id,
    ):
        """POST /v1/company with valid data -> 201."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            mock_client = MagicMock()
            mock_auth_response = MagicMock()
            mock_auth_response.user.email = "brett@drypros.com"
            mock_auth_response.user.user_metadata = {
                "full_name": "Brett Sodders",
                "avatar_url": "https://avatar.url",
            }
            mock_client.auth.admin.get_user_by_id.return_value = mock_auth_response

            company_row = {
                "id": str(mock_company_id),
                "name": "DryPros",
                "slug": "drypros-a1b2",
                "phone": "(586) 944-7700",
                "email": "brett@drypros.com",
                "logo_url": None,
                "address": None,
                "city": None,
                "state": None,
                "zip": None,
                "subscription_tier": "free",
                "created_at": "2026-03-25T00:00:00Z",
                "updated_at": "2026-03-25T00:00:00Z",
            }

            user_row = {
                "id": str(mock_user_id),
                "auth_user_id": str(mock_auth_user_id),
                "company_id": str(mock_company_id),
                "email": "brett@drypros.com",
                "name": "Brett Sodders",
                "first_name": "Brett",
                "last_name": "Sodders",
                "phone": None,
                "avatar_url": "https://avatar.url",
                "role": "owner",
                "is_platform_admin": False,
                "deleted_at": None,
            }

            def table_side_effect(table_name):
                mock_table = MagicMock()
                if table_name == "users":
                    # maybe_single for existing user check (returns None)
                    (
                        mock_table.select.return_value
                        .eq.return_value
                        .is_.return_value
                        .maybe_single.return_value
                        .execute.return_value
                    ).data = None
                    # insert for new user
                    (mock_table.insert.return_value.execute.return_value).data = [user_row]
                elif table_name == "companies":
                    (mock_table.insert.return_value.execute.return_value).data = [company_row]
                return mock_table

            mock_client.table.side_effect = table_side_effect

            with (
                patch(
                    "api.auth.service.get_supabase_admin_client",
                    return_value=mock_client,
                ),
                patch(
                    "api.shared.database.get_supabase_admin_client",
                    return_value=mock_client,
                ),
            ):
                response = client.post(
                    "/v1/company",
                    json={"name": "DryPros", "phone": "(586) 944-7700"},
                    headers={"Authorization": f"Bearer {valid_token}"},
                )
                assert response.status_code == 201

    def test_create_company_missing_name(self, client, valid_token, jwt_secret):
        """POST /v1/company without name -> 422."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            response = client.post(
                "/v1/company",
                json={},
                headers={"Authorization": f"Bearer {valid_token}"},
            )
            assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /v1/jobs — moved to api/jobs/router.py (Spec 01)
# Tests will be in test_jobs.py when the jobs module is built.
# ---------------------------------------------------------------------------
