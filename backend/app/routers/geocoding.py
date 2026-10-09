"""
Geocoding API Router.
Exposes endpoints for querying locations and retrieving coordinates.
"""
from fastapi import APIRouter, HTTPException, Query
import httpx

from app.schemas import GeocodingSearchResponse, ErrorResponse
from app.services.geocoding import search_locations

router = APIRouter(prefix="/api/geocoding", tags=["Geocoding"])


@router.get(
    "/search",
    response_model=GeocodingSearchResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid query parameter"},
        502: {"model": ErrorResponse, "description": "Upstream geocoding service error"},
        504: {"model": ErrorResponse, "description": "Upstream timeout"},
    },
    summary="Search for cities and regions to get geographic coordinates",
)
async def search_cities_and_regions(
    q: str = Query(
        ...,
        min_length=2,
        max_length=100,
        description="Search query string (city name, administrative area, etc.)",
        examples=["Chennai", "London", "Tokyo"],
    ),
    count: int = Query(
        default=5,
        ge=1,
        le=10,
        description="Maximum number of results to return",
    ),
) -> GeocodingSearchResponse:
    """
    Searches for locations using Open-Meteo Geocoding API.
    Returns matched cities and verified geographic coordinates.
    """
    try:
        return await search_locations(query=q, count=count)
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail={
                "code": "UPSTREAM_TIMEOUT",
                "message": "The geocoding data provider timed out.",
                "retryable": True,
            },
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "UPSTREAM_ERROR",
                "message": f"Upstream geocoding service returned HTTP {exc.response.status_code}.",
                "retryable": exc.response.status_code >= 500,
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INTERNAL_SERVER_ERROR",
                "message": f"An unexpected error occurred during geocoding search: {exc}",
                "retryable": False,
            },
        )
