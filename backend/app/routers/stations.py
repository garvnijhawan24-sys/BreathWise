"""
Ground Stations API Router.
Exposes endpoints for discovering OpenAQ ground monitoring stations and their recent observations.
"""
from fastapi import APIRouter, HTTPException, Query
import httpx

from app.schemas import NearbyStationsResponse, StationMeasurementsResponse, ErrorResponse
from app.services.openaq import discover_nearby_stations, fetch_station_measurements

router = APIRouter(prefix="/api/stations", tags=["Ground Stations"])


@router.get(
    "/nearby",
    response_model=NearbyStationsResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid coordinates or radius"},
        401: {"model": ErrorResponse, "description": "OpenAQ API Key missing or unauthorized"},
        502: {"model": ErrorResponse, "description": "Upstream OpenAQ error"},
        504: {"model": ErrorResponse, "description": "Upstream timeout"},
    },
    summary="Discover ground monitoring stations near coordinates",
)
async def get_nearby_stations(
    latitude: float = Query(
        ...,
        ge=-90.0,
        le=90.0,
        description="Latitude in degrees (-90.0 to 90.0)",
        examples=[13.0827],
    ),
    longitude: float = Query(
        ...,
        ge=-180.0,
        le=180.0,
        description="Longitude in degrees (-180.0 to 180.0)",
        examples=[80.2707],
    ),
    radius_km: int = Query(
        25,
        ge=1,
        le=100,
        description="Search radius in kilometers (1 to 100)",
    ),
    limit: int = Query(
        10,
        ge=1,
        le=20,
        description="Maximum number of stations to return",
    ),
) -> NearbyStationsResponse:
    """
    Discovers physical ground air quality monitoring stations from OpenAQ API v3 within radius_km.
    Results are cached in-memory for 1 hour.
    """
    try:
        radius_meters = radius_km * 1000
        return await discover_nearby_stations(
            latitude=latitude,
            longitude=longitude,
            radius_meters=radius_meters,
            limit=limit,
        )
    except PermissionError as perm_err:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "OPENAQ_AUTH_REQUIRED",
                "message": str(perm_err),
                "retryable": False,
            },
        )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail={
                "code": "UPSTREAM_TIMEOUT",
                "message": "The OpenAQ ground station provider timed out.",
                "retryable": True,
            },
        )
    except httpx.HTTPStatusError as exc:
        status_code = 502
        if exc.response.status_code == 401 or exc.response.status_code == 403:
            status_code = 401
            code = "OPENAQ_UNAUTHORIZED"
            msg = "OpenAQ rejected the API key or authorization header."
        elif exc.response.status_code == 429:
            status_code = 429
            code = "OPENAQ_RATE_LIMITED"
            msg = "OpenAQ API rate limit exceeded. Please retry later."
        else:
            code = "OPENAQ_UPSTREAM_ERROR"
            msg = f"OpenAQ returned HTTP {exc.response.status_code}."

        raise HTTPException(
            status_code=status_code,
            detail={
                "code": code,
                "message": msg,
                "retryable": exc.response.status_code in (429, 502, 503, 504),
            },
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred while discovering nearby ground stations.",
                "retryable": False,
            },
        )


@router.get(
    "/{station_id}/measurements",
    response_model=StationMeasurementsResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid station ID"},
        401: {"model": ErrorResponse, "description": "OpenAQ API Key missing or unauthorized"},
        404: {"model": ErrorResponse, "description": "Station not found"},
        502: {"model": ErrorResponse, "description": "Upstream OpenAQ error"},
        504: {"model": ErrorResponse, "description": "Upstream timeout"},
    },
    summary="Get recent sensor measurements for an OpenAQ ground station",
)
async def get_station_measurements(
    station_id: int,
    limit: int = Query(10, ge=1, le=50, description="Maximum measurements to return"),
) -> StationMeasurementsResponse:
    """
    Retrieves recent sensor measurements from OpenAQ API v3 for a physical monitoring station.
    Results are cached in-memory for 10 minutes.
    """
    try:
        return await fetch_station_measurements(station_id=station_id, limit=limit)
    except PermissionError as perm_err:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "OPENAQ_AUTH_REQUIRED",
                "message": str(perm_err),
                "retryable": False,
            },
        )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail={
                "code": "UPSTREAM_TIMEOUT",
                "message": "The OpenAQ ground station provider timed out.",
                "retryable": True,
            },
        )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "STATION_NOT_FOUND",
                    "message": f"OpenAQ station #{station_id} was not found.",
                    "retryable": False,
                },
            )
        status_code = 502
        if exc.response.status_code in (401, 403):
            status_code = 401
            code = "OPENAQ_UNAUTHORIZED"
            msg = "OpenAQ rejected the API key or authorization header."
        elif exc.response.status_code == 429:
            status_code = 429
            code = "OPENAQ_RATE_LIMITED"
            msg = "OpenAQ API rate limit exceeded. Please retry later."
        else:
            code = "OPENAQ_UPSTREAM_ERROR"
            msg = f"OpenAQ returned HTTP {exc.response.status_code}."

        raise HTTPException(
            status_code=status_code,
            detail={
                "code": code,
                "message": msg,
                "retryable": exc.response.status_code in (429, 502, 503, 504),
            },
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred while fetching station measurements.",
                "retryable": False,
            },
        )
