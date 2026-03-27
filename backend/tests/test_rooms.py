"""Tests for rooms endpoints (Spec 03 — Rooms)."""

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
    return "test-secret-for-rooms"


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
def mock_room_id():
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
def mock_user_row(mock_user_id, mock_auth_user_id, mock_company_id):
    return {
        "id": str(mock_user_id),
        "auth_user_id": str(mock_auth_user_id),
        "company_id": str(mock_company_id),
        "role": "owner",
        "is_platform_admin": False,
    }


@pytest.fixture
def mock_room_row(mock_room_id, mock_job_id, mock_company_id):
    return {
        "id": str(mock_room_id),
        "job_id": str(mock_job_id),
        "company_id": str(mock_company_id),
        "floor_plan_id": None,
        "room_name": "Kitchen",
        "length_ft": 12.0,
        "width_ft": 10.0,
        "height_ft": 8.0,
        "square_footage": 120.0,
        "water_category": "1",
        "water_class": "2",
        "dry_standard": None,
        "equipment_air_movers": 0,
        "equipment_dehus": 0,
        "room_sketch_data": None,
        "notes": None,
        "sort_order": 0,
        "reading_count": 0,
        "latest_reading_date": None,
        "created_at": MOCK_NOW,
        "updated_at": MOCK_NOW,
    }


def _setup_mocks(jwt_secret, mock_user_row, mock_job_row):
    """Return context managers for auth + job validation."""
    mock_admin = MagicMock()
    (
        mock_admin.table.return_value.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
    ).data = mock_user_row

    mock_auth_client = MagicMock()
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
# POST /v1/jobs/{job_id}/rooms
# ---------------------------------------------------------------------------


class TestCreateRoom:
    """Test POST /v1/jobs/{job_id}/rooms."""

    def test_create_room_success(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
        mock_room_row,
    ):
        """POST with valid data -> 201, square_footage auto-calculated from l*w."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = MagicMock()
        # insert result
        (mock_service_client.table.return_value.insert.return_value.execute.return_value).data = [
            mock_room_row
        ]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.rooms.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms",
                json={
                    "room_name": "Kitchen",
                    "length_ft": 12.0,
                    "width_ft": 10.0,
                    "water_category": "1",
                    "water_class": "2",
                },
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["room_name"] == "Kitchen"
            assert float(data["square_footage"]) == 120.0
            assert data["reading_count"] == 0

    def test_create_room_with_floor_plan(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_floor_plan_id,
        mock_user_row,
        mock_job_row,
        mock_room_row,
    ):
        """POST with floor_plan_id -> 201 after validating floor plan exists."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        room_with_fp = {**mock_room_row, "floor_plan_id": str(mock_floor_plan_id)}

        mock_service_client = MagicMock()
        # floor plan validation check
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [{"id": str(mock_floor_plan_id)}]
        # insert result
        (mock_service_client.table.return_value.insert.return_value.execute.return_value).data = [
            room_with_fp
        ]

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.rooms.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms",
                json={
                    "room_name": "Kitchen",
                    "floor_plan_id": str(mock_floor_plan_id),
                },
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["floor_plan_id"] == str(mock_floor_plan_id)

    def test_create_room_invalid_water_category(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST with invalid water_category -> 400 INVALID_WATER_CATEGORY."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms",
                json={
                    "room_name": "Kitchen",
                    "water_category": "5",
                },
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "INVALID_WATER_CATEGORY"


# ---------------------------------------------------------------------------
# GET /v1/jobs/{job_id}/rooms
# ---------------------------------------------------------------------------


class TestListRooms:
    """Test GET /v1/jobs/{job_id}/rooms."""

    def test_list_rooms(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
        mock_room_row,
    ):
        """GET -> 200 with list of rooms including reading_count."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = MagicMock()
        # list query
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.order.return_value.execute.return_value
        ).data = [mock_room_row]
        # moisture readings query (empty)
        (
            mock_service_client.table.return_value.select.return_value.in_.return_value.execute.return_value
        ).data = []

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.rooms.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.get(
                f"/v1/jobs/{mock_job_id}/rooms",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 1
            assert data[0]["room_name"] == "Kitchen"


# ---------------------------------------------------------------------------
# PATCH /v1/jobs/{job_id}/rooms/{room_id}
# ---------------------------------------------------------------------------


class TestUpdateRoom:
    """Test PATCH /v1/jobs/{job_id}/rooms/{room_id}."""

    def test_update_room_equipment(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_room_id,
        mock_user_row,
        mock_job_row,
        mock_room_row,
    ):
        """PATCH equipment counts -> 200 with updated values."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        updated_row = {
            **mock_room_row,
            "equipment_air_movers": 3,
            "equipment_dehus": 1,
        }

        mock_service_client = MagicMock()
        # existing room lookup
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_room_row
        # update result
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [updated_row]
        # moisture readings for stats
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.execute.return_value
        ).data = []

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.rooms.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}",
                json={"equipment_air_movers": 3, "equipment_dehus": 1},
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["equipment_air_movers"] == 3
            assert data["equipment_dehus"] == 1

    def test_update_room_dimensions_recalc_sqft(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_room_id,
        mock_user_row,
        mock_job_row,
        mock_room_row,
    ):
        """PATCH with new dimensions -> 200, square_footage recalculated."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        # Existing room has 12x10 = 120 sqft. Update to 15x12 = 180 sqft.
        updated_row = {
            **mock_room_row,
            "length_ft": 15.0,
            "width_ft": 12.0,
            "square_footage": 180.0,
        }

        mock_service_client = MagicMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_room_row
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [updated_row]
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.execute.return_value
        ).data = []

        with (
            patches[0],
            patches[1],
            patches[2],
            patches[3],
            patch(
                "api.rooms.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}",
                json={"length_ft": 15.0, "width_ft": 12.0},
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert float(data["square_footage"]) == 180.0


# ---------------------------------------------------------------------------
# DELETE /v1/jobs/{job_id}/rooms/{room_id}
# ---------------------------------------------------------------------------


class TestDeleteRoom:
    """Test DELETE /v1/jobs/{job_id}/rooms/{room_id}."""

    def test_delete_room(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_room_id,
        mock_user_row,
        mock_job_row,
    ):
        """DELETE existing room -> 204."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = MagicMock()
        # existing room lookup
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = {"id": str(mock_room_id), "room_name": "Kitchen"}
        # unlink photos + delete
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
                "api.rooms.service.get_authenticated_client",
                return_value=mock_service_client,
            ),
        ):
            response = client.delete(
                f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}",
                headers=auth_headers,
            )
            assert response.status_code == 204
