"""
Air Quality API Router.
Exposes endpoints for querying current air quality.
"""
from fastapi import APIRouter, HTTPException, Query
import httpx

from app.schemas import CurrentAirQualityResponse, ErrorResponse
from app.services.open_meteo import fetch_current_air_quality

router = APIRouter(prefix="/api/air-quality", tags=["Air Quality"])


@router.get(
    "/current",
    response_model=CurrentAirQualityResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid coordinates or query parameters"},
        502: {"model": ErrorResponse, "description": "Upstream Open-Meteo provider error"},
        504: {"model": ErrorResponse, "description": "Upstream timeout"},
    },
    summary="Get current air quality estimates for coordinates",
)
async def get_current_air_quality(
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
) -> CurrentAirQualityResponse:
    """
    Retrieves current air quality estimates (European AQI, US AQI, PM2.5, PM10, NO2, SO2, O3, CO)
    from Open-Meteo Air Quality API. Results are cached in-memory with a 15-minute TTL.
    """
    try:
        data = await fetch_current_air_quality(latitude=latitude, longitude=longitude)
        return data
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail={
                "code": "UPSTREAM_TIMEOUT",
                "message": "The air quality data provider (Open-Meteo) timed out.",
                "retryable": True,
            },
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "UPSTREAM_ERROR",
                "message": f"Upstream provider returned HTTP {exc.response.status_code}.",
                "retryable": exc.response.status_code >= 500,
            },
        )
    except ValueError as val_err:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "UPSTREAM_MALFORMED_RESPONSE",
                "message": str(val_err),
                "retryable": False,
            },
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred while processing air quality data.",
                "retryable": False,
            },
        )
