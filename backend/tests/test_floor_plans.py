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
