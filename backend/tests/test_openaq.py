"""
Tests for OpenAQ ground monitoring stations and observations integration.
"""
import pytest
import httpx
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from app.main import app
from app.config import settings
from app.services.cache import cache
from app.services.openaq import (
    discover_nearby_stations,
    fetch_station_measurements,
    haversine_distance,
)

client = TestClient(app)

MOCK_OPENAQ_LOCATIONS_PAYLOAD = {
    "results": [
        {
            "id": 10425,
            "name": "Manali, Chennai - CPCB",
            "coordinates": {"latitude": 13.1643, "longitude": 80.2612},
            "locality": "Chennai",
            "country": {"code": "IN", "name": "India"},
            "timezone": "Asia/Kolkata",
            "sensors": [
                {"id": 23401, "name": "pm25", "parameter": {"name": "pm25", "units": "µg/m³"}},
                {"id": 23402, "name": "pm10", "parameter": {"name": "pm10", "units": "µg/m³"}},
                {"id": 23403, "name": "no2", "parameter": {"name": "no2", "units": "µg/m³"}},
            ],
        },
        {
            "id": 10426,
            "name": "Alandur, Chennai - CPCB",
            "coordinates": {"latitude": 13.0012, "longitude": 80.2015},
            "locality": "Chennai",
            "country": {"code": "IN", "name": "India"},
            "timezone": "Asia/Kolkata",
            "sensors": [
                {"id": 23404, "name": "pm25", "parameter": {"name": "pm25", "units": "µg/m³"}},
            ],
        },
    ]
}

MOCK_OPENAQ_MEASUREMENTS_PAYLOAD = {
    "results": [
        {
            "parameter": {"name": "pm25", "units": "µg/m³"},
            "value": 34.5,
            "datetime": {"utc": "2026-10-09T17:30:00Z", "local": "2026-10-09T23:00:00+05:30"},
            "sensorsId": 23401,
        },
        {
            "parameter": {"name": "pm10", "units": "µg/m³"},
            "value": 68.2,
            "datetime": {"utc": "2026-10-09T17:30:00Z", "local": "2026-10-09T23:00:00+05:30"},
            "sensorsId": 23402,
        },
        {
            "parameter": {"name": "no2", "units": "µg/m³"},
            "value": 14.1,
            "datetime": {"utc": "2026-10-09T17:30:00Z", "local": "2026-10-09T23:00:00+05:30"},
            "sensorsId": 23403,
        },
    ]
}

MOCK_OPENAQ_LOCATION_DETAIL = {
    "results": [
        {
            "id": 10425,
            "name": "Manali, Chennai - CPCB",
            "coordinates": {"latitude": 13.1643, "longitude": 80.2612},
        }
    ]
}


def test_haversine_distance():
    """Verify haversine distance calculation between Chennai center and Manali."""
    # Approx 9 km
    dist = haversine_distance(13.0827, 80.2707, 13.1643, 80.2612)
    assert 8000 < dist < 11000


def test_missing_openaq_api_key_returns_401():
    """Test that requests fail with actionable 401 when OPENAQ_API_KEY is not configured."""
    with patch.object(settings, "openaq_api_key", ""):
        res = client.get("/api/stations/nearby?latitude=13.0827&longitude=80.2707")
        assert res.status_code == 401
        body = res.json()
        assert body["detail"]["code"] == "OPENAQ_AUTH_REQUIRED"
        assert "OPENAQ_API_KEY" in body["detail"]["message"]

        res2 = client.get("/api/stations/10425/measurements")
        assert res2.status_code == 401


@pytest.mark.anyio
async def test_discover_nearby_stations_success():
    """Test station discovery with mock HTTP client."""
    cache.clear()
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_response = httpx.Response(
        status_code=200,
        json=MOCK_OPENAQ_LOCATIONS_PAYLOAD,
        request=httpx.Request("GET", "https://api.openaq.org/v3/locations"),
    )
    mock_client.get.return_value = mock_response

    with patch.object(settings, "openaq_api_key", "test-key-mock"):
        result = await discover_nearby_stations(
            latitude=13.0827,
            longitude=80.2707,
            radius_meters=25000,
            limit=10,
            client=mock_client,
            use_cache=True,
        )

    assert result.source == "OpenAQ API v3"
    assert result.data_type == "monitoring_station_locations"
    assert result.total_found == 2
    assert len(result.stations) == 2
    first_st = result.stations[0]
    assert first_st.id in (10425, 10426)
    assert first_st.coordinates.latitude > 0
    assert first_st.distance_meters is not None
    assert len(first_st.sensors) > 0


@pytest.mark.anyio
async def test_discover_nearby_stations_empty():
    """Test empty station results when no ground stations exist nearby."""
    cache.clear()
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_response = httpx.Response(
        status_code=200,
        json={"results": []},
        request=httpx.Request("GET", "https://api.openaq.org/v3/locations"),
    )
    mock_client.get.return_value = mock_response

    with patch.object(settings, "openaq_api_key", "test-key-mock"):
        result = await discover_nearby_stations(
            latitude=0.0,
            longitude=0.0,
            client=mock_client,
            use_cache=False,
        )

    assert result.total_found == 0
    assert result.stations == []


@pytest.mark.anyio
async def test_fetch_station_measurements_success():
    """Test fetching ground station measurements with mock HTTP client."""
    cache.clear()
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    
    loc_resp = httpx.Response(
        status_code=200,
        json=MOCK_OPENAQ_LOCATION_DETAIL,
        request=httpx.Request("GET", "https://api.openaq.org/v3/locations/10425"),
    )
    meas_resp = httpx.Response(
        status_code=200,
        json=MOCK_OPENAQ_MEASUREMENTS_PAYLOAD,
        request=httpx.Request("GET", "https://api.openaq.org/v3/locations/10425/latest"),
    )
    mock_client.get.side_effect = [loc_resp, meas_resp]

    with patch.object(settings, "openaq_api_key", "test-key-mock"):
        result = await fetch_station_measurements(
            station_id=10425,
            client=mock_client,
            use_cache=True,
        )

    assert result.source == "OpenAQ API v3"
    assert result.data_type == "ground_station_observations"
    assert result.station_id == 10425
    assert result.station_name == "Manali, Chennai - CPCB"
    assert len(result.measurements) == 3
    assert result.measurements[0].parameter == "pm25"
    assert result.measurements[0].value == 34.5
    assert result.measurements[0].unit == "µg/m³"


def test_station_endpoints_validation():
    """Test parameter validation for station endpoints."""
    # Invalid coordinates
    res1 = client.get("/api/stations/nearby?latitude=100.0&longitude=80.0")
    assert res1.status_code == 422

    # Invalid radius (> 100 km)
    res2 = client.get("/api/stations/nearby?latitude=13.0&longitude=80.0&radius_km=200")
    assert res2.status_code == 422


@patch("app.routers.stations.discover_nearby_stations")
def test_openaq_upstream_timeout(mock_discover):
    """Test router handling of OpenAQ timeout returning 504."""
    mock_discover.side_effect = httpx.TimeoutException("OpenAQ timed out")
    res = client.get("/api/stations/nearby?latitude=13.0827&longitude=80.2707")
    assert res.status_code == 504
    assert res.json()["detail"]["code"] == "UPSTREAM_TIMEOUT"


@patch("app.routers.stations.discover_nearby_stations")
def test_openaq_rate_limited(mock_discover):
    """Test router handling of OpenAQ 429 rate limit."""
    mock_response = httpx.Response(status_code=429, request=httpx.Request("GET", "https://api.openaq.org/v3"))
    mock_discover.side_effect = httpx.HTTPStatusError("Rate limited", request=mock_response.request, response=mock_response)
    res = client.get("/api/stations/nearby?latitude=13.0827&longitude=80.2707")
    assert res.status_code == 429
    assert res.json()["detail"]["code"] == "OPENAQ_RATE_LIMITED"
