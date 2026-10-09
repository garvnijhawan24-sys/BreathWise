"""
Unit and integration tests for Environmental Reports and CSV export (Phase 5A).
"""
import io
import csv
import pytest
import httpx
from starlette.testclient import TestClient

from app.main import app
from app.config import settings
from app.services.reports import generate_environmental_report, generate_report_csv
from app.schemas import EnvironmentalReport


@pytest.fixture
def mock_open_meteo_payload():
    return {
        "latitude": 13.08,
        "longitude": 80.25,
        "generationtime_ms": 1.2,
        "utc_offset_seconds": 0,
        "timezone": "UTC",
        "timezone_abbreviation": "UTC",
        "elevation": 10.0,
        "current": {
            "time": "2026-10-10T00:00",
            "interval": 3600,
            "european_aqi": 35.0,
            "us_aqi": 68.0,
            "pm10": 42.5,
            "pm2_5": 20.1,
            "carbon_monoxide": 350.0,
            "nitrogen_dioxide": 28.4,
            "sulphur_dioxide": 12.0,
            "ozone": 45.0,
        },
    }


@pytest.fixture
def mock_openaq_locations_payload():
    return {
        "results": [
            {
                "id": 101,
                "name": "Central Ground Station",
                "coordinates": {"latitude": 13.085, "longitude": 80.275},
                "locality": "Chennai",
                "country": {"name": "India"},
                "timezone": "Asia/Kolkata",
                "sensors": [
                    {"id": 501, "name": "PM2.5 Sensor", "parameter": {"name": "pm25", "units": "µg/m³"}}
                ],
            }
        ]
    }


@pytest.fixture
def mock_openaq_latest_payload():
    return {
        "results": [
            {
                "parameter": {"name": "pm25", "units": "µg/m³"},
                "value": 24.5,
                "datetime": {"utc": "2026-10-10T00:00:00Z"},
                "sensorId": 501,
            }
        ]
    }


@pytest.mark.anyio
async def test_generate_report_without_openaq_key(monkeypatch, mock_open_meteo_payload):
    """
    When OpenAQ API key is unset, the report succeeds with full Open-Meteo data
    and gracefully marks OpenAQ ground monitoring as unauthenticated.
    """
    monkeypatch.setattr(settings, "openaq_api_key", None)
    monkeypatch.setattr(settings, "ml_model_enabled", False)

    def mock_handler(request: httpx.Request) -> httpx.Response:
        if "open-meteo.com" in str(request.url):
            return httpx.Response(200, json=mock_open_meteo_payload)
        return httpx.Response(404)

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as client:
        report = await generate_environmental_report(
            latitude=13.0827,
            longitude=80.2707,
            client=client,
        )

    assert isinstance(report, EnvironmentalReport)
    assert report.report_id.startswith("BW-REP-")
    assert report.open_meteo.available is True
    assert report.open_meteo.status == "operational"
    assert report.open_meteo.european_aqi.value == 35.0
    assert report.open_meteo.european_aqi.category == "Fair"
    assert report.open_meteo.pollutants["pm2_5"].value == 20.1

    # OpenAQ graceful degradation
    assert report.openaq.available is False
    assert report.openaq.status == "unauthenticated"
    assert "OpenAQ API key is not configured" in report.openaq.message

    # ML disclaimer
    assert report.ml_forecast.status == "model_not_trained"
    assert "uncalibrated" in report.ml_forecast.disclaimer


@pytest.mark.anyio
async def test_generate_report_with_openaq_data(
    monkeypatch,
    mock_open_meteo_payload,
    mock_openaq_locations_payload,
    mock_openaq_latest_payload,
):
    """
    When OpenAQ API key is configured and returns data, both sections are operational.
    """
    monkeypatch.setattr(settings, "openaq_api_key", "test-valid-key")
    monkeypatch.setattr(settings, "ml_model_enabled", False)

    def mock_handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "open-meteo.com" in url_str:
            return httpx.Response(200, json=mock_open_meteo_payload)
        elif "/locations/101/latest" in url_str:
            return httpx.Response(200, json=mock_openaq_latest_payload)
        elif "/locations/101" in url_str:
            return httpx.Response(200, json=mock_openaq_locations_payload)
        elif "/locations" in url_str:
            return httpx.Response(200, json=mock_openaq_locations_payload)
        return httpx.Response(404)

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as client:
        report = await generate_environmental_report(
            latitude=13.0827,
            longitude=80.2707,
            client=client,
        )

    assert report.open_meteo.available is True
    assert report.openaq.available is True
    assert report.openaq.status == "operational"
    assert report.openaq.stations_found == 1
    assert len(report.openaq.stations) == 1
    station = report.openaq.stations[0]
    assert station.station_name == "Central Ground Station"
    assert len(station.measurements) == 1
    assert station.measurements[0].value == 24.5
    assert station.measurements[0].unit == "µg/m³"


@pytest.mark.anyio
async def test_report_csv_generation(monkeypatch, mock_open_meteo_payload):
    """
    Verifies that CSV generation formats cleanly, contains all required sections,
    and preserves RFC 4180 parsing.
    """
    monkeypatch.setattr(settings, "openaq_api_key", None)
    monkeypatch.setattr(settings, "ml_model_enabled", False)

    def mock_handler(request: httpx.Request) -> httpx.Response:
        if "open-meteo.com" in str(request.url):
            return httpx.Response(200, json=mock_open_meteo_payload)
        return httpx.Response(404)

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as client:
        report = await generate_environmental_report(
            latitude=13.0827,
            longitude=80.2707,
            client=client,
        )

    csv_text = generate_report_csv(report)
    assert "BREATHEWISE ENVIRONMENTAL INTELLIGENCE REPORT" in csv_text
    assert "SECTION 1: ATMOSPHERIC MODEL ESTIMATES (OPEN-METEO)" in csv_text
    assert "European AQI,35.0" in csv_text
    assert "United States AQI,68.0" in csv_text
    assert "CC BY 4.0" in csv_text
    assert "SECTION 2: PHYSICAL GROUND-STATION OBSERVATIONS (OPENAQ)" in csv_text
    assert "SECTION 3: LOCAL MACHINE LEARNING FORECASTING STATUS" in csv_text
    assert "model_not_trained" in csv_text
    assert "METHODOLOGY & SCIENTIFIC DISCLAIMERS" in csv_text

    # Verify CSV is parsable by standard csv.reader
    reader = csv.reader(io.StringIO(csv_text))
    rows = list(reader)
    assert len(rows) > 10


def test_api_reports_endpoint():
    """
    Integration test for GET /api/reports endpoint.
    """
    with TestClient(app) as client:
        resp = client.get("/api/reports?latitude=13.0827&longitude=80.2707")
        # May be 200 or upstream handled depending on network, but should not 500
        assert resp.status_code in (200, 502, 504)
        if resp.status_code == 200:
            data = resp.json()
            assert "report_id" in data
            assert "open_meteo" in data
            assert "openaq" in data
            assert "ml_forecast" in data


def test_api_reports_export_csv_endpoint():
    """
    Integration test for GET /api/reports/export endpoint.
    """
    with TestClient(app) as client:
        resp = client.get("/api/reports/export?latitude=13.0827&longitude=80.2707&format=csv")
        assert resp.status_code in (200, 502, 504)
        if resp.status_code == 200:
            assert resp.headers["content-type"].startswith("text/csv")
            assert "attachment;" in resp.headers["content-disposition"]
            assert "BREATHEWISE ENVIRONMENTAL INTELLIGENCE REPORT" in resp.text


def test_api_reports_invalid_parameters():
    """
    Test coordinate bounds and format validation.
    """
    with TestClient(app) as client:
        # Invalid latitude
        resp = client.get("/api/reports?latitude=100.0&longitude=50.0")
        assert resp.status_code == 422

        # Invalid format
        resp = client.get("/api/reports/export?latitude=13.0&longitude=80.0&format=unsupported")
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "INVALID_FORMAT"
