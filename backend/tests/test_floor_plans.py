"""Tests for floor plans endpoints (Spec 03 — Floor Plans).

Covers:
- POST /v1/jobs/{job_id}/floor-plans (create)
- GET /v1/jobs/{job_id}/floor-plans (list)
- PATCH /v1/jobs/{job_id}/floor-plans/{floor_plan_id} (update)
- DELETE /v1/jobs/{job_id}/floor-plans/{floor_plan_id} (delete)
- POST /v1/jobs/{job_id}/floor-plans/{floor_plan_id}/cleanup (sketch cleanup)
- POST /v1/jobs/{job_id}/floor-plans/{floor_plan_id}/ai-cleanup (alias)
- POST /v1/jobs/{job_id}/floor-plans/{floor_plan_id}/edit (AI stub)

Auth: missing token, expired token
Validation: invalid floor_number, duplicate floor_number
Edge cases: not-found, empty update, DB errors, too many walls
"""

from unittest.mock import MagicMock, patch

from tests.conftest import AsyncSupabaseMock
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from api.config import settings
from api.main import app

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

MOCK_NOW = "2026-03-25T12:00:00Z"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def jwt_secret():
    return "test-secret-for-floor-plans"


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
def mock_floor_plan_id():
    return uuid4()


@pytest.fixture
def valid_token(mock_auth_user_id, jwt_secret):
    return jwt.encode(
        {"sub": str(mock_auth_user_id), "aud": "authenticated", "role": "authenticated"},
        jwt_secret,
        algorithm="HS256",
    )


@pytest.fixture
def expired_token(mock_auth_user_id, jwt_secret):
    """Generate an expired JWT."""
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
def auth_headers(valid_token):
    return {"Authorization": f"Bearer {valid_token}"}


@pytest.fixture
def mock_job_row(mock_job_id, mock_company_id):
    return {
        "id": str(mock_job_id),
        "company_id": str(mock_company_id),
        "status": "in_progress",
        "deleted_at": None,
    }


@pytest.fixture
def mock_floor_plan_row(mock_floor_plan_id, mock_job_id, mock_company_id):
    return {
        "id": str(mock_floor_plan_id),
        "job_id": str(mock_job_id),
        "company_id": str(mock_company_id),
        "floor_number": 1,
        "floor_name": "Floor 1",
        "canvas_data": None,
        "thumbnail_url": None,
        "created_at": MOCK_NOW,
        "updated_at": MOCK_NOW,
    }


@pytest.fixture
def mock_user_row(mock_user_id, mock_auth_user_id, mock_company_id):
    return {
        "id": str(mock_user_id),
        "auth_user_id": str(mock_auth_user_id),
        "company_id": str(mock_company_id),
        "role": "owner",
        "is_platform_admin": False,
    }


def _setup_mocks(jwt_secret, mock_user_row, mock_job_row):
    """Return context managers that mock auth + job validation + event logging."""
    mock_admin = AsyncSupabaseMock()
    # Auth context: user lookup
    (
        mock_admin.table.return_value.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
    ).data = mock_user_row

    mock_auth_client = AsyncSupabaseMock()
    # get_valid_job: job lookup
    (
        mock_auth_client.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
    ).data = mock_job_row

    return (
        patch.object(settings, "supabase_jwt_secret", jwt_secret),
        patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_admin),
        patch(
            "api.shared.dependencies.get_authenticated_client",
            return_value=mock_auth_client,
        ),
        patch("api.shared.events.get_supabase_admin_client", return_value=AsyncSupabaseMock()),
    )


# ---------------------------------------------------------------------------
# AUTH — missing token, expired token
# ---------------------------------------------------------------------------


class TestFloorPlanAuth:
    """Test authentication requirements for floor plan endpoints."""

    def test_missing_auth_header(self, client, mock_job_id):
        """Request without Authorization header -> 401."""
        response = client.get(f"/v1/jobs/{mock_job_id}/floor-plans")
        assert response.status_code == 401
        assert response.json()["error_code"] == "AUTH_MISSING_TOKEN"

    def test_expired_token(self, client, mock_job_id, jwt_secret, expired_token):
        """Request with expired JWT -> 401."""
        with patch.object(settings, "supabase_jwt_secret", jwt_secret):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/floor-plans",
                headers={"Authorization": f"Bearer {expired_token}"},
            )
        assert response.status_code == 401
        assert response.json()["error_code"] == "AUTH_TOKEN_EXPIRED"

    def test_invalid_token(self, client, mock_job_id):
        """Request with garbage JWT -> 401."""
        response = client.get(
            f"/v1/jobs/{mock_job_id}/floor-plans",
            headers={"Authorization": "Bearer not-a-valid-jwt"},
        )
        assert response.status_code == 401

    def test_missing_bearer_prefix(self, client, mock_job_id, valid_token):
        """Authorization header without Bearer prefix -> 401."""
        response = client.get(
            f"/v1/jobs/{mock_job_id}/floor-plans",
            headers={"Authorization": valid_token},
        )
        assert response.status_code == 401
        assert response.json()["error_code"] == "AUTH_MISSING_TOKEN"


# ---------------------------------------------------------------------------
# POST /v1/jobs/{job_id}/floor-plans
# ---------------------------------------------------------------------------


class TestCreateFloorPlan:
    """Test POST /v1/jobs/{job_id}/floor-plans."""

    def test_create_floor_plan_success(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_company_id,
        mock_user_row,
        mock_job_row,
        mock_floor_plan_row,
    ):
        """POST with valid data -> 201 with floor plan response."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        # uniqueness check: no existing floor plan
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = []
        # insert
        (mock_service_client.table.return_value.insert.return_value.execute.return_value).data = [
            mock_floor_plan_row
        ]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans",
                json={"floor_number": 1, "floor_name": "Floor 1"},
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["floor_number"] == 1
            assert data["floor_name"] == "Floor 1"
            assert data["id"] == str(mock_floor_plan_row["id"])

    def test_create_floor_plan_with_canvas_data(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
        mock_floor_plan_row,
    ):
        """POST with canvas_data included -> 201."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        canvas = {"walls": [{"x1": 0, "y1": 0, "x2": 100, "y2": 0}], "scale": 24}
        row_with_canvas = {**mock_floor_plan_row, "canvas_data": canvas}

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = []
        (mock_service_client.table.return_value.insert.return_value.execute.return_value).data = [
            row_with_canvas
        ]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans",
                json={"floor_number": 1, "floor_name": "Floor 1", "canvas_data": canvas},
                headers=auth_headers,
            )
            assert response.status_code == 201
            assert response.json()["canvas_data"] == canvas

    def test_create_floor_plan_defaults(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
        mock_floor_plan_row,
    ):
        """POST with empty body uses defaults (floor_number=1, floor_name='Floor 1') -> 201."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = []
        (mock_service_client.table.return_value.insert.return_value.execute.return_value).data = [
            mock_floor_plan_row
        ]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans",
                json={},
                headers=auth_headers,
            )
            assert response.status_code == 201

    def test_create_floor_plan_duplicate_floor_number(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST with duplicate floor_number -> 409 FLOOR_PLAN_EXISTS."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        # uniqueness check: existing floor plan found
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [{"id": str(uuid4())}]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans",
                json={"floor_number": 1, "floor_name": "Floor 1"},
                headers=auth_headers,
            )
            assert response.status_code == 409
            assert response.json()["error_code"] == "FLOOR_PLAN_EXISTS"

    def test_create_floor_plan_job_not_found(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_user_row,
    ):
        """POST with non-existent job -> 404 JOB_NOT_FOUND."""
        mock_admin = AsyncSupabaseMock()
        (
            mock_admin.table.return_value.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
        ).data = mock_user_row

        mock_auth_client = AsyncSupabaseMock()
        # Job not found
        (
            mock_auth_client.table.return_value.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
        ).data = None

        fake_job_id = uuid4()
        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch(
                "api.auth.middleware.get_supabase_admin_client",
                return_value=mock_admin,
            ),
            patch(
                "api.shared.dependencies.get_authenticated_client",
                return_value=mock_auth_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{fake_job_id}/floor-plans",
                json={"floor_number": 1, "floor_name": "Floor 1"},
                headers=auth_headers,
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "JOB_NOT_FOUND"

    def test_create_floor_plan_invalid_floor_number_too_high(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_user_row, mock_job_row
    ):
        """POST with floor_number > 10 -> 422 validation error."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)
        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans",
                json={"floor_number": 11, "floor_name": "Floor 11"},
                headers=auth_headers,
            )
        assert response.status_code == 422

    def test_create_floor_plan_invalid_floor_number_negative(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_user_row, mock_job_row
    ):
        """POST with floor_number < 0 -> 422 validation error."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)
        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans",
                json={"floor_number": -1, "floor_name": "Basement"},
                headers=auth_headers,
            )
        assert response.status_code == 422

    def test_create_floor_plan_floor_name_too_long(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_user_row, mock_job_row
    ):
        """POST with floor_name > 50 chars -> 422 validation error."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)
        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans",
                json={"floor_number": 1, "floor_name": "X" * 51},
                headers=auth_headers,
            )
        assert response.status_code == 422

    def test_create_floor_plan_db_error(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST when DB insert raises APIError -> 500 DB_ERROR."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        # uniqueness check passes
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = []
        # insert raises APIError
        mock_service_client.table.return_value.insert.return_value.execute.side_effect = APIError(
            {"message": "connection failed", "code": "500", "details": ""}
        )

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans",
                json={"floor_number": 1, "floor_name": "Floor 1"},
                headers=auth_headers,
            )
            assert response.status_code == 500
            assert response.json()["error_code"] == "DB_ERROR"


# ---------------------------------------------------------------------------
# GET /v1/jobs/{job_id}/floor-plans
# ---------------------------------------------------------------------------


class TestListFloorPlans:
    """Test GET /v1/jobs/{job_id}/floor-plans."""

    def test_list_floor_plans(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
        mock_floor_plan_row,
    ):
        """GET -> 200 with list of floor plans."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.execute.return_value
        ).data = [mock_floor_plan_row]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/floor-plans",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert "items" in data
            assert "total" in data
            assert len(data["items"]) == 1
            assert data["items"][0]["floor_number"] == 1

    def test_list_floor_plans_empty(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """GET on job with no floor plans -> 200 with empty list."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.execute.return_value
        ).data = []

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/floor-plans",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["items"] == []
            assert data["total"] == 0

    def test_list_floor_plans_multiple(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_company_id,
        mock_user_row,
        mock_job_row,
    ):
        """GET with multiple floor plans -> 200 with ordered list."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        rows = [
            {
                "id": str(uuid4()),
                "job_id": str(mock_job_id),
                "company_id": str(mock_company_id),
                "floor_number": i,
                "floor_name": f"Floor {i}",
                "canvas_data": None,
                "thumbnail_url": None,
                "created_at": MOCK_NOW,
                "updated_at": MOCK_NOW,
            }
            for i in range(3)
        ]

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.execute.return_value
        ).data = rows

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/floor-plans",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert len(data["items"]) == 3
            assert data["total"] == 3
            assert data["items"][0]["floor_number"] == 0
            assert data["items"][2]["floor_number"] == 2


# ---------------------------------------------------------------------------
# PATCH /v1/jobs/{job_id}/floor-plans/{floor_plan_id}
# ---------------------------------------------------------------------------


class TestUpdateFloorPlan:
    """Test PATCH /v1/jobs/{job_id}/floor-plans/{floor_plan_id}."""

    def test_update_floor_plan_canvas_data(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
        mock_floor_plan_row,
    ):
        """PATCH with canvas_data -> 200 with updated floor plan."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        canvas = {"walls": [{"x": 0, "y": 0}], "version": 1}
        updated_row = {**mock_floor_plan_row, "canvas_data": canvas}

        mock_service_client = AsyncSupabaseMock()
        # existing lookup
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_floor_plan_row
        # update
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [updated_row]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}",
                json={"canvas_data": canvas},
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["canvas_data"] == canvas

    def test_update_floor_plan_name(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
        mock_floor_plan_row,
    ):
        """PATCH with floor_name -> 200."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        updated_row = {**mock_floor_plan_row, "floor_name": "Main Floor"}

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_floor_plan_row
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [updated_row]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}",
                json={"floor_name": "Main Floor"},
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["floor_name"] == "Main Floor"

    def test_update_floor_plan_empty_body(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
        mock_floor_plan_row,
    ):
        """PATCH with empty body -> 200 returns existing data unchanged."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_floor_plan_row

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}",
                json={},
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["id"] == str(mock_floor_plan_id)

    def test_update_floor_plan_not_found(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
    ):
        """PATCH on non-existent floor plan -> 404."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        # existing lookup returns nothing
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = None

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}",
                json={"floor_name": "Updated"},
                headers=auth_headers,
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "FLOOR_PLAN_NOT_FOUND"

    def test_update_floor_number_duplicate(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
        mock_floor_plan_row,
    ):
        """PATCH changing floor_number to existing value -> 409."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()

        # We need table() to return different mocks for different calls.
        # Call sequence: select (existing lookup) -> select (dup check)
        # Since both use table("floor_plans"), we need call-count tracking.
        call_count = {"select": 0}

        def table_side_effect(table_name):
            mock_table = AsyncSupabaseMock()
            if table_name == "floor_plans":
                call_count["select"] += 1
                if call_count["select"] == 1:
                    # First call: existing lookup (select -> eq -> eq -> eq -> single -> execute)
                    (
                        mock_table.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
                    ).data = mock_floor_plan_row
                else:
                    # Second call: dup check (select -> eq -> eq -> neq -> execute)
                    (
                        mock_table.select.return_value.eq.return_value.eq.return_value.neq.return_value.execute.return_value
                    ).data = [{"id": str(uuid4())}]  # duplicate found
            return mock_table

        mock_service_client.table.side_effect = table_side_effect

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}",
                json={"floor_number": 2},
                headers=auth_headers,
            )
            assert response.status_code == 409
            assert response.json()["error_code"] == "FLOOR_PLAN_EXISTS"

    def test_update_floor_number_same_value_skips_dup_check(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
        mock_floor_plan_row,
    ):
        """PATCH with same floor_number as existing skips uniqueness check -> 200."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        # existing lookup returns floor_number=1
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_floor_plan_row
        # update succeeds
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [mock_floor_plan_row]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}",
                json={"floor_number": 1},  # same as existing
                headers=auth_headers,
            )
            assert response.status_code == 200

    def test_update_floor_plan_db_error(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
        mock_floor_plan_row,
    ):
        """PATCH when DB update raises APIError -> 500 DB_ERROR."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_floor_plan_row
        # update raises APIError
        mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.side_effect = APIError(
            {"message": "trigger error", "code": "500", "details": "record new has no field deleted_at"}
        )

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}",
                json={"floor_name": "Updated"},
                headers=auth_headers,
            )
            assert response.status_code == 500
            assert response.json()["error_code"] == "DB_ERROR"

    def test_update_floor_plan_thumbnail_url(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
        mock_floor_plan_row,
    ):
        """PATCH with thumbnail_url -> 200."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        updated_row = {**mock_floor_plan_row, "thumbnail_url": "https://example.com/thumb.png"}

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_floor_plan_row
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [updated_row]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}",
                json={"thumbnail_url": "https://example.com/thumb.png"},
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["thumbnail_url"] == "https://example.com/thumb.png"

    def test_update_floor_plan_invalid_floor_number(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_floor_plan_id, mock_user_row, mock_job_row
    ):
        """PATCH with floor_number > 10 -> 422."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)
        with patches[0], patches[1], patches[2], patches[3]:
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}",
                json={"floor_number": 99},
                headers=auth_headers,
            )
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# DELETE /v1/jobs/{job_id}/floor-plans/{floor_plan_id}
# ---------------------------------------------------------------------------


class TestDeleteFloorPlan:
    """Test DELETE /v1/jobs/{job_id}/floor-plans/{floor_plan_id}."""

    def test_delete_floor_plan(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
        mock_floor_plan_row,
    ):
        """DELETE existing floor plan -> 204."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        # existing lookup
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = {"id": str(mock_floor_plan_id)}
        # unlink rooms + delete return mock results
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.execute.return_value
        ).data = []
        (
            mock_service_client.table.return_value.delete.return_value.eq.return_value.execute.return_value
        ).data = []

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}",
                headers=auth_headers,
            )
            assert response.status_code == 204

    def test_delete_floor_plan_not_found(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
    ):
        """DELETE non-existent floor plan -> 404."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = None

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}",
                headers=auth_headers,
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "FLOOR_PLAN_NOT_FOUND"

    def test_delete_is_hard_delete(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
    ):
        """DELETE uses hard delete (not soft delete) — verify .delete() is called, not .update()."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()

        call_log = []

        def table_side_effect(table_name):
            mock_table = AsyncSupabaseMock()
            if table_name == "floor_plans":
                call_log.append(("floor_plans", "access"))
                # existing lookup
                (
                    mock_table.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
                ).data = {"id": str(mock_floor_plan_id)}
                # delete chain
                mock_table.delete.return_value.eq.return_value.execute.return_value.data = []

                # Track delete call
                original_delete = mock_table.delete

                def track_delete():
                    call_log.append(("floor_plans", "delete"))
                    return original_delete()

                mock_table.delete = track_delete
            elif table_name == "job_rooms":
                # unlink rooms
                mock_table.update.return_value.eq.return_value.execute.return_value.data = []
            return mock_table

        mock_service_client.table.side_effect = table_side_effect

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}",
                headers=auth_headers,
            )
            assert response.status_code == 204
            # Verify hard delete was called
            assert ("floor_plans", "delete") in call_log


# ---------------------------------------------------------------------------
# POST /v1/jobs/{job_id}/floor-plans/{floor_plan_id}/cleanup
# ---------------------------------------------------------------------------


class TestSketchCleanup:
    """Test POST .../cleanup — deterministic sketch cleanup (no AI)."""

    def test_cleanup_straightens_and_detects_rooms(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
    ):
        """Cleanup straightens walls, detects rooms, returns event_id -> 200."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        # A slightly wobbly rectangle that should be straightened
        canvas = {
            "walls": [
                {"id": "w1", "x1": 0, "y1": 2, "x2": 240, "y2": 3},
                {"id": "w2", "x1": 239, "y1": 2, "x2": 241, "y2": 240},
                {"id": "w3", "x1": 241, "y1": 239, "x2": 1, "y2": 241},
                {"id": "w4", "x1": 1, "y1": 240, "x2": 0, "y2": 3},
            ],
            "scale": 24,
            "offset": {"x": 0, "y": 0},
        }

        mock_service_client = AsyncSupabaseMock()
        # Floor plan fetch returns canvas_data
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = {
            "id": str(mock_floor_plan_id),
            "canvas_data": canvas,
        }
        # Update after cleanup
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [{"id": str(mock_floor_plan_id)}]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}/cleanup",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert "canvas_data" in data
            assert "changes_made" in data
            assert "event_id" in data
            result = data["canvas_data"]
            assert "walls" in result
            assert len(result["walls"]) == 4
            assert "rooms" in result
            assert len(result["rooms"]) >= 1
            room = result["rooms"][0]
            assert "area_sqft" in room
            assert room["area_sqft"] > 0

    def test_cleanup_with_client_canvas_data(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
    ):
        """Cleanup with client-supplied canvas_data uses that instead of saved data -> 200."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        client_canvas = {
            "walls": [
                {"id": "w1", "x1": 0, "y1": 1, "x2": 240, "y2": 2},
                {"id": "w2", "x1": 239, "y1": 1, "x2": 241, "y2": 240},
                {"id": "w3", "x1": 241, "y1": 239, "x2": 1, "y2": 241},
                {"id": "w4", "x1": 1, "y1": 240, "x2": 0, "y2": 2},
            ],
            "scale": 24,
        }

        mock_service_client = AsyncSupabaseMock()
        # Floor plan exists but has NO saved canvas_data
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = {
            "id": str(mock_floor_plan_id),
            "canvas_data": None,
        }
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [{"id": str(mock_floor_plan_id)}]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}/cleanup",
                json={"canvas_data": client_canvas},
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert len(data["canvas_data"]["walls"]) == 4

    def test_cleanup_no_sketch_data(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
    ):
        """Cleanup with no canvas_data (neither client nor saved) -> 400."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = {
            "id": str(mock_floor_plan_id),
            "canvas_data": None,
        }

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}/cleanup",
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "NO_SKETCH_DATA"

    def test_cleanup_floor_plan_not_found(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
    ):
        """Cleanup on non-existent floor plan -> 404."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = None

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}/cleanup",
                headers=auth_headers,
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "FLOOR_PLAN_NOT_FOUND"

    def test_cleanup_empty_walls(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
    ):
        """Cleanup with empty walls list -> 400 NO_SKETCH_DATA."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = {
            "id": str(mock_floor_plan_id),
            "canvas_data": {"walls": [], "scale": 24},
        }

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}/cleanup",
                headers=auth_headers,
            )
            assert response.status_code == 400

    def test_ai_cleanup_alias_works(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST .../ai-cleanup (alias) works the same as /cleanup -> 200."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        canvas = {
            "walls": [
                {"id": "w1", "x1": 0, "y1": 0, "x2": 240, "y2": 0},
                {"id": "w2", "x1": 240, "y1": 0, "x2": 240, "y2": 240},
                {"id": "w3", "x1": 240, "y1": 240, "x2": 0, "y2": 240},
                {"id": "w4", "x1": 0, "y1": 240, "x2": 0, "y2": 0},
            ],
            "scale": 24,
        }

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = {
            "id": str(mock_floor_plan_id),
            "canvas_data": canvas,
        }
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [{"id": str(mock_floor_plan_id)}]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.floor_plans.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}/ai-cleanup",
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert "canvas_data" in response.json()


# ---------------------------------------------------------------------------
# POST /v1/jobs/{job_id}/floor-plans/{floor_plan_id}/edit
# ---------------------------------------------------------------------------


class TestSketchEdit:
    """Test POST .../edit — AI sketch edit (stub until Spec 02)."""

    def test_edit_stub_returns_current_canvas(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
    ):
        """Edit stub returns current canvas_data + event_id -> 200."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        canvas = {"walls": [{"id": "w1", "x1": 0, "y1": 0, "x2": 100, "y2": 0}]}

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = {
            "id": str(mock_floor_plan_id),
            "canvas_data": canvas,
        }

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.shared.database.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}/edit",
                json={"instruction": "Add a door on the left wall"},
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["canvas_data"] == canvas
            assert "changes_made" in data
            assert "event_id" in data
            assert data["cost_cents"] == 0
            assert data["duration_ms"] == 0

    def test_edit_floor_plan_not_found(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
    ):
        """Edit on non-existent floor plan -> 404."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = None

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.shared.database.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}/edit",
                json={"instruction": "Add a window"},
                headers=auth_headers,
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "FLOOR_PLAN_NOT_FOUND"

    def test_edit_missing_instruction(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_floor_plan_id, mock_user_row, mock_job_row
    ):
        """Edit without instruction field -> 422."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)
        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}/edit",
                json={},
                headers=auth_headers,
            )
        assert response.status_code == 422

    def test_edit_empty_instruction(
        self, client, auth_headers, jwt_secret, mock_job_id, mock_floor_plan_id, mock_user_row, mock_job_row
    ):
        """Edit with empty instruction string -> 422 (min_length=1)."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)
        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}/edit",
                json={"instruction": ""},
                headers=auth_headers,
            )
        assert response.status_code == 422

    def test_edit_no_canvas_data_returns_empty_dict(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
    ):
        """Edit on floor plan with no canvas_data returns empty dict -> 200."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = {
            "id": str(mock_floor_plan_id),
            "canvas_data": None,
        }

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.shared.database.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/floor-plans/{mock_floor_plan_id}/edit",
                json={"instruction": "Add a wall"},
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["canvas_data"] == {}


# ---------------------------------------------------------------------------
# Unit tests for cleanup_sketch() internal logic
# ---------------------------------------------------------------------------


class TestCleanupSketchUnit:
    """Unit tests for the cleanup_sketch function directly."""

    def test_empty_walls_returns_unchanged(self):
        """cleanup_sketch with no walls returns canvas_data unchanged."""
        from api.floor_plans.service import cleanup_sketch

        canvas = {"walls": [], "scale": 24}
        result = cleanup_sketch(canvas)
        assert result == canvas

    def test_invalid_walls_are_filtered(self):
        """cleanup_sketch filters out walls missing required keys."""
        from api.floor_plans.service import cleanup_sketch

        canvas = {
            "walls": [
                {"x1": 0, "y1": 0, "x2": 240, "y2": 0},  # valid
                {"x1": 0, "y1": 0},  # missing x2, y2
                "not a dict",  # not a dict
                {"x1": 0, "y1": 0, "x2": "bad", "y2": 0},  # non-numeric
            ],
            "scale": 24,
        }
        result = cleanup_sketch(canvas)
        # Only the first valid wall should remain
        assert len(result["walls"]) == 1

    def test_too_many_walls_raises(self):
        """cleanup_sketch raises AppException for > 500 walls."""
        from api.floor_plans.service import cleanup_sketch
        from api.shared.exceptions import AppException

        canvas = {
            "walls": [{"x1": i, "y1": 0, "x2": i + 10, "y2": 0} for i in range(501)],
            "scale": 24,
        }
        with pytest.raises(AppException) as exc_info:
            cleanup_sketch(canvas)
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "TOO_MANY_WALLS"

    def test_straightening_near_horizontal(self):
        """Near-horizontal walls are straightened (small y difference)."""
        from api.floor_plans.service import cleanup_sketch

        canvas = {
            "walls": [
                {"x1": 0, "y1": 2, "x2": 240, "y2": 3},  # nearly horizontal
            ],
            "scale": 24,
        }
        result = cleanup_sketch(canvas)
        wall = result["walls"][0]
        # After straightening, y1 should equal y2
        assert wall["y1"] == wall["y2"]

    def test_straightening_near_vertical(self):
        """Near-vertical walls are straightened (small x difference)."""
        from api.floor_plans.service import cleanup_sketch

        canvas = {
            "walls": [
                {"x1": 2, "y1": 0, "x2": 3, "y2": 240},  # nearly vertical
            ],
            "scale": 24,
        }
        result = cleanup_sketch(canvas)
        wall = result["walls"][0]
        # After straightening, x1 should equal x2
        assert wall["x1"] == wall["x2"]

    def test_room_detection_rectangle(self):
        """A proper rectangle should detect exactly one room."""
        from api.floor_plans.service import cleanup_sketch

        # Perfect rectangle, already axis-aligned
        canvas = {
            "walls": [
                {"x1": 0, "y1": 0, "x2": 240, "y2": 0},
                {"x1": 240, "y1": 0, "x2": 240, "y2": 240},
                {"x1": 240, "y1": 240, "x2": 0, "y2": 240},
                {"x1": 0, "y1": 240, "x2": 0, "y2": 0},
            ],
            "scale": 24,
        }
        result = cleanup_sketch(canvas)
        rooms = result.get("rooms", [])
        assert len(rooms) >= 1
        # Room area should be approximately 100 sqft (10ft x 10ft)
        assert rooms[0]["area_sqft"] > 0

    def test_default_scale(self):
        """cleanup_sketch uses scale=24 as default if not specified."""
        from api.floor_plans.service import cleanup_sketch

        canvas = {
            "walls": [
                {"x1": 0, "y1": 0, "x2": 240, "y2": 0},
            ],
        }
        result = cleanup_sketch(canvas)
        assert result["scale"] == 24

    def test_offset_preserved(self):
        """cleanup_sketch preserves the offset from input."""
        from api.floor_plans.service import cleanup_sketch

        canvas = {
            "walls": [
                {"x1": 0, "y1": 0, "x2": 240, "y2": 0},
            ],
            "scale": 24,
            "offset": {"x": 100, "y": 200},
        }
        result = cleanup_sketch(canvas)
        assert result["offset"] == {"x": 100, "y": 200}

    def test_zero_length_wall_preserved_in_cleanup(self):
        """A zero-length wall (x1==x2, y1==y2) is kept through cleanup."""
        from api.floor_plans.service import cleanup_sketch

        canvas = {
            "walls": [
                {"x1": 0, "y1": 0, "x2": 0, "y2": 0},
            ],
            "scale": 24,
        }
        result = cleanup_sketch(canvas)
        # Zero-length wall should still be in the list (standardize keeps it)
        assert len(result["walls"]) == 1


# ---------------------------------------------------------------------------
# C2: _create_version concurrent-edit handling
# ---------------------------------------------------------------------------


class TestCreateVersionConcurrentEdit:
    """_create_version must surface unique-violation (Postgres 23505) as
    409 CONCURRENT_EDIT so the retry in save_canvas can fork cleanly.

    After C4, _create_version delegates to the `save_floor_plan_version`
    RPC which does flip + insert + pin atomically. The 23505 path now
    originates from the RPC's INSERT (same partial unique indexes) — we
    still convert it to 409 at the service layer.
    """

    @pytest.mark.asyncio
    async def test_rpc_unique_violation_raises_409_concurrent_edit(self):
        from api.floor_plans.service import _create_version
        from api.shared.exceptions import AppException

        client = AsyncSupabaseMock()
        # The RPC raises 23505 when the partial unique index fires.
        client.rpc.return_value.execute.side_effect = APIError(
            {"message": "duplicate key value violates unique constraint", "code": "23505", "details": ""}
        )

        with pytest.raises(AppException) as exc_info:
            await _create_version(
                client=client,
                property_id=uuid4(),
                floor_number=1,
                floor_name="Floor 1",
                company_id=uuid4(),
                job_id=uuid4(),
                user_id=uuid4(),
                canvas_data={"walls": []},
                change_summary="test",
            )
        assert exc_info.value.status_code == 409
        assert exc_info.value.error_code == "CONCURRENT_EDIT"

    @pytest.mark.asyncio
    async def test_rpc_non_unique_apierror_raises_500_db_error(self):
        """Sanity: other APIError codes from the RPC (connection failures,
        permission errors, etc.) still surface as 500 DB_ERROR — we only
        special-case 23505."""
        from api.floor_plans.service import _create_version
        from api.shared.exceptions import AppException

        client = AsyncSupabaseMock()
        client.rpc.return_value.execute.side_effect = APIError(
            {"message": "connection refused", "code": "08006", "details": ""}
        )

        with pytest.raises(AppException) as exc_info:
            await _create_version(
                client=client,
                property_id=uuid4(),
                floor_number=1,
                floor_name="Floor 1",
                company_id=uuid4(),
                job_id=uuid4(),
                user_id=uuid4(),
                canvas_data={"walls": []},
                change_summary="test",
            )
        assert exc_info.value.status_code == 500
        assert exc_info.value.error_code == "DB_ERROR"


# ---------------------------------------------------------------------------
# R3 (round 2): save_floor_plan_version RPC tenant hardening
# ---------------------------------------------------------------------------


class TestCreateVersionRPCTenantHardening:
    """The hardened RPC (migration ``c7f8a9b0d1e2``) derives the caller's
    company from the JWT via ``get_my_company_id()`` and rejects any call
    where the JWT-resolved company doesn't match ``p_company_id`` (42501)
    or where the property/job ownership chain is broken (P0002). The
    service layer must translate these into meaningful HTTP responses
    rather than a bare 500 DB_ERROR.
    """

    @pytest.mark.asyncio
    async def test_rpc_42501_maps_to_403_company_mismatch(self):
        """Caller passed a ``p_company_id`` that doesn't match the JWT's
        resolved company. RPC raises 42501; service translates to 403
        COMPANY_MISMATCH so the client sees an unambiguous auth error."""
        from api.floor_plans.service import _create_version
        from api.shared.exceptions import AppException

        client = AsyncSupabaseMock()
        client.rpc.return_value.execute.side_effect = APIError(
            {
                "message": "p_company_id does not match the authenticated caller company",
                "code": "42501",
                "details": "",
            }
        )

        with pytest.raises(AppException) as exc_info:
            await _create_version(
                client=client,
                property_id=uuid4(),
                floor_number=1,
                floor_name="Floor 1",
                company_id=uuid4(),
                job_id=uuid4(),
                user_id=uuid4(),
                canvas_data={"walls": []},
                change_summary="test",
            )
        assert exc_info.value.status_code == 403
        assert exc_info.value.error_code == "COMPANY_MISMATCH"

    @pytest.mark.asyncio
    async def test_rpc_p0002_maps_to_400_property_mismatch(self):
        """RPC's property-or-job ownership check failed (property not in
        caller's company, or job not on the named property). Service maps
        the P0002 to 400 PROPERTY_MISMATCH — we avoid a 404 to prevent
        tenant-existence leaks."""
        from api.floor_plans.service import _create_version
        from api.shared.exceptions import AppException

        client = AsyncSupabaseMock()
        client.rpc.return_value.execute.side_effect = APIError(
            {
                "message": "Job not found or does not belong to this property",
                "code": "P0002",
                "details": "",
            }
        )

        with pytest.raises(AppException) as exc_info:
            await _create_version(
                client=client,
                property_id=uuid4(),
                floor_number=1,
                floor_name="Floor 1",
                company_id=uuid4(),
                job_id=uuid4(),
                user_id=uuid4(),
                canvas_data={"walls": []},
                change_summary="test",
            )
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "PROPERTY_MISMATCH"

    def test_migration_hardens_tenant_checks(self):
        """Static migration-file guardrail. The ``c7f8a9b0d1e2`` migration
        MUST derive the company from the JWT (``get_my_company_id()``),
        MUST verify property ownership, MUST verify the job lives on the
        named property, and MUST lock ``search_path`` — or a future editor
        could silently re-open the R3 hole.
        """
        from pathlib import Path

        migration = (
            Path(__file__).resolve().parents[1]
            / "alembic"
            / "versions"
            / "c7f8a9b0d1e2_spec01h_rpc_tenant_hardening.py"
        )
        assert migration.exists(), f"R3 migration missing at {migration}"
        text = migration.read_text(encoding="utf-8")

        required = {
            "jwt-derived company": "get_my_company_id()",
            "42501 on company mismatch": "'42501'",
            "property ownership check": "FROM properties",
            "property company filter":
                "company_id = v_caller_company",
            "job-on-property check":
                "AND property_id = p_property_id",
            "search_path pinned":
                "SET search_path",
        }
        missing = [label for label, needle in required.items() if needle not in text]
        assert not missing, (
            "R3 migration is missing required tenant hardening elements: "
            + ", ".join(missing)
        )


# ---------------------------------------------------------------------------
# C4: atomic RPC for flip + insert + pin
# ---------------------------------------------------------------------------


class TestCreateVersionRPCAtomicity:
    """_create_version delegates to save_floor_plan_version RPC so flip +
    insert + pin run as one transaction. Previously these were three
    separate client calls — a failure between insert and pin left the job
    pinned to the frozen old row, causing the next save to fork another
    version and orphan the one just created.
    """

    @pytest.mark.asyncio
    async def test_rpc_success_returns_new_row(self):
        """Happy path: RPC returns the new version row; _create_version
        returns it unchanged. Validates the call shape and return unwrap."""
        from api.floor_plans.service import _create_version

        client = AsyncSupabaseMock()
        new_row = {
            "id": str(uuid4()),
            "property_id": str(uuid4()),
            "floor_number": 1,
            "floor_name": "Floor 1",
            "version_number": 2,
            "canvas_data": {"walls": []},
            "is_current": True,
        }
        # supabase-py returns JSONB scalar directly as dict
        client.rpc.return_value.execute.return_value.data = new_row

        result = await _create_version(
            client=client,
            property_id=uuid4(),
            floor_number=1,
            floor_name="Floor 1",
            company_id=uuid4(),
            job_id=uuid4(),
            user_id=uuid4(),
            canvas_data={"walls": []},
            change_summary="test",
        )
        assert result == new_row
        # RPC was called once with the known function name
        client.rpc.assert_called_once()
        called_args = client.rpc.call_args
        assert called_args[0][0] == "save_floor_plan_version"
        # All 8 params present
        params = called_args[0][1]
        assert set(params.keys()) == {
            "p_property_id", "p_floor_number", "p_floor_name",
            "p_company_id", "p_job_id", "p_user_id",
            "p_canvas_data", "p_change_summary",
        }

    @pytest.mark.asyncio
    async def test_rpc_list_wrapped_response_unwrapped(self):
        """Some supabase-py versions wrap scalar JSONB in a list; the
        service must normalize."""
        from api.floor_plans.service import _create_version

        client = AsyncSupabaseMock()
        new_row = {"id": str(uuid4()), "version_number": 1}
        client.rpc.return_value.execute.return_value.data = [new_row]

        result = await _create_version(
            client=client,
            property_id=uuid4(),
            floor_number=1,
            floor_name=None,
            company_id=uuid4(),
            job_id=uuid4(),
            user_id=uuid4(),
            canvas_data={"walls": []},
            change_summary="",
        )
        assert result == new_row

    @pytest.mark.asyncio
    async def test_rpc_empty_response_raises_500(self):
        """RPC returning null/empty means the function failed silently —
        surface as 500 rather than return None and confuse callers."""
        from api.floor_plans.service import _create_version
        from api.shared.exceptions import AppException

        client = AsyncSupabaseMock()
        client.rpc.return_value.execute.return_value.data = None

        with pytest.raises(AppException) as exc_info:
            await _create_version(
                client=client,
                property_id=uuid4(),
                floor_number=1,
                floor_name=None,
                company_id=uuid4(),
                job_id=uuid4(),
                user_id=uuid4(),
                canvas_data={"walls": []},
                change_summary="",
            )
        assert exc_info.value.status_code == 500
        assert exc_info.value.error_code == "DB_ERROR"


# ---------------------------------------------------------------------------
# C3: Case 2 is_current TOCTOU — UPDATE filters on is_current, falls through
# ---------------------------------------------------------------------------


class TestCase2IsCurrentTOCTOU:
    """Case 2's `pinned_still_current` check reads is_current in memory,
    then UPDATEs the row — between those two steps a sibling job's Case 3
    fork can flip is_current=false. The fix: filter the UPDATE on
    .eq("is_current", True). If Postgres matches zero rows, fall through
    to Case 3 (fork a new version) instead of silently writing to what
    is now frozen history.
    """

    @pytest.mark.asyncio
    async def test_case2_update_matches_zero_rows_falls_through_to_case3(self):
        """UPDATE matches 0 rows (row was frozen mid-flight) → Case 3 fork runs.

        save_canvas runs several queries in sequence. We intercept them with a
        fake supabase client that returns scripted responses per query shape,
        plus a no-op UPDATE that simulates the `.eq("is_current", True)` filter
        matching zero rows (TOCTOU race — is_current flipped between read and
        write). The assertion is that _create_version was invoked, proving the
        fallthrough happened.
        """
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service

        job_id = uuid4()
        company_id = uuid4()
        user_id = uuid4()
        floor_plan_id = uuid4()
        property_id = uuid4()
        pinned_version_id = str(uuid4())

        def _result(data):
            r = MagicMock()
            r.data = data
            return r

        anchor_row = {
            "id": str(floor_plan_id),
            "property_id": str(property_id),
            "floor_number": 1,
        }
        job_row = {
            "id": str(job_id),
            "floor_plan_id": pinned_version_id,
            "status": "mitigation",
            # R8 tightened save_canvas to reject NULL property_id with
            # JOB_NO_PROPERTY; this test needs the property to match the
            # anchor so the check passes and the TOCTOU fallthrough is
            # actually exercised.
            "property_id": str(property_id),
        }
        pinned_row = {
            "id": pinned_version_id,
            "property_id": str(property_id),
            "floor_number": 1,
            "version_number": 1,
            "is_current": True,
            "created_by_job_id": str(job_id),
            "change_summary": None,
        }

        # Chainable query builder that decides its response from the table +
        # applied filters. Same instance returned by every chain method so
        # we can inspect what was asked of us.
        class QB:
            def __init__(self, table_name: str):
                self.table_name = table_name
                self.filters: dict[str, object] = {}
                self.update_args: dict | None = None

            # select / single / order / limit / insert are all no-ops that
            # return self, keeping the chain going.
            def select(self, *args, **kwargs): return self
            def single(self): return self
            def order(self, *args, **kwargs): return self
            def limit(self, *args, **kwargs): return self
            def is_(self, col, val): self.filters[col] = val; return self
            def eq(self, col, val): self.filters[col] = val; return self

            def update(self, row): self.update_args = row; return self
            def insert(self, row): return self

            async def execute(self):
                if self.table_name == "jobs":
                    return _result(job_row)
                if self.table_name == "floor_plans":
                    # UPDATE call — simulate zero rows matched because the
                    # is_current=True filter failed (TOCTOU).
                    if self.update_args is not None:
                        return _result([])
                    # SELECT — two shapes: the target-floor lookup and the
                    # pinned-version lookup. Distinguish by which id filter
                    # was passed.
                    wanted_id = self.filters.get("id")
                    if wanted_id == str(floor_plan_id):
                        return _result(anchor_row)
                    if wanted_id == pinned_version_id:
                        return _result(pinned_row)
                return _result(None)

        class FakeClient:
            def table(self, name): return QB(name)

        fake_client = FakeClient()

        forked_row = {
            "id": str(uuid4()),
            "version_number": 2,
            "is_current": True,
        }
        mock_create_version = AsyncMock(return_value=forked_row)

        # After C4, _create_version delegates to the save_floor_plan_version
        # RPC which does flip + insert + pin atomically — no separate pin
        # function to patch.
        with (
            patch.object(fp_service, "_create_version", mock_create_version),
            patch.object(
                fp_service, "get_authenticated_client",
                AsyncMock(return_value=fake_client),
            ),
            patch.object(fp_service, "log_event", AsyncMock(return_value=None)),
        ):
            result = await fp_service.save_canvas(
                token="test-token",
                floor_plan_id=floor_plan_id,
                job_id=job_id,
                company_id=company_id,
                user_id=user_id,
                canvas_data={"walls": []},
                change_summary="test",
            )

        # Fall-through happened: _create_version was invoked (Case 3)
        mock_create_version.assert_awaited_once()
        # Returned row is the forked one, not a stale Case 2 update target
        assert result == forked_row


# ---------------------------------------------------------------------------
# C6: linked recon rooms no longer inherit mitigation's floor_plan_id
# ---------------------------------------------------------------------------


class TestCopyRoomsFromLinkedJob:
    """_copy_rooms_from_linked_job::COPY_FIELDS must NOT include
    "floor_plan_id". Post-container/versions merge, that id points at a
    specific version row; if copied, recon's rooms would reference
    mitigation's frozen v1 while recon's own job pin moves to v2 — the
    ROOM ↔ FLOOR-PLAN linkage desyncs from the JOB ↔ FLOOR-PLAN pin
    forever. Fix: strip the field so recon's rooms start NULL and relink
    through the normal save flow.
    """

    def test_copy_fields_excludes_floor_plan_id(self):
        """Static guardrail: inspect the function source and confirm
        'floor_plan_id' is absent from the COPY_FIELDS list. This also
        fires if a future edit accidentally re-includes it."""
        import inspect
        import re

        from api.jobs.service import _copy_rooms_from_linked_job

        src = inspect.getsource(_copy_rooms_from_linked_job)
        # Match the `COPY_FIELDS = [ ... ]` list literal body only
        m = re.search(r"COPY_FIELDS\s*=\s*\[(.*?)\]", src, re.DOTALL)
        assert m, "COPY_FIELDS list not found in _copy_rooms_from_linked_job"
        fields_block = m.group(1)
        assert "floor_plan_id" not in fields_block, (
            "COPY_FIELDS must not include 'floor_plan_id' — recon rooms would "
            "inherit mitigation's version pin and desync on first save"
        )

    @pytest.mark.asyncio
    async def test_copied_rows_have_no_floor_plan_id_key(self):
        """Behavioral check: the rows inserted into job_rooms for the new
        recon job do not carry a floor_plan_id field (comes through as
        not-present, which Postgres treats as NULL via default)."""
        from unittest.mock import AsyncMock, MagicMock

        from api.jobs.service import _copy_rooms_from_linked_job

        source_rooms = [
            {
                "room_name": "Kitchen",
                "length_ft": 12,
                "width_ft": 10,
                "height_ft": 8,
                "square_footage": 120,
                "room_type": "kitchen",
                "ceiling_type": "flat",
                "floor_level": "main",
                "room_polygon": None,
                "floor_openings": None,
                "custom_wall_sf": None,
                "sort_order": 0,
            },
        ]

        # Fake supabase client: fetch returns source rooms, insert captures
        # the rows we were about to write.
        inserted_rows: list = []

        class QB:
            def __init__(self):
                self._mode = None

            def select(self, *args, **kwargs): return self
            def eq(self, *args, **kwargs): return self

            def insert(self, rows):
                inserted_rows.extend(rows)
                self._mode = "insert"
                return self

            async def execute(self):
                result = MagicMock()
                if self._mode == "insert":
                    result.data = inserted_rows
                else:
                    result.data = source_rooms
                return result

        class FakeClient:
            def table(self, name): return QB()

        count = await _copy_rooms_from_linked_job(
            client=FakeClient(),
            source_job_id=uuid4(),
            new_job_id=uuid4(),
            company_id=uuid4(),
        )
        assert count == 1
        assert inserted_rows, "no rows were inserted"
        for row in inserted_rows:
            assert "floor_plan_id" not in row, (
                f"copied row unexpectedly carries floor_plan_id: {row!r}"
            )


# ---------------------------------------------------------------------------
# P2.1: cleanup_floor_plan requires job_id — archive guard has no bypass
# ---------------------------------------------------------------------------


class TestSketchCleanupRequiresJobId:
    """SketchCleanupRequest.job_id is required (not Optional) so the archive
    gate always runs on cleanup. This closes the partial C1 bypass where a
    request without job_id would skip ensure_job_mutable and rely only on
    the is_current guard — leaving a collected job's current version open
    to mutation."""

    def test_schema_requires_job_id(self):
        """Pydantic rejects a cleanup request without job_id."""
        from pydantic import ValidationError

        from api.floor_plans.schemas import SketchCleanupRequest

        with pytest.raises(ValidationError) as exc_info:
            SketchCleanupRequest(canvas_data={"walls": []})
        errs = exc_info.value.errors()
        assert any(e.get("loc") == ("job_id",) and e.get("type") == "missing" for e in errs), (
            f"expected a 'missing' error on job_id; got {errs}"
        )

    def test_schema_accepts_valid_request(self):
        from api.floor_plans.schemas import SketchCleanupRequest

        req = SketchCleanupRequest(job_id=uuid4(), canvas_data={"walls": []})
        assert req.job_id is not None
        assert req.canvas_data == {"walls": []}


# ---------------------------------------------------------------------------
# W1: save_canvas rejects floor_plan_id from a foreign property
# ---------------------------------------------------------------------------


class TestSaveCanvasPropertyMismatch:
    """save_canvas must reject a save when the target floor_plan_id resolves
    to a property that isn't the job's own property. Same-company but wrong-
    property requests would otherwise pin a job to a floor plan it doesn't
    own, breaking the "a job's floor plan lives on its property" invariant.
    """

    @pytest.mark.asyncio
    async def test_rejects_floor_plan_from_foreign_property(self):
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.shared.exceptions import AppException

        job_id = uuid4()
        company_id = uuid4()
        user_id = uuid4()
        foreign_floor_plan_id = uuid4()
        job_property_id = uuid4()
        foreign_property_id = uuid4()  # belongs to a different property

        def _result(data):
            r = MagicMock()
            r.data = data
            return r

        class QB:
            def __init__(self, table_name):
                self.table_name = table_name
                self.filters = {}

            def select(self, *_args, **_kw): return self
            def single(self): return self
            def eq(self, col, val): self.filters[col] = val; return self
            def is_(self, col, val): self.filters[col] = val; return self

            async def execute(self):
                if self.table_name == "floor_plans":
                    # target floor plan lookup — belongs to foreign property
                    return _result({
                        "property_id": str(foreign_property_id),
                        "floor_number": 1,
                    })
                if self.table_name == "jobs":
                    # job is on its own property, not the foreign one
                    return _result({
                        "id": str(job_id),
                        "floor_plan_id": None,
                        "status": "mitigation",
                        "property_id": str(job_property_id),
                    })
                return _result(None)

        class FakeClient:
            def table(self, name): return QB(name)

        with (
            patch.object(
                fp_service, "get_authenticated_client",
                AsyncMock(return_value=FakeClient()),
            ),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.save_canvas(
                    token="test",
                    floor_plan_id=foreign_floor_plan_id,
                    job_id=job_id,
                    company_id=company_id,
                    user_id=user_id,
                    canvas_data={"walls": []},
                    change_summary=None,
                )
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "PROPERTY_MISMATCH"

    @pytest.mark.asyncio
    async def test_allows_save_when_property_ids_match(self):
        """Happy path: job.property_id == target_property_id → save proceeds
        into Case 1 (no pinned version) without raising PROPERTY_MISMATCH."""
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service

        job_id = uuid4()
        company_id = uuid4()
        user_id = uuid4()
        floor_plan_id = uuid4()
        shared_property_id = uuid4()

        def _result(data):
            r = MagicMock()
            r.data = data
            return r

        class QB:
            def __init__(self, table_name):
                self.table_name = table_name

            def select(self, *_args, **_kw): return self
            def single(self): return self
            def eq(self, *_args, **_kw): return self
            def is_(self, *_args, **_kw): return self

            async def execute(self):
                if self.table_name == "floor_plans":
                    return _result({
                        "property_id": str(shared_property_id),
                        "floor_number": 1,
                    })
                if self.table_name == "jobs":
                    return _result({
                        "id": str(job_id),
                        "floor_plan_id": None,
                        "status": "mitigation",
                        "property_id": str(shared_property_id),
                    })
                return _result(None)

        class FakeClient:
            def table(self, name): return QB(name)

        forked_row = {"id": str(uuid4()), "version_number": 1, "is_current": True}
        with (
            patch.object(fp_service, "_create_version", AsyncMock(return_value=forked_row)),
            patch.object(fp_service, "log_event", AsyncMock(return_value=None)),
            patch.object(
                fp_service, "get_authenticated_client",
                AsyncMock(return_value=FakeClient()),
            ),
        ):
            result = await fp_service.save_canvas(
                token="test",
                floor_plan_id=floor_plan_id,
                job_id=job_id,
                company_id=company_id,
                user_id=user_id,
                canvas_data={"walls": []},
                change_summary=None,
            )
        assert result == forked_row

    @pytest.mark.asyncio
    async def test_rejects_save_when_job_property_id_is_null(self):
        """R8 (round 2): the former "legacy accommodation" that let a NULL
        ``job.property_id`` bypass the property check is gone. In the
        current product, every job is created with an address that
        deterministically resolves a property, so a NULL here is a data
        integrity signal — fail loudly with JOB_NO_PROPERTY instead of
        silently permitting a cross-property save.

        Prior behavior (kept as reference): the test at this line used to
        assert the save succeeded with ``property_id=None``; we flipped it
        to match the tightened helper. ``POST /jobs/{id}/floor-plans``
        remains the recovery path (auto-creates + links a property)."""
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.shared.exceptions import AppException

        job_id = uuid4()
        company_id = uuid4()
        user_id = uuid4()
        floor_plan_id = uuid4()
        some_property_id = uuid4()

        def _result(data):
            r = MagicMock()
            r.data = data
            return r

        class QB:
            def __init__(self, table_name):
                self.table_name = table_name

            def select(self, *_args, **_kw): return self
            def single(self): return self
            def eq(self, *_args, **_kw): return self
            def is_(self, *_args, **_kw): return self

            async def execute(self):
                if self.table_name == "floor_plans":
                    return _result({
                        "property_id": str(some_property_id),
                        "floor_number": 1,
                    })
                if self.table_name == "jobs":
                    return _result({
                        "id": str(job_id),
                        "floor_plan_id": None,
                        "status": "mitigation",
                        "property_id": None,  # regression: must be rejected
                    })
                return _result(None)

        class FakeClient:
            def table(self, name): return QB(name)

        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=FakeClient()),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.save_canvas(
                    token="test",
                    floor_plan_id=floor_plan_id,
                    job_id=job_id,
                    company_id=company_id,
                    user_id=user_id,
                    canvas_data={"walls": []},
                    change_summary=None,
                )
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "JOB_NO_PROPERTY"


# ---------------------------------------------------------------------------
# W2: shared_with_room_id must belong to the same company
# ---------------------------------------------------------------------------


class TestWallSharedWithRoomValidation:
    """create_wall / update_wall must reject a shared_with_room_id that
    doesn't belong to the caller's company. The FK only checks row
    existence; without this service-level check an INSERT with a foreign
    room_id succeeds (RLS blocks the read-back but the write itself
    confirms the target exists — a tenant-data side-channel)."""

    @pytest.mark.asyncio
    async def test_validator_rejects_foreign_company_room(self):
        from api.shared.exceptions import AppException
        from api.walls.service import _validate_shared_with_room

        class QB:
            def select(self, *_args, **_kw): return self
            def eq(self, *_args, **_kw): return self
            def single(self): return self
            async def execute(self):
                r = MagicMock()
                r.data = None
                return r

        class FakeClient:
            def table(self, _name): return QB()

        with pytest.raises(AppException) as exc_info:
            await _validate_shared_with_room(
                client=FakeClient(),
                shared_with_room_id=uuid4(),
                company_id=uuid4(),
            )
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "INVALID_SHARED_ROOM"

    @pytest.mark.asyncio
    async def test_validator_accepts_same_company_room(self):
        from api.walls.service import _validate_shared_with_room

        class QB:
            def select(self, *_args, **_kw): return self
            def eq(self, *_args, **_kw): return self
            def single(self): return self
            async def execute(self):
                r = MagicMock()
                r.data = {"id": "some-uuid"}
                return r

        class FakeClient:
            def table(self, _name): return QB()

        await _validate_shared_with_room(
            client=FakeClient(),
            shared_with_room_id=uuid4(),
            company_id=uuid4(),
        )

    @pytest.mark.asyncio
    async def test_validator_noops_on_none(self):
        """shared_with_room_id=None is the common non-shared case — no
        query should run, no exception."""
        from api.walls.service import _validate_shared_with_room

        class FakeClient:
            def table(self, _name):
                raise AssertionError("validator should not query when id is None")

        await _validate_shared_with_room(
            client=FakeClient(),
            shared_with_room_id=None,
            company_id=uuid4(),
        )


# ---------------------------------------------------------------------------
# W3: PATCH / DELETE via job rejects when job.property_id is null
# ---------------------------------------------------------------------------


class TestFloorPlanJobEndpointsRequirePropertyId:
    """Legacy jobs without property_id used to bypass the ownership path
    by having the router read property_id from the floor plan row itself
    (circular — row declared its own owner). The fallback is removed;
    the endpoints now reject with 400 JOB_NO_PROPERTY, forcing callers
    through POST /jobs/{id}/floor-plans which auto-creates + links the
    property. Thumb rule: every job MUST have a property_id."""

    @pytest.mark.asyncio
    async def test_patch_rejects_job_with_null_property_id(self):
        from unittest.mock import AsyncMock

        from api.floor_plans.router import update_floor_plan_by_job_endpoint
        from api.floor_plans.schemas import FloorPlanUpdate
        from api.shared.exceptions import AppException

        job = {"id": str(uuid4()), "property_id": None}
        ctx = MagicMock()
        ctx.company_id = uuid4()
        ctx.user_id = uuid4()
        request = MagicMock()
        request.headers = {"authorization": "Bearer test"}

        with pytest.raises(AppException) as exc_info:
            await update_floor_plan_by_job_endpoint(
                body=FloorPlanUpdate(floor_name="New Name"),
                request=request,
                floor_plan_id=uuid4(),
                job=job,
                ctx=ctx,
            )
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "JOB_NO_PROPERTY"

    @pytest.mark.asyncio
    async def test_delete_rejects_job_with_null_property_id(self):
        from api.floor_plans.router import delete_floor_plan_by_job_endpoint
        from api.shared.exceptions import AppException

        job = {"id": str(uuid4()), "property_id": None}
        ctx = MagicMock()
        ctx.company_id = uuid4()
        ctx.user_id = uuid4()
        request = MagicMock()
        request.headers = {"authorization": "Bearer test"}

        with pytest.raises(AppException) as exc_info:
            await delete_floor_plan_by_job_endpoint(
                request=request,
                floor_plan_id=uuid4(),
                job=job,
                ctx=ctx,
            )
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "JOB_NO_PROPERTY"


# ---------------------------------------------------------------------------
# W4: delete_floor_plan is single-row — refuses when siblings exist
# ---------------------------------------------------------------------------


class TestDeleteFloorPlanSingleRow:
    """delete_floor_plan targets one version row by id. If other versions
    exist on the same floor it must refuse (409 VERSIONS_EXIST), not
    silently wipe the whole floor's history like it used to."""

    @pytest.mark.asyncio
    async def test_refuses_when_other_versions_exist(self):
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.shared.exceptions import AppException

        floor_plan_id = uuid4()
        property_id = uuid4()
        company_id = uuid4()

        def _result(data, count=None):
            r = MagicMock()
            r.data = data
            r.count = count
            return r

        class QB:
            def __init__(self):
                self.mode = "single"

            def select(self, *_a, **kw):
                if kw.get("count") == "exact":
                    self.mode = "count"
                return self

            def single(self): self.mode = "single"; return self
            def eq(self, *_a, **_kw): return self
            def neq(self, *_a, **_kw): return self

            async def execute(self):
                if self.mode == "single":
                    return _result({
                        "id": str(floor_plan_id),
                        "floor_number": 1,
                        "is_current": True,
                    })
                # count mode — siblings query
                return _result([{"id": "other"}, {"id": "another"}], count=2)

        class FakeClient:
            def table(self, _name): return QB()

        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=FakeClient()),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.delete_floor_plan(
                    token="test",
                    floor_plan_id=floor_plan_id,
                    property_id=property_id,
                    company_id=company_id,
                    user_id=uuid4(),
                )
        assert exc_info.value.status_code == 409
        assert exc_info.value.error_code == "VERSIONS_EXIST"

    @pytest.mark.asyncio
    async def test_deletes_when_no_siblings_exist(self):
        """Single-version floor: the one row can be deleted cleanly."""
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service

        floor_plan_id = uuid4()
        property_id = uuid4()
        company_id = uuid4()

        delete_calls: list = []

        def _result(data, count=None):
            r = MagicMock()
            r.data = data
            r.count = count
            return r

        class QB:
            def __init__(self, table_name):
                self.table_name = table_name
                self.mode = "single"

            def select(self, *_a, **kw):
                if kw.get("count") == "exact":
                    self.mode = "count"
                return self

            def single(self): self.mode = "single"; return self
            def update(self, _row): self.mode = "update"; return self

            def delete(self):
                self.mode = "delete"
                delete_calls.append(self.table_name)
                return self

            def eq(self, *_a, **_kw): return self
            def neq(self, *_a, **_kw): return self

            async def execute(self):
                if self.mode == "single":
                    return _result({
                        "id": str(floor_plan_id),
                        "floor_number": 1,
                        "is_current": True,
                    })
                if self.mode == "count":
                    return _result([], count=0)
                return _result([])

        class FakeClient:
            def table(self, name): return QB(name)

        with (
            patch.object(
                fp_service, "get_authenticated_client",
                AsyncMock(return_value=FakeClient()),
            ),
            patch.object(fp_service, "log_event", AsyncMock(return_value=None)),
        ):
            await fp_service.delete_floor_plan(
                token="test",
                floor_plan_id=floor_plan_id,
                property_id=property_id,
                company_id=company_id,
                user_id=uuid4(),
            )

        # One delete call — against floor_plans table
        assert "floor_plans" in delete_calls


# ---------------------------------------------------------------------------
# W5: update_floor_plan rejects ANY update on a frozen (non-current) row
# ---------------------------------------------------------------------------


class TestUpdateFloorPlanFrozenGuard:
    """Previously only canvas_data + floor_number were blocked on
    non-current rows; floor_name + thumbnail_url were still editable.
    Renaming v1 after v2 was forked broke audit comparisons. The guard
    now blocks any update field on a frozen version."""

    @pytest.mark.asyncio
    async def test_rejects_floor_name_rename_on_frozen_row(self):
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.floor_plans.schemas import FloorPlanUpdate
        from api.shared.exceptions import AppException

        floor_plan_id = uuid4()
        property_id = uuid4()
        company_id = uuid4()

        def _result(data):
            r = MagicMock()
            r.data = data
            return r

        class QB:
            def select(self, *_a, **_kw): return self
            def single(self): return self
            def eq(self, *_a, **_kw): return self
            async def execute(self):
                # non-current (frozen) version row
                return _result({
                    "id": str(floor_plan_id),
                    "floor_number": 1,
                    "floor_name": "Floor 1",
                    "is_current": False,
                })

        class FakeClient:
            def table(self, _name): return QB()

        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=FakeClient()),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.update_floor_plan(
                    token="test",
                    floor_plan_id=floor_plan_id,
                    property_id=property_id,
                    company_id=company_id,
                    user_id=uuid4(),
                    body=FloorPlanUpdate(floor_name="Floor 1 (renamed)"),
                )
        assert exc_info.value.status_code == 403
        assert exc_info.value.error_code == "VERSION_FROZEN"

    @pytest.mark.asyncio
    async def test_rejects_thumbnail_update_on_frozen_row(self):
        """thumbnail_url also locked — no partial escape hatches on frozen rows."""
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.floor_plans.schemas import FloorPlanUpdate
        from api.shared.exceptions import AppException

        def _result(data):
            r = MagicMock()
            r.data = data
            return r

        class QB:
            def select(self, *_a, **_kw): return self
            def single(self): return self
            def eq(self, *_a, **_kw): return self
            async def execute(self):
                return _result({
                    "id": "fp-id",
                    "floor_number": 1,
                    "floor_name": "Floor 1",
                    "is_current": False,
                })

        class FakeClient:
            def table(self, _name): return QB()

        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=FakeClient()),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.update_floor_plan(
                    token="test",
                    floor_plan_id=uuid4(),
                    property_id=uuid4(),
                    company_id=uuid4(),
                    user_id=uuid4(),
                    body=FloorPlanUpdate(thumbnail_url="https://example.com/new.png"),
                )
        assert exc_info.value.status_code == 403
        assert exc_info.value.error_code == "VERSION_FROZEN"


# ---------------------------------------------------------------------------
# R4 (round 2): TOCTOU on update_floor_plan + cleanup_floor_plan — UPDATE
# must filter on is_current=true atomically. Round-1 C3 fixed this in
# save_canvas Case 2; the reviewer found the identical pattern unguarded
# in these two callers.
# ---------------------------------------------------------------------------


class _UpdateTOCTOUClient:
    """Fake supabase client that:
    - returns ``is_current=true`` on the initial SELECT (so the in-memory
      guard at L503 / L1199 does not trip)
    - returns ``data=[]`` on the subsequent UPDATE (simulating the TOCTOU
      race where a sibling fork flipped is_current=false between read and
      write, so the ``.eq("is_current", True)`` filter matches zero rows).

    Accepts a shared ``property_id`` so R5's property cross-check at
    ``cleanup_floor_plan`` passes with its mocked job dict. Used by both
    update_floor_plan and cleanup_floor_plan tests.
    """

    def __init__(
        self,
        *,
        floor_plan_id,
        property_id=None,
        is_current_on_read=True,
        update_rows_matched=0,
    ):
        self._floor_plan_id = str(floor_plan_id)
        self._property_id = str(property_id or uuid4())
        self._is_current_on_read = is_current_on_read
        self._update_rows_matched = update_rows_matched

    @property
    def property_id(self):
        return self._property_id

    def table(self, _name):
        outer = self

        class QB:
            def __init__(self):
                self._mode = None  # "select" | "update"

            def select(self, *_a, **_kw):
                self._mode = "select"
                return self

            def update(self, _payload):
                self._mode = "update"
                return self

            def eq(self, *_a, **_kw): return self
            def neq(self, *_a, **_kw): return self
            def single(self): return self

            async def execute(self):
                r = MagicMock()
                if self._mode == "update":
                    r.data = [{"id": outer._floor_plan_id, "floor_name": "X", "is_current": True}] \
                        * outer._update_rows_matched
                else:  # select
                    r.data = {
                        "id": outer._floor_plan_id,
                        "property_id": outer._property_id,
                        "company_id": str(uuid4()),
                        "floor_number": 1,
                        "floor_name": "Floor 1",
                        "thumbnail_url": None,
                        "canvas_data": {"walls": [{"x1": 0, "y1": 0, "x2": 10, "y2": 0}]},
                        "is_current": outer._is_current_on_read,
                    }
                return r

        return QB()


class TestUpdateFloorPlanTOCTOU:
    """update_floor_plan's UPDATE at L530 must filter on is_current=true so a
    sibling Case 3 fork that flips the target to frozen mid-flight causes the
    UPDATE to match zero rows, which we translate into VERSION_FROZEN rather
    than silently mutating a historical snapshot.
    """

    @pytest.mark.asyncio
    async def test_update_zero_rows_matched_raises_version_frozen(self):
        """Read returns is_current=true (skips in-memory guard). UPDATE
        returns data=[] (race won by sibling fork). Must raise VERSION_FROZEN.
        """
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.floor_plans.schemas import FloorPlanUpdate
        from api.shared.exceptions import AppException

        floor_plan_id = uuid4()
        client = _UpdateTOCTOUClient(
            floor_plan_id=floor_plan_id,
            is_current_on_read=True,
            update_rows_matched=0,
        )
        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=client),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.update_floor_plan(
                    token="test",
                    floor_plan_id=floor_plan_id,
                    property_id=uuid4(),
                    company_id=uuid4(),
                    user_id=uuid4(),
                    body=FloorPlanUpdate(floor_name="New Name"),
                )
        assert exc_info.value.status_code == 403
        assert exc_info.value.error_code == "VERSION_FROZEN"

    @pytest.mark.asyncio
    async def test_update_writes_when_row_still_current(self):
        """Happy-path regression. UPDATE matches 1 row → returns the row,
        no VERSION_FROZEN. Confirms the atomic filter change did not break
        the common autosave path.
        """
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.floor_plans.schemas import FloorPlanUpdate

        floor_plan_id = uuid4()
        client = _UpdateTOCTOUClient(
            floor_plan_id=floor_plan_id,
            is_current_on_read=True,
            update_rows_matched=1,
        )
        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=client),
        ):
            with patch.object(fp_service, "log_event", AsyncMock()):
                result = await fp_service.update_floor_plan(
                    token="test",
                    floor_plan_id=floor_plan_id,
                    property_id=uuid4(),
                    company_id=uuid4(),
                    user_id=uuid4(),
                    body=FloorPlanUpdate(floor_name="New Name"),
                )
        assert result["id"] == str(floor_plan_id)


class TestRestoreRelationalSnapshotMigration:
    """R19 (round 2): restore_floor_plan_relational_snapshot RPC.

    Verifies the migration has the production-grade shape:
      - SECURITY DEFINER + JWT-derived company (same pattern as R3).
      - DELETE + INSERT inside one function call for transactional atomicity.
      - Restores all four relational sources: wall_segments, wall_openings,
        job_rooms.room_polygon, job_rooms.floor_openings.
      - Handles legacy versions without _relational_snapshot gracefully
        (returns restored=false, not a 500).
      - Pinned search_path for SECURITY DEFINER hygiene.
    """

    MIGRATION_FILE = "e5f8a9b0c1d2_spec01h_restore_floor_plan_snapshot_rpc.py"

    def _text(self) -> str:
        from pathlib import Path

        path = (
            Path(__file__).resolve().parents[1]
            / "alembic" / "versions" / self.MIGRATION_FILE
        )
        assert path.exists(), f"R19 migration missing at {path}"
        return path.read_text(encoding="utf-8")

    def test_upgrade_defines_rpc(self):
        text = self._text()
        assert "CREATE OR REPLACE FUNCTION restore_floor_plan_relational_snapshot" in text

    def test_rpc_is_security_definer_with_locked_search_path(self):
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        assert "SECURITY DEFINER" in upgrade
        assert "SET search_path = pg_catalog, public" in upgrade

    def test_rpc_derives_company_from_jwt(self):
        """Must call get_my_company_id() — never trust a caller-supplied
        company id. Same R3 pattern across every 01H SECURITY DEFINER RPC."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        assert "get_my_company_id()" in upgrade
        assert "'42501'" in upgrade  # raised on no-auth-company

    def test_rpc_restores_all_four_relational_sources(self):
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        # wall_segments: delete + insert
        assert "DELETE FROM wall_segments" in upgrade
        assert "INSERT INTO wall_segments" in upgrade
        # wall_openings: insert under new parent (delete cascades via FK)
        assert "INSERT INTO wall_openings" in upgrade
        # job_rooms JSONB fields
        assert "room_polygon" in upgrade
        assert "floor_openings" in upgrade

    def test_rpc_handles_legacy_versions_without_snapshot(self):
        """Versions saved before R19 have no _relational_snapshot key.
        The RPC must return restored=false (not 500) so the service layer
        can warn and keep canvas-only rollback for legacy data."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        assert "'no_snapshot'" in upgrade
        assert "'restored'" in upgrade

    def test_rpc_rejects_unsupported_snapshot_version(self):
        """Future-proofing: if the snapshot format changes, the RPC must
        refuse to apply a version it doesn't understand rather than
        corrupt the data."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        assert "v_snapshot_version" in upgrade
        assert "Unsupported snapshot version" in upgrade

    def test_downgrade_drops_function(self):
        text = self._text()
        downgrade = text.split("DOWNGRADE_SQL", 1)[1]
        assert "DROP FUNCTION IF EXISTS restore_floor_plan_relational_snapshot" in downgrade


class TestSaveCanvasEmbedsRelationalSnapshot:
    """R19 snapshot side: save_canvas calls _enrich_canvas_with_relational_snapshot
    before _create_version so every new floor_plans row carries the snapshot
    needed for future full-fidelity rollback. The helper itself reads the
    CURRENT server-side relational state — the frontend blob is not
    authoritative for this purpose."""

    def test_save_canvas_enriches_before_create_version(self):
        import inspect

        from api.floor_plans.service import save_canvas

        src = inspect.getsource(save_canvas)
        assert "_enrich_canvas_with_relational_snapshot" in src, (
            "save_canvas must build the relational snapshot BEFORE calling "
            "_create_version so the snapshot ships in canvas_data."
        )

    @pytest.mark.asyncio
    async def test_enricher_adds_snapshot_key(self):
        """Behavioral: helper returns canvas_data with _relational_snapshot."""
        from unittest.mock import MagicMock

        from api.floor_plans.service import _enrich_canvas_with_relational_snapshot

        room_id = str(uuid4())

        class QB:
            def __init__(self, table): self.table = table
            def select(self, *_a, **_kw): return self
            def eq(self, *_a, **_kw): return self
            def in_(self, *_a, **_kw): return self
            async def execute(self):
                r = MagicMock()
                if self.table == "job_rooms":
                    r.data = [{"id": room_id, "room_polygon": None, "floor_openings": []}]
                elif self.table == "wall_segments":
                    r.data = [{
                        "id": str(uuid4()), "room_id": room_id,
                        "x1": 0, "y1": 0, "x2": 100, "y2": 0,
                        "wall_type": "interior", "wall_height_ft": None,
                        "affected": False, "shared": False,
                        "shared_with_room_id": None, "sort_order": 0,
                    }]
                else:
                    r.data = []
                return r

        class FakeClient:
            def table(self, name): return QB(name)

        canvas_in = {"rooms": [{"id": "frontend-id", "propertyRoomId": room_id}]}
        canvas_out = await _enrich_canvas_with_relational_snapshot(
            FakeClient(), canvas_in, uuid4(),
        )
        assert "_relational_snapshot" in canvas_out
        snap = canvas_out["_relational_snapshot"]
        assert snap["version"] == 1
        assert len(snap["rooms"]) == 1
        assert snap["rooms"][0]["id"] == room_id
        assert len(snap["rooms"][0]["walls"]) == 1

    @pytest.mark.asyncio
    async def test_enricher_does_not_mutate_input(self):
        """Defensive: the helper returns a new dict — mutating the caller's
        canvas_data would confuse any code path that reuses the object."""
        from unittest.mock import MagicMock

        from api.floor_plans.service import _enrich_canvas_with_relational_snapshot

        class EmptyQB:
            def select(self, *_a, **_kw): return self
            def eq(self, *_a, **_kw): return self
            def in_(self, *_a, **_kw): return self
            async def execute(self):
                r = MagicMock(); r.data = []
                return r

        class FakeClient:
            def table(self, _name): return EmptyQB()

        canvas_in = {"rooms": []}
        await _enrich_canvas_with_relational_snapshot(
            FakeClient(), canvas_in, uuid4(),
        )
        assert "_relational_snapshot" not in canvas_in, (
            "helper must not mutate caller's dict"
        )


# TestRollbackCallsRestoreRpc (original R19 tests) were superseded by
# TestRollbackVersionUsesAtomicWrapper — see round-2 follow-on F1. The old
# two-RPC-call shape no longer exists; rollback_version invokes the atomic
# wrapper and the wrapper invokes both save + restore inside one plpgsql
# transaction. All the assertions that used to live here are now covered
# by the new class above.


class TestComputeWallSfForRoomSecurity:
    """Round-2 follow-on #2: _compute_wall_sf_for_room must derive company
    from the JWT via get_my_company_id(), not accept it as a caller-supplied
    parameter. SECURITY DEFINER grants bypass RLS, so caller-supplied tenant
    is a cross-tenant write vector — same anti-pattern R3 closed on
    save_floor_plan_version.
    """

    MIGRATION_FILE = "a7b8c9d0e1f2_spec01h_rpc_security_followup.py"

    def _text(self) -> str:
        from pathlib import Path

        return (
            Path(__file__).resolve().parents[1]
            / "alembic" / "versions" / self.MIGRATION_FILE
        ).read_text(encoding="utf-8")

    def test_compute_helper_takes_only_room_id(self):
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        # New signature is 1-arg; the 2-arg version is dropped first.
        assert "DROP FUNCTION IF EXISTS _compute_wall_sf_for_room(UUID, UUID)" in upgrade
        assert "CREATE OR REPLACE FUNCTION _compute_wall_sf_for_room(\n    p_room_id UUID\n)" in upgrade

    def test_compute_helper_derives_company_from_jwt(self):
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        helper = upgrade.split("CREATE OR REPLACE FUNCTION _compute_wall_sf_for_room", 1)[1]
        assert "v_caller_company := get_my_company_id()" in helper
        assert "'42501'" in helper  # raise on no-auth

    def test_restore_rpc_calls_1arg_helper(self):
        """restore_floor_plan_relational_snapshot must pass only room_id."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        restore = upgrade.split(
            "CREATE OR REPLACE FUNCTION restore_floor_plan_relational_snapshot", 1
        )[1]
        assert "_compute_wall_sf_for_room(v_room_id)" in restore
        # Regression guard: must not pass the 2-arg form.
        assert "_compute_wall_sf_for_room(v_room_id, v_caller_company)" not in restore


class TestFrozenTriggerDistinctSqlstate:
    """Round-2 follow-on #4: the R4 frozen-mutation trigger previously
    raised 42501 (same SQLSTATE as R3's tenant-mismatch check). Python
    catch blocks couldn't tell them apart. a7b8c9d0e1f2 changes the
    trigger to raise 55006 (object_in_use, class 55) so VERSION_FROZEN
    and COMPANY_MISMATCH live on distinct codes.
    """

    MIGRATION_FILE = "a7b8c9d0e1f2_spec01h_rpc_security_followup.py"

    def _text(self) -> str:
        from pathlib import Path

        return (
            Path(__file__).resolve().parents[1]
            / "alembic" / "versions" / self.MIGRATION_FILE
        ).read_text(encoding="utf-8")

    def test_trigger_uses_55006_sqlstate(self):
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        trigger_block = upgrade.split(
            "CREATE OR REPLACE FUNCTION floor_plans_prevent_frozen_mutation", 1
        )[1]
        assert "'55006'" in trigger_block

    def test_downgrade_restores_42501(self):
        """Rollback returns the trigger to its pre-follow-on 42501 so a
        mid-migration downgrade doesn't leave the system in a mixed state."""
        text = self._text()
        downgrade = text.split("DOWNGRADE_SQL", 1)[1]
        trigger_block = downgrade.split(
            "CREATE OR REPLACE FUNCTION floor_plans_prevent_frozen_mutation", 1
        )[1]
        assert "'42501'" in trigger_block


class TestServiceMapsVersionFrozen55006:
    """Service-layer catches must translate 55006 → VERSION_FROZEN (403)
    across every path that can hit the frozen-mutation trigger. _create_version
    and update_floor_plan and cleanup_floor_plan all need the branch."""

    def test_create_version_maps_55006_to_version_frozen(self):
        import inspect

        from api.floor_plans.service import _create_version

        src = inspect.getsource(_create_version)
        assert '"55006"' in src
        assert "VERSION_FROZEN" in src

    def test_update_floor_plan_maps_55006_to_version_frozen(self):
        import inspect

        from api.floor_plans.service import update_floor_plan

        src = inspect.getsource(update_floor_plan)
        assert '"55006"' in src
        assert "VERSION_FROZEN" in src

    def test_cleanup_floor_plan_wraps_update_and_maps_55006(self):
        import inspect

        from api.floor_plans.service import cleanup_floor_plan

        src = inspect.getsource(cleanup_floor_plan)
        # cleanup's UPDATE is now inside a try/except APIError block.
        assert "except APIError" in src
        assert '"55006"' in src
        assert "VERSION_FROZEN" in src


class TestEnsureJobProperty23505Retry:
    """Round-2 follow-on #5: the router's ensure_job_property call now
    retries once on 23505 (partial unique address index violation from
    two different jobs at the same address racing past their FOR UPDATE
    locks). On retry the SELECT finds the winner's row and reuses it.
    Back-to-back 23505s surface as 409 CONCURRENT_EDIT so the client
    can retry the request."""

    @staticmethod
    def _endpoint_body() -> str:
        import re
        from pathlib import Path

        src = (
            Path(__file__).resolve().parents[1]
            / "api" / "floor_plans" / "router.py"
        ).read_text(encoding="utf-8")
        m = re.search(
            r"async def create_floor_plan_by_job_endpoint\(.*?(?=^async def |\Z)",
            src, re.DOTALL | re.MULTILINE,
        )
        assert m, "create_floor_plan_by_job_endpoint not found"
        return m.group(0)

    def test_router_retries_on_23505(self):
        body = self._endpoint_body()
        assert '"23505"' in body
        assert "_invoke_ensure" in body
        assert "CONCURRENT_EDIT" in body


class TestRouterImportsHoisted:
    """Round-2 follow-on #8: inline imports inside endpoint bodies are
    cleaned up — logger, APIError, get_authenticated_client, AppException
    all live at module top like the rest of the file."""

    @staticmethod
    def _text() -> str:
        from pathlib import Path

        return (
            Path(__file__).resolve().parents[1]
            / "api" / "floor_plans" / "router.py"
        ).read_text(encoding="utf-8")

    def test_module_imports_are_at_top(self):
        text = self._text()
        # Every top-level import shows up before the first `async def`.
        header, _, body = text.partition("\nasync def ")
        for marker in (
            "import logging",
            "from postgrest.exceptions import APIError",
            "from api.shared.database import get_authenticated_client",
            "from api.shared.exceptions import AppException",
        ):
            assert marker in header, f"missing top-level import: {marker}"

    def test_no_inline_imports_in_endpoint_bodies(self):
        """Regression: once hoisted, duplicate inline imports should not
        creep back into endpoint function bodies."""
        text = self._text()
        _header, _, body = text.partition("\nasync def ")
        # Only check inside endpoint bodies for these specific duplicates.
        for marker in (
            "    from postgrest.exceptions import APIError",
            "    from api.shared.database import get_authenticated_client",
            "    from api.shared.exceptions import AppException",
        ):
            assert marker not in body, f"inline import reappeared: {marker}"


class TestPinUpdateScopedByCompanyId:
    """Round-2 follow-on #7: create_floor_plan_by_job_endpoint's pin UPDATE
    now scopes by company_id for consistency with other write paths."""

    def test_pin_update_adds_company_id_filter(self):
        import re
        from pathlib import Path

        src = (
            Path(__file__).resolve().parents[1]
            / "api" / "floor_plans" / "router.py"
        ).read_text(encoding="utf-8")
        m = re.search(
            r"async def create_floor_plan_by_job_endpoint\(.*?(?=^async def |\Z)",
            src, re.DOTALL | re.MULTILINE,
        )
        assert m, "create_floor_plan_by_job_endpoint not found"
        body = m.group(0)
        # The jobs.floor_plan_id UPDATE chain must include .eq("company_id", ...).
        pin_block = body.split('.update({"floor_plan_id": floor_plan["id"]})', 1)[1]
        assert '.eq("company_id"' in pin_block


class TestSaveCanvasCase3AutosaveReconciliation:
    """Round-2 follow-on #3: the normal autosave path at floor-plan/page.tsx
    now captures the POST response and reconciles activeFloorId + caches
    when the backend forks (Case 3). Mirrors R12's cross-floor save fix —
    without this, the FloorSelector points at a frozen row after fork and
    the next autosave forks again."""

    @staticmethod
    def _text() -> str:
        from pathlib import Path

        return (
            Path(__file__).resolve().parents[1].parent
            / "web" / "src" / "app"
            / "(protected)" / "jobs" / "[id]" / "floor-plan" / "page.tsx"
        ).read_text(encoding="utf-8")

    def test_autosave_captures_version_response(self):
        text = self._text()
        # Find the normal-autosave block (currentFloor branch).
        assert "const savedVersion = await apiPost<FloorPlan>" in text

    def test_autosave_reconciles_on_fork(self):
        text = self._text()
        # Fork detection + setActiveFloorId to the saved id + stale history invalidation.
        assert "savedVersion.id !== currentFloor.id" in text
        assert "setActiveFloorId(savedVersion.id)" in text

    def test_first_floor_create_also_captures_and_reconciles(self):
        text = self._text()
        # Second call site at the first-floor-create path.
        assert "const firstSaved = await apiPost<FloorPlan>" in text
        assert "firstSaved.id !== created.id" in text


class TestSaveCanvasPostEnrichmentSizeCap:
    """F7 (round-2 follow-on): the W6 incoming cap (500 KB) runs at the
    router boundary, before ``_enrich_canvas_with_relational_snapshot`` adds
    the server-side ``_relational_snapshot``. Without a post-enrichment
    check, a 497 KB incoming canvas + snapshot could silently land ~510 KB
    in the DB, making the W6 contract a lie. save_canvas now re-validates
    the enriched payload against a wider stored cap (600 KB) and raises
    413 CANVAS_TOO_LARGE when exceeded. The two-layer cap is documented in
    ``floor_plans/schemas.py``.
    """

    def test_schemas_export_both_caps(self):
        """Both the incoming-cap and stored-cap constants are exposed so
        save_canvas and any future reader can reason about them explicitly."""
        from api.floor_plans.schemas import (
            MAX_INCOMING_CANVAS_DATA_BYTES,
            MAX_STORED_CANVAS_DATA_BYTES,
        )

        assert MAX_INCOMING_CANVAS_DATA_BYTES == 500_000
        assert MAX_STORED_CANVAS_DATA_BYTES == 600_000
        assert MAX_STORED_CANVAS_DATA_BYTES > MAX_INCOMING_CANVAS_DATA_BYTES, (
            "stored cap must be > incoming cap to absorb snapshot overhead"
        )

    def test_save_canvas_enforces_stored_cap_after_enrichment(self):
        """Static guard: save_canvas references MAX_STORED_CANVAS_DATA_BYTES
        and raises CANVAS_TOO_LARGE. This catches future edits that drop the
        post-enrichment check and let oversized rows land silently."""
        import inspect

        from api.floor_plans.service import save_canvas

        src = inspect.getsource(save_canvas)
        assert "MAX_STORED_CANVAS_DATA_BYTES" in src
        assert "CANVAS_TOO_LARGE" in src
        assert "status_code=413" in src

    @pytest.mark.asyncio
    async def test_oversize_enriched_canvas_raises_413(self):
        """Behavioral: if enrichment pushes the payload past the stored cap,
        save_canvas raises before any RPC call. Fake client returns anchor +
        job rows, and enrichment is patched to produce a >600KB blob."""
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.shared.exceptions import AppException

        company_id = uuid4()
        job_id = uuid4()
        property_id = uuid4()

        def _result(data):
            r = MagicMock(); r.data = data; return r

        class QB:
            def __init__(self, table): self.table = table
            def select(self, *_a, **_kw): return self
            def single(self): return self
            def eq(self, *_a, **_kw): return self
            def is_(self, *_a, **_kw): return self
            async def execute(self):
                if self.table == "floor_plans":
                    return _result({
                        "property_id": str(property_id),
                        "floor_number": 1,
                    })
                if self.table == "jobs":
                    return _result({
                        "id": str(job_id),
                        "floor_plan_id": None,
                        "status": "mitigation",
                        "property_id": str(property_id),
                    })
                return _result(None)

        class FakeClient:
            def table(self, name): return QB(name)

        # Patch enrichment to return a huge blob. 700KB of padding guarantees
        # we're above the 600KB stored cap.
        huge = {"rooms": [], "_relational_snapshot": {
            "version": 1,
            "rooms": [],
            "padding": "x" * 700_000,
        }}

        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=FakeClient()),
        ), patch.object(
            fp_service, "_enrich_canvas_with_relational_snapshot",
            AsyncMock(return_value=huge),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.save_canvas(
                    token="test",
                    floor_plan_id=uuid4(),
                    job_id=job_id,
                    company_id=company_id,
                    user_id=uuid4(),
                    canvas_data={"rooms": []},
                    change_summary=None,
                )
        assert exc_info.value.status_code == 413
        assert exc_info.value.error_code == "CANVAS_TOO_LARGE"


class TestAtomicRollbackWrapperMigration:
    """Round-2 follow-on (F1+F2+F3): atomic rollback wrapper RPC.

    Critical-review flagged that rollback_version's two-RPC composition
    (save_floor_plan_version + restore_floor_plan_relational_snapshot)
    was non-atomic — if the restore failed, the new version row + repin
    were already committed. This migration folds both into one plpgsql
    function so Postgres's implicit transaction gives us true atomicity.

    Same migration also:
      - F2: recomputes wall_square_footage per room inside restore (so
        R16's "backend authoritative" invariant holds across rollback).
      - F3: surfaces skipped-room IDs in the restore return payload.
    """

    MIGRATION_FILE = "f6a9b0c1d2e3_spec01h_rollback_atomic_wrapper.py"

    def _text(self) -> str:
        from pathlib import Path

        path = (
            Path(__file__).resolve().parents[1]
            / "alembic" / "versions" / self.MIGRATION_FILE
        )
        assert path.exists(), f"F1 migration missing at {path}"
        return path.read_text(encoding="utf-8")

    # ─── F1 — atomic wrapper RPC ──────────────────────────────────────────

    def test_upgrade_defines_atomic_wrapper_rpc(self):
        text = self._text()
        assert "CREATE OR REPLACE FUNCTION rollback_floor_plan_version_atomic" in text

    def test_wrapper_calls_save_then_restore_inside_one_plpgsql_function(self):
        """The wrapper's body invokes both save_floor_plan_version and
        restore_floor_plan_relational_snapshot — placing both in the same
        plpgsql function is what gives us atomic semantics."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        wrapper_block = upgrade.split("rollback_floor_plan_version_atomic", 1)[1]
        assert "save_floor_plan_version(" in wrapper_block
        assert "restore_floor_plan_relational_snapshot(" in wrapper_block

    def test_wrapper_validates_tenant_property_and_archive(self):
        """F1 moves the R5/R6/R8 checks into the RPC so they share the
        transaction. Verify all three guards are present."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        wrapper_block = upgrade.split("rollback_floor_plan_version_atomic", 1)[1]
        assert "get_my_company_id()" in wrapper_block
        assert "Property mismatch" in wrapper_block or "property_id <> v_target.property_id" in wrapper_block
        assert "Job archived" in wrapper_block or "status = 'collected'" in wrapper_block
        assert "Job has no property" in wrapper_block

    def test_wrapper_is_security_definer_with_locked_search_path(self):
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        wrapper_block = upgrade.split("rollback_floor_plan_version_atomic", 1)[1]
        # Look just past the function body for the LANGUAGE declaration.
        assert "LANGUAGE plpgsql" in wrapper_block
        assert "SECURITY DEFINER" in wrapper_block
        assert "SET search_path = pg_catalog, public" in wrapper_block

    # ─── F2 — wall_sf recompute inside restore ────────────────────────────

    def test_upgrade_defines_compute_wall_sf_helper(self):
        text = self._text()
        assert "CREATE OR REPLACE FUNCTION _compute_wall_sf_for_room" in text

    def test_compute_helper_honors_custom_wall_sf_override(self):
        """R16 contract: if custom_wall_sf is set, skip the formula and
        store that value directly."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        helper_block = upgrade.split("_compute_wall_sf_for_room", 1)[1]
        assert "v_room.custom_wall_sf IS NOT NULL" in helper_block

    def test_compute_helper_uses_ceiling_multipliers_matching_python(self):
        """The multiplier table must match CEILING_MULTIPLIERS in
        shared/constants.py. If Python changes, this test catches drift."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        helper_block = upgrade.split("_compute_wall_sf_for_room", 1)[1]
        for line in [
            "WHEN 'flat'      THEN 1.0",
            "WHEN 'vaulted'   THEN 1.3",
            "WHEN 'cathedral' THEN 1.5",
            "WHEN 'sloped'    THEN 1.2",
        ]:
            assert line in helper_block

    def test_restore_invokes_compute_wall_sf_per_room(self):
        """After re-inserting walls + openings for a room, the restore
        function must call _compute_wall_sf_for_room so the stored SF
        catches up. Without this, rollback silently regresses R16."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        restore_block = upgrade.split(
            "FUNCTION restore_floor_plan_relational_snapshot", 1
        )[1].split(
            "FUNCTION rollback_floor_plan_version_atomic", 1
        )[0]
        assert "_compute_wall_sf_for_room(v_room_id, v_caller_company)" in restore_block

    # ─── F3 — skipped rooms surfaced ──────────────────────────────────────

    def test_restore_accumulates_skipped_rooms(self):
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        restore_block = upgrade.split(
            "FUNCTION restore_floor_plan_relational_snapshot", 1
        )[1].split(
            "FUNCTION rollback_floor_plan_version_atomic", 1
        )[0]
        # When tenant check misses, append to skipped_rooms.
        assert "v_skipped_rooms := v_skipped_rooms ||" in restore_block
        # And return it in the payload.
        assert "'skipped_rooms'" in restore_block


class TestRollbackVersionUsesAtomicWrapper:
    """Python's rollback_version now makes one RPC call to the wrapper
    instead of two separate calls. Mapping of plpgsql SQLSTATEs to HTTP
    error codes lives in the service layer."""

    def test_rollback_calls_atomic_wrapper_rpc(self):
        import inspect

        from api.floor_plans.service import rollback_version

        src = inspect.getsource(rollback_version)
        assert '"rollback_floor_plan_version_atomic"' in src

    def test_rollback_drops_the_two_separate_rpc_calls(self):
        """Regression guard: the old two-RPC pattern (explicit
        _create_version then restore_floor_plan_relational_snapshot) must
        not reappear in rollback_version. The wrapper now owns both."""
        import inspect

        from api.floor_plans.service import rollback_version

        src = inspect.getsource(rollback_version)
        # _create_version and restore RPC name must be gone from rollback.
        assert "_create_version(" not in src, (
            "rollback_version must route through the atomic wrapper, not "
            "call _create_version directly — doing so reintroduces the "
            "non-atomic two-write pattern the reviewer flagged."
        )
        assert '"restore_floor_plan_relational_snapshot"' not in src

    def test_rollback_maps_42501_to_403_rollback_forbidden(self):
        import inspect

        from api.floor_plans.service import rollback_version

        src = inspect.getsource(rollback_version)
        assert "ROLLBACK_FORBIDDEN" in src

    def test_rollback_logs_skipped_rooms_warning(self):
        """F3: when restore skips rooms, the service must log a warning
        with the ids so data-integrity issues are visible."""
        import inspect

        from api.floor_plans.service import rollback_version

        src = inspect.getsource(rollback_version)
        assert "skipped_rooms" in src
        assert "logger.warning" in src


class TestEnrichCanvasRaisesOnNonDict:
    """F4: _enrich_canvas_with_relational_snapshot used to coerce a
    non-dict canvas_data to ``{"rooms": []}`` silently, saving an empty
    version if a programmer error upstream corrupted the payload. The
    helper now fails loudly with INVALID_CANVAS_DATA."""

    @pytest.mark.asyncio
    async def test_raises_on_list(self):
        from api.floor_plans.service import _enrich_canvas_with_relational_snapshot
        from api.shared.exceptions import AppException

        class FakeClient:
            def table(self, _n): raise AssertionError("should not reach DB")

        with pytest.raises(AppException) as exc_info:
            await _enrich_canvas_with_relational_snapshot(
                FakeClient(), [{"not": "a dict"}], uuid4(),
            )
        assert exc_info.value.error_code == "INVALID_CANVAS_DATA"

    @pytest.mark.asyncio
    async def test_raises_on_string(self):
        from api.floor_plans.service import _enrich_canvas_with_relational_snapshot
        from api.shared.exceptions import AppException

        class FakeClient:
            def table(self, _n): raise AssertionError("should not reach DB")

        with pytest.raises(AppException) as exc_info:
            await _enrich_canvas_with_relational_snapshot(
                FakeClient(), "oops", uuid4(),
            )
        assert exc_info.value.error_code == "INVALID_CANVAS_DATA"

    @pytest.mark.asyncio
    async def test_raises_on_none(self):
        from api.floor_plans.service import _enrich_canvas_with_relational_snapshot
        from api.shared.exceptions import AppException

        class FakeClient:
            def table(self, _n): raise AssertionError("should not reach DB")

        with pytest.raises(AppException):
            await _enrich_canvas_with_relational_snapshot(
                FakeClient(), None, uuid4(),
            )


class TestWallSfNonNegBackfillGuard:
    """F5: R17 migration backfills any rows with negative wall_sf to NULL
    before the ADD CONSTRAINT, so the migration cannot fail on legacy
    data. Uses a DO block with GET DIAGNOSTICS + RAISE NOTICE so the
    count is visible in deploy logs."""

    MIGRATION_FILE = "c3d4e5f8a9b0_spec01h_wall_sf_nonneg_checks.py"

    def _text(self) -> str:
        from pathlib import Path

        return (
            Path(__file__).resolve().parents[1]
            / "alembic" / "versions" / self.MIGRATION_FILE
        ).read_text(encoding="utf-8")

    def test_upgrade_backfills_negative_custom_wall_sf_to_null(self):
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        assert "UPDATE job_rooms SET custom_wall_sf = NULL" in upgrade
        assert "custom_wall_sf < 0" in upgrade

    def test_upgrade_backfills_negative_wall_square_footage_to_null(self):
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        assert "UPDATE job_rooms SET wall_square_footage = NULL" in upgrade
        assert "wall_square_footage < 0" in upgrade

    def test_upgrade_emits_notice_with_row_counts(self):
        """Operators should see how many rows were fixed in the deploy log."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        assert "RAISE NOTICE" in upgrade
        assert "GET DIAGNOSTICS" in upgrade


class TestSwingColumnCommentMigration:
    """R18 (round 2): wall_openings.swing is INTEGER CHECK IN (0,1,2,3).
    Reviewer flagged that the four values have no DB-level documentation.
    Migration d4e5f8a9b0c1 attaches a COMMENT ON COLUMN so psql \\d+ shows
    the mapping inline. The comment must also be accurate — reviewer
    guessed N/E/S/W, but the real frontend mapping is hinge + swing
    quadrants per FloorOpeningData in floor-plan-tools.ts.
    """

    MIGRATION_FILE = "d4e5f8a9b0c1_spec01h_wall_openings_swing_comment.py"

    def _text(self) -> str:
        from pathlib import Path

        path = (
            Path(__file__).resolve().parents[1]
            / "alembic" / "versions" / self.MIGRATION_FILE
        )
        assert path.exists(), f"R18 migration missing at {path}"
        return path.read_text(encoding="utf-8")

    def test_upgrade_attaches_comment_to_swing_column(self):
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        assert "COMMENT ON COLUMN wall_openings.swing" in upgrade

    def test_comment_enumerates_all_four_values(self):
        """All four mapping entries must be present and match the frontend
        source-of-truth. If this fires, check floor-plan-tools.ts didn't
        silently change the mapping."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        assert "0=hinge-left-swing-up" in upgrade
        assert "1=hinge-left-swing-down" in upgrade
        assert "2=hinge-right-swing-down" in upgrade
        assert "3=hinge-right-swing-up" in upgrade

    def test_comment_points_at_frontend_source(self):
        """The doc pointer to the authoritative TS enum should survive so
        future devs find the source without grepping blind."""
        text = self._text()
        assert "floor-plan-tools.ts" in text

    def test_downgrade_clears_the_comment(self):
        text = self._text()
        downgrade = text.split("DOWNGRADE_SQL", 1)[1]
        assert "COMMENT ON COLUMN wall_openings.swing IS NULL" in downgrade


class TestRoomUpdateTriggersWallSfRecalc:
    """R16 (round 2): wall_square_footage is a cached value derived from
    room-level inputs (height_ft, ceiling_type, custom_wall_sf) joined with
    wall_segments + wall_openings. The walls/openings CRUD endpoints already
    call _recalculate_room_wall_sf after every mutation (6 sites). The last
    drift gap is room-level fields: if a tech PATCHes height_ft from 8 to
    10, the formula input changes but no wall-level write fires, so the
    cached SF stays stale. This test asserts update_room wires in the same
    recalc hook when any of those three fields are part of the update.
    """

    @staticmethod
    def _update_room_source() -> str:
        import inspect

        from api.rooms.service import update_room

        return inspect.getsource(update_room)

    def test_update_room_calls_recalc_on_wall_sf_input_change(self):
        src = self._update_room_source()
        # The wire-up uses a set of known formula inputs + conditional call.
        assert '{"height_ft", "ceiling_type", "custom_wall_sf"}' in src, (
            "update_room must name the three wall-SF formula inputs so the "
            "recalc hook fires on any of them"
        )
        assert "_recalculate_room_wall_sf" in src, (
            "update_room must invoke _recalculate_room_wall_sf after the main "
            "UPDATE — otherwise stored wall_square_footage drifts when room "
            "height/ceiling/override change"
        )

    def test_update_room_stamps_fresh_sf_on_response(self):
        """After the recalc, the response dict must carry the new SF so the
        caller (frontend mobile modal display, etc.) doesn't render the
        pre-recalc stale value that was on result.data[0]."""
        src = self._update_room_source()
        assert 'room["wall_square_footage"] = fresh_sf' in src


class TestRecalculateRoomWallSfReturnsValue:
    """R16 helper refactor: _recalculate_room_wall_sf now returns the
    freshly computed wall_sf so callers can update their in-memory room
    dicts without a second DB round-trip."""

    def test_function_signature_returns_float_or_none(self):
        import inspect

        from api.walls.service import _recalculate_room_wall_sf

        sig = inspect.signature(_recalculate_room_wall_sf)
        assert str(sig.return_annotation) in ("float | None", "typing.Optional[float]"), (
            "_recalculate_room_wall_sf must return the computed wall_sf so "
            "callers in update_room (R16) can stamp the fresh value on the "
            "response dict without re-fetching the row."
        )


class TestWallSfNonNegChecksMigration:
    """R17 (round 2): job_rooms.wall_square_footage and job_rooms.custom_wall_sf
    had no DB-level sanity constraint. A tech typing -100 into an override (or
    a future calc bug producing a negative) would silently corrupt every
    downstream SF calculation — and therefore Xactimate line items.

    Migration c3d4e5f8a9b0 adds two CHECK constraints with the exact names
    the reviewer specified. NULL stays allowed (not-set case). 0 stays
    allowed (valid edge case). Negative values → 23514 check_violation.
    """

    MIGRATION_FILE = "c3d4e5f8a9b0_spec01h_wall_sf_nonneg_checks.py"

    def _text(self) -> str:
        from pathlib import Path

        path = (
            Path(__file__).resolve().parents[1]
            / "alembic" / "versions" / self.MIGRATION_FILE
        )
        assert path.exists(), f"R17 migration missing at {path}"
        return path.read_text(encoding="utf-8")

    def test_upgrade_adds_custom_wall_sf_constraint(self):
        """Constraint name + shape must match the reviewer's exact snippet
        so anyone reading the PR round-2 thread can confirm the fix is the
        one they approved."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        assert "ADD CONSTRAINT custom_wall_sf_nonneg" in upgrade
        assert "CHECK (custom_wall_sf IS NULL OR custom_wall_sf >= 0)" in upgrade

    def test_upgrade_adds_wall_square_footage_constraint(self):
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        assert "ADD CONSTRAINT wall_square_footage_nonneg" in upgrade
        assert "CHECK (wall_square_footage IS NULL OR wall_square_footage >= 0)" in upgrade

    def test_downgrade_drops_both_constraints(self):
        text = self._text()
        downgrade = text.split("DOWNGRADE_SQL", 1)[1]
        assert "DROP CONSTRAINT IF EXISTS custom_wall_sf_nonneg" in downgrade
        assert "DROP CONSTRAINT IF EXISTS wall_square_footage_nonneg" in downgrade

    def test_revision_chains_after_r14(self):
        text = self._text()
        assert 'revision: str = "c3d4e5f8a9b0"' in text
        assert 'down_revision: str | None = "b2c3d4e5f8a9"' in text


class TestNumericInputInlineErrorMessaging:
    """R17 UX follow-on (round 2): user asked for inline error messages on
    numeric inputs so a typed ``-11`` gives visible feedback instead of
    silently getting rejected. Touches 3 frontend files:

      * cutout-editor-sheet.tsx — Width / Length (Must be greater than 0)
      * floor-plan-sidebar.tsx — NumericInput (out-of-range message)
      * konva-floor-plan.tsx — mobile-sheet Width / Height (Must be > 0)

    The ceiling-height input in room-confirmation-card.tsx uses the
    browser's native min/max prompt and is intentionally left alone.

    These are static text scans against the TS source — same pattern used
    for router + use-jobs hook guards. Runs in pytest, no Vitest needed.
    """

    @staticmethod
    def _read(relative_path: str) -> str:
        from pathlib import Path

        path = (
            Path(__file__).resolve().parents[1].parent / "web" / "src" / relative_path
        )
        assert path.exists(), f"frontend file missing at {path}"
        return path.read_text(encoding="utf-8")

    # ─── cutout-editor-sheet.tsx ─────────────────────────────────────────

    def test_cutout_editor_shows_error_when_invalid(self):
        text = self._read("components/sketch/cutout-editor-sheet.tsx")
        # Both Width and Length get the new "Must be greater than 0" message.
        # There should be at least 2 occurrences — one per field.
        assert text.count('Must be greater than 0') >= 2, (
            "cutout-editor-sheet must show 'Must be greater than 0' for both "
            "Width and Length when the typed value is invalid (non-empty, "
            "non-positive)."
        )

    def test_cutout_editor_error_gated_on_not_valid(self):
        """The message must only render when the value is ACTUALLY invalid —
        not when the field is empty (user mid-edit) or over-max (which has
        its own message). Guards: `!wValid` / `!lValid` + non-empty + !wOver."""
        text = self._read("components/sketch/cutout-editor-sheet.tsx")
        # Both guards should appear exactly next to the new error line.
        assert '!wValid && widthStr !== "" && !wOver' in text
        assert '!lValid && lengthStr !== "" && !lOver' in text

    # ─── floor-plan-sidebar.tsx NumericInput ─────────────────────────────

    def test_numeric_input_derives_draft_invalid_state(self):
        text = self._read("components/sketch/floor-plan-sidebar.tsx")
        assert "const draftInvalid = " in text, (
            "NumericInput must track draft invalidity so the red border + "
            "error message can render live (not after blur-and-revert)."
        )

    def test_numeric_input_shows_error_message(self):
        text = self._read("components/sketch/floor-plan-sidebar.tsx")
        # Error message block keyed off errorMessage state.
        assert "{errorMessage && (" in text
        assert 'text-red-600' in text

    def test_numeric_input_applies_red_border_when_invalid(self):
        text = self._read("components/sketch/floor-plan-sidebar.tsx")
        assert 'draftInvalid ? "border-red-400"' in text

    # ─── konva-floor-plan.tsx mobile sheet ───────────────────────────────

    def test_konva_mobile_sheet_shows_error_for_width(self):
        text = self._read("components/sketch/konva-floor-plan.tsx")
        assert "const wInvalid = widthStr !== \"\" && (!Number.isFinite(wNum) || wNum <= 0)" in text
        # Red border toggles on invalid
        assert 'wInvalid ? "border-red-400"' in text

    def test_konva_mobile_sheet_shows_error_for_height(self):
        text = self._read("components/sketch/konva-floor-plan.tsx")
        assert "const hInvalid = heightStr !== \"\" && (!Number.isFinite(hNum) || hNum <= 0)" in text
        assert 'hInvalid ? "border-red-400"' in text

    def test_konva_mobile_sheet_has_error_messages(self):
        """Both Width and Height need the inline error line."""
        text = self._read("components/sketch/konva-floor-plan.tsx")
        # At least one "Must be greater than 0" per input = 2 minimum.
        assert text.count('Must be greater than 0') >= 2

    # ─── page.tsx RoomDimensionInputs (MobileRoomPanel bottom sheet) ─────
    # Fourth entry point for numeric dimension inputs. Shown when the user
    # taps an existing room on mobile. Same inline error pattern, min=1
    # (matching commit()'s w < 1 || h < 1 guard).

    def test_room_dimension_inputs_tracks_invalid_state(self):
        text = self._read("app/(protected)/jobs/[id]/floor-plan/page.tsx")
        assert "const wInvalid = wStr !== \"\" && (!Number.isFinite(wNum) || wNum < 1)" in text
        assert "const hInvalid = hStr !== \"\" && (!Number.isFinite(hNum) || hNum < 1)" in text

    def test_room_dimension_inputs_applies_red_border(self):
        text = self._read("app/(protected)/jobs/[id]/floor-plan/page.tsx")
        # Both Width and Length inputs swap border colour on invalid.
        assert 'wInvalid ? "border-red-400"' in text
        assert 'hInvalid ? "border-red-400"' in text

    def test_room_dimension_inputs_shows_error_text(self):
        """Tech who typed a negative or sub-1 value sees 'Must be at least 1'
        — instead of the previous silent-reject behavior that left them
        staring at an input that had no effect."""
        text = self._read("app/(protected)/jobs/[id]/floor-plan/page.tsx")
        assert text.count("Must be at least 1") >= 2


class TestUseJobsHookSignatures:
    """R15 (round 2): two frontend hook fixes in web/src/lib/hooks/use-jobs.ts.

    R15a — useUpdateFloorPlan stopped accepting canvas_data (backend dropped
    it from FloorPlanUpdate in round-1 C1). Old signature silently lied.

    R15b — useSaveCanvas now takes jobId so it can invalidate the per-job
    floor-plans list cache and the job row, instead of relying on every
    caller to remember to invalidate manually.

    These are static text assertions against the TS source — matches the
    pattern we use for router guards, runs in plain pytest with no Vitest.
    """

    @staticmethod
    def _text() -> str:
        from pathlib import Path

        path = (
            Path(__file__).resolve().parents[1].parent
            / "web" / "src" / "lib" / "hooks" / "use-jobs.ts"
        )
        assert path.exists(), f"use-jobs.ts not found at {path}"
        return path.read_text(encoding="utf-8")

    @staticmethod
    def _hook_body(hook_name: str, text: str) -> str:
        """Slice just the named hook's body so regex hits don't bleed
        across functions."""
        import re

        m = re.search(
            rf"export function {re.escape(hook_name)}\(.*?(?=^export function |\Z)",
            text,
            re.DOTALL | re.MULTILINE,
        )
        assert m, f"{hook_name} not found in use-jobs.ts"
        return m.group(0)

    # ─── R15a: useUpdateFloorPlan — canvas_data removed ──────────────────

    @staticmethod
    def _strip_comments(src: str) -> str:
        """Remove `//`-style line comments so a word appearing in a comment
        doesn't trigger the check. `/* */` isn't used in this file."""
        import re

        return re.sub(r"//[^\n]*", "", src)

    def test_use_update_floor_plan_no_longer_accepts_canvas_data(self):
        body = self._strip_comments(self._hook_body("useUpdateFloorPlan", self._text()))
        # The mutationFn's type parameter object must not list canvas_data.
        # This catches the class of bug where the hook accepts a field the
        # backend will silently drop.
        assert "canvas_data" not in body, (
            "useUpdateFloorPlan must not list canvas_data in its type signature — "
            "FloorPlanUpdate schema doesn't accept it. Content writes go through "
            "useSaveCanvas (POST /versions) exclusively."
        )

    def test_use_update_floor_plan_still_accepts_metadata_fields(self):
        """Happy-path regression: floor_name and thumbnail_url are the
        legitimate mutable metadata fields. They must still be accepted."""
        body = self._hook_body("useUpdateFloorPlan", self._text())
        assert "floor_name" in body
        assert "thumbnail_url" in body

    # ─── R15b: useSaveCanvas — jobId param + full cache invalidation ─────

    def test_use_save_canvas_takes_job_id(self):
        text = self._text()
        assert "export function useSaveCanvas(floorPlanId: string, jobId: string)" in text, (
            "useSaveCanvas must take jobId so it can invalidate the per-job "
            "floor-plans list cache from inside the hook, instead of relying "
            "on every caller to remember."
        )

    def test_use_save_canvas_invalidates_floor_plans_list(self):
        body = self._hook_body("useSaveCanvas", self._text())
        assert 'queryKey: ["floor-plans", jobId]' in body, (
            'useSaveCanvas must invalidate ["floor-plans", jobId] on success'
        )

    def test_use_save_canvas_invalidates_jobs(self):
        """Save may change room count on the floor — invalidate the job row
        so any job-detail panels showing roomCount refresh."""
        body = self._hook_body("useSaveCanvas", self._text())
        assert 'queryKey: ["jobs", jobId]' in body

    def test_use_save_canvas_still_invalidates_history(self):
        """Regression: don't drop the existing floor-plan-history invalidation
        while adding the new keys."""
        body = self._hook_body("useSaveCanvas", self._text())
        assert 'queryKey: ["floor-plan-history", floorPlanId]' in body


class TestDropRedundantIsCurrentIndexMigration:
    """R13 (round 2): idx_floor_plans_is_current (non-unique) is shadowed by
    idx_floor_plans_current_unique (same columns, same predicate, plus UNIQUE).
    Postgres always picks the unique index for reads, so the non-unique one
    is dead weight on INSERT/UPDATE. Migration a1b2c3d4e5f7 drops it.
    """

    MIGRATION_FILE = "a1b2c3d4e5f7_spec01h_drop_redundant_is_current_index.py"

    def _text(self) -> str:
        from pathlib import Path

        path = (
            Path(__file__).resolve().parents[1]
            / "alembic" / "versions" / self.MIGRATION_FILE
        )
        assert path.exists(), f"R13 migration missing at {path}"
        return path.read_text(encoding="utf-8")

    def test_upgrade_drops_redundant_index(self):
        text = self._text()
        upgrade = text.split("def upgrade", 1)[1].split("def downgrade", 1)[0]
        assert "DROP INDEX IF EXISTS idx_floor_plans_is_current" in upgrade, (
            "R13 upgrade must drop idx_floor_plans_is_current (IF EXISTS for idempotency)"
        )

    def test_downgrade_recreates_the_index(self):
        """Rollback must restore the non-unique index exactly (same columns,
        same predicate) so a downgrade leaves the schema identical to the
        pre-R13 state."""
        text = self._text()
        downgrade = text.split("def downgrade", 1)[1]
        assert "CREATE INDEX" in downgrade and "idx_floor_plans_is_current" in downgrade
        assert "property_id, floor_number" in downgrade
        assert "WHERE is_current = true" in downgrade

    def test_revision_chains_after_r10(self):
        """R13 must chain onto R10 (f0a1b2c3d4e5), not break the head."""
        text = self._text()
        assert 'revision: str = "a1b2c3d4e5f7"' in text
        assert 'down_revision: str | None = "f0a1b2c3d4e5"' in text


class TestRenameVersionsPoliciesMigration:
    """R14 (round 2): policies on the renamed floor_plans table kept their
    pre-rename names (versions_*). This migration renames to floor_plans_*
    for grep-ability. Pure rename — zero behavior change.
    """

    MIGRATION_FILE = "b2c3d4e5f8a9_spec01h_rename_versions_policies.py"

    def _text(self) -> str:
        from pathlib import Path

        path = (
            Path(__file__).resolve().parents[1]
            / "alembic" / "versions" / self.MIGRATION_FILE
        )
        assert path.exists(), f"R14 migration missing at {path}"
        return path.read_text(encoding="utf-8")

    def test_upgrade_renames_all_four_policies(self):
        """select, insert, update, delete — every policy gets the rename."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        for action in ("select", "insert", "update", "delete"):
            assert (
                f"ALTER POLICY versions_{action} ON floor_plans "
                f"RENAME TO floor_plans_{action}" in upgrade
            ), f"R14 upgrade missing rename for versions_{action}"

    def test_upgrade_guards_with_exists_check(self):
        """EXISTS guard keeps the migration re-runnable — second pass on
        already-renamed policies must not error."""
        text = self._text()
        upgrade = text.split("UPGRADE_SQL", 1)[1].split("DOWNGRADE_SQL", 1)[0]
        # One EXISTS guard per policy rename — 4 total.
        assert upgrade.count("IF EXISTS (SELECT 1 FROM pg_policies") == 4

    def test_downgrade_reverses_all_four_renames(self):
        text = self._text()
        downgrade = text.split("DOWNGRADE_SQL", 1)[1]
        for action in ("select", "insert", "update", "delete"):
            assert (
                f"ALTER POLICY floor_plans_{action} ON floor_plans "
                f"RENAME TO versions_{action}" in downgrade
            ), f"R14 downgrade missing reverse rename for floor_plans_{action}"

    def test_revision_chains_after_r13(self):
        text = self._text()
        assert 'revision: str = "b2c3d4e5f8a9"' in text
        assert 'down_revision: str | None = "a1b2c3d4e5f7"' in text


class TestWallsOpeningsParentOwnershipRlsMigration:
    """R10 (round 2): the ``walls_insert`` / ``walls_update`` /
    ``openings_insert`` / ``openings_update`` RLS policies now require that
    the parent row (job_rooms for walls, wall_segments for openings) is
    also in the caller's company — not just the child row. Closes the
    tenant-id side-channel where a bad INSERT could exist-check a foreign
    parent id.
    """

    MIGRATION_FILE = "f0a1b2c3d4e5_spec01h_walls_openings_parent_rls.py"

    def _migration_text(self) -> str:
        from pathlib import Path

        path = (
            Path(__file__).resolve().parents[1]
            / "alembic" / "versions" / self.MIGRATION_FILE
        )
        assert path.exists(), f"R10 migration missing at {path}"
        return path.read_text(encoding="utf-8")

    def test_migration_rewrites_walls_insert_with_parent_exists(self):
        text = self._migration_text()

        assert "CREATE POLICY walls_insert ON wall_segments" in text
        assert "FROM job_rooms jr" in text, (
            "walls_insert policy must join job_rooms for parent-ownership check"
        )
        assert "jr.id = wall_segments.room_id" in text
        assert "jr.company_id = get_my_company_id()" in text

    def test_migration_rewrites_walls_update_with_parent_exists(self):
        text = self._migration_text()

        # walls_update must have both USING (old row) and WITH CHECK (new row)
        # clauses so a row's room_id can't be moved to a foreign room either.
        assert "CREATE POLICY walls_update ON wall_segments" in text
        assert "FOR UPDATE USING (company_id = get_my_company_id())" in text
        assert "WITH CHECK (" in text
        # The EXISTS must appear inside the WITH CHECK block of walls_update,
        # not just inside walls_insert.
        walls_update_block = text.split("walls_update ON wall_segments", 1)[1]
        walls_update_block = walls_update_block.split("DROP POLICY", 1)[0]
        assert "EXISTS" in walls_update_block and "job_rooms" in walls_update_block

    def test_migration_rewrites_openings_insert_with_parent_exists(self):
        text = self._migration_text()

        assert "CREATE POLICY openings_insert ON wall_openings" in text
        assert "FROM wall_segments ws" in text
        assert "ws.id = wall_openings.wall_id" in text
        assert "ws.company_id = get_my_company_id()" in text

    def test_migration_rewrites_openings_update_with_parent_exists(self):
        text = self._migration_text()

        assert "CREATE POLICY openings_update ON wall_openings" in text
        # Scope the EXISTS assertion to the openings_update block
        openings_update_block = text.split("openings_update ON wall_openings", 1)[1]
        openings_update_block = openings_update_block.split("DROP POLICY", 1)[0]
        assert "EXISTS" in openings_update_block
        assert "wall_segments" in openings_update_block

    def test_migration_downgrade_restores_pre_r10_policies(self):
        """Downgrade must reinstate the old child-only policies. Without
        this, an accidental downgrade would leave the tables with no
        walls_insert / openings_insert policy at all — every write fails."""
        text = self._migration_text()

        down = text.split("DOWNGRADE_SQL", 1)[1]
        for policy in ("walls_insert", "walls_update", "openings_insert", "openings_update"):
            assert f"CREATE POLICY {policy}" in down, (
                f"downgrade must recreate {policy} with the old child-only shape"
            )


class TestEnsureJobPropertyRpcMigration:
    """R9 (round 2): the auto-property-link path is now an atomic RPC
    (migration ``e9f0a1b2c3d4``) with SELECT ... FOR UPDATE on the jobs row.
    Tests here are static content scans — we can't apply the migration
    locally because the moisture branch has migrations stacked on top.
    """

    MIGRATION_FILE = "e9f0a1b2c3d4_spec01h_ensure_job_property_rpc.py"

    def _migration_text(self) -> str:
        from pathlib import Path

        path = (
            Path(__file__).resolve().parents[1]
            / "alembic" / "versions" / self.MIGRATION_FILE
        )
        assert path.exists(), f"R9 migration missing at {path}"
        return path.read_text(encoding="utf-8")

    def test_migration_defines_rpc_with_required_hardening(self):
        text = self._migration_text()

        required = {
            "RPC defined":
                "CREATE OR REPLACE FUNCTION ensure_job_property",
            "SECURITY DEFINER":
                "SECURITY DEFINER",
            "search_path pinned":
                "SET search_path",
            "JWT-derived company":
                "get_my_company_id()",
            "row lock on jobs":
                "FOR UPDATE",
            "idempotent fast-path return":
                "IF v_job.property_id IS NOT NULL THEN",
            "same-address reuse":
                "FROM properties",
            "42501 on no-company":
                "'42501'",
            "P0002 on job-not-accessible":
                "'P0002'",
            "grants to authenticated":
                "GRANT EXECUTE ON FUNCTION ensure_job_property",
        }
        missing = [label for label, needle in required.items() if needle not in text]
        assert not missing, (
            "R9 RPC migration missing required elements: " + ", ".join(missing)
        )

    def test_migration_installs_partial_unique_address_index(self):
        text = self._migration_text()

        assert "CREATE UNIQUE INDEX" in text and "idx_properties_address_active" in text, (
            "R9 migration must install the partial unique address index as "
            "belt-and-suspenders for the RPC's FOR UPDATE coordination."
        )
        assert "lower(btrim(address_line1))" in text, (
            "index expression must normalize address_line1 via lower+btrim "
            "so '123 Main St' and '123 main st  ' dedup to one row"
        )
        assert "WHERE deleted_at IS NULL" in text, (
            "index must be partial on deleted_at so soft-deleted rows don't "
            "block re-creation at the same address"
        )

    def test_migration_downgrade_drops_rpc_and_index(self):
        text = self._migration_text()
        assert "DROP FUNCTION IF EXISTS ensure_job_property" in text
        assert "DROP INDEX IF EXISTS idx_properties_address_active" in text


class TestCreateFloorPlanByJobAutoLinkRace:
    """R9 router refactor: ``create_floor_plan_by_job_endpoint`` now calls
    the ``ensure_job_property`` RPC instead of read→INSERT→UPDATE. Static
    check that the old 3-step dance is gone and the RPC call is present.
    """

    @staticmethod
    def _endpoint_source() -> str:
        from pathlib import Path
        import re

        router_path = (
            Path(__file__).resolve().parents[1]
            / "api" / "floor_plans" / "router.py"
        )
        src = router_path.read_text(encoding="utf-8")
        m = re.search(
            r"async def create_floor_plan_by_job_endpoint\(.*?(?=^async def |\Z)",
            src,
            re.DOTALL | re.MULTILINE,
        )
        assert m, "create_floor_plan_by_job_endpoint not found"
        return m.group(0)

    def test_calls_ensure_job_property_rpc(self):
        body = self._endpoint_source()
        assert 'client.rpc(' in body and '"ensure_job_property"' in body, (
            "create_floor_plan_by_job_endpoint must call the ensure_job_property "
            "RPC instead of the old non-atomic read→INSERT→UPDATE sequence."
        )

    def test_old_non_atomic_block_is_gone(self):
        """Regression guard: the deleted INSERT-into-properties + UPDATE-jobs
        pair must not reappear inline. Fires if a future edit accidentally
        reintroduces the racy path.
        """
        body = self._endpoint_source()
        assert 'client.table("properties")\n            .insert(' not in body, (
            "Inline .table('properties').insert(...) is the old racy path. "
            "Use the ensure_job_property RPC."
        )
        # The "UPDATE jobs SET property_id" step of the old dance also goes
        # away — the RPC now owns that write.
        assert 'client.table("jobs")\n            .update({"property_id"' not in body, (
            "Inline .table('jobs').update({'property_id': ...}) from the old "
            "auto-link dance must not reappear. The RPC owns this write."
        )


class TestFrozenMutationTriggerMigration:
    """R4 belt-and-suspenders (round 2): a database trigger enforces that
    rows with ``is_current = false`` cannot be UPDATEd. Defense-in-depth
    behind the application-level ``.eq("is_current", True)`` filters added
    to update_floor_plan and cleanup_floor_plan.

    We can't apply the migration here (moisture branch divergence), so the
    test is a static content scan of the migration file — if a future edit
    weakens the trigger to, say, only guard ``canvas_data`` changes, this
    test fires.
    """

    def test_migration_installs_prevent_frozen_mutation_trigger(self):
        from pathlib import Path

        migration = (
            Path(__file__).resolve().parents[1]
            / "alembic"
            / "versions"
            / "d8e9f0a1b2c3_spec01h_floor_plans_frozen_trigger.py"
        )
        assert migration.exists(), f"R4 trigger migration missing at {migration}"
        text = migration.read_text(encoding="utf-8")

        required = {
            "trigger function defined":
                "CREATE OR REPLACE FUNCTION floor_plans_prevent_frozen_mutation",
            "fires BEFORE UPDATE":
                "BEFORE UPDATE ON floor_plans",
            "checks OLD.is_current":
                "OLD.is_current IS FALSE",
            "raises SQLSTATE 42501":
                "'42501'",
            "search_path pinned":
                "SET search_path",
            "downgrade drops trigger":
                "DROP TRIGGER IF EXISTS trg_floor_plans_prevent_frozen_mutation",
        }
        missing = [label for label, needle in required.items() if needle not in text]
        assert not missing, (
            "R4 belt-and-suspenders trigger migration is missing required "
            "elements: " + ", ".join(missing)
        )


class TestCleanupFloorPlanTOCTOU:
    """cleanup_floor_plan's UPDATE at L1242 has the same TOCTOU shape as
    update_floor_plan. Same fix: atomic is_current filter + VERSION_FROZEN
    on zero-row result.
    """

    @pytest.mark.asyncio
    async def test_cleanup_zero_rows_matched_raises_version_frozen(self):
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.shared.exceptions import AppException

        floor_plan_id = uuid4()
        client = _UpdateTOCTOUClient(
            floor_plan_id=floor_plan_id,
            is_current_on_read=True,
            update_rows_matched=0,
        )

        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=client),
        ), patch.object(
            fp_service, "ensure_job_mutable",
            AsyncMock(return_value={"id": "job-id", "status": "active", "property_id": client.property_id}),
        ), patch.object(
            fp_service, "cleanup_sketch",
            MagicMock(return_value={"walls": [{"x1": 0, "y1": 0, "x2": 10, "y2": 0}]}),
        ), patch.object(
            fp_service, "log_event", AsyncMock(),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.cleanup_floor_plan(
                    token="test",
                    floor_plan_id=floor_plan_id,
                    job_id=uuid4(),
                    company_id=uuid4(),
                    user_id=uuid4(),
                    client_canvas_data=None,
                )
        assert exc_info.value.status_code == 403
        assert exc_info.value.error_code == "VERSION_FROZEN"

    @pytest.mark.asyncio
    async def test_cleanup_writes_when_row_still_current(self):
        """Happy path regression — cleaned canvas lands and response is
        returned unchanged when the is_current filter matches."""
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service

        floor_plan_id = uuid4()
        cleaned_walls = [{"x1": 0, "y1": 0, "x2": 10, "y2": 0}]
        client = _UpdateTOCTOUClient(
            floor_plan_id=floor_plan_id,
            is_current_on_read=True,
            update_rows_matched=1,
        )

        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=client),
        ), patch.object(
            fp_service, "ensure_job_mutable",
            AsyncMock(return_value={"id": "job-id", "status": "active", "property_id": client.property_id}),
        ), patch.object(
            fp_service, "cleanup_sketch",
            MagicMock(return_value={"walls": cleaned_walls}),
        ), patch.object(
            fp_service, "log_event", AsyncMock(),
        ):
            result = await fp_service.cleanup_floor_plan(
                token="test",
                floor_plan_id=floor_plan_id,
                job_id=uuid4(),
                company_id=uuid4(),
                user_id=uuid4(),
                client_canvas_data=None,
            )
        assert result["canvas_data"] == {"walls": cleaned_walls}


# ---------------------------------------------------------------------------
# R5 (round 2): rollback_version + cleanup_floor_plan must reject a job
# whose property doesn't own the target floor plan. Round-1 W1 added this
# check only to save_canvas; the helper assert_job_on_floor_plan_property
# is now shared across all three call sites.
# ---------------------------------------------------------------------------


class _RollbackClient:
    """Fake client for rollback_version tests. Four sequential SELECTs:
    (1) jobs → returns {status, property_id}
    (2) floor_plans anchor → returns {property_id, floor_number}
    (3) floor_plans target version → returns a row with canvas_data
    _create_version is patched separately, so no UPDATE/INSERT path here.
    """

    def __init__(self, *, job_property_id, floor_plan_property_id, job_status="active"):
        self._calls = 0
        self._job_property_id = str(job_property_id)
        self._fp_property_id = str(floor_plan_property_id)
        self._job_status = job_status

    def table(self, _name):
        outer = self

        class QB:
            def select(self, *_a, **_kw): return self
            def eq(self, *_a, **_kw): return self
            def is_(self, *_a, **_kw): return self
            def single(self): return self
            async def execute(self):
                outer._calls += 1
                r = MagicMock()
                if outer._calls == 1:  # jobs
                    r.data = {
                        "status": outer._job_status,
                        "property_id": outer._job_property_id,
                    }
                elif outer._calls == 2:  # anchor
                    r.data = {
                        "property_id": outer._fp_property_id,
                        "floor_number": 1,
                    }
                else:  # target version (only reached if property check passes)
                    r.data = {
                        "id": str(uuid4()),
                        "canvas_data": {"walls": []},
                        "version_number": 1,
                    }
                return r

        return QB()

    # Round-2 follow-on (F1): rollback_version now calls a single atomic
    # wrapper RPC (rollback_floor_plan_version_atomic) which returns
    # {"version": {...}, "restore": {...}}. Earlier intermediate code
    # called restore_floor_plan_relational_snapshot separately — that path
    # is gone. Return the wrapper shape so rollback_version's happy path
    # can complete and the test assertions on the returned version hold.
    def rpc(self, _name, _params=None):
        class RpcQB:
            async def execute(self):
                r = MagicMock()
                r.data = {
                    "version": {
                        "id": str(uuid4()),
                        "version_number": 2,
                        "is_current": True,
                    },
                    "restore": {
                        "restored": False,
                        "reason": "no_snapshot",
                        "rooms": 0, "walls": 0, "openings": 0,
                        "skipped_rooms": [],
                    },
                }
                return r
        return RpcQB()


class TestRollbackVersionCrossProperty:
    """rollback_version must reject a job_id whose property doesn't own the
    floor plan being rolled back. Same-company user with job on property A
    cannot rollback a floor plan on property B — even though both are
    readable to them via RLS."""

    @pytest.mark.asyncio
    async def test_rejects_cross_property_job(self):
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.shared.exceptions import AppException

        job_property = uuid4()
        fp_property = uuid4()  # different

        client = _RollbackClient(
            job_property_id=job_property,
            floor_plan_property_id=fp_property,
        )
        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=client),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.rollback_version(
                    token="test",
                    floor_plan_id=uuid4(),
                    version_number=1,
                    job_id=uuid4(),
                    company_id=uuid4(),
                    user_id=uuid4(),
                )
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "PROPERTY_MISMATCH"

    @pytest.mark.asyncio
    async def test_allows_same_property_job(self):
        """Happy path: job and floor plan share property_id → rollback reaches
        the atomic wrapper RPC, which returns a new version payload. We
        assert the version dict shape is unwrapped from the RPC response
        and returned to the caller unchanged.
        """
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service

        shared_property = uuid4()
        client = _RollbackClient(
            job_property_id=shared_property,
            floor_plan_property_id=shared_property,
        )

        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=client),
        ), patch.object(
            fp_service, "log_event", AsyncMock(),
        ):
            result = await fp_service.rollback_version(
                token="test",
                floor_plan_id=uuid4(),
                version_number=1,
                job_id=uuid4(),
                company_id=uuid4(),
                user_id=uuid4(),
            )
        # _RollbackClient.rpc() returns a fixed wrapper payload; rollback_version
        # should hand back the `version` slice of that payload.
        assert result["version_number"] == 2
        assert result["is_current"] is True


class TestRollbackVersionNullProperty:
    """R8 (round 2): rollback_version must reject a job whose property_id
    is NULL. The shared helper used to skip silently; the rewrite raises
    JOB_NO_PROPERTY so the write never lands against a cross-property
    floor plan by bypass.
    """

    @pytest.mark.asyncio
    async def test_rejects_job_with_null_property(self):
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.shared.exceptions import AppException

        client = _RollbackClient(
            job_property_id="unused",  # overridden below
            floor_plan_property_id=uuid4(),
        )
        # Override the first SELECT response so jobs.property_id is NULL.
        async def _null_exec_shim(calls_ref=[0]):
            calls_ref[0] += 1
            r = MagicMock()
            if calls_ref[0] == 1:
                r.data = {"status": "active", "property_id": None}
            else:
                r.data = {"property_id": str(uuid4()), "floor_number": 1}
            return r
        client.table = lambda _name, _shim=_null_exec_shim: _NullPropQB(_shim)

        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=client),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.rollback_version(
                    token="test",
                    floor_plan_id=uuid4(),
                    version_number=1,
                    job_id=uuid4(),
                    company_id=uuid4(),
                    user_id=uuid4(),
                )
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "JOB_NO_PROPERTY"


class _NullPropQB:
    """Minimal query-builder fake that delegates .execute() to a supplied
    async shim. Used by TestRollbackVersionNullProperty to script the two
    sequential SELECT responses."""

    def __init__(self, shim):
        self._shim = shim

    def select(self, *_a, **_kw): return self
    def eq(self, *_a, **_kw): return self
    def is_(self, *_a, **_kw): return self
    def single(self): return self

    async def execute(self):
        return await self._shim()


class TestCleanupFloorPlanNullProperty:
    """R8: cleanup_floor_plan also rejects a job with NULL property_id —
    prevents a data-integrity NULL from silently permitting a cross-property
    cleanup under the former legacy-accommodation branch."""

    @pytest.mark.asyncio
    async def test_rejects_job_with_null_property(self):
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.shared.exceptions import AppException

        floor_plan_id = uuid4()
        fp_property = uuid4()
        client = _UpdateTOCTOUClient(
            floor_plan_id=floor_plan_id,
            property_id=fp_property,
            is_current_on_read=True,
            update_rows_matched=1,
        )
        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=client),
        ), patch.object(
            fp_service, "ensure_job_mutable",
            AsyncMock(return_value={
                "id": "job-id",
                "status": "active",
                "property_id": None,  # R8: must be rejected
            }),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.cleanup_floor_plan(
                    token="test",
                    floor_plan_id=floor_plan_id,
                    job_id=uuid4(),
                    company_id=uuid4(),
                    user_id=uuid4(),
                    client_canvas_data=None,
                )
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "JOB_NO_PROPERTY"


class TestCleanupFloorPlanCrossProperty:
    """Companion to TestRollbackVersionCrossProperty — same R5 check wired
    into cleanup_floor_plan. Uses _UpdateTOCTOUClient (current-row read) plus
    a mocked ensure_job_mutable that declares a different property_id than
    the floor plan's. Property check must fire BEFORE the UPDATE.
    """

    @pytest.mark.asyncio
    async def test_rejects_cross_property_job(self):
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.shared.exceptions import AppException

        floor_plan_id = uuid4()
        fp_property = uuid4()
        job_property = uuid4()  # different
        client = _UpdateTOCTOUClient(
            floor_plan_id=floor_plan_id,
            property_id=fp_property,
            is_current_on_read=True,
            update_rows_matched=1,  # irrelevant — property check fires first
        )
        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=client),
        ), patch.object(
            fp_service, "ensure_job_mutable",
            AsyncMock(return_value={
                "id": "job-id",
                "status": "active",
                "property_id": str(job_property),
            }),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.cleanup_floor_plan(
                    token="test",
                    floor_plan_id=floor_plan_id,
                    job_id=uuid4(),
                    company_id=uuid4(),
                    user_id=uuid4(),
                    client_canvas_data=None,
                )
        assert exc_info.value.status_code == 400
        assert exc_info.value.error_code == "PROPERTY_MISMATCH"


# ---------------------------------------------------------------------------
# R6 (round 2): archive-job guard wired into 3 by-job floor-plan endpoints.
# get_valid_job only rejects soft-deleted rows; collected jobs slipped
# through on POST/PATCH/DELETE /jobs/{id}/floor-plans. raise_if_archived
# is now called at the top of each. Tests verify (a) the helper raises
# correctly for each input shape, and (b) every by-job floor-plan
# endpoint calls the helper before any IO.
# ---------------------------------------------------------------------------


class TestCreateFloorPlanConcurrentEdit:
    """create_floor_plan's INSERT must map Postgres 23505 (partial unique
    index violation on ``is_current=true`` per (property, floor)) to 409
    CONCURRENT_EDIT so the client can retry. Round-1 C2 only wired this
    handling into ``_create_version``; the initial create path surfaced
    the race as a bare 500 DB_ERROR.
    """

    @pytest.mark.asyncio
    async def test_insert_23505_raises_409_concurrent_edit(self):
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.floor_plans.schemas import FloorPlanCreate
        from api.shared.exceptions import AppException

        class QB:
            def __init__(self):
                self._mode = None

            def select(self, *_a, **_kw):
                self._mode = "select"
                return self

            def insert(self, _payload):
                self._mode = "insert"
                return self

            def eq(self, *_a, **_kw): return self

            async def execute(self):
                if self._mode == "select":
                    r = MagicMock()
                    r.data = []  # no existing floor plan — pass the pre-check
                    return r
                # insert path — simulate the race: partial unique index fires.
                raise APIError({
                    "message": "duplicate key value violates unique constraint "
                               "\"idx_floor_plans_current_unique\"",
                    "code": "23505",
                    "details": "",
                })

        class FakeClient:
            def table(self, _name): return QB()

        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=FakeClient()),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.create_floor_plan(
                    token="test",
                    property_id=uuid4(),
                    company_id=uuid4(),
                    user_id=uuid4(),
                    body=FloorPlanCreate(floor_number=1, floor_name="Main"),
                )
        assert exc_info.value.status_code == 409
        assert exc_info.value.error_code == "CONCURRENT_EDIT"

    @pytest.mark.asyncio
    async def test_insert_non_23505_still_raises_500_db_error(self):
        """Connection/permission errors keep the existing 500 DB_ERROR shape
        — we only special-case the unique-violation race."""
        from unittest.mock import AsyncMock

        import api.floor_plans.service as fp_service
        from api.floor_plans.schemas import FloorPlanCreate
        from api.shared.exceptions import AppException

        class QB:
            def __init__(self):
                self._mode = None

            def select(self, *_a, **_kw):
                self._mode = "select"
                return self

            def insert(self, _payload):
                self._mode = "insert"
                return self

            def eq(self, *_a, **_kw): return self

            async def execute(self):
                if self._mode == "select":
                    r = MagicMock()
                    r.data = []
                    return r
                raise APIError({
                    "message": "connection refused",
                    "code": "08006",
                    "details": "",
                })

        class FakeClient:
            def table(self, _name): return QB()

        with patch.object(
            fp_service, "get_authenticated_client",
            AsyncMock(return_value=FakeClient()),
        ):
            with pytest.raises(AppException) as exc_info:
                await fp_service.create_floor_plan(
                    token="test",
                    property_id=uuid4(),
                    company_id=uuid4(),
                    user_id=uuid4(),
                    body=FloorPlanCreate(floor_number=1, floor_name="Main"),
                )
        assert exc_info.value.status_code == 500
        assert exc_info.value.error_code == "DB_ERROR"


class TestRaiseIfArchivedHelper:
    """Behavioral tests for the archive-job guard helper itself. Shared by
    the 3 by-job router endpoints for R6 (and by ensure_job_mutable)."""

    def test_collected_status_raises_job_archived(self):
        from api.shared.exceptions import AppException
        from api.shared.guards import raise_if_archived

        with pytest.raises(AppException) as exc_info:
            raise_if_archived({"status": "collected", "deleted_at": None})
        assert exc_info.value.status_code == 403
        assert exc_info.value.error_code == "JOB_ARCHIVED"

    def test_active_status_returns_none(self):
        from api.shared.guards import raise_if_archived

        # No exception raised for a live job.
        result = raise_if_archived({"status": "active", "deleted_at": None})
        assert result is None

    def test_deleted_at_raises_job_not_found(self):
        """Soft-deleted rows short-circuit to 404 rather than leaking that
        they exist. Keeps the behavior consistent across get_valid_job and
        this in-memory guard."""
        from api.shared.exceptions import AppException
        from api.shared.guards import raise_if_archived

        with pytest.raises(AppException) as exc_info:
            raise_if_archived({"status": "active", "deleted_at": "2026-04-01T00:00:00Z"})
        assert exc_info.value.status_code == 404
        assert exc_info.value.error_code == "JOB_NOT_FOUND"


class TestByJobRouterArchiveGuards:
    """Static guardrail: the 3 by-job floor-plan router endpoints must call
    raise_if_archived(job) at the top of their bodies. R6 plugged the last
    leaks in the archive gate; this test fires if a future edit removes
    the guard from any of them.

    We read the router file as text rather than via inspect because
    ``api.floor_plans.router`` imports as the APIRouter instance (module
    shadowing), making ``inspect.getsource(module.fn)`` unavailable.
    """

    @staticmethod
    def _router_source() -> str:
        from pathlib import Path

        router_path = (
            Path(__file__).resolve().parents[1] / "api" / "floor_plans" / "router.py"
        )
        return router_path.read_text(encoding="utf-8")

    @staticmethod
    def _body_for(defn: str, src: str) -> str:
        """Return the function body starting at ``async def <defn>(`` up to
        the next ``^async def`` (or EOF). Gives us a bounded window so we
        don't accidentally match ``raise_if_archived`` from a different fn.
        """
        import re

        match = re.search(
            rf"async def {re.escape(defn)}\(.*?(?=^async def |\Z)",
            src,
            re.DOTALL | re.MULTILINE,
        )
        assert match, f"function {defn} not found in router.py"
        return match.group(0)

    def test_create_floor_plan_by_job_calls_raise_if_archived(self):
        body = self._body_for("create_floor_plan_by_job_endpoint", self._router_source())
        assert "raise_if_archived(job)" in body, (
            "create_floor_plan_by_job_endpoint must call raise_if_archived(job) — "
            "get_valid_job does not block collected jobs."
        )

    def test_update_floor_plan_by_job_calls_raise_if_archived(self):
        body = self._body_for("update_floor_plan_by_job_endpoint", self._router_source())
        assert "raise_if_archived(job)" in body, (
            "update_floor_plan_by_job_endpoint must call raise_if_archived(job)."
        )

    def test_delete_floor_plan_by_job_calls_raise_if_archived(self):
        body = self._body_for("delete_floor_plan_by_job_endpoint", self._router_source())
        assert "raise_if_archived(job)" in body, (
            "delete_floor_plan_by_job_endpoint must call raise_if_archived(job)."
        )


# ---------------------------------------------------------------------------
# W6: canvas_data size cap (500KB) prevents oversized JSON payloads
# ---------------------------------------------------------------------------


class TestCanvasDataSizeCap:
    """FloorPlanSaveRequest.canvas_data was accepted as an opaque dict with
    no size limit — a client could POST 10MB+ of JSON. We now cap the
    serialized size at ~500KB across save, create, and cleanup requests."""

    def test_save_rejects_oversized_canvas(self):
        from pydantic import ValidationError

        from api.floor_plans.schemas import FloorPlanSaveRequest

        # 600KB payload — well above the 500KB cap
        big_blob = {"walls": ["x" * 100 for _ in range(6000)]}
        with pytest.raises(ValidationError) as exc_info:
            FloorPlanSaveRequest(
                job_id=uuid4(),
                canvas_data=big_blob,
                change_summary=None,
            )
        assert any(
            "too large" in str(e.get("msg", ""))
            for e in exc_info.value.errors()
        )

    def test_save_accepts_reasonable_canvas(self):
        from api.floor_plans.schemas import FloorPlanSaveRequest

        # ~100 walls is a large real sketch, well under the cap
        normal = {"walls": [{"x1": 0, "y1": 0, "x2": 240, "y2": 0} for _ in range(100)]}
        req = FloorPlanSaveRequest(
            job_id=uuid4(),
            canvas_data=normal,
            change_summary="edit",
        )
        assert req.canvas_data is not None

    def test_cleanup_rejects_oversized_canvas(self):
        """Cleanup accepts optional canvas_data — same cap applies."""
        from pydantic import ValidationError

        from api.floor_plans.schemas import SketchCleanupRequest

        big_blob = {"walls": ["x" * 100 for _ in range(6000)]}
        with pytest.raises(ValidationError):
            SketchCleanupRequest(job_id=uuid4(), canvas_data=big_blob)

    def test_cleanup_accepts_none_canvas(self):
        from api.floor_plans.schemas import SketchCleanupRequest

        req = SketchCleanupRequest(job_id=uuid4(), canvas_data=None)
        assert req.canvas_data is None


# ---------------------------------------------------------------------------
# W7: _copy_rooms_from_linked_job re-raises DB errors instead of returning 0
# ---------------------------------------------------------------------------


class TestCopyRoomsFromLinkedJobErrors:
    """Previously the function caught Exception on both fetch + copy and
    returned 0. Callers couldn't tell "source has no rooms" (legitimate)
    from "copy crashed" (broken data). Now fetch/copy APIErrors re-raise
    as AppException; only a truly empty source returns 0."""

    @pytest.mark.asyncio
    async def test_fetch_failure_raises_500(self):
        from postgrest.exceptions import APIError

        from api.jobs.service import _copy_rooms_from_linked_job
        from api.shared.exceptions import AppException

        class QB:
            def select(self, *_a, **_kw): return self
            def eq(self, *_a, **_kw): return self
            async def execute(self):
                raise APIError(
                    {"message": "connection refused", "code": "08006", "details": ""}
                )

        class FakeClient:
            def table(self, _name): return QB()

        with pytest.raises(AppException) as exc_info:
            await _copy_rooms_from_linked_job(
                client=FakeClient(),
                source_job_id=uuid4(),
                new_job_id=uuid4(),
                company_id=uuid4(),
            )
        assert exc_info.value.status_code == 500
        assert exc_info.value.error_code == "LINKED_ROOMS_FETCH_FAILED"

    @pytest.mark.asyncio
    async def test_copy_failure_raises_500(self):
        """Fetch succeeds, but the subsequent INSERT fails — re-raise."""
        from postgrest.exceptions import APIError

        from api.jobs.service import _copy_rooms_from_linked_job
        from api.shared.exceptions import AppException

        class QB:
            def __init__(self):
                self.mode = "fetch"

            def select(self, *_a, **_kw): self.mode = "fetch"; return self
            def eq(self, *_a, **_kw): return self
            def insert(self, _rows): self.mode = "insert"; return self

            async def execute(self):
                if self.mode == "fetch":
                    r = MagicMock()
                    r.data = [{"room_name": "Kitchen", "sort_order": 0}]
                    return r
                # insert path: fail
                raise APIError(
                    {"message": "duplicate key", "code": "23505", "details": ""}
                )

        class FakeClient:
            def table(self, _name): return QB()

        with pytest.raises(AppException) as exc_info:
            await _copy_rooms_from_linked_job(
                client=FakeClient(),
                source_job_id=uuid4(),
                new_job_id=uuid4(),
                company_id=uuid4(),
            )
        assert exc_info.value.status_code == 500
        assert exc_info.value.error_code == "LINKED_ROOMS_COPY_FAILED"

    @pytest.mark.asyncio
    async def test_empty_source_returns_zero(self):
        """Legitimate: source job has no rooms. Returns 0, no exception."""
        from api.jobs.service import _copy_rooms_from_linked_job

        class QB:
            def select(self, *_a, **_kw): return self
            def eq(self, *_a, **_kw): return self
            async def execute(self):
                r = MagicMock()
                r.data = []
                return r

        class FakeClient:
            def table(self, _name): return QB()

        count = await _copy_rooms_from_linked_job(
            client=FakeClient(),
            source_job_id=uuid4(),
            new_job_id=uuid4(),
            company_id=uuid4(),
        )
        assert count == 0
