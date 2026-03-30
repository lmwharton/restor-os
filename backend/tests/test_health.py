"""Tests for the health check endpoint."""

from unittest.mock import patch

from tests.conftest import AsyncSupabaseMock


def test_health_check_returns_200(client):
    """GET /health returns 200 with status and version."""
    # Mock Supabase client so health check doesn't try to connect
    mock_client = AsyncSupabaseMock()
    mock_client.table.return_value.select.return_value.limit.return_value.execute.return_value.data = [
        {"id": "test"}
    ]

    with patch("api.shared.database.get_supabase_client", return_value=mock_client):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "version" in data


def test_health_check_includes_version(client):
    """GET /health response includes the current API version."""
    mock_client = AsyncSupabaseMock()
    mock_client.table.return_value.select.return_value.limit.return_value.execute.return_value.data = [
        {"id": "test"}
    ]

    with patch("api.shared.database.get_supabase_client", return_value=mock_client):
        response = client.get("/health")
        data = response.json()
        assert data["version"] == "26.3.1"


def test_health_check_degraded_on_db_failure(client):
    """GET /health returns degraded when database is unreachable."""
    mock_client = AsyncSupabaseMock()
    mock_client.table.return_value.select.return_value.limit.return_value.execute.side_effect = Exception(
        "Connection refused"
    )

    with patch("api.shared.database.get_supabase_client", return_value=mock_client):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"
        assert data["services"]["database"]["status"] == "disconnected"
