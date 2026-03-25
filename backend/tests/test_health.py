"""Tests for the health check endpoint."""


def test_health_check_returns_200(client):
    """GET /health returns 200 with status ok and version."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data


def test_health_check_includes_version(client):
    """GET /health response includes the API version string."""
    response = client.get("/health")
    data = response.json()
    assert data["version"] == "0.1.0"
