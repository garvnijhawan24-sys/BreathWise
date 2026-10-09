"""
Open-Meteo Air Quality integration service.
Handles upstream HTTP requests, timeouts, response validation, AQI categorization, and caching.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional
import httpx

from app.config import settings
from app.schemas import (
    CurrentAirQualityResponse,
    AQIReading,
    PollutantValue,
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
