"""
Open-Meteo Air Quality integration service.
Handles upstream HTTP requests, timeouts, response validation, AQI categorization, and caching.
"""
from datetime import datetime, timezone
import math
from typing import Any, Dict, Optional
import httpx

from app.config import settings
from app.schemas import (
    CurrentAirQualityResponse,
    AQIReading,
    PollutantValue,
    GridSamplePoint,
    AirQualityGridResponse,
)
from app.services.cache import cache


def get_european_aqi_category(val: Optional[float]) -> tuple[str, str]:
    if val is None:
        return "Unknown", "Data not available"
    if val <= 20:
        return "Good", "Air quality is considered good."
    if val <= 40:
        return "Fair", "Air quality is acceptable."
    if val <= 60:
        return "Moderate", "Air quality is moderate; sensitive individuals may experience symptoms."
    if val <= 80:
        return "Poor", "Air quality is poor; adverse health effects may be experienced."
    if val <= 100:
        return "Very Poor", "Air quality is very poor; general public may be affected."
    return "Extremely Poor", "Emergency condition; severe health risks for all."


def get_us_aqi_category(val: Optional[float]) -> tuple[str, str]:
    if val is None:
        return "Unknown", "Data not available"
    if val <= 50:
        return "Good", "Air quality is satisfactory and poses little or no risk."
    if val <= 100:
        return "Moderate", "Air quality is acceptable; however, sensitive groups may be affected."
    if val <= 150:
        return "Unhealthy for Sensitive Groups", "General public is less likely to be affected; sensitive groups may experience problems."
    if val <= 200:
        return "Unhealthy", "Some members of the general public may experience health effects."
    if val <= 300:
        return "Very Unhealthy", "Health alert: The risk of health effects is increased for everyone."
    return "Hazardous", "Health warning of emergency conditions: Everyone is more likely to be affected."


async def fetch_current_air_quality(
    latitude: float,
    longitude: float,
    client: Optional[httpx.AsyncClient] = None,
    use_cache: bool = True,
) -> CurrentAirQualityResponse:
    """
    Fetches current air quality conditions from Open-Meteo Air Quality API.
    Uses in-memory cache with rounded coordinate key (2 decimal places ~1.1km).
    Maintains requested coordinate fidelity while preserving grid coordinates.
    """
    cache_key = f"current_aq_{round(latitude, 2)}_{round(longitude, 2)}"

    if use_cache:
        cached_result = cache.get(cache_key)
        if cached_result is not None:
            # Preserve caller's requested coordinates while retaining grid coordinates and marking cached=True
            cached_copy = cached_result.model_copy(
                update={"cached": True, "latitude": latitude, "longitude": longitude}
            )
            return cached_copy

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "european_aqi,us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone",
    }

    # Internal helper for making the request
    async def _do_request(c: httpx.AsyncClient) -> Dict[str, Any]:
        response = await c.get(
            settings.open_meteo_air_quality_base_url,
            params=params,
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0),
        )
        response.raise_for_status()
        return response.json()

    if client is not None:
        raw_data = await _do_request(client)
    else:
        async with httpx.AsyncClient() as new_client:
            raw_data = await _do_request(new_client)

    # Validate essential payload structure
    current = raw_data.get("current")
    if not isinstance(current, dict):
        raise ValueError("Malformed response from Open-Meteo: missing 'current' object")

    current_units = raw_data.get("current_units", {})

    # Extract AQI readings
    eaqi_val = current.get("european_aqi")
    eaqi_cat, eaqi_desc = get_european_aqi_category(eaqi_val)
    european_aqi = AQIReading(
        value=eaqi_val,
        scale="European AQI (EAQI)",
        category=eaqi_cat,
        description=eaqi_desc,
    )

    usaqi_val = current.get("us_aqi")
    usaqi_cat, usaqi_desc = get_us_aqi_category(usaqi_val)
    us_aqi = AQIReading(
        value=usaqi_val,
        scale="United States AQI (USAQI)",
        category=usaqi_cat,
        description=usaqi_desc,
    )

    # Map supported pollutant variables preserving nulls and official units
    pollutant_defs = [
        ("pm2_5", "PM2.5", "\u03bcg/m\u00b3"),
        ("pm10", "PM10", "\u03bcg/m\u00b3"),
        ("nitrogen_dioxide", "NO\u2082", "\u03bcg/m\u00b3"),
        ("sulphur_dioxide", "SO\u2082", "\u03bcg/m\u00b3"),
        ("ozone", "O\u2083", "\u03bcg/m\u00b3"),
        ("carbon_monoxide", "CO", "\u03bcg/m\u00b3"),
    ]

    pollutants: Dict[str, PollutantValue] = {}
    for key, display_name, fallback_unit in pollutant_defs:
        val = current.get(key)
        unit = current_units.get(key, fallback_unit)
        pollutants[key] = PollutantValue(
            value=val,
            unit=unit,
            display_name=display_name,
        )

    retrieved_at = datetime.now(timezone.utc).isoformat()
    observed_at = str(current.get("time", retrieved_at))

    result = CurrentAirQualityResponse(
        latitude=latitude,
        longitude=longitude,
        grid_latitude=raw_data.get("latitude"),
        grid_longitude=raw_data.get("longitude"),
        elevation=raw_data.get("elevation"),
        timezone=raw_data.get("timezone", "GMT"),
        observed_at=observed_at,
        retrieved_at=retrieved_at,
        source="Open-Meteo Air Quality API",
        data_type="atmospheric_model_estimate",
        attribution="Data provided by Open-Meteo.com under CC BY 4.0",
        european_aqi=european_aqi,
        us_aqi=us_aqi,
        pollutants=pollutants,
        cached=False,
    )

    if use_cache:
        cache.set(cache_key, result, ttl_seconds=900)

    return result


async def fetch_air_quality_grid(
    latitude: float,
    longitude: float,
    radius_km: float = 25.0,
    grid_size: int = 4,
    client: Optional[httpx.AsyncClient] = None,
    use_cache: bool = True,
) -> AirQualityGridResponse:
    """
    Fetches genuine atmospheric model estimates across a bounded spatial grid
    around the target coordinates. Uses Open-Meteo multi-coordinate batch requests
    and in-memory caching (15-min TTL) to ensure zero upstream rate-limiting.
    """
    grid_size = max(2, min(6, grid_size))
    cache_key = f"grid_aq_{round(latitude, 2)}_{round(longitude, 2)}_{round(radius_km, 1)}_{grid_size}"

    if use_cache:
        cached_result = cache.get(cache_key)
        if cached_result is not None:
            return cached_result.model_copy(update={"cached": True})

    # Generate spatial grid points bounded by radius_km
    lat_rad = math.radians(latitude)
    cos_lat = max(0.1, math.cos(lat_rad))
    half_span_lat = radius_km / 111.0
    half_span_lon = radius_km / (111.0 * cos_lat)

    lat_steps = [
        round(max(-90.0, min(90.0, latitude - half_span_lat + i * (2 * half_span_lat / (grid_size - 1)))), 4)
        for i in range(grid_size)
    ]
    lon_steps = [
        round(max(-180.0, min(180.0, longitude - half_span_lon + j * (2 * half_span_lon / (grid_size - 1)))), 4)
        for j in range(grid_size)
    ]

    coords = [(lt, ln) for lt in lat_steps for ln in lon_steps]

    batch_lats = ",".join(str(c[0]) for c in coords)
    batch_lons = ",".join(str(c[1]) for c in coords)

    params = {
        "latitude": batch_lats,
        "longitude": batch_lons,
        "current": "us_aqi,european_aqi,pm2_5",
    }

    async def _do_request(c: httpx.AsyncClient) -> Any:
        response = await c.get(
            settings.open_meteo_air_quality_base_url,
            params=params,
            timeout=httpx.Timeout(connect=5.0, read=12.0, write=5.0, pool=5.0),
        )
        response.raise_for_status()
        return response.json()

    if client is not None:
        raw_list = await _do_request(client)
    else:
        async with httpx.AsyncClient() as new_client:
            raw_list = await _do_request(new_client)

    if isinstance(raw_list, dict):
        raw_list = [raw_list]

    retrieved_at = datetime.now(timezone.utc).isoformat()
    points: list[GridSamplePoint] = []

    for item in raw_list:
        cur = item.get("current") or {}
        us_val = cur.get("us_aqi")
        eaqi_val = cur.get("european_aqi")
        pm25_val = cur.get("pm2_5")
        cat, _ = get_us_aqi_category(us_val)
        obs_time = str(cur.get("time", retrieved_at))

        points.append(
            GridSamplePoint(
                latitude=item.get("latitude", latitude),
                longitude=item.get("longitude", longitude),
                us_aqi=us_val,
                european_aqi=eaqi_val,
                pm2_5=pm25_val,
                category=cat,
                observed_at=obs_time,
            )
        )

    grid_response = AirQualityGridResponse(
        center_latitude=latitude,
        center_longitude=longitude,
        radius_km=radius_km,
        grid_points_count=len(points),
        points=points,
        primary_metric="us_aqi",
        source="Open-Meteo Atmospheric Air Quality Model",
        data_type="atmospheric_model_estimate",
        attribution="Air quality estimates by Open-Meteo.com under CC BY 4.0",
        retrieved_at=retrieved_at,
        cached=False,
    )

    if use_cache:
        cache.set(cache_key, grid_response, ttl_seconds=900)

    return grid_response

