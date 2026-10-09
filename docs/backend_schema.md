# BreatheWise --- Backend API Schema and Service Contracts

## 1. Purpose

This document defines the FastAPI boundary between the frontend and
data/ML services. Provider-specific response formats should not leak
into React components. Validate inputs, normalize outputs, preserve
provenance, and return consistent errors.

## 2. Endpoint Catalogue

  ------------------------------------------------------------------------------------
  Method            Endpoint                 Parameters              Response
  ----------------- ------------------------ ----------------------- -----------------
  GET               `/api/health`            none                    Service status

  GET               `/api/air-quality`       `lat`, `lon`, `start`,  Available station
                                             `end`, optional         observations and
                                             `radius_km`             station metadata

  GET               `/api/forecast`          `lat`, `lon`, `hours`   External
                                                                     pollutant
                                                                     forecast

  GET               `/api/forecast/ml`       supported               Local ML forecast
                                             `station_id`/location   or unavailable
                                             key, `hours`            status

  GET               `/api/trends`            `lat`, `lon`, `start`,  Summary
                                             `end`, `pollutant`      statistics and
                                                                     peaks

  GET               `/api/hotspots`          `lat`, `lon`,           Nearby station
                                             `radius_km`             comparison

  GET               `/api/reports`           `lat`, `lon`, `region`  Public
                                                                     environmental
                                                                     reports

  GET               `/api/recommendations`   `lat`, `lon`            Condition-based
                                                                     guidance
  ------------------------------------------------------------------------------------

## 3. Validation

-   Latitude: `-90` to `90`.
-   Longitude: `-180` to `180`.
-   Start date must be before or equal to end date.
-   Enforce supported historical windows and upstream provider limits.
-   Forecast horizon must be from an allowlist such as 24, 48, or 72
    hours, subject to provider support.
-   Radius must be positive and bounded.
-   Pollutant must be an allowlisted canonical identifier.
-   Bound result limits and pagination.
-   Use timezone-aware timestamps.
-   Reject malformed values with FastAPI/Pydantic validation.
-   Never let a client provide arbitrary URLs that the server fetches.

## 4. Canonical Pollutant Names

  Canonical name       Display name   Typical unit
  -------------------- -------------- -------------------------------------
  `pm2_5`              PM2.5          µg/m³
  `pm10`               PM10           µg/m³
  `nitrogen_dioxide`   NO₂            provider-specific; normalize/record
  `sulphur_dioxide`    SO₂            provider-specific; normalize/record
  `ozone`              O₃             provider-specific; normalize/record

Never assume all providers use the same unit for gaseous pollutants.
Normalize only when the conversion is valid and documented. Preserve the
source unit if conversion is not performed.

## 5. Pydantic Response Models

``` python
from datetime import datetime
from typing import Literal
from pydantic import BaseModel

Pollutant = Literal[
    "pm2_5", "pm10", "nitrogen_dioxide",
    "sulphur_dioxide", "ozone"
]

class Measurement(BaseModel):
    timestamp: datetime
    pollutant: Pollutant
    value: float | None
    unit: str
    source: str
    data_type: Literal[
        "station_observation",
        "model_forecast",
        "historical_model_data"
    ]
    station_id: str | None = None
    quality_status: str | None = None

class ForecastPoint(BaseModel):
    timestamp: datetime
    pollutant: Pollutant
    value: float | None
    unit: str
    source: str
    model_name: str | None = None
    forecast_horizon_hours: int | None = None

class TrendSummary(BaseModel):
    pollutant: Pollutant
    unit: str
    sample_count: int
    mean_value: float | None
    min_value: float | None
    max_value: float | None
    first_value: float | None
    last_value: float | None
    change_percent: float | None

class ApiError(BaseModel):
    code: str
    message: str
    retryable: bool = False
```

Use timezone-aware datetimes. `change_percent` is `null` if the baseline
is zero or unavailable. Empty valid datasets should return a clear empty
result, not fake zeros.

## 6. Example Trends Response

``` json
{
  "location": {
    "latitude": 13.0827,
    "longitude": 80.2707
  },
  "period": {
    "start": "2026-10-01T00:00:00+05:30",
    "end": "2026-10-08T23:00:00+05:30"
  },
  "source": "openaq",
  "pollutant": "pm2_5",
  "unit": "µg/m³",
  "sample_count": 0,
  "mean_value": null,
  "min_value": null,
  "max_value": null,
  "change_percent": null
}
```

This example represents no data; it is not a real query result.

## 7. Error Contract

Suggested error body:

``` json
{
  "code": "UPSTREAM_TIMEOUT",
  "message": "The data provider did not respond in time.",
  "retryable": true
}
```

Suggested statuses: - `200`: successful response, including a valid
no-data result. - `400` or `422`: invalid parameters. - `429`: rate
limit reached if rate limiting is implemented. - `502`/`503`: provider
failure or temporary unavailability. - `504`: upstream timeout where
appropriate. - `500`: unexpected internal error, with no stack trace or
secret details in the public response.

Use a consistent schema and do not expose raw provider exceptions to
clients.

## 8. Service Boundaries

-   `services/open_meteo.py`: build request, call provider, validate
    response, normalize model forecast.
-   `services/openaq.py`: locate stations, retrieve sensor metadata,
    fetch measurements, normalize observations.
-   `services/cache.py`: cache provider responses with explicit TTL.
-   `analytics/trends.py`: summary, peaks, comparison.
-   `analytics/recommendations.py`: transparent rule-based advice.
-   `services/report_search.py`: source-backed report retrieval and
    normalization.
-   `ml/predict.py`: load trusted model and produce predictions or
    unavailable status.

Routers should validate and delegate; do not put all provider parsing or
training in route handlers.

## 9. Provider Error Handling

-   Set HTTP timeouts.
-   Check status codes and response shape.
-   Validate numeric values and timestamps.
-   Handle absent pollutant arrays without converting them to zero.
-   Bound retries and use backoff for retryable failures.
-   Cache only when the cache key contains all relevant query
    dimensions.
-   Show stale cache age if returning cached results during an outage.
-   Do not disable TLS verification.

## 10. Security

-   Keep OpenAQ and search API keys on the backend.
-   Restrict CORS to known frontend origins.
-   Validate coordinates, date ranges, pollutant identifiers, and
    radius.
-   Do not fetch arbitrary client-supplied URLs.
-   Avoid unbounded date windows and result counts.
-   Do not return stack traces, environment variables, or secrets.
-   Consider per-IP rate limiting for public deployments.
-   Do not log secrets.
-   Keep logs useful but privacy-conscious.

## 11. OpenAPI and Testing

FastAPI serves interactive documentation at `/docs` by default. Use it
during development and verify that response models reflect actual
behaviour.

Minimum tests: - Health returns 200. - Invalid coordinates return 422. -
Provider timeout becomes a safe error. - Malformed upstream payload is
handled. - Empty valid data returns a valid empty response. - Trends are
correct for a known dataset. - Missing model returns explicit
unavailable status. - CORS works on the deployed frontend.

## 12. Example Health Endpoint

``` python
from fastapi import FastAPI

app = FastAPI(title="BreatheWise API")

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "breathewise"}
```

Run locally from the backend directory with
`uvicorn app.main:app --reload --port 8000`.
