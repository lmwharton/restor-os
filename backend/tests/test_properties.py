"""Tests for Properties CRUD endpoints (Spec 01)."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

from api.config import settings

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


def _setup_properties_mock(
    mock_table,
    *,
    insert_row=None,
    select_rows=None,
    select_single=None,
    select_count=None,
    duplicate_exists=False,
    update_row=None,
):
    """Configure a properties table mock for various operations.

    This configures the FIRST call chain on the mock_table. For operations
    that require multiple sequential calls to the same table (e.g., dup check
    then insert), use a stateful side_effect instead.
    """
    # For duplicate check: select().eq().eq().is_().limit().execute()
    dup_result = MagicMock()
    dup_result.data = [{"id": str(uuid4())}] if duplicate_exists else []
    (
        mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value
    ) = dup_result

    # For insert: insert().execute()
    if insert_row is not None:
        insert_result = MagicMock()
        insert_result.data = [insert_row]
        mock_table.insert.return_value.execute.return_value = insert_result

    # For list: select().eq().is_().order().range().execute() or with .or_()
    if select_rows is not None:
        list_result = MagicMock()
        list_result.data = select_rows
        list_result.count = select_count if select_count is not None else len(select_rows)
        # Without search (no or_)
        (
            mock_table.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
        ) = list_result
        # With search (has or_)
        (
            mock_table.select.return_value.eq.return_value.is_.return_value.order.return_value.or_.return_value.range.return_value.execute.return_value
        ) = list_result

    # For get single: select().eq().eq().is_().single().execute()
    if select_single is not None:
        single_result = MagicMock()
        single_result.data = select_single
        (
            mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
        ) = single_result

    # For update: update().eq().eq().single().execute()
    if update_row is not None:
        update_result = MagicMock()
        update_result.data = update_row
        (
            mock_table.update.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
        ) = update_result


# ---------------------------------------------------------------------------
# Tests
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

        call_count = {"properties": 0}

        def properties_handler(mock_table):
            call_count["properties"] += 1
            if call_count["properties"] == 1:
                # Duplicate check — no duplicate
                (
                    mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value
                ).data = []
            elif call_count["properties"] == 2:
                # Insert
                mock_table.insert.return_value.execute.return_value.data = [row]

        mock_client = MagicMock()

        prop_call_count = {"n": 0}

        def table_side_effect(table_name):
            mock_table = MagicMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = mock_user_row
            elif table_name == "properties":
                prop_call_count["n"] += 1
                if prop_call_count["n"] == 1:
                    # Duplicate check
                    (
                        mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value
                    ).data = []
                else:
                    # Insert
                    mock_table.insert.return_value.execute.return_value.data = [row]
            elif table_name == "event_history":
                mock_table.insert.return_value.execute.return_value = MagicMock()
            return mock_table

        mock_client.table.side_effect = table_side_effect

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
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
        ):
            body = _create_body(
                year_built=2005,
                property_type="commercial",
                total_sqft=5000,
                latitude=42.5803,
                longitude=-83.1431,
            )
            response = client.post("/v1/properties", json=body, headers=auth_headers)

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

        mock_client = MagicMock()
        prop_call_count = {"n": 0}

        def table_side_effect(table_name):
            mock_table = MagicMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = mock_user_row
            elif table_name == "properties":
                prop_call_count["n"] += 1
                if prop_call_count["n"] == 1:
                    (
                        mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value
                    ).data = []
                else:
                    mock_table.insert.return_value.execute.return_value.data = [row]
            elif table_name == "event_history":
                mock_table.insert.return_value.execute.return_value = MagicMock()
            return mock_table

        mock_client.table.side_effect = table_side_effect

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
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
        ):
            body = _create_body()
            response = client.post("/v1/properties", json=body, headers=auth_headers)

        assert response.status_code == 201

    def test_create_property_duplicate(self, client, auth_headers, jwt_secret, mock_user_row):
        """Duplicate address within company returns 400 PROPERTY_DUPLICATE."""
        mock_client = MagicMock()

        def table_side_effect(table_name):
            mock_table = MagicMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = mock_user_row
            elif table_name == "properties":
                # Duplicate check finds existing property
                (
                    mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value
                ).data = [{"id": str(uuid4())}]
            return mock_table

        mock_client.table.side_effect = table_side_effect

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch(
                "api.auth.middleware.get_supabase_admin_client",
                return_value=mock_client,
            ),
            patch(
                "api.properties.service.get_authenticated_client",
                return_value=mock_client,
            ),
        ):
            response = client.post("/v1/properties", json=_create_body(), headers=auth_headers)

        assert response.status_code == 400
        assert response.json()["error_code"] == "PROPERTY_DUPLICATE"

    def test_create_property_no_auth(self, client):
        """Request without auth returns 401."""
        response = client.post("/v1/properties", json=_create_body())
        assert response.status_code == 401


class TestListProperties:
    """GET /v1/properties"""

    def test_list_properties_empty(self, client, auth_headers, jwt_secret, mock_user_row):
        """Empty property list returns 200 with items=[] and total=0."""
        mock_client = MagicMock()

        def table_side_effect(table_name):
            mock_table = MagicMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = mock_user_row
            elif table_name == "properties":
                result = MagicMock()
                result.data = []
                result.count = 0
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
                ) = result
            return mock_table

        mock_client.table.side_effect = table_side_effect

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch(
                "api.auth.middleware.get_supabase_admin_client",
                return_value=mock_client,
            ),
            patch(
                "api.properties.service.get_authenticated_client",
                return_value=mock_client,
            ),
        ):
            response = client.get("/v1/properties", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_properties_with_search(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Search filter is applied and results returned."""
        rows = [_property_row(company_id=mock_company_id)]
        mock_client = MagicMock()

        def table_side_effect(table_name):
            mock_table = MagicMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = mock_user_row
            elif table_name == "properties":
                result = MagicMock()
                result.data = rows
                result.count = 1
                # With search: select().eq().is_().order().or_().range().execute()
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.order.return_value.or_.return_value.range.return_value.execute.return_value
                ) = result
            return mock_table

        mock_client.table.side_effect = table_side_effect

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch(
                "api.auth.middleware.get_supabase_admin_client",
                return_value=mock_client,
            ),
            patch(
                "api.properties.service.get_authenticated_client",
                return_value=mock_client,
            ),
        ):
            response = client.get("/v1/properties?search=Troy", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
        assert data["total"] == 1


class TestGetProperty:
    """GET /v1/properties/{property_id}"""

    def test_get_property_success(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Get existing property returns 200."""
        prop_id = uuid4()
        row = _property_row(property_id=prop_id, company_id=mock_company_id)
        mock_client = MagicMock()

        def table_side_effect(table_name):
            mock_table = MagicMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = mock_user_row
            elif table_name == "properties":
                (
                    mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = row
            return mock_table

        mock_client.table.side_effect = table_side_effect

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch(
                "api.auth.middleware.get_supabase_admin_client",
                return_value=mock_client,
            ),
            patch(
                "api.properties.service.get_authenticated_client",
                return_value=mock_client,
            ),
        ):
            response = client.get(f"/v1/properties/{prop_id}", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(prop_id)
        assert data["address_line1"] == "123 Main St"

    def test_get_property_not_found(self, client, auth_headers, jwt_secret, mock_user_row):
        """Non-existent property returns 404."""
        mock_client = MagicMock()

        def table_side_effect(table_name):
            mock_table = MagicMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = mock_user_row
            elif table_name == "properties":
                (
                    mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = None
            return mock_table

        mock_client.table.side_effect = table_side_effect

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch(
                "api.auth.middleware.get_supabase_admin_client",
                return_value=mock_client,
            ),
            patch(
                "api.properties.service.get_authenticated_client",
                return_value=mock_client,
            ),
        ):
            response = client.get(f"/v1/properties/{uuid4()}", headers=auth_headers)

        assert response.status_code == 404
        assert response.json()["error_code"] == "PROPERTY_NOT_FOUND"


class TestUpdateProperty:
    """PATCH /v1/properties/{property_id}"""

    def test_update_property_success(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Update property fields returns 200."""
        prop_id = uuid4()
        current_row = _property_row(property_id=prop_id, company_id=mock_company_id)
        updated_row = {**current_row, "year_built": 2020}

        mock_client = MagicMock()
        prop_call_count = {"n": 0}

        def table_side_effect(table_name):
            mock_table = MagicMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = mock_user_row
            elif table_name == "properties":
                prop_call_count["n"] += 1
                if prop_call_count["n"] == 1:
                    # Fetch current
                    (
                        mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                    ).data = current_row
                else:
                    # Update
                    (
                        mock_table.update.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
                    ).data = updated_row
            elif table_name == "event_history":
                mock_table.insert.return_value.execute.return_value = MagicMock()
            return mock_table

        mock_client.table.side_effect = table_side_effect

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
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
        """Empty update body returns current property (no error from service)."""
        prop_id = uuid4()
        current_row = _property_row(property_id=prop_id, company_id=mock_company_id)

        mock_client = MagicMock()

        def table_side_effect(table_name):
            mock_table = MagicMock()
            if table_name == "users":
                (
                    mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = mock_user_row
            elif table_name == "properties":
                # Fetch current — service returns current_row when no updates
                (
                    mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
                ).data = current_row
            return mock_table

        mock_client.table.side_effect = table_side_effect

        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch(
                "api.auth.middleware.get_supabase_admin_client",
                return_value=mock_client,
            ),
            patch(
                "api.properties.service.get_authenticated_client",
                return_value=mock_client,
            ),
        ):
            response = client.patch(
                f"/v1/properties/{prop_id}",
                json={},
                headers=auth_headers,
            )

        # Service returns current data when no fields are updated (not an error)
        assert response.status_code == 200
        assert response.json()["id"] == str(prop_id)
