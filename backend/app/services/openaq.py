"""
OpenAQ API v3 integration service.
Handles station discovery, measurement fetching, header authentication, error handling, and caching.
"""
from datetime import datetime, timezone
import math
from typing import Any, Dict, List, Optional
import httpx

from app.config import settings
from app.schemas import (
    NearbyStationsResponse,
    StationSummary,
    StationCoordinates,
    StationSensorSummary,
    StationMeasurementsResponse,
    GroundMeasurement,
)
from app.services.cache import cache


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate great-circle distance between two points on Earth in meters.
    """
    R = 6371000.0  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(R * c, 1)


def get_openaq_headers() -> Dict[str, str]:
    """
    Returns headers required by OpenAQ API v3.
    """
    headers = {"Accept": "application/json"}
    if settings.openaq_api_key and settings.openaq_api_key.strip():
        headers["X-API-Key"] = settings.openaq_api_key.strip()
    return headers


async def discover_nearby_stations(
    latitude: float,
    longitude: float,
    radius_meters: int = 25000,
    limit: int = 10,
    client: Optional[httpx.AsyncClient] = None,
    use_cache: bool = True,
) -> NearbyStationsResponse:
    """
    Discovers OpenAQ ground monitoring stations within radius_meters of coordinates.
    Cached for 1 hour (3600 seconds) by rounded coordinate key.
    """
    cache_key = f"openaq_stations_{round(latitude, 2)}_{round(longitude, 2)}_{radius_meters}_{limit}"

    if use_cache:
        cached = cache.get(cache_key)
        if cached is not None:
            return cached.model_copy(update={"cached": True})

    # Validate API key presence
    if not settings.openaq_api_key or not settings.openaq_api_key.strip():
        raise PermissionError(
            "OpenAQ API key is not configured. Set OPENAQ_API_KEY in backend/.env to query ground stations."
        )

    # OpenAQ v3 uses coordinates=lat,lon and radius in meters
    params = {
        "coordinates": f"{latitude},{longitude}",
        "radius": radius_meters,
        "limit": min(limit, 20),
    }

    url = f"{settings.openaq_base_url.rstrip('/')}/locations"

    async def _do_req(c: httpx.AsyncClient) -> Dict[str, Any]:
        resp = await c.get(
            url,
            params=params,
            headers=get_openaq_headers(),
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0),
        )
        resp.raise_for_status()
        return resp.json()

    if client is not None:
        raw = await _do_req(client)
    else:
        async with httpx.AsyncClient() as new_client:
            raw = await _do_req(new_client)

    results = raw.get("results", [])
    stations: List[StationSummary] = []

    for item in results:
        coords_raw = item.get("coordinates")
        if not coords_raw or "latitude" not in coords_raw or "longitude" not in coords_raw:
            continue

        st_lat = float(coords_raw["latitude"])
        st_lon = float(coords_raw["longitude"])
        dist = haversine_distance(latitude, longitude, st_lat, st_lon)

        # Parse sensors summary attached to location if present
        sensors_list: List[StationSensorSummary] = []
        for s in item.get("sensors", []):
            param = s.get("parameter", {})
            param_name = param.get("name", "unknown") if isinstance(param, dict) else str(param)
            param_units = param.get("units", "unknown") if isinstance(param, dict) else "unknown"
            sensors_list.append(
                StationSensorSummary(
                    id=s.get("id", 0),
                    name=s.get("name", param_name),
                    parameter=param_name,
                    units=param_units,
                )
            )

        country_data = item.get("country", {})
        country_name = country_data.get("name") if isinstance(country_data, dict) else str(country_data) if country_data else None

        stations.append(
            StationSummary(
                id=item.get("id"),
                name=item.get("name", f"Station #{item.get('id')}"),
                coordinates=StationCoordinates(latitude=st_lat, longitude=st_lon),
                distance_meters=dist,
                locality=item.get("locality"),
                country=country_name,
                timezone=item.get("timezone"),
                sensors=sensors_list,
            )
        )

    # Sort stations by distance
    stations.sort(key=lambda x: x.distance_meters if x.distance_meters is not None else float("inf"))

    response = NearbyStationsResponse(
        latitude=latitude,
        longitude=longitude,
        radius_meters=radius_meters,
        source="OpenAQ API v3",
        data_type="monitoring_station_locations",
        attribution="Data provided by OpenAQ (openaq.org) under CC BY 4.0",
        stations=stations,
        total_found=len(stations),
        cached=False,
    )

    if use_cache:
        cache.set(cache_key, response, ttl_seconds=3600)

    return response


async def fetch_station_measurements(
    station_id: int,
    limit: int = 10,
    client: Optional[httpx.AsyncClient] = None,
    use_cache: bool = True,
) -> StationMeasurementsResponse:
    """
    Fetches recent sensor measurements for an OpenAQ ground monitoring location.
    Cached for 10 minutes (600 seconds) by station_id.
    """
    cache_key = f"openaq_measurements_{station_id}_{limit}"

    if use_cache:
        cached = cache.get(cache_key)
        if cached is not None:
            return cached.model_copy(update={"cached": True})

    if not settings.openaq_api_key or not settings.openaq_api_key.strip():
        raise PermissionError(
            "OpenAQ API key is not configured. Set OPENAQ_API_KEY in backend/.env to query ground stations."
        )

    # In OpenAQ v3: GET /locations/{location_id} returns sensor definitions,
    # and GET /locations/{location_id}/latest (or latest sensor measurements) provides recent readings.
    loc_url = f"{settings.openaq_base_url.rstrip('/')}/locations/{station_id}"
    latest_url = f"{settings.openaq_base_url.rstrip('/')}/locations/{station_id}/latest"

    async def _do_req(c: httpx.AsyncClient) -> tuple[Dict[str, Any], Dict[str, Any]]:
        # Fetch location metadata
        loc_resp = await c.get(
            loc_url,
            headers=get_openaq_headers(),
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0),
        )
        loc_resp.raise_for_status()

        # Fetch latest measurements
        latest_resp = await c.get(
            latest_url,
            headers=get_openaq_headers(),
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0),
        )
        latest_resp.raise_for_status()

        return loc_resp.json(), latest_resp.json()

    if client is not None:
        loc_raw, latest_raw = await _do_req(client)
    else:
        async with httpx.AsyncClient() as new_client:
            loc_raw, latest_raw = await _do_req(new_client)

    loc_results = loc_raw.get("results", [])
    loc_item = loc_results[0] if loc_results else {}
    st_name = loc_item.get("name", f"Station #{station_id}")

    st_coords = None
    if "coordinates" in loc_item and loc_item["coordinates"]:
        st_coords = StationCoordinates(
            latitude=float(loc_item["coordinates"]["latitude"]),
            longitude=float(loc_item["coordinates"]["longitude"]),
        )

    measurements_raw = latest_raw.get("results", [])
    measurements: List[GroundMeasurement] = []

    for m in measurements_raw:
        param = m.get("parameter", {})
        param_name = param.get("name", "unknown") if isinstance(param, dict) else str(param)
        param_units = param.get("units", "µg/m³") if isinstance(param, dict) else "µg/m³"
        
        # Datetime period or timestamp
        dt_val = m.get("datetime", {})
        observed_time = (
            dt_val.get("utc") or dt_val.get("local")
            if isinstance(dt_val, dict)
            else str(m.get("period", {}).get("datetimeTo", {}).get("utc", datetime.now(timezone.utc).isoformat()))
        )

        val = m.get("value")
        sensor_id = m.get("sensorsId") or m.get("sensorId") or 0

        measurements.append(
            GroundMeasurement(
                parameter=param_name,
                value=float(val) if val is not None else None,
                unit=param_units,
                observed_at=str(observed_time),
                sensor_id=int(sensor_id),
            )
        )

    retrieved_at = datetime.now(timezone.utc).isoformat()

    response = StationMeasurementsResponse(
        station_id=station_id,
        station_name=st_name,
        coordinates=st_coords,
        source="OpenAQ API v3",
        data_type="ground_station_observations",
        attribution="Data provided by OpenAQ (openaq.org) under CC BY 4.0",
        retrieved_at=retrieved_at,
        measurements=measurements,
        cached=False,
    )

    if use_cache:
        cache.set(cache_key, response, ttl_seconds=600)

    return response
