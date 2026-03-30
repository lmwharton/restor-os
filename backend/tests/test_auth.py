"""Tests for auth endpoints and middleware (Spec 00 -- Bootstrap).

Covers:
- JWT validation (missing, expired, malformed, invalid sub)
- get_auth_user_id dependency
- get_auth_context dependency (user lookup, no company, happy path)
- GET /v1/me (happy path, user not found)
- PATCH /v1/me (update name, update phone, empty body)
- GET /v1/company (happy path, no company, user not found)
- POST /v1/company (create, missing name, auth user not in Supabase)
- PATCH /v1/company (owner, non-owner, empty body)
- POST /v1/company/logo (owner, non-owner, non-image, too large)
"""

from io import BytesIO
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
    return "test-secret-key-for-jwt-signing-32b"


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


@pytest.fixture
def token_no_sub(jwt_secret):
    """JWT with no sub claim."""
    return jwt.encode(
        {"aud": "authenticated", "role": "authenticated"},
        jwt_secret,
        algorithm="HS256",
    )


@pytest.fixture
def token_invalid_sub(jwt_secret):
    """JWT with a non-UUID sub claim."""
    return jwt.encode(
        {"sub": "not-a-uuid", "aud": "authenticated", "role": "authenticated"},
        jwt_secret,
        algorithm="HS256",
    )


@pytest.fixture
def auth_headers(valid_token):
    return {"Authorization": f"Bearer {valid_token}"}


@pytest.fixture
def mock_user_row(mock_user_id, mock_company_id):
    """User row as returned from the users table (for auth context)."""
    return {
        "id": str(mock_user_id),
        "company_id": str(mock_company_id),
        "role": "owner",
        "is_platform_admin": False,
    }


@pytest.fixture
def mock_user_row_no_company(mock_user_id):
    """User row with no company_id."""
    return {
        "id": str(mock_user_id),
        "company_id": None,
        "role": "owner",
        "is_platform_admin": False,
    }


@pytest.fixture
def mock_user_row_employee(mock_user_id, mock_company_id):
    """User row with employee role."""
    return {
        "id": str(mock_user_id),
        "company_id": str(mock_company_id),
        "role": "employee",
        "is_platform_admin": False,
    }


@pytest.fixture
def full_user_data(mock_user_id, mock_auth_user_id, mock_company_id):
    """Full user row with nested company, as returned by get_user_with_company."""
    return {
        "id": str(mock_user_id),
        "auth_user_id": str(mock_auth_user_id),
        "company_id": str(mock_company_id),
        "email": "brett@drypros.com",
        "name": "Brett Sodders",
        "first_name": "Brett",
        "last_name": "Sodders",
        "phone": "(586) 944-7700",
        "avatar_url": "https://avatar.url",
        "role": "owner",
        "is_platform_admin": False,
        "deleted_at": None,
        "companies": {
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
        },
    }


def _make_admin_mock(user_row, service_table_handlers=None):
    """Create a MagicMock Supabase admin client.

    Args:
        user_row: Dict for the auth context user lookup. None = user not found.
        service_table_handlers: Optional dict mapping table names to callables
            that receive a fresh MagicMock table and configure it.
    """
    mock_client = AsyncSupabaseMock()

    def table_side_effect(table_name):
        mock_table = AsyncSupabaseMock()
        if table_name == "users":
            # Auth middleware lookup: select().eq().is_().single().execute().data
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = user_row
        if service_table_handlers and table_name in service_table_handlers:
            service_table_handlers[table_name](mock_table)
        return mock_table

    mock_client.table.side_effect = table_side_effect
    return mock_client


# ---------------------------------------------------------------------------
# Auth middleware tests — JWT validation
# ---------------------------------------------------------------------------


class TestAuthMiddleware:
    """Test JWT validation on protected endpoints."""

    def test_missing_auth_header(self, client):
        """Request without Authorization header -> 401."""
        response = client.get("/v1/me")
        assert response.status_code == 401
        assert response.json()["error_code"] == "AUTH_MISSING_TOKEN"

    def test_expired_token(self, client, expired_token, jwt_secret):
        """Expired JWT -> 401 with AUTH_TOKEN_EXPIRED."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            response = client.get(
                "/v1/me", headers={"Authorization": f"Bearer {expired_token}"}
            )
            assert response.status_code == 401
            assert response.json()["error_code"] == "AUTH_TOKEN_EXPIRED"

    def test_bearer_prefix_required(self, client):
        """Authorization header without 'Bearer ' prefix -> 401."""
        response = client.get("/v1/company", headers={"Authorization": "Token abc123"})
        assert response.status_code == 401
        assert response.json()["error_code"] == "AUTH_MISSING_TOKEN"

    def test_malformed_token(self, client):
        """Garbage token string -> 401 with AUTH_TOKEN_INVALID."""
        response = client.get(
            "/v1/me", headers={"Authorization": "Bearer not.a.valid.jwt"}
        )
        assert response.status_code == 401
        assert response.json()["error_code"] == "AUTH_TOKEN_INVALID"

    def test_wrong_secret(self, client, mock_auth_user_id):
        """JWT signed with wrong secret -> 401."""
        token = jwt.encode(
            {"sub": str(mock_auth_user_id), "aud": "authenticated"},
            "wrong-secret-key-definitely-wrong",
            algorithm="HS256",
        )
        with patch.object(settings, "supabase_jwt_secret", "correct-secret-key-32-chars-long"):
            response = client.get(
                "/v1/me", headers={"Authorization": f"Bearer {token}"}
            )
            assert response.status_code == 401
            assert response.json()["error_code"] == "AUTH_TOKEN_INVALID"

    def test_token_missing_sub(self, client, token_no_sub, jwt_secret):
        """JWT without sub claim -> 401 with AUTH_TOKEN_INVALID."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            response = client.get(
                "/v1/me", headers={"Authorization": f"Bearer {token_no_sub}"}
            )
            assert response.status_code == 401
            assert response.json()["error_code"] == "AUTH_TOKEN_INVALID"

    def test_token_invalid_sub_not_uuid(self, client, token_invalid_sub, jwt_secret):
        """JWT with non-UUID sub -> 401 with AUTH_TOKEN_INVALID."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            response = client.get(
                "/v1/me", headers={"Authorization": f"Bearer {token_invalid_sub}"}
            )
            assert response.status_code == 401
            assert response.json()["error_code"] == "AUTH_TOKEN_INVALID"

    def test_empty_bearer_token(self, client):
        """Authorization: Bearer (empty) -> 401."""
        response = client.get("/v1/me", headers={"Authorization": "Bearer "})
        assert response.status_code == 401

    def test_auth_required_on_me_endpoint(self, client):
        """GET /v1/me without auth -> 401."""
        response = client.get("/v1/me")
        assert response.status_code == 401

    def test_auth_required_on_company_endpoint(self, client):
        """GET /v1/company without auth -> 401."""
        response = client.get("/v1/company")
        assert response.status_code == 401

    def test_auth_required_on_patch_me(self, client):
        """PATCH /v1/me without auth -> 401."""
        response = client.patch("/v1/me", json={"name": "Test"})
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# get_auth_context — user lookup
# ---------------------------------------------------------------------------


class TestGetAuthContext:
    """Test auth context injection (user lookup from JWT)."""

    def test_user_not_found_in_db(self, client, valid_token, jwt_secret):
        """Valid JWT but user not in DB -> 401 AUTH_USER_NOT_FOUND."""
        mock_client = _make_admin_mock(user_row=None)
        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
        ):
            response = client.get(
                "/v1/me", headers={"Authorization": f"Bearer {valid_token}"}
            )
            assert response.status_code == 401
            assert response.json()["error_code"] == "AUTH_USER_NOT_FOUND"

    def test_user_no_company(self, client, valid_token, jwt_secret, mock_user_row_no_company):
        """User exists but has no company_id -> 401 AUTH_NO_COMPANY."""
        mock_client = _make_admin_mock(user_row=mock_user_row_no_company)
        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
        ):
            response = client.get(
                "/v1/me", headers={"Authorization": f"Bearer {valid_token}"}
            )
            assert response.status_code == 401
            assert response.json()["error_code"] == "AUTH_NO_COMPANY"


# ---------------------------------------------------------------------------
# GET /v1/me — user profile with company
# ---------------------------------------------------------------------------


class TestGetMe:
    """Test GET /v1/me endpoint."""

    def test_get_me_success(
        self, client, valid_token, jwt_secret, mock_user_row, full_user_data, mock_user_id
    ):
        """GET /v1/me with valid user -> 200 with profile + company."""
        # Auth context mock
        auth_mock = _make_admin_mock(user_row=mock_user_row)

        # Service mock for get_user_with_company
        service_mock = AsyncSupabaseMock()

        def service_table(table_name):
            t = AsyncSupabaseMock()
            if table_name == "users":
                # get_user_with_company: select("*, companies(*)").eq().is_().single().execute()
                (
                    t.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = full_user_data
                # update_last_login: update().eq().execute()
                t.update.return_value.eq.return_value.execute.return_value = AsyncSupabaseMock()
            return t

        service_mock.table.side_effect = service_table

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=auth_mock),
            patch("api.auth.service.get_supabase_admin_client", return_value=service_mock),
        ):
            response = client.get(
                "/v1/me", headers={"Authorization": f"Bearer {valid_token}"}
            )
            assert response.status_code == 200
            data = response.json()
            assert data["email"] == "brett@drypros.com"
            assert data["name"] == "Brett Sodders"
            assert data["company"]["name"] == "DryPros"
            assert data["company"]["slug"] == "drypros-a1b2"

    def test_get_me_user_not_found(self, client, valid_token, jwt_secret, mock_user_row):
        """GET /v1/me with valid JWT but user not in service layer -> 404."""
        auth_mock = _make_admin_mock(user_row=mock_user_row)
        service_mock = AsyncSupabaseMock()

        def service_table(table_name):
            t = AsyncSupabaseMock()
            if table_name == "users":
                (
                    t.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = None
            return t

        service_mock.table.side_effect = service_table

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=auth_mock),
            patch("api.auth.service.get_supabase_admin_client", return_value=service_mock),
        ):
            response = client.get(
                "/v1/me", headers={"Authorization": f"Bearer {valid_token}"}
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "USER_NOT_FOUND"


# ---------------------------------------------------------------------------
# PATCH /v1/me — update user profile
# ---------------------------------------------------------------------------


class TestPatchMe:
    """Test PATCH /v1/me endpoint."""

    def test_update_name(
        self, client, valid_token, jwt_secret, mock_user_row, mock_user_id
    ):
        """PATCH /v1/me with name -> 200 with updated profile."""
        auth_mock = _make_admin_mock(user_row=mock_user_row)

        updated_user = {
            "id": str(mock_user_id),
            "email": "brett@drypros.com",
            "name": "Brett S.",
            "first_name": "Brett",
            "last_name": "S.",
            "phone": None,
            "avatar_url": None,
            "role": "owner",
            "is_platform_admin": False,
        }

        service_mock = AsyncSupabaseMock()

        def service_table(table_name):
            t = AsyncSupabaseMock()
            if table_name == "users":
                t.update.return_value.eq.return_value.execute.return_value.data = [updated_user]
            return t

        service_mock.table.side_effect = service_table

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=auth_mock),
            patch("api.auth.service.get_supabase_admin_client", return_value=service_mock),
        ):
            response = client.patch(
                "/v1/me",
                json={"name": "Brett S."},
                headers={"Authorization": f"Bearer {valid_token}"},
            )
            assert response.status_code == 200
            assert response.json()["name"] == "Brett S."

    def test_update_phone(
        self, client, valid_token, jwt_secret, mock_user_row, mock_user_id
    ):
        """PATCH /v1/me with phone -> 200."""
        auth_mock = _make_admin_mock(user_row=mock_user_row)

        updated_user = {
            "id": str(mock_user_id),
            "email": "brett@drypros.com",
            "name": "Brett Sodders",
            "first_name": "Brett",
            "last_name": "Sodders",
            "phone": "(586) 555-1234",
            "avatar_url": None,
            "role": "owner",
            "is_platform_admin": False,
        }

        service_mock = AsyncSupabaseMock()

        def service_table(table_name):
            t = AsyncSupabaseMock()
            if table_name == "users":
                t.update.return_value.eq.return_value.execute.return_value.data = [updated_user]
            return t

        service_mock.table.side_effect = service_table

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=auth_mock),
            patch("api.auth.service.get_supabase_admin_client", return_value=service_mock),
        ):
            response = client.patch(
                "/v1/me",
                json={"phone": "(586) 555-1234"},
                headers={"Authorization": f"Bearer {valid_token}"},
            )
            assert response.status_code == 200
            assert response.json()["phone"] == "(586) 555-1234"

    def test_update_empty_body(
        self, client, valid_token, jwt_secret, mock_user_row
    ):
        """PATCH /v1/me with no fields to update -> 400 NO_UPDATES."""
        auth_mock = _make_admin_mock(user_row=mock_user_row)
        service_mock = AsyncSupabaseMock()

        # The service raises AppException for empty updates before calling DB
        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=auth_mock),
            patch("api.auth.service.get_supabase_admin_client", return_value=service_mock),
        ):
            response = client.patch(
                "/v1/me",
                json={},
                headers={"Authorization": f"Bearer {valid_token}"},
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "NO_UPDATES"


# ---------------------------------------------------------------------------
# GET /v1/company — get company for current user
# ---------------------------------------------------------------------------


class TestGetCompany:
    """Test GET /v1/company endpoint."""

    def test_get_company_success(
        self, client, valid_token, jwt_secret, full_user_data
    ):
        """GET /v1/company -> 200 with company data."""
        # This endpoint uses get_auth_user_id (not get_auth_context)
        service_mock = AsyncSupabaseMock()

        def service_table(table_name):
            t = AsyncSupabaseMock()
            if table_name == "users":
                (
                    t.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = full_user_data
            return t

        service_mock.table.side_effect = service_table

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.service.get_supabase_admin_client", return_value=service_mock),
        ):
            response = client.get(
                "/v1/company", headers={"Authorization": f"Bearer {valid_token}"}
            )
            assert response.status_code == 200
            data = response.json()
            assert data["name"] == "DryPros"
            assert data["slug"] == "drypros-a1b2"

    def test_get_company_user_not_found(
        self, client, valid_token, jwt_secret
    ):
        """GET /v1/company when user has no record -> 404."""
        service_mock = AsyncSupabaseMock()

        def service_table(table_name):
            t = AsyncSupabaseMock()
            if table_name == "users":
                (
                    t.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = None
            return t

        service_mock.table.side_effect = service_table

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.service.get_supabase_admin_client", return_value=service_mock),
        ):
            response = client.get(
                "/v1/company", headers={"Authorization": f"Bearer {valid_token}"}
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "COMPANY_NOT_FOUND"

    def test_get_company_no_company(
        self, client, valid_token, jwt_secret, mock_user_id
    ):
        """GET /v1/company when user exists but has no company -> 404."""
        user_no_company = {
            "id": str(mock_user_id),
            "auth_user_id": str(uuid4()),
            "company_id": None,
            "email": "test@test.com",
            "name": "Test",
            "first_name": "Test",
            "last_name": None,
            "phone": None,
            "avatar_url": None,
            "role": "owner",
            "is_platform_admin": False,
            "deleted_at": None,
            "companies": None,
        }

        service_mock = AsyncSupabaseMock()

        def service_table(table_name):
            t = AsyncSupabaseMock()
            if table_name == "users":
                (
                    t.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = user_no_company
            return t

        service_mock.table.side_effect = service_table

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.service.get_supabase_admin_client", return_value=service_mock),
        ):
            response = client.get(
                "/v1/company", headers={"Authorization": f"Bearer {valid_token}"}
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "COMPANY_NOT_FOUND"


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
            mock_client = AsyncSupabaseMock()
            mock_auth_response = AsyncSupabaseMock()
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
                mock_table = AsyncSupabaseMock()
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
                data = response.json()
                assert "company" in data
                assert "user" in data

    def test_create_company_missing_name(self, client, valid_token, jwt_secret):
        """POST /v1/company without name -> 422."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            response = client.post(
                "/v1/company",
                json={},
                headers={"Authorization": f"Bearer {valid_token}"},
            )
            assert response.status_code == 422

    def test_create_company_auth_user_not_found(
        self, client, valid_token, jwt_secret
    ):
        """POST /v1/company when Supabase auth user not found -> 401."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            mock_client = AsyncSupabaseMock()
            mock_auth_response = AsyncSupabaseMock()
            mock_auth_response.user = None
            mock_client.auth.admin.get_user_by_id.return_value = mock_auth_response

            with patch(
                "api.shared.database.get_supabase_admin_client",
                return_value=mock_client,
            ):
                response = client.post(
                    "/v1/company",
                    json={"name": "TestCo"},
                    headers={"Authorization": f"Bearer {valid_token}"},
                )
                assert response.status_code == 401
                assert response.json()["error_code"] == "AUTH_USER_NOT_FOUND"

    def test_create_company_no_auth(self, client):
        """POST /v1/company without auth -> 401."""
        response = client.post("/v1/company", json={"name": "TestCo"})
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# PATCH /v1/company — update company (owner only)
# ---------------------------------------------------------------------------


class TestPatchCompany:
    """Test PATCH /v1/company endpoint."""

    def test_update_company_owner(
        self, client, valid_token, jwt_secret, mock_user_row, mock_company_id
    ):
        """PATCH /v1/company as owner -> 200."""
        auth_mock = _make_admin_mock(user_row=mock_user_row)

        updated_company = {
            "id": str(mock_company_id),
            "name": "DryPros LLC",
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

        service_mock = AsyncSupabaseMock()
        service_mock.table.return_value.update.return_value.eq.return_value.execute.return_value.data = [
            updated_company
        ]

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=auth_mock),
            patch("api.auth.service.get_supabase_admin_client", return_value=service_mock),
        ):
            response = client.patch(
                "/v1/company",
                json={"name": "DryPros LLC"},
                headers={"Authorization": f"Bearer {valid_token}"},
            )
            assert response.status_code == 200
            assert response.json()["name"] == "DryPros LLC"

    def test_update_company_non_owner_forbidden(
        self, client, valid_token, jwt_secret, mock_user_row_employee
    ):
        """PATCH /v1/company as employee -> 403."""
        auth_mock = _make_admin_mock(user_row=mock_user_row_employee)

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=auth_mock),
        ):
            response = client.patch(
                "/v1/company",
                json={"name": "Nope"},
                headers={"Authorization": f"Bearer {valid_token}"},
            )
            assert response.status_code == 403
            assert response.json()["error_code"] == "FORBIDDEN"

    def test_update_company_empty_body(
        self, client, valid_token, jwt_secret, mock_user_row
    ):
        """PATCH /v1/company with empty body -> 400 NO_UPDATES."""
        auth_mock = _make_admin_mock(user_row=mock_user_row)
        service_mock = AsyncSupabaseMock()

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=auth_mock),
            patch("api.auth.service.get_supabase_admin_client", return_value=service_mock),
        ):
            response = client.patch(
                "/v1/company",
                json={},
                headers={"Authorization": f"Bearer {valid_token}"},
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "NO_UPDATES"


# ---------------------------------------------------------------------------
# POST /v1/company/logo — upload company logo (owner only)
# ---------------------------------------------------------------------------


class TestUploadCompanyLogo:
    """Test POST /v1/company/logo endpoint."""

    def test_upload_logo_non_owner_forbidden(
        self, client, valid_token, jwt_secret, mock_user_row_employee
    ):
        """POST /v1/company/logo as employee -> 403."""
        auth_mock = _make_admin_mock(user_row=mock_user_row_employee)

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=auth_mock),
        ):
            response = client.post(
                "/v1/company/logo",
                files={"file": ("logo.png", BytesIO(b"fake-image"), "image/png")},
                headers={"Authorization": f"Bearer {valid_token}"},
            )
            assert response.status_code == 403
            assert response.json()["error_code"] == "FORBIDDEN"

    def test_upload_logo_non_image_rejected(
        self, client, valid_token, jwt_secret, mock_user_row
    ):
        """POST /v1/company/logo with non-image file -> 400."""
        auth_mock = _make_admin_mock(user_row=mock_user_row)

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=auth_mock),
        ):
            response = client.post(
                "/v1/company/logo",
                files={"file": ("doc.pdf", BytesIO(b"fake-pdf"), "application/pdf")},
                headers={"Authorization": f"Bearer {valid_token}"},
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "INVALID_FILE_TYPE"

    def test_upload_logo_success(
        self, client, valid_token, jwt_secret, mock_user_row, mock_company_id
    ):
        """POST /v1/company/logo with valid image -> 200 with logo_url."""
        auth_mock = _make_admin_mock(user_row=mock_user_row)

        service_mock = AsyncSupabaseMock()
        service_mock.storage.from_.return_value.upload.return_value = None
        service_mock.storage.from_.return_value.get_public_url.return_value = (
            "https://storage.test/logos/logo.png"
        )
        service_mock.table.return_value.update.return_value.eq.return_value.execute.return_value = (
            MagicMock()
        )

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=auth_mock),
            patch("api.auth.service.get_supabase_admin_client", return_value=service_mock),
        ):
            # Create a small fake PNG (just the header bytes)
            response = client.post(
                "/v1/company/logo",
                files={"file": ("logo.png", BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100), "image/png")},
                headers={"Authorization": f"Bearer {valid_token}"},
            )
            assert response.status_code == 200
            assert response.json()["logo_url"] == "https://storage.test/logos/logo.png"

    def test_upload_logo_no_auth(self, client):
        """POST /v1/company/logo without auth -> 401."""
        response = client.post(
            "/v1/company/logo",
            files={"file": ("logo.png", BytesIO(b"fake"), "image/png")},
        )
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Service layer unit tests
# ---------------------------------------------------------------------------


class TestSlugify:
    """Test the _slugify helper."""

    def test_basic_slug(self):
        from api.auth.service import _slugify

        slug = _slugify("DryPros LLC")
        assert slug.startswith("drypros-llc-")
        assert len(slug) == len("drypros-llc-") + 4  # 4-char suffix

    def test_special_characters_removed(self):
        from api.auth.service import _slugify

        slug = _slugify("Test & Co!")
        # & and ! are stripped, result is "test-co-XXXX"
        assert slug.startswith("test-co-")

    def test_whitespace_collapsed(self):
        from api.auth.service import _slugify

        slug = _slugify("  Multiple   Spaces  ")
        assert slug.startswith("multiple-spaces-")

    def test_empty_name(self):
        from api.auth.service import _slugify

        slug = _slugify("")
        # Should produce just the suffix "-XXXX"
        assert len(slug) >= 4


class TestParseHelpers:
    """Test _parse_company and _parse_user."""

    def test_parse_company(self, mock_company_id):
        from api.auth.service import _parse_company

        data = {
            "id": str(mock_company_id),
            "name": "TestCo",
            "slug": "testco-ab12",
            "phone": None,
            "email": None,
            "logo_url": None,
            "address": None,
            "city": None,
            "state": None,
            "zip": None,
            "subscription_tier": "free",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
        company = _parse_company(data)
        assert company.name == "TestCo"
        assert company.id == mock_company_id

    def test_parse_user_without_company(self, mock_user_id):
        from api.auth.service import _parse_user

        data = {
            "id": str(mock_user_id),
            "email": "test@test.com",
            "name": "Test User",
            "first_name": "Test",
            "last_name": "User",
            "phone": None,
            "avatar_url": None,
            "role": "owner",
            "is_platform_admin": False,
        }
        user = _parse_user(data)
        assert user.name == "Test User"
        assert user.company is None

    def test_parse_user_with_company(self, mock_user_id, mock_company_id):
        from api.auth.service import _parse_company, _parse_user

        company_data = {
            "id": str(mock_company_id),
            "name": "Co",
            "slug": "co-1234",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
        company = _parse_company(company_data)
        user_data = {
            "id": str(mock_user_id),
            "email": "test@test.com",
            "name": "Test",
            "role": "owner",
        }
        user = _parse_user(user_data, company)
        assert user.company is not None
        assert user.company.name == "Co"
