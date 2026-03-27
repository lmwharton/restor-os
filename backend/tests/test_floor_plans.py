"""Tests for floor plans endpoints (Spec 03 — Floor Plans)."""

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
    """Return context managers that mock auth + job validation + service DB calls."""
    mock_admin = MagicMock()
    # Auth context: user lookup
    (
        mock_admin.table.return_value.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
    ).data = mock_user_row

    mock_auth_client = MagicMock()
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
        patch("api.shared.events.get_supabase_admin_client", return_value=MagicMock()),
    )


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

        mock_service_client = MagicMock()
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

        mock_service_client = MagicMock()
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
        mock_admin = MagicMock()
        (
            mock_admin.table.return_value.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
        ).data = mock_user_row

        mock_auth_client = MagicMock()
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

        mock_service_client = MagicMock()
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
            assert isinstance(data, list)
            assert len(data) == 1
            assert data[0]["floor_number"] == 1


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

        mock_service_client = MagicMock()
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

        mock_service_client = MagicMock()
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

        mock_service_client = MagicMock()
        # Floor plan fetch returns canvas_data
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = {
            "id": str(mock_floor_plan_id),
            "canvas_data": canvas,
        }
        # Update after cleanup
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.execute.return_value
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
        """Cleanup with no canvas_data -> 400."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = MagicMock()
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

        mock_service_client = MagicMock()
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
            assert "canvas_data" in data
            assert "changes_made" in data
            assert "event_id" in data
            assert "cost_cents" in data
            assert data["cost_cents"] == 0  # stub
