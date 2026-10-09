"""
Tests for Open-Meteo Air Quality integration, coordinate fidelity, and caching.
"""
import pytest
import time
import httpx
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from app.main import app
from app.services.cache import InMemoryCache, cache
from app.services.open_meteo import fetch_current_air_quality

client = TestClient(app)

MOCK_OPEN_METEO_PAYLOAD = {
    "latitude": 13.099998,
    "longitude": 80.30002,
    "generationtime_ms": 0.36,
    "utc_offset_seconds": 0,
    "timezone": "GMT",
    "timezone_abbreviation": "GMT",
    "elevation": 12.0,
    "current_units": {
        "time": "iso8601",
        "interval": "seconds",
        "european_aqi": "EAQI",
        "us_aqi": "USAQI",
        "pm10": "µg/m³",
        "pm2_5": "µg/m³",
        "carbon_monoxide": "µg/m³",
        "nitrogen_dioxide": "µg/m³",
        "sulphur_dioxide": "µg/m³",
        "ozone": "µg/m³",
    },
    "current": {
        "time": "2026-10-09T17:00",
        "interval": 3600,
        "european_aqi": 41,
        "us_aqi": 69,
        "pm10": 24.8,
        "pm2_5": 17.6,
        "carbon_monoxide": 165.0,
        "nitrogen_dioxide": 7.6,
        "sulphur_dioxide": 5.7,
        "ozone": 38.0,
    },
}


def test_invalid_coordinates():
    """Test latitude and longitude validation boundaries."""
    # Latitude out of bounds (> 90)
    res1 = client.get("/api/air-quality/current?latitude=95.0&longitude=80.0")
    assert res1.status_code == 422

    # Longitude out of bounds (< -180)
    res2 = client.get("/api/air-quality/current?latitude=13.0&longitude=-185.0")
    assert res2.status_code == 422

    # Missing parameters
    res3 = client.get("/api/air-quality/current")
    assert res3.status_code == 422


@pytest.mark.anyio
async def test_fetch_current_air_quality_success():
    """Test service function with mocked HTTP client response."""
    cache.clear()
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_response = httpx.Response(
        status_code=200,
        json=MOCK_OPEN_METEO_PAYLOAD,
        request=httpx.Request("GET", "https://air-quality-api.open-meteo.com/v1/air-quality"),
    )
    mock_client.get.return_value = mock_response

    result = await fetch_current_air_quality(
        latitude=13.0827,
        longitude=80.2707,
        client=mock_client,
        use_cache=True,
    )

    assert result.source == "Open-Meteo Air Quality API"
    assert result.data_type == "atmospheric_model_estimate"
    assert result.latitude == 13.0827
    assert result.longitude == 80.2707
    assert result.grid_latitude == 13.099998
    assert result.grid_longitude == 80.30002
    assert result.european_aqi.value == 41
    assert result.european_aqi.category == "Moderate"
    assert result.us_aqi.value == 69
    assert result.us_aqi.category == "Moderate"
    assert result.pollutants["pm2_5"].value == 17.6
    assert result.pollutants["pm2_5"].unit == "µg/m³"
    assert result.pollutants["pm10"].value == 24.8
    assert result.cached is False


@pytest.mark.anyio
async def test_cache_coordinate_fidelity_regression():
    """
    Regression test for Phase 2 finding:
    Two queries mapping to the same rounded cache key must both preserve
    their respective requested coordinates while sharing the cached model data.
    """
    cache.clear()
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_response = httpx.Response(
        status_code=200,
        json=MOCK_OPEN_METEO_PAYLOAD,
        request=httpx.Request("GET", "https://air-quality-api.open-meteo.com/v1/air-quality"),
    )
    mock_client.get.return_value = mock_response

    # Query 1: (13.081, 80.271) rounds to (13.08, 80.27)
    res1 = await fetch_current_air_quality(
        latitude=13.081,
        longitude=80.271,
        client=mock_client,
        use_cache=True,
    )
    assert res1.latitude == 13.081
    assert res1.longitude == 80.271
    assert res1.cached is False

    # Query 2: (13.084, 80.269) also rounds to (13.08, 80.27) -> Cache hit
    res2 = await fetch_current_air_quality(
        latitude=13.084,
        longitude=80.269,
        client=mock_client,
        use_cache=True,
    )
    # Must preserve Query 2's requested coordinates, NOT Query 1's
    assert res2.latitude == 13.084
    assert res2.longitude == 80.269
    assert res2.cached is True
    # Both share the same grid coordinates
    assert res2.grid_latitude == res1.grid_latitude
    assert res2.grid_longitude == res1.grid_longitude


@pytest.mark.anyio
async def test_missing_optional_pollutants():
    """Test that missing/null pollutants remain null rather than converting to zero."""
    cache.clear()
    sparse_payload = {
        "latitude": 10.0,
        "longitude": 20.0,
        "current_units": {"pm2_5": "µg/m³"},
        "current": {
            "time": "2026-10-09T12:00",
            "pm2_5": None,
            "european_aqi": None,
            "us_aqi": None,
        },
    }
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_response = httpx.Response(
        status_code=200,
        json=sparse_payload,
        request=httpx.Request("GET", "https://air-quality-api.open-meteo.com/v1/air-quality"),
    )
    mock_client.get.return_value = mock_response

    result = await fetch_current_air_quality(
        latitude=10.0,
        longitude=20.0,
        client=mock_client,
        use_cache=False,
    )

    assert result.pollutants["pm2_5"].value is None
    assert result.pollutants["pm10"].value is None
    assert result.european_aqi.value is None
    assert result.european_aqi.category == "Unknown"
    assert result.us_aqi.value is None


@pytest.mark.anyio
async def test_malformed_upstream_response():
    """Test that responses missing 'current' raise ValueError."""
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_response = httpx.Response(
        status_code=200,
        json={"error": True, "reason": "Latitude must be in range of -90 to 90"},
        request=httpx.Request("GET", "https://air-quality-api.open-meteo.com/v1/air-quality"),
    )
    mock_client.get.return_value = mock_response

    with pytest.raises(ValueError, match="missing 'current' object"):
        await fetch_current_air_quality(latitude=13.0, longitude=80.0, client=mock_client, use_cache=False)


def test_in_memory_cache_ttl_and_eviction():
    """Test in-memory cache TTL expiration and max entries LRU behavior."""
    test_cache = InMemoryCache(default_ttl_seconds=3600, max_entries=2)
    test_cache.set("a", 100)
    test_cache.set("b", 200)

    # Both present
    assert test_cache.get("b") == 200
    assert test_cache.get("a") == 100  # Touch 'a', now 'b' is least recently used

    # Adding 'c' must evict 'b'
    test_cache.set("c", 300)
    assert test_cache.get("a") == 100
    assert test_cache.get("b") is None
    assert test_cache.get("c") == 300


def test_in_memory_cache_ttl_expiration():
    """Test that expired cache items return None."""
    test_cache = InMemoryCache(default_ttl_seconds=0, max_entries=5)
    test_cache.set("quick", 999, ttl_seconds=0)
    time.sleep(0.01)
    assert test_cache.get("quick") is None


@patch("app.routers.air_quality.fetch_current_air_quality")
def test_endpoint_upstream_timeout(mock_fetch):
    """Test router handling of upstream TimeoutException returning 504."""
    mock_fetch.side_effect = httpx.TimeoutException("Connection timed out")
    response = client.get("/api/air-quality/current?latitude=13.0827&longitude=80.2707")
    assert response.status_code == 504
    body = response.json()
    assert body["detail"]["code"] == "UPSTREAM_TIMEOUT"
    assert body["detail"]["retryable"] is True


def test_air_quality_grid_endpoint_validation():
    """Verify bounds validation on /api/air-quality/grid."""
    res_lat = client.get("/api/air-quality/grid?latitude=100.0&longitude=80.0")
    assert res_lat.status_code == 422

    res_rad = client.get("/api/air-quality/grid?latitude=13.0&longitude=80.0&radius_km=0.5")
    assert res_rad.status_code == 422


@pytest.mark.anyio
async def test_fetch_air_quality_grid_mocked():
    """Verify grid sampling service parses multi-coordinate response correctly."""
    from app.services.open_meteo import fetch_air_quality_grid

    mock_batch = [
        {
            "latitude": 13.0,
            "longitude": 80.0,
            "current": {"us_aqi": 55, "european_aqi": 30, "pm2_5": 14.2, "time": "2026-10-09T17:00"},
        },
        {
            "latitude": 13.1,
            "longitude": 80.1,
            "current": {"us_aqi": 75, "european_aqi": 45, "pm2_5": 22.0, "time": "2026-10-09T17:00"},
        },
    ]

    class MockTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=mock_batch)

    async with httpx.AsyncClient(transport=MockTransport()) as test_client:
        res = await fetch_air_quality_grid(
            latitude=13.0,
            longitude=80.0,
            radius_km=15.0,
            grid_size=2,
            client=test_client,
            use_cache=False,
        )
        assert res.grid_points_count == 2
        assert len(res.points) == 2
        assert res.points[0].us_aqi == 55
        assert res.points[0].category == "Moderate"
        assert res.data_type == "atmospheric_model_estimate"


def test_geocoding_search_endpoint():
    """Verify /api/geocoding/search endpoint handles input and validation."""
    # Min length validation
    res_short = client.get("/api/geocoding/search?q=a")
    assert res_short.status_code == 422

    # Query with mock
    with patch("app.routers.geocoding.search_locations") as mock_search:
        from app.schemas import GeocodingSearchResponse, GeocodingResultItem
        mock_search.return_value = GeocodingSearchResponse(
            query="Chennai",
            count=1,
            results=[
                GeocodingResultItem(
                    id=123,
                    name="Chennai",
                    latitude=13.0827,
                    longitude=80.2707,
                    country="India",
                    country_code="IN",
                )
            ],
        )
        res = client.get("/api/geocoding/search?q=Chennai")
        assert res.status_code == 200
        data = res.json()
        assert data["count"] == 1
        assert data["results"][0]["name"] == "Chennai"

