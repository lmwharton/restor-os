"""Integration tests: /health endpoint against real local Supabase."""

import pytest

pytestmark = [pytest.mark.integration]


@pytest.mark.asyncio
async def test_health_returns_healthy(api_client):
    """Verify /health returns 200 with database connected."""
    resp = await api_client.get("/health")
    assert resp.status_code == 200

    data = resp.json()
    assert data["status"] == "healthy"
    assert data["services"]["api"]["status"] == "ok"
    assert data["services"]["database"]["status"] == "connected"


@pytest.mark.asyncio
async def test_health_includes_version(api_client):
    """Verify /health includes version and timestamp."""
    resp = await api_client.get("/health")
    data = resp.json()

    assert "version" in data
    assert "timestamp" in data
    assert data["environment"] == "test"
