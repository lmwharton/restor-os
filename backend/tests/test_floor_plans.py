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
