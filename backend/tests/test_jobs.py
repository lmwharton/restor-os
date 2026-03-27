"""Tests for Jobs CRUD endpoints (Spec 01)."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

from api.config import settings

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

NOW_ISO = "2026-03-26T00:00:00Z"


def _job_row(
    job_id=None,
    company_id=None,
    user_id=None,
    *,
    job_number="JOB-20260326-001",
    address_line1="456 Oak Ave",
    city="Troy",
    state="MI",
    zip_code="48083",
    loss_type="water",
    status="new",
    customer_name=None,
    customer_phone=None,
    customer_email=None,
    claim_number=None,
    carrier=None,
    adjuster_name=None,
    adjuster_phone=None,
    adjuster_email=None,
    loss_category=None,
    loss_class=None,
    loss_cause=None,
    loss_date=None,
    property_id=None,
    assigned_to=None,
    notes=None,
    tech_notes=None,
    latitude=None,
    longitude=None,
):
    """Build a realistic job row dict."""
    return {
        "id": str(job_id or uuid4()),
        "company_id": str(company_id or uuid4()),
        "property_id": str(property_id) if property_id else None,
        "job_number": job_number,
        "address_line1": address_line1,
        "city": city,
        "state": state,
        "zip": zip_code,
        "customer_name": customer_name,
        "customer_phone": customer_phone,
        "customer_email": customer_email,
        "claim_number": claim_number,
        "carrier": carrier,
        "adjuster_name": adjuster_name,
        "adjuster_phone": adjuster_phone,
        "adjuster_email": adjuster_email,
        "loss_type": loss_type,
        "loss_category": loss_category,
        "loss_class": loss_class,
        "loss_cause": loss_cause,
        "loss_date": loss_date,
        "status": status,
        "assigned_to": str(assigned_to) if assigned_to else None,
        "notes": notes,
        "tech_notes": tech_notes,
        "latitude": latitude,
        "longitude": longitude,
        "created_by": str(user_id or uuid4()),
        "updated_by": None,
        "created_at": NOW_ISO,
        "updated_at": NOW_ISO,
    }


def _create_body(**overrides):
    """Build a job creation request body with required fields."""
    defaults = {
        "address_line1": "456 Oak Ave",
        "loss_type": "water",
    }
    defaults.update(overrides)
    return defaults


def _make_mock_client(user_row, table_handlers=None):
    """Create a mock Supabase client with auth + table routing.

    Args:
        user_row: User row for auth middleware lookup.
        table_handlers: Dict of {table_name: callable(mock_table)} to configure
                        table-specific behavior. Each handler receives a fresh
                        MagicMock and should configure return values on it.
    """
    mock_client = MagicMock()
    # Track call counts per table to support sequential calls
    call_counts = {}

    def table_side_effect(table_name):
        mock_table = MagicMock()
        call_counts.setdefault(table_name, 0)
        call_counts[table_name] += 1

        if table_name == "users":
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = user_row
        elif table_name == "event_history":
            mock_table.insert.return_value.execute.return_value = MagicMock()
        elif table_handlers and table_name in table_handlers:
            handler = table_handlers[table_name]
            handler(mock_table, call_counts[table_name])
        return mock_table

    mock_client.table.side_effect = table_side_effect
    return mock_client


def _patch_all(jwt_secret, mock_client):
    """Context manager combining all patches needed for job tests."""
    from contextlib import contextmanager

    @contextmanager
    def _ctx():
        with (
            patch.object(settings, "supabase_jwt_secret", jwt_secret),
            patch(
                "api.auth.middleware.get_supabase_admin_client",
                return_value=mock_client,
            ),
            patch(
                "api.jobs.service.get_authenticated_client",
                return_value=mock_client,
            ),
            patch(
                "api.shared.events.get_supabase_admin_client",
                return_value=mock_client,
            ),
        ):
            yield

    return _ctx()


# ---------------------------------------------------------------------------
# Tests: Create Job
# ---------------------------------------------------------------------------


class TestCreateJob:
    """POST /v1/jobs"""

    def test_create_job_success(
        self,
        client,
        auth_headers,
        jwt_secret,
        mock_user_row,
        mock_company_id,
        mock_user_id,
    ):
        """Create job with all fields returns 201 with auto-generated job_number."""
        job_id = uuid4()
        row = _job_row(
            job_id=job_id,
            company_id=mock_company_id,
            user_id=mock_user_id,
            customer_name="Brett Sodders",
            customer_phone="(586) 944-7700",
            loss_category="1",
            loss_class="2",
        )

        def jobs_handler(mock_table, call_num):
            if call_num == 1:
                # _generate_job_number: select().eq().like().order().limit().execute()
                (
                    mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
                ).data = []
            elif call_num == 2:
                # insert().execute()
                mock_table.insert.return_value.execute.return_value.data = [row]

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            body = _create_body(
                customer_name="Brett Sodders",
                customer_phone="(586) 944-7700",
                loss_category="1",
                loss_class="2",
                city="Troy",
                state="MI",
                zip="48083",
            )
            response = client.post("/v1/jobs", json=body, headers=auth_headers)

        assert response.status_code == 201
        data = response.json()
        assert data["id"] == str(job_id)
        assert data["job_number"].startswith("JOB-")
        assert data["status"] == "new"
        assert data["room_count"] == 0

    def test_create_job_minimal(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Create job with address + loss_type only returns 201."""
        row = _job_row(company_id=mock_company_id)

        def jobs_handler(mock_table, call_num):
            if call_num == 1:
                (
                    mock_table.select.return_value.eq.return_value.like.return_value.order.return_value.limit.return_value.execute.return_value
                ).data = []
            elif call_num == 2:
                mock_table.insert.return_value.execute.return_value.data = [row]

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.post("/v1/jobs", json=_create_body(), headers=auth_headers)

        assert response.status_code == 201

    def test_create_job_invalid_loss_type(self, client, auth_headers, jwt_secret, mock_user_row):
        """Invalid loss_type returns 400 INVALID_LOSS_TYPE."""
        mock_client = _make_mock_client(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                "/v1/jobs",
                json=_create_body(loss_type="earthquake"),
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_LOSS_TYPE"

    def test_create_job_invalid_loss_category(
        self, client, auth_headers, jwt_secret, mock_user_row
    ):
        """Invalid loss_category returns 400 INVALID_LOSS_CATEGORY."""
        mock_client = _make_mock_client(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            response = client.post(
                "/v1/jobs",
                json=_create_body(loss_category="5"),
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_LOSS_CATEGORY"

    def test_create_job_no_auth(self, client):
        """Request without auth returns 401."""
        response = client.post("/v1/jobs", json=_create_body())
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Tests: List Jobs
# ---------------------------------------------------------------------------


class TestListJobs:
    """GET /v1/jobs"""

    def test_list_jobs_empty(self, client, auth_headers, jwt_secret, mock_user_row):
        """Empty job list returns 200 with items=[] and total=0."""

        def jobs_handler(mock_table, call_num):
            result = MagicMock()
            result.data = []
            result.count = 0
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_jobs_with_status_filter(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Filter by status returns matching jobs."""
        rows = [_job_row(company_id=mock_company_id, status="mitigation")]

        def jobs_handler(mock_table, call_num):
            result = MagicMock()
            result.data = rows
            result.count = 1
            # With status filter: select().eq().is_().eq().order().range().execute()
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs?status=scoped", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
        assert data["total"] == 1

    def test_list_jobs_with_search(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Search filter returns matching jobs."""
        rows = [_job_row(company_id=mock_company_id, customer_name="Brett")]

        def jobs_handler(mock_table, call_num):
            result = MagicMock()
            result.data = rows
            result.count = 1
            # With search (or_): select().eq().is_().or_().order().range().execute()
            (
                mock_table.select.return_value.eq.return_value.is_.return_value.or_.return_value.order.return_value.range.return_value.execute.return_value
            ) = result

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get("/v1/jobs?search=Brett", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1


# ---------------------------------------------------------------------------
# Tests: Get Job Detail
# ---------------------------------------------------------------------------


class TestGetJob:
    """GET /v1/jobs/{job_id}"""

    def test_get_job_detail(self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id):
        """Get existing job returns 200 with computed counts."""
        job_id = uuid4()
        row = _job_row(job_id=job_id, company_id=mock_company_id)

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = row

        def counts_handler(mock_table, call_num):
            """Handle count queries for job_rooms, photos, floor_plans, line_items."""
            result = MagicMock()
            result.count = 0
            (mock_table.select.return_value.eq.return_value.execute.return_value) = result

        mock_client = _make_mock_client(
            mock_user_row,
            {
                "jobs": jobs_handler,
                "job_rooms": counts_handler,
                "photos": counts_handler,
                "floor_plans": counts_handler,
                "line_items": counts_handler,
            },
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.get(f"/v1/jobs/{job_id}", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(job_id)
        assert data["room_count"] == 0
        assert data["photo_count"] == 0
        assert data["floor_plan_count"] == 0
        assert data["line_item_count"] == 0

    def test_get_job_not_found(self, client, auth_headers, jwt_secret, mock_user_row):
        """Non-existent job returns 404."""

        def jobs_handler(mock_table, call_num):
            (
                mock_table.select.return_value.eq.return_value.eq.return_value.is_.return_value.single.return_value.execute.return_value
            ).data = None

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.get(f"/v1/jobs/{uuid4()}", headers=auth_headers)

        assert response.status_code == 404
        assert response.json()["error_code"] == "JOB_NOT_FOUND"


# ---------------------------------------------------------------------------
# Tests: Update Job
# ---------------------------------------------------------------------------


class TestUpdateJob:
    """PATCH /v1/jobs/{job_id}"""

    def test_update_job_success(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Update job fields returns 200."""
        job_id = uuid4()
        updated_row = _job_row(
            job_id=job_id,
            company_id=mock_company_id,
            customer_name="Updated Name",
        )

        def jobs_handler(mock_table, call_num):
            if call_num == 1:
                # update().eq().eq().is_().execute()
                result = MagicMock()
                result.data = [updated_row]
                (
                    mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
                ) = result

        def counts_handler(mock_table, call_num):
            result = MagicMock()
            result.count = 0
            mock_table.select.return_value.eq.return_value.execute.return_value = result

        mock_client = _make_mock_client(
            mock_user_row,
            {
                "jobs": jobs_handler,
                "job_rooms": counts_handler,
                "photos": counts_handler,
                "floor_plans": counts_handler,
                "line_items": counts_handler,
            },
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{job_id}",
                json={"customer_name": "Updated Name"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json()["customer_name"] == "Updated Name"

    def test_update_job_status(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Update job status returns 200."""
        job_id = uuid4()
        updated_row = _job_row(job_id=job_id, company_id=mock_company_id, status="mitigation")

        def jobs_handler(mock_table, call_num):
            if call_num == 1:
                result = MagicMock()
                result.data = [updated_row]
                (
                    mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
                ) = result

        def counts_handler(mock_table, call_num):
            result = MagicMock()
            result.count = 0
            mock_table.select.return_value.eq.return_value.execute.return_value = result

        mock_client = _make_mock_client(
            mock_user_row,
            {
                "jobs": jobs_handler,
                "job_rooms": counts_handler,
                "photos": counts_handler,
                "floor_plans": counts_handler,
                "line_items": counts_handler,
            },
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{job_id}",
                json={"status": "mitigation"},
                headers=auth_headers,
            )

        assert response.status_code == 200
        assert response.json()["status"] == "mitigation"

    def test_update_job_invalid_status(self, client, auth_headers, jwt_secret, mock_user_row):
        """Invalid status returns 400 INVALID_STATUS."""
        mock_client = _make_mock_client(mock_user_row)

        with _patch_all(jwt_secret, mock_client):
            response = client.patch(
                f"/v1/jobs/{uuid4()}",
                json={"status": "bogus"},
                headers=auth_headers,
            )

        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_STATUS"


# ---------------------------------------------------------------------------
# Tests: Delete Job
# ---------------------------------------------------------------------------


class TestDeleteJob:
    """DELETE /v1/jobs/{job_id}"""

    def test_delete_job_owner(
        self, client, auth_headers, jwt_secret, mock_user_row, mock_company_id
    ):
        """Owner can soft-delete a job (200)."""
        job_id = uuid4()

        def jobs_handler(mock_table, call_num):
            result = MagicMock()
            result.data = [_job_row(job_id=job_id, company_id=mock_company_id)]
            (
                mock_table.update.return_value.eq.return_value.eq.return_value.is_.return_value.execute.return_value
            ) = result

        mock_client = _make_mock_client(mock_user_row, {"jobs": jobs_handler})

        with _patch_all(jwt_secret, mock_client):
            response = client.delete(f"/v1/jobs/{job_id}", headers=auth_headers)

        assert response.status_code == 200
        assert response.json()["deleted"] is True

    def test_delete_job_non_owner(
        self,
        client,
        jwt_secret,
        mock_auth_user_id,
        mock_user_id,
        mock_company_id,
    ):
        """Non-owner/non-admin gets 403 FORBIDDEN."""
        # Create a user_row with role=tech (not owner/admin)
        tech_user_row = {
            "id": str(mock_user_id),
            "company_id": str(mock_company_id),
            "role": "tech",
            "is_platform_admin": False,
        }
        mock_client = _make_mock_client(tech_user_row)

        import jwt as pyjwt

        token = pyjwt.encode(
            {
                "sub": str(mock_auth_user_id),
                "aud": "authenticated",
                "role": "authenticated",
            },
            jwt_secret,
            algorithm="HS256",
        )

        with _patch_all(jwt_secret, mock_client):
            response = client.delete(
                f"/v1/jobs/{uuid4()}",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert response.status_code == 403
        assert response.json()["error_code"] == "FORBIDDEN"
