"""Tests for Properties CRUD endpoints (Spec 01).

Covers: POST, GET (list), GET (single), PATCH, DELETE
Including: auth, validation, duplicate detection, soft-delete, search, pagination.
"""

from unittest.mock import MagicMock, patch

from tests.conftest import AsyncSupabaseMock
from uuid import uuid4

import pytest

from api.config import settings
from api.properties.service import _build_usps_standardized

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

NOW_ISO = "2026-03-26T00:00:00Z"


def _property_row(
    property_id=None,
    company_id=None,
    *,
    address_line1="123 Main St",
    address_line2=None,
    city="Troy",
    state="MI",
    zip_code="48083",
    usps_standardized="123 main st troy mi 48083",
    year_built=1990,
    property_type="residential",
    total_sqft=2000,
    latitude=None,
    longitude=None,
):
    """Build a realistic property row dict."""
    return {
        "id": str(property_id or uuid4()),
        "company_id": str(company_id or uuid4()),
        "address_line1": address_line1,
        "address_line2": address_line2,
        "city": city,
        "state": state,
        "zip": zip_code,
        "usps_standardized": usps_standardized,
        "year_built": year_built,
        "property_type": property_type,
        "total_sqft": total_sqft,
        "latitude": latitude,
        "longitude": longitude,
        "created_at": NOW_ISO,
        "updated_at": NOW_ISO,
    }


def _create_body(**overrides):
    """Build a property creation request body."""
    defaults = {
        "address_line1": "123 Main St",
        "city": "Troy",
        "state": "MI",
        "zip": "48083",
    }
    defaults.update(overrides)
    return defaults


def _make_stateful_properties_mock(user_row, call_sequence):
    """Create a mock client with stateful per-call property table behavior.

    Args:
        user_row: Dict for auth middleware user lookup.
        call_sequence: List of callables. Each time .table("properties") is
                       called, the next callable in the list is invoked with
                       a fresh MagicMock table and should configure it.
    """
    mock_client = AsyncSupabaseMock()
    prop_call_count = {"n": 0}

    def table_side_effect(table_name):
        mock_table = AsyncSupabaseMock()
        if table_name == "users":
            # Auth middleware uses .maybe_single() (commit 7423ce2) — match it.
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.maybe_single.return_value.execute.return_value
            ).data = user_row
        elif table_name == "event_history":
            mock_table.insert.return_value.execute.return_value = AsyncSupabaseMock()
        elif table_name == "properties":
            idx = prop_call_count["n"]
            prop_call_count["n"] += 1
            if idx < len(call_sequence):
                call_sequence[idx](mock_table)
        return mock_table

    mock_client.table.side_effect = table_side_effect
    return mock_client


def _patches(mock_client, jwt_secret_val, *, patch_admin=False):
    """Return a list of context managers for standard patches."""
    patches = [
        patch.object(settings, "supabase_jwt_secret", jwt_secret_val),
        patch(
            "api.auth.middleware.get_supabase_admin_client",
            return_value=mock_client,
        ),
        patch(
            "api.properties.service.get_authenticated_client",
            return_value=mock_client,
        ),
        patch(
            "api.shared.events.get_supabase_admin_client",
            return_value=mock_client,
        ),
    ]
    if patch_admin:
        patches.append(
            patch(
                "api.properties.service.get_supabase_admin_client",
                return_value=mock_client,
            )
        )
    return patches


def _apply_patches(patches_list):
    """Enter all patches and return a cleanup list."""
    entered = []
    for p in patches_list:
        entered.append(p.__enter__())
    return patches_list


# ---------------------------------------------------------------------------
# Unit tests for _build_usps_standardized
# ---------------------------------------------------------------------------


class TestBuildUspsStandardized:
    """Unit tests for the address normalization helper."""

    def test_basic_normalization(self):
        result = _build_usps_standardized("123 Main St", None, "Troy", "MI", "48083")
        assert result == "123 main st troy mi 48083"

    def test_with_address_line2(self):
        result = _build_usps_standardized("123 Main St", "Apt 4B", "Troy", "MI", "48083")
        assert result == "123 main st apt 4b troy mi 48083"

    def test_strips_whitespace(self):
        result = _build_usps_standardized("  123 Main St  ", None, " Troy ", " MI ", " 48083 ")
        assert result == "123 main st troy mi 48083"

    def test_empty_address_line2_excluded(self):
        result = _build_usps_standardized("123 Main St", "", "Troy", "MI", "48083")
        assert result == "123 main st troy mi 48083"

    def test_all_uppercase_normalized(self):
        result = _build_usps_standardized("123 MAIN ST", None, "TROY", "MI", "48083")
        assert result == "123 main st troy mi 48083"


# ---------------------------------------------------------------------------
# Create Property Tests
# ---------------------------------------------------------------------------


class TestCreateProperty:
    """POST /v1/properties"""

    def test_create_property_success(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Create property with all fields returns 201."""
        prop_id = uuid4()
        row = _property_row(
            property_id=prop_id,
            company_id=mock_company_id,
            year_built=2005,
            property_type="commercial",
            total_sqft=5000,
            latitude=42.5803,
            longitude=-83.1431,
        )

        def dup_check(mt):
            (
                mt.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value
            ).data = []

        def insert(mt):
            mt.insert.return_value.execute.return_value.data = [row]

        mock_client = _make_stateful_properties_mock(mock_user_row, [dup_check, insert])

        for p in _patches(mock_client, jwt_secret):
            p.__enter__()
        try:
            body = _create_body(
                year_built=2005,
                property_type="commercial",
                total_sqft=5000,
                latitude=42.5803,
                longitude=-83.1431,
            )
            response = client.post("/v1/properties", json=body, headers=auth_headers)
        finally:
            pass

        assert response.status_code == 201
        data = response.json()
        assert data["id"] == str(prop_id)
        assert data["address_line1"] == "123 Main St"
        assert data["usps_standardized"] == "123 main st troy mi 48083"
        assert data["year_built"] == 2005
        assert data["property_type"] == "commercial"

    def test_create_property_minimal(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Create property with required fields only returns 201."""
        row = _property_row(company_id=mock_company_id)

        def dup_check(mt):
            (
                mt.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value
            ).data = []

        def insert(mt):
            mt.insert.return_value.execute.return_value.data = [row]

        mock_client = _make_stateful_properties_mock(mock_user_row, [dup_check, insert])

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
            patch("api.shared.events.get_supabase_admin_client", return_value=mock_client),
        ):
            response = client.post("/v1/properties", json=_create_body(), headers=auth_headers)

        assert response.status_code == 201

    def test_create_property_duplicate(self, client, auth_headers, jwt_secret, mock_user_row):
        """Duplicate address within company returns 400 PROPERTY_DUPLICATE."""

        def dup_found(mt):
            (
                mt.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value
            ).data = [{"id": str(uuid4())}]

        mock_client = _make_stateful_properties_mock(mock_user_row, [dup_found])

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
        ):
            response = client.post("/v1/properties", json=_create_body(), headers=auth_headers)

        assert response.status_code == 400
        assert response.json()["error_code"] == "PROPERTY_DUPLICATE"

    def test_create_property_no_auth(self, client):
        """Request without auth returns 401."""
        response = client.post("/v1/properties", json=_create_body())
        assert response.status_code == 401

    @pytest.mark.parametrize(
        "missing_field",
        ["address_line1", "city", "state", "zip"],
    )
    def test_create_property_missing_required_field(
        self, client, auth_headers, missing_field
    ):
        """Missing required fields return 422 validation error."""
        body = _create_body()
        del body[missing_field]
        response = client.post("/v1/properties", json=body, headers=auth_headers)
        # FastAPI returns 422 for pydantic validation without hitting auth middleware
        assert response.status_code == 422

    def test_create_property_invalid_state_too_long(self, client, auth_headers):
        """State longer than 2 chars returns 422."""
        body = _create_body(state="Michigan")
        response = client.post("/v1/properties", json=body, headers=auth_headers)
        assert response.status_code == 422

    def test_create_property_invalid_state_too_short(self, client, auth_headers):
        """State shorter than 2 chars returns 422."""
        body = _create_body(state="M")
        response = client.post("/v1/properties", json=body, headers=auth_headers)
        assert response.status_code == 422

    def test_create_property_invalid_year_built(self, client, auth_headers):
        """Year built out of range returns 422."""
        body = _create_body(year_built=1500)
        response = client.post("/v1/properties", json=body, headers=auth_headers)
        assert response.status_code == 422

    def test_create_property_invalid_total_sqft_negative(self, client, auth_headers):
        """Negative total_sqft returns 422."""
        body = _create_body(total_sqft=-100)
        response = client.post("/v1/properties", json=body, headers=auth_headers)
        assert response.status_code == 422

    def test_create_property_empty_address(self, client, auth_headers):
        """Empty address_line1 returns 422."""
        body = _create_body(address_line1="")
        response = client.post("/v1/properties", json=body, headers=auth_headers)
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# List Properties Tests
# ---------------------------------------------------------------------------


class TestListProperties:
    """GET /v1/properties"""

    def test_list_properties_empty(self, client, auth_headers, jwt_secret, mock_user_row):
        """Empty property list returns 200 with items=[] and total=0."""

        def list_empty(mt):
            result = AsyncSupabaseMock()
            result.data = []
            result.count = 0
            (
                mt.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = _make_stateful_properties_mock(mock_user_row, [list_empty])

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
        ):
            response = client.get("/v1/properties", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_properties_with_results(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """List returns multiple properties with correct total."""
        rows = [
            _property_row(company_id=mock_company_id, address_line1="123 Main St"),
            _property_row(company_id=mock_company_id, address_line1="456 Oak Ave"),
        ]

        def list_results(mt):
            result = AsyncSupabaseMock()
            result.data = rows
            result.count = 2
            (
                mt.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = _make_stateful_properties_mock(mock_user_row, [list_results])

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
        ):
            response = client.get("/v1/properties", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["total"] == 2

    def test_list_properties_with_search(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Search filter is applied and results returned."""
        rows = [_property_row(company_id=mock_company_id)]

        def list_search(mt):
            result = AsyncSupabaseMock()
            result.data = rows
            result.count = 1
            # With search: select().eq().is_().order().or_().range().execute()
            (
                mt.select.return_value.eq.return_value.is_.return_value.order.return_value.or_.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = _make_stateful_properties_mock(mock_user_row, [list_search])

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
        ):
            response = client.get("/v1/properties?search=Troy", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
        assert data["total"] == 1

    def test_list_properties_malicious_search_sanitized(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Malicious search with PostgREST operators is sanitized before query."""
        rows = [_property_row(company_id=mock_company_id)]

        def list_search(mt):
            result = AsyncSupabaseMock()
            result.data = rows
            result.count = 1
            # Sanitized search still uses or_ path
            (
                mt.select.return_value.eq.return_value.is_.return_value.order.return_value.or_.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = _make_stateful_properties_mock(mock_user_row, [list_search])

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
        ):
            # Injection attempt via comma and .eq. operator
            response = client.get(
                "/v1/properties?search=test%25,status.eq.deleted",
                headers=auth_headers,
            )

        assert response.status_code == 200

    def test_list_properties_search_only_special_chars(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Search of only special characters returns unfiltered results."""
        rows = [_property_row(company_id=mock_company_id)]

        def list_no_search(mt):
            result = AsyncSupabaseMock()
            result.data = rows
            result.count = 1
            # No or_ in chain (search sanitizes to empty)
            (
                mt.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = _make_stateful_properties_mock(mock_user_row, [list_no_search])

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
        ):
            response = client.get(
                "/v1/properties?search=.,%25()",
                headers=auth_headers,
            )

        assert response.status_code == 200

    def test_list_properties_with_pagination(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Pagination params are passed through correctly."""
        rows = [_property_row(company_id=mock_company_id)]

        def list_paginated(mt):
            result = AsyncSupabaseMock()
            result.data = rows
            result.count = 50  # Total is larger than returned page
            (
                mt.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = _make_stateful_properties_mock(mock_user_row, [list_paginated])

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
        ):
            response = client.get(
                "/v1/properties?limit=10&offset=20", headers=auth_headers
            )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 50

    def test_list_properties_no_auth(self, client):
        """Request without auth returns 401."""
        response = client.get("/v1/properties")
        assert response.status_code == 401

    def test_list_properties_null_count_defaults_to_zero(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        """When Supabase returns count=None, total defaults to 0."""

        def list_null_count(mt):
            result = AsyncSupabaseMock()
            result.data = []
            result.count = None
            (
                mt.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = _make_stateful_properties_mock(mock_user_row, [list_null_count])

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
        ):
            response = client.get("/v1/properties", headers=auth_headers)

        assert response.status_code == 200
        assert response.json()["total"] == 0


# ---------------------------------------------------------------------------
# Get Property Tests
# ---------------------------------------------------------------------------


class TestGetProperty:
    """GET /v1/properties/{property_id}"""

    def test_get_property_success(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Get existing property returns 200."""
        prop_id = uuid4()
        row = _property_row(property_id=prop_id, company_id=mock_company_id)

        def get_single(mt):
            (
                mt.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = row

        mock_client = _make_stateful_properties_mock(mock_user_row, [get_single])

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
        ):
            response = client.get(f"/v1/properties/{prop_id}", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(prop_id)
        assert data["address_line1"] == "123 Main St"

    def test_get_property_not_found(self, client, auth_headers, jwt_secret, mock_user_row):
        """Non-existent property returns 404."""

        def get_none(mt):
            (
                mt.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = None

        mock_client = _make_stateful_properties_mock(mock_user_row, [get_none])

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
        ):
            response = client.get(f"/v1/properties/{uuid4()}", headers=auth_headers)

        assert response.status_code == 404
        assert response.json()["error_code"] == "PROPERTY_NOT_FOUND"

    def test_get_property_invalid_uuid(self, client, auth_headers):
        """Invalid UUID in path returns 422."""
        response = client.get("/v1/properties/not-a-uuid", headers=auth_headers)
        assert response.status_code == 422

    def test_get_property_no_auth(self, client):
        """Request without auth returns 401."""
        response = client.get(f"/v1/properties/{uuid4()}")
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Update Property Tests
# ---------------------------------------------------------------------------


class TestUpdateProperty:
    """PATCH /v1/properties/{property_id}"""

    def test_update_property_success(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Update property fields returns 200."""
        prop_id = uuid4()
        current_row = _property_row(property_id=prop_id, company_id=mock_company_id)
        updated_row = {**current_row, "year_built": 2020}

        def fetch_current(mt):
            (
                mt.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = current_row

        def do_update(mt):
            (
                mt.update.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
            ).data = updated_row

        mock_client = _make_stateful_properties_mock(
            mock_user_row, [fetch_current, do_update]
        )

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
            patch("api.shared.events.get_supabase_admin_client", return_value=mock_client),
        ):
            response = client.patch(
                f"/v1/properties/{prop_id}",
                json={"year_built": 2020},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json()["year_built"] == 2020

    def test_update_property_no_changes(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Empty update body returns current property unchanged."""
        prop_id = uuid4()
        current_row = _property_row(property_id=prop_id, company_id=mock_company_id)

        def fetch_current(mt):
            (
                mt.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = current_row

        mock_client = _make_stateful_properties_mock(mock_user_row, [fetch_current])

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
        ):
            response = client.patch(
                f"/v1/properties/{prop_id}",
                json={},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json()["id"] == str(prop_id)

    def test_update_property_not_found(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        """Update non-existent property returns 404."""

        def fetch_none(mt):
            (
                mt.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = None

        mock_client = _make_stateful_properties_mock(mock_user_row, [fetch_none])

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
        ):
            response = client.patch(
                f"/v1/properties/{uuid4()}",
                json={"year_built": 2020},
                headers=auth_headers,
            )

        assert response.status_code == 404
        assert response.json()["error_code"] == "PROPERTY_NOT_FOUND"

    def test_update_property_address_recalculates_usps(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Changing address fields recalculates usps_standardized."""
        prop_id = uuid4()
        current_row = _property_row(property_id=prop_id, company_id=mock_company_id)
        updated_row = {
            **current_row,
            "city": "Detroit",
            "usps_standardized": "123 main st detroit mi 48083",
        }

        def fetch_current(mt):
            (
                mt.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = current_row

        def dup_check_no_dup(mt):
            # Duplicate check after address change: select().eq().eq().is_().neq().limit().execute()
            (
                mt.select.return_value.eq.return_value.eq.return_value.is_.return_value.neq.return_value.limit.return_value.execute.return_value
            ).data = []

        def do_update(mt):
            (
                mt.update.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
            ).data = updated_row

        mock_client = _make_stateful_properties_mock(
            mock_user_row, [fetch_current, dup_check_no_dup, do_update]
        )

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
            patch("api.shared.events.get_supabase_admin_client", return_value=mock_client),
        ):
            response = client.patch(
                f"/v1/properties/{prop_id}",
                json={"city": "Detroit"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json()["city"] == "Detroit"

    def test_update_property_address_duplicate_rejected(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Changing address to an existing address returns 400 PROPERTY_DUPLICATE."""
        prop_id = uuid4()
        current_row = _property_row(property_id=prop_id, company_id=mock_company_id)

        def fetch_current(mt):
            (
                mt.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = current_row

        def dup_check_found(mt):
            (
                mt.select.return_value.eq.return_value.eq.return_value.is_.return_value.neq.return_value.limit.return_value.execute.return_value
            ).data = [{"id": str(uuid4())}]

        mock_client = _make_stateful_properties_mock(
            mock_user_row, [fetch_current, dup_check_found]
        )

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
        ):
            response = client.patch(
                f"/v1/properties/{prop_id}",
                json={"city": "Detroit"},
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "PROPERTY_DUPLICATE"

    def test_update_property_address_same_usps_skips_dup_check(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Changing address that results in same usps skips duplicate check and updates."""
        prop_id = uuid4()
        current_row = _property_row(
            property_id=prop_id,
            company_id=mock_company_id,
            address_line1="123 Main St",
            usps_standardized="123 main st troy mi 48083",
        )
        # Change address_line1 case only -- usps stays the same
        updated_row = {**current_row, "address_line1": "123 main st"}

        def fetch_current(mt):
            (
                mt.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = current_row

        def do_update(mt):
            (
                mt.update.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
            ).data = updated_row

        mock_client = _make_stateful_properties_mock(
            mock_user_row, [fetch_current, do_update]
        )

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_authenticated_client", return_value=mock_client),
            patch("api.shared.events.get_supabase_admin_client", return_value=mock_client),
        ):
            response = client.patch(
                f"/v1/properties/{prop_id}",
                json={"address_line1": "123 main st"},
                headers=auth_headers,
            )

        assert response.status_code == 200

    def test_update_property_no_auth(self, client):
        """Request without auth returns 401."""
        response = client.patch(f"/v1/properties/{uuid4()}", json={"year_built": 2020})
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Delete Property Tests
# ---------------------------------------------------------------------------


class TestDeleteProperty:
    """DELETE /v1/properties/{property_id}"""

    def test_delete_property_success_owner(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Owner can soft-delete a property, returns {"deleted": true}."""
        prop_id = uuid4()
        # mock_user_row has role="owner" by default

        mock_client = AsyncSupabaseMock()

        def table_side_effect(table_name):
            mock_table = AsyncSupabaseMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = mock_user_row
            elif table_name == "properties":
                # Soft delete: update().eq().eq().is_().execute()
                result = AsyncSupabaseMock()
                result.data = [{"id": str(prop_id)}]
                (
                    mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
                ) = result
            elif table_name == "event_history":
                mock_table.insert.return_value.execute.return_value = AsyncSupabaseMock()
            return mock_table

        mock_client.table.side_effect = table_side_effect

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_supabase_admin_client", return_value=mock_client),
            patch("api.shared.events.get_supabase_admin_client", return_value=mock_client),
        ):
            response = client.delete(f"/v1/properties/{prop_id}", headers=auth_headers)

        assert response.status_code == 200
        assert response.json() == {"deleted": True}

    def test_delete_property_success_admin(
        self, client, jwt_secret, mock_user_id, mock_company_id, valid_token
    ):
        """Admin can soft-delete a property."""
        prop_id = uuid4()
        admin_user_row = {
            "id": str(mock_user_id),
            "company_id": str(mock_company_id),
            "role": "admin",
            "is_platform_admin": False,
        }

        mock_client = AsyncSupabaseMock()

        def table_side_effect(table_name):
            mock_table = AsyncSupabaseMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = admin_user_row
            elif table_name == "properties":
                result = AsyncSupabaseMock()
                result.data = [{"id": str(prop_id)}]
                (
                    mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
                ) = result
            elif table_name == "event_history":
                mock_table.insert.return_value.execute.return_value = AsyncSupabaseMock()
            return mock_table

        mock_client.table.side_effect = table_side_effect

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_supabase_admin_client", return_value=mock_client),
            patch("api.shared.events.get_supabase_admin_client", return_value=mock_client),
        ):
            response = client.delete(
                f"/v1/properties/{prop_id}",
                headers={"Authorization": f"Bearer {valid_token}"},
            )

        assert response.status_code == 200
        assert response.json() == {"deleted": True}

    def test_delete_property_forbidden_tech(
        self, client, jwt_secret, mock_user_id, mock_company_id, valid_token
    ):
        """Tech role cannot delete properties, returns 403."""
        tech_user_row = {
            "id": str(mock_user_id),
            "company_id": str(mock_company_id),
            "role": "tech",
            "is_platform_admin": False,
        }

        mock_client = AsyncSupabaseMock()

        def table_side_effect(table_name):
            mock_table = AsyncSupabaseMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = tech_user_row
            return mock_table

        mock_client.table.side_effect = table_side_effect

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
        ):
            response = client.delete(
                f"/v1/properties/{uuid4()}",
                headers={"Authorization": f"Bearer {valid_token}"},
            )

        assert response.status_code == 403
        assert response.json()["error_code"] == "FORBIDDEN"

    def test_delete_property_not_found(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        """Deleting non-existent property returns 404."""
        mock_client = AsyncSupabaseMock()

        def table_side_effect(table_name):
            mock_table = AsyncSupabaseMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = mock_user_row
            elif table_name == "properties":
                # No rows matched = not found
                result = AsyncSupabaseMock()
                result.data = []
                (
                    mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
                ) = result
            return mock_table

        mock_client.table.side_effect = table_side_effect

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=mock_client),
            patch("api.properties.service.get_supabase_admin_client", return_value=mock_client),
        ):
            response = client.delete(f"/v1/properties/{uuid4()}", headers=auth_headers)

        assert response.status_code == 404
        assert response.json()["error_code"] == "PROPERTY_NOT_FOUND"

    def test_delete_property_no_auth(self, client):
        """Request without auth returns 401."""
        response = client.delete(f"/v1/properties/{uuid4()}")
        assert response.status_code == 401

    def test_delete_property_uses_admin_client(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Delete uses admin client (not authenticated client) to bypass RLS."""
        prop_id = uuid4()
        admin_mock = AsyncSupabaseMock()
        auth_mock = AsyncSupabaseMock()

        # Configure admin mock for properties table (delete uses admin)
        def admin_table(table_name):
            mock_table = AsyncSupabaseMock()
            if table_name == "properties":
                result = AsyncSupabaseMock()
                result.data = [{"id": str(prop_id)}]
                (
                    mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
                ) = result
            elif table_name == "event_history":
                mock_table.insert.return_value.execute.return_value = AsyncSupabaseMock()
            return mock_table

        admin_mock.table.side_effect = admin_table

        # Configure auth mock for users table only (auth middleware)
        def auth_table(table_name):
            mock_table = AsyncSupabaseMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = mock_user_row
            return mock_table

        auth_mock.table.side_effect = auth_table

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch("api.auth.middleware.get_supabase_admin_client", return_value=auth_mock),
            patch(
                "api.properties.service.get_supabase_admin_client",
                return_value=admin_mock,
            ),
            patch("api.shared.events.get_supabase_admin_client", return_value=admin_mock),
        ):
            response = client.delete(f"/v1/properties/{prop_id}", headers=auth_headers)

        assert response.status_code == 200
        # Verify admin_mock.table was called (not auth_mock for properties)
        admin_table_calls = [
            c for c in admin_mock.table.call_args_list if c[0][0] == "properties"
        ]
        assert len(admin_table_calls) >= 1, "Delete should use admin client for properties table"
