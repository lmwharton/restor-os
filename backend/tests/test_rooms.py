"""Tests for rooms endpoints (Spec 03 -- Rooms).

Covers: create, list, get (via list), update, delete.
Uses _setup_mocks pattern consistent with other test files in the suite.
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
    mock_admin = AsyncSupabaseMock()
    (
        mock_admin.table.return_value.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
    ).data = mock_user_row

    mock_auth_client = AsyncSupabaseMock()
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
# AUTH TESTS (shared across endpoints)
# ---------------------------------------------------------------------------


class TestRoomsAuth:
    """Auth tests for rooms endpoints."""

    def test_no_auth_header_create(self, client, mock_job_id):
        """POST without Authorization header -> 401."""
        response = client.post(
            f"/v1/jobs/{mock_job_id}/rooms",
            json={"room_name": "Kitchen"},
        )
        assert response.status_code == 401

    def test_no_auth_header_list(self, client, mock_job_id):
        """GET without Authorization header -> 401."""
        response = client.get(f"/v1/jobs/{mock_job_id}/rooms")
        assert response.status_code == 401

    def test_no_auth_header_update(self, client, mock_job_id, mock_room_id):
        """PATCH without Authorization header -> 401."""
        response = client.patch(
            f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}",
            json={"room_name": "Updated"},
        )
        assert response.status_code == 401

    def test_no_auth_header_delete(self, client, mock_job_id, mock_room_id):
        """DELETE without Authorization header -> 401."""
        response = client.delete(f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}")
        assert response.status_code == 401

    def test_invalid_token(self, client, mock_job_id):
        """POST with garbage token -> 401."""
        response = client.post(
            f"/v1/jobs/{mock_job_id}/rooms",
            json={"room_name": "Kitchen"},
            headers={"Authorization": "Bearer garbage-token"},
        )
        assert response.status_code == 401


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

        mock_service_client = AsyncSupabaseMock()
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
            assert data["latest_reading_date"] is None

    def test_create_room_minimal_fields(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST with only room_name (minimum required) -> 201."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        minimal_row = {
            "id": str(uuid4()),
            "job_id": str(mock_job_id),
            "company_id": str(mock_user_row["company_id"]),
            "floor_plan_id": None,
            "room_name": "Hallway",
            "length_ft": None,
            "width_ft": None,
            "height_ft": 8.0,
            "square_footage": None,
            "water_category": None,
            "water_class": None,
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

        mock_service_client = AsyncSupabaseMock()
        (mock_service_client.table.return_value.insert.return_value.execute.return_value).data = [
            minimal_row
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
                json={"room_name": "Hallway"},
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["room_name"] == "Hallway"
            assert data["square_footage"] is None
            assert data["water_category"] is None

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

        mock_service_client = AsyncSupabaseMock()
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

    def test_create_room_floor_plan_not_found(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST with non-existent floor_plan_id -> 404 FLOOR_PLAN_NOT_FOUND."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        # floor plan lookup returns empty
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value
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
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms",
                json={
                    "room_name": "Kitchen",
                    "floor_plan_id": str(uuid4()),
                },
                headers=auth_headers,
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "FLOOR_PLAN_NOT_FOUND"

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

    def test_create_room_invalid_water_class(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST with invalid water_class -> 400 INVALID_WATER_CLASS."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms",
                json={
                    "room_name": "Kitchen",
                    "water_class": "5",
                },
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "INVALID_WATER_CLASS"

    def test_create_room_empty_name_rejected(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST with empty room_name -> 422 validation error (Pydantic min_length=1)."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms",
                json={"room_name": ""},
                headers=auth_headers,
            )
            assert response.status_code == 422

    def test_create_room_missing_name_rejected(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST with no room_name field -> 422 validation error."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms",
                json={},
                headers=auth_headers,
            )
            assert response.status_code == 422

    def test_create_room_name_too_long(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST with room_name exceeding 100 chars -> 422."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms",
                json={"room_name": "A" * 101},
                headers=auth_headers,
            )
            assert response.status_code == 422

    def test_create_room_negative_length(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST with negative length_ft -> 422 (ge=0 constraint)."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms",
                json={"room_name": "Kitchen", "length_ft": -5.0},
                headers=auth_headers,
            )
            assert response.status_code == 422

    def test_create_room_negative_equipment(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST with negative equipment count -> 422 (ge=0 constraint)."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post(
                f"/v1/jobs/{mock_job_id}/rooms",
                json={"room_name": "Kitchen", "equipment_air_movers": -1},
                headers=auth_headers,
            )
            assert response.status_code == 422

    def test_create_room_db_error(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST when DB insert fails -> 500 DB_ERROR."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        mock_service_client.table.return_value.insert.return_value.execute.side_effect = APIError(
            {"message": "insert failed", "code": "23505", "details": "", "hint": ""}
        )

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
                json={"room_name": "Kitchen"},
                headers=auth_headers,
            )
            assert response.status_code == 500
            assert response.json()["error_code"] == "DB_ERROR"

    def test_create_room_with_all_fields(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """POST with all optional fields populated -> 201."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        full_row = {
            "id": str(uuid4()),
            "job_id": str(mock_job_id),
            "company_id": str(mock_user_row["company_id"]),
            "floor_plan_id": None,
            "room_name": "Master Bath",
            "length_ft": 15.5,
            "width_ft": 12.0,
            "height_ft": 9.0,
            "square_footage": 186.0,
            "water_category": "2",
            "water_class": "3",
            "dry_standard": 40.0,
            "equipment_air_movers": 4,
            "equipment_dehus": 2,
            "room_sketch_data": {"walls": []},
            "notes": "Heavy damage near tub",
            "sort_order": 3,
            "reading_count": 0,
            "latest_reading_date": None,
            "created_at": MOCK_NOW,
            "updated_at": MOCK_NOW,
        }

        mock_service_client = AsyncSupabaseMock()
        (mock_service_client.table.return_value.insert.return_value.execute.return_value).data = [
            full_row
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
                    "room_name": "Master Bath",
                    "length_ft": 15.5,
                    "width_ft": 12.0,
                    "height_ft": 9.0,
                    "water_category": "2",
                    "water_class": "3",
                    "dry_standard": 40.0,
                    "equipment_air_movers": 4,
                    "equipment_dehus": 2,
                    "room_sketch_data": {"walls": []},
                    "notes": "Heavy damage near tub",
                    "sort_order": 3,
                },
                headers=auth_headers,
            )
            assert response.status_code == 201
            data = response.json()
            assert data["room_name"] == "Master Bath"
            assert data["water_category"] == "2"
            assert data["water_class"] == "3"
            assert data["equipment_air_movers"] == 4
            assert data["equipment_dehus"] == 2
            assert data["notes"] == "Heavy damage near tub"
            assert data["sort_order"] == 3


# ---------------------------------------------------------------------------
# GET /v1/jobs/{job_id}/rooms
# ---------------------------------------------------------------------------


class TestListRooms:
    """Test GET /v1/jobs/{job_id}/rooms."""

    def test_list_rooms_success(
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

        mock_service_client = AsyncSupabaseMock()
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
            assert "items" in data
            assert "total" in data
            assert len(data["items"]) == 1
            assert data["items"][0]["room_name"] == "Kitchen"
            assert data["items"][0]["reading_count"] == 0

    def test_list_rooms_empty(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_user_row,
        mock_job_row,
    ):
        """GET when no rooms exist -> 200 with empty list."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.order.return_value.execute.return_value
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
            assert data["items"] == []
            assert data["total"] == 0

    def test_list_rooms_with_moisture_readings(
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
        """GET -> 200 with reading_count and latest_reading_date populated from readings."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.order.return_value.execute.return_value
        ).data = [mock_room_row]
        # moisture readings with dates
        (
            mock_service_client.table.return_value.select.return_value.in_.return_value.execute.return_value
        ).data = [
            {"room_id": str(mock_room_id), "reading_date": "2026-03-20"},
            {"room_id": str(mock_room_id), "reading_date": "2026-03-25"},
            {"room_id": str(mock_room_id), "reading_date": "2026-03-22"},
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
            response = client.get(
                f"/v1/jobs/{mock_job_id}/rooms",
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert len(data["items"]) == 1
            assert data["items"][0]["reading_count"] == 3
            assert data["items"][0]["latest_reading_date"] == "2026-03-25"

    def test_list_rooms_multiple(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_company_id,
        mock_user_row,
        mock_job_row,
    ):
        """GET -> 200 with multiple rooms."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        room1_id = str(uuid4())
        room2_id = str(uuid4())
        rooms = [
            {
                "id": room1_id,
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
                "created_at": MOCK_NOW,
                "updated_at": MOCK_NOW,
            },
            {
                "id": room2_id,
                "job_id": str(mock_job_id),
                "company_id": str(mock_company_id),
                "floor_plan_id": None,
                "room_name": "Bathroom",
                "length_ft": 8.0,
                "width_ft": 6.0,
                "height_ft": 8.0,
                "square_footage": 48.0,
                "water_category": "2",
                "water_class": "3",
                "dry_standard": None,
                "equipment_air_movers": 2,
                "equipment_dehus": 1,
                "room_sketch_data": None,
                "notes": None,
                "sort_order": 1,
                "created_at": MOCK_NOW,
                "updated_at": MOCK_NOW,
            },
        ]

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.order.return_value.execute.return_value
        ).data = rooms
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
            assert len(data["items"]) == 2
            assert data["total"] == 2
            assert data["items"][0]["room_name"] == "Kitchen"
            assert data["items"][1]["room_name"] == "Bathroom"


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

        mock_service_client = AsyncSupabaseMock()
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

        updated_row = {
            **mock_room_row,
            "length_ft": 15.0,
            "width_ft": 12.0,
            "square_footage": 180.0,
        }

        mock_service_client = AsyncSupabaseMock()
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

    def test_update_room_not_found(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_room_id,
        mock_user_row,
        mock_job_row,
    ):
        """PATCH on non-existent room -> 404 ROOM_NOT_FOUND."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        # room lookup returns None
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = None

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
                json={"room_name": "Updated"},
                headers=auth_headers,
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "ROOM_NOT_FOUND"

    def test_update_room_empty_body(
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
        """PATCH with empty body -> 200 returns existing room unchanged."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_room_row

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
                json={},
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["room_name"] == "Kitchen"

    def test_update_room_invalid_water_category(
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
        """PATCH with invalid water_category -> 400."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_room_row

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
                json={"water_category": "99"},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "INVALID_WATER_CATEGORY"

    def test_update_room_invalid_water_class(
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
        """PATCH with invalid water_class -> 400."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_room_row

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
                json={"water_class": "0"},
                headers=auth_headers,
            )
            assert response.status_code == 400
            assert response.json()["error_code"] == "INVALID_WATER_CLASS"

    def test_update_room_floor_plan_not_found(
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
        """PATCH with non-existent floor_plan_id -> 404 FLOOR_PLAN_NOT_FOUND."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        # existing room found
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_room_row
        # floor plan lookup returns empty
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.execute.return_value
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
                json={"floor_plan_id": str(uuid4())},
                headers=auth_headers,
            )
            assert response.status_code == 404
            assert response.json()["error_code"] == "FLOOR_PLAN_NOT_FOUND"

    def test_update_room_db_error(
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
        """PATCH when DB update fails -> 500 DB_ERROR."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_room_row
        mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.side_effect = APIError(
            {"message": "update failed", "code": "50000", "details": "", "hint": ""}
        )

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
                json={"room_name": "Updated Kitchen"},
                headers=auth_headers,
            )
            assert response.status_code == 500
            assert response.json()["error_code"] == "DB_ERROR"

    def test_update_room_name(
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
        """PATCH room_name -> 200 with updated name."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        updated_row = {**mock_room_row, "room_name": "Main Kitchen"}

        mock_service_client = AsyncSupabaseMock()
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
                json={"room_name": "Main Kitchen"},
                headers=auth_headers,
            )
            assert response.status_code == 200
            assert response.json()["room_name"] == "Main Kitchen"

    def test_update_room_with_reading_stats(
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
        """PATCH -> 200 with reading_count and latest_reading_date from moisture readings."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        updated_row = {**mock_room_row, "notes": "Updated notes"}

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = mock_room_row
        (
            mock_service_client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value
        ).data = [updated_row]
        # moisture readings with dates
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.execute.return_value
        ).data = [
            {"reading_date": "2026-03-20"},
            {"reading_date": "2026-03-25"},
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
            response = client.patch(
                f"/v1/jobs/{mock_job_id}/rooms/{mock_room_id}",
                json={"notes": "Updated notes"},
                headers=auth_headers,
            )
            assert response.status_code == 200
            data = response.json()
            assert data["reading_count"] == 2
            assert data["latest_reading_date"] == "2026-03-25"


# ---------------------------------------------------------------------------
# DELETE /v1/jobs/{job_id}/rooms/{room_id}
# ---------------------------------------------------------------------------


class TestDeleteRoom:
    """Test DELETE /v1/jobs/{job_id}/rooms/{room_id}."""

    def test_delete_room_success(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_room_id,
        mock_user_row,
        mock_job_row,
    ):
        """DELETE existing room -> 204, photos unlinked, room hard-deleted."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
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

    def test_delete_room_not_found(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_room_id,
        mock_user_row,
        mock_job_row,
    ):
        """DELETE non-existent room -> 404 ROOM_NOT_FOUND."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        # room lookup returns None
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = None

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
            assert response.status_code == 404
            assert response.json()["error_code"] == "ROOM_NOT_FOUND"

    def test_delete_room_no_body_returned(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_job_id,
        mock_room_id,
        mock_user_row,
        mock_job_row,
    ):
        """DELETE -> 204 with no response body (correct for 204 No Content)."""
        patches = _setup_mocks(jwt_secret, mock_user_row, mock_job_row)

        mock_service_client = AsyncSupabaseMock()
        (
            mock_service_client.table.return_value.select.return_value.eq.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ).data = {"id": str(mock_room_id), "room_name": "Kitchen"}
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
            assert response.content == b""


# ---------------------------------------------------------------------------
# UNIT TESTS for service helper functions
# ---------------------------------------------------------------------------


class TestServiceHelpers:
    """Unit tests for pure functions in rooms/service.py."""

    def test_validate_water_fields_valid(self):
        """Valid water_category and water_class should not raise."""
        from api.rooms.service import _validate_water_fields

        # Should not raise
        _validate_water_fields("1", "1")
        _validate_water_fields("2", "3")
        _validate_water_fields("3", "4")
        _validate_water_fields(None, None)
        _validate_water_fields("1", None)
        _validate_water_fields(None, "2")

    def test_validate_water_fields_invalid_category(self):
        """Invalid water_category should raise AppException."""
        from api.rooms.service import _validate_water_fields
        from api.shared.exceptions import AppException

        with pytest.raises(AppException) as exc_info:
            _validate_water_fields("0", "1")
        assert exc_info.value.error_code == "INVALID_WATER_CATEGORY"

        with pytest.raises(AppException):
            _validate_water_fields("4", None)

    def test_validate_water_fields_invalid_class(self):
        """Invalid water_class should raise AppException."""
        from api.rooms.service import _validate_water_fields
        from api.shared.exceptions import AppException

        with pytest.raises(AppException) as exc_info:
            _validate_water_fields("1", "5")
        assert exc_info.value.error_code == "INVALID_WATER_CLASS"

        with pytest.raises(AppException):
            _validate_water_fields(None, "0")

    def test_calc_square_footage_both_present(self):
        """square_footage = length * width when both provided."""
        from decimal import Decimal

        from api.rooms.service import _calc_square_footage

        result = _calc_square_footage(Decimal("12.0"), Decimal("10.0"))
        assert result == Decimal("120.0")

    def test_calc_square_footage_none_values(self):
        """square_footage is None when either dimension is None."""
        from decimal import Decimal

        from api.rooms.service import _calc_square_footage

        assert _calc_square_footage(None, Decimal("10.0")) is None
        assert _calc_square_footage(Decimal("12.0"), None) is None
        assert _calc_square_footage(None, None) is None

    def test_calc_square_footage_zero(self):
        """square_footage = 0 when a dimension is zero."""
        from decimal import Decimal

        from api.rooms.service import _calc_square_footage

        result = _calc_square_footage(Decimal("0"), Decimal("10.0"))
        assert result == Decimal("0")

    def test_serialize_decimals(self):
        """Decimal values should be converted to float, others untouched."""
        from decimal import Decimal

        from api.rooms.service import _serialize_decimals

        data = {
            "length_ft": Decimal("12.5"),
            "room_name": "Kitchen",
            "count": 3,
            "notes": None,
        }
        result = _serialize_decimals(data)
        assert result["length_ft"] == 12.5
        assert isinstance(result["length_ft"], float)
        assert result["room_name"] == "Kitchen"
        assert result["count"] == 3
        assert result["notes"] is None

    def test_serialize_decimals_empty(self):
        """Empty dict should return empty dict."""
        from api.rooms.service import _serialize_decimals

        assert _serialize_decimals({}) == {}
