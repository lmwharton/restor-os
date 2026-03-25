"""Tests for auth middleware and bootstrap endpoints (company, jobs)."""

from unittest.mock import MagicMock, patch

from api.config import settings

# ---------------------------------------------------------------------------
# Auth middleware: missing / invalid / expired tokens
# ---------------------------------------------------------------------------


class TestAuthMiddleware:
    """Test JWT validation on protected endpoints."""

    def test_missing_auth_header_returns_401(self, client):
        """GET /v1/company without Authorization header -> 401."""
        response = client.get("/v1/company")
        assert response.status_code == 401
        data = response.json()
        assert data["error_code"] == "AUTH_MISSING_TOKEN"

    def test_invalid_token_returns_401(self, client):
        """GET /v1/company with garbage token -> 401."""
        response = client.get("/v1/company", headers={"Authorization": "Bearer garbage"})
        assert response.status_code == 401
        data = response.json()
        assert data["error_code"] == "AUTH_TOKEN_INVALID"

    def test_expired_token_returns_401(self, client, expired_token, jwt_secret):
        """GET /v1/company with expired JWT -> 401."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            response = client.get(
                "/v1/company",
                headers={"Authorization": f"Bearer {expired_token}"},
            )
            assert response.status_code == 401
            data = response.json()
            assert data["error_code"] == "AUTH_TOKEN_EXPIRED"

    def test_bearer_prefix_required(self, client):
        """Authorization header without 'Bearer ' prefix -> 401."""
        response = client.get("/v1/company", headers={"Authorization": "Token abc123"})
        assert response.status_code == 401

    def test_auth_required_on_jobs_endpoint(self, client):
        """GET /v1/jobs without auth -> 401."""
        response = client.get("/v1/jobs")
        assert response.status_code == 401

    def test_auth_required_on_me_endpoint(self, client):
        """GET /v1/me without auth -> 401."""
        response = client.get("/v1/me")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# GET /v1/company — user lookup
# ---------------------------------------------------------------------------


class TestGetCompany:
    """Test GET /v1/company endpoint."""

    def test_valid_token_no_user_returns_404(
        self, client, valid_token, jwt_secret, mock_auth_user_id
    ):
        """Valid JWT but user not in DB (first visit) -> 404 COMPANY_NOT_FOUND."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            mock_client = MagicMock()

            # get_user_with_company queries users table with .single()
            # Return None to simulate no user found
            mock_result = MagicMock()
            mock_result.data = None
            (
                mock_client.table.return_value.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ) = mock_result

            with patch(
                "api.auth.service.get_supabase_admin_client",
                return_value=mock_client,
            ):
                response = client.get(
                    "/v1/company",
                    headers={"Authorization": f"Bearer {valid_token}"},
                )
                assert response.status_code == 404
                data = response.json()
                assert data["error_code"] == "COMPANY_NOT_FOUND"


# ---------------------------------------------------------------------------
# POST /v1/company — onboarding: create company + user
# ---------------------------------------------------------------------------


class TestCreateCompany:
    """Test POST /v1/company onboarding endpoint."""

    def test_create_company_success(
        self,
        client,
        valid_token,
        jwt_secret,
        mock_auth_user_id,
        mock_company_id,
        mock_user_id,
    ):
        """POST /v1/company creates company + user and returns 201."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            mock_client = MagicMock()

            company_data = {
                "id": str(mock_company_id),
                "name": "DryPros LLC",
                "slug": "drypros-llc-a7k2",
                "phone": "+15551234567",
                "email": "brett@drypros.com",
                "logo_url": None,
                "address": None,
                "city": None,
                "state": None,
                "zip": None,
                "subscription_tier": "free",
                "created_at": "2026-03-25T00:00:00+00:00",
                "updated_at": "2026-03-25T00:00:00+00:00",
            }
            user_data = {
                "id": str(mock_user_id),
                "auth_user_id": str(mock_auth_user_id),
                "company_id": str(mock_company_id),
                "email": "brett@drypros.com",
                "name": "Brett Sodders",
                "first_name": "Brett",
                "last_name": "Sodders",
                "phone": None,
                "avatar_url": None,
                "title": None,
                "role": "owner",
                "is_platform_admin": False,
                "last_login_at": None,
                "created_at": "2026-03-25T00:00:00+00:00",
                "updated_at": "2026-03-25T00:00:00+00:00",
            }

            # Mock Supabase auth admin to return the auth user
            mock_auth_user = MagicMock()
            mock_auth_user.email = "brett@drypros.com"
            mock_auth_user.user_metadata = {
                "full_name": "Brett Sodders",
                "avatar_url": None,
            }
            mock_auth_response = MagicMock()
            mock_auth_response.user = mock_auth_user
            mock_client.auth.admin.get_user_by_id.return_value = mock_auth_response

            def table_side_effect(table_name):
                mock_table = MagicMock()
                if table_name == "users":
                    # maybe_single check for existing user -> None (new user)
                    (
                        mock_table.select.return_value.eq.return_value.is_.return_value.maybe_single.return_value.execute.return_value
                    ).data = None
                    # insert new user -> user_data
                    mock_table.insert.return_value.execute.return_value.data = [user_data]
                elif table_name == "companies":
                    mock_table.insert.return_value.execute.return_value.data = [company_data]
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
                    json={"name": "DryPros LLC", "phone": "+15551234567"},
                    headers={"Authorization": f"Bearer {valid_token}"},
                )
                assert response.status_code == 201
                data = response.json()
                assert data["company"]["name"] == "DryPros LLC"
                assert data["user"]["role"] == "owner"
                assert data["user"]["email"] == "brett@drypros.com"

    def test_create_company_missing_name_returns_422(self, client, valid_token, jwt_secret):
        """POST /v1/company without required 'name' field -> 422."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            response = client.post(
                "/v1/company",
                json={},
                headers={"Authorization": f"Bearer {valid_token}"},
            )
            assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /v1/jobs — list jobs for current company
# ---------------------------------------------------------------------------


class TestListJobs:
    """Test GET /v1/jobs endpoint."""

    def test_jobs_list_empty(
        self,
        client,
        valid_token,
        jwt_secret,
        mock_auth_user_id,
        mock_company_id,
        mock_user_id,
    ):
        """GET /v1/jobs returns empty list for new company."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            mock_client = MagicMock()

            user_row = {
                "id": str(mock_user_id),
                "auth_user_id": str(mock_auth_user_id),
                "company_id": str(mock_company_id),
                "email": "brett@drypros.com",
                "name": "Brett Sodders",
                "role": "owner",
                "is_platform_admin": False,
                "deleted_at": None,
            }

            def table_side_effect(table_name):
                mock_table = MagicMock()
                if table_name == "users":
                    # get_auth_context uses .single() (not maybe_single)
                    (
                        mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                    ).data = user_row
                elif table_name == "jobs":
                    (
                        mock_table.select.return_value.eq.return_value.is_.return_value.order.return_value.execute.return_value
                    ).data = []
                return mock_table

            mock_client.table.side_effect = table_side_effect

            with (
                patch(
                    "api.auth.middleware.get_supabase_admin_client",
                    return_value=mock_client,
                ),
                patch(
                    "api.auth.service.get_supabase_admin_client",
                    return_value=mock_client,
                ),
            ):
                response = client.get(
                    "/v1/jobs",
                    headers={"Authorization": f"Bearer {valid_token}"},
                )
                assert response.status_code == 200
                data = response.json()
                assert data["jobs"] == []

    def test_jobs_requires_company(
        self, client, valid_token, jwt_secret, mock_auth_user_id, mock_user_id
    ):
        """GET /v1/jobs with user that has no company -> 401."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            mock_client = MagicMock()

            # User exists but has no company_id
            user_row = {
                "id": str(mock_user_id),
                "auth_user_id": str(mock_auth_user_id),
                "company_id": None,
                "email": "brett@drypros.com",
                "name": "Brett Sodders",
                "role": "owner",
                "is_platform_admin": False,
                "deleted_at": None,
            }

            (
                mock_client.table.return_value.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = user_row

            with patch(
                "api.auth.middleware.get_supabase_admin_client",
                return_value=mock_client,
            ):
                response = client.get(
                    "/v1/jobs",
                    headers={"Authorization": f"Bearer {valid_token}"},
                )
                assert response.status_code == 401
                data = response.json()
                assert data["error_code"] == "AUTH_NO_COMPANY"
