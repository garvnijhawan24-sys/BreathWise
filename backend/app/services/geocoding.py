"""
Open-Meteo Geocoding Integration Service.
Provides fast, API-key-free location searches with in-memory caching and input validation.
"""
import logging
from typing import Optional
import httpx

from app.config import settings
from app.schemas import GeocodingResultItem, GeocodingSearchResponse
from app.services.cache import cache

logger = logging.getLogger(__name__)


async def search_locations(
    query: str,
    count: int = 5,
    client: Optional[httpx.AsyncClient] = None,
    use_cache: bool = True,
) -> GeocodingSearchResponse:
    """
    Searches for cities and regions using Open-Meteo Geocoding API.
    Returns validated coordinates and administrative metadata.
    """
    clean_q = query.strip()
    if len(clean_q) < 2:
        return GeocodingSearchResponse(query=clean_q, count=0, results=[])

    count = max(1, min(10, count))
    cache_key = f"geocoding_{clean_q.lower()}_{count}"

    if use_cache:
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

    params = {
        "name": clean_q,
        "count": count,
        "language": "en",
        "format": "json",
    }

    async def _do_request(c: httpx.AsyncClient) -> dict:
        resp = await c.get(
            settings.open_meteo_geocoding_base_url,
            params=params,
            timeout=httpx.Timeout(connect=5.0, read=8.0, write=5.0, pool=5.0),
        )
        resp.raise_for_status()
        return resp.json()

    try:
        if client is not None:
            data = await _do_request(client)
        else:
            async with httpx.AsyncClient() as new_client:
                data = await _do_request(new_client)
    except Exception as exc:
        logger.warning(f"Geocoding request failed for '{clean_q}': {exc}")
        return GeocodingSearchResponse(query=clean_q, count=0, results=[])

    raw_results = data.get("results") or []
    items: list[GeocodingResultItem] = []

    for r in raw_results:
        try:
            items.append(
                GeocodingResultItem(
                    id=r["id"],
                    name=r["name"],
                    latitude=float(r["latitude"]),
                    longitude=float(r["longitude"]),
                    country=r.get("country"),
                    country_code=r.get("country_code"),
                    admin1=r.get("admin1"),
                    timezone=r.get("timezone"),
                )
            )
        except (KeyError, ValueError, TypeError) as parse_err:
            logger.debug(f"Skipping malformed geocoding entry: {parse_err}")
            continue

    response = GeocodingSearchResponse(
        query=clean_q,
        count=len(items),
        results=items,
    )

    if use_cache and items:
        cache.set(cache_key, response, ttl_seconds=3600)

    return response
