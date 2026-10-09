"""
Air Quality API Router.
Exposes endpoints for querying current air quality.
"""
from fastapi import APIRouter, HTTPException, Query
import httpx

from app.schemas import CurrentAirQualityResponse, AirQualityGridResponse, ErrorResponse
from app.services.open_meteo import fetch_current_air_quality, fetch_air_quality_grid

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


@router.get(
    "/grid",
    response_model=AirQualityGridResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid coordinates or query parameters"},
        502: {"model": ErrorResponse, "description": "Upstream Open-Meteo provider error"},
        504: {"model": ErrorResponse, "description": "Upstream timeout"},
    },
    summary="Get spatial grid air quality estimates for heatmap visualization",
)
async def get_air_quality_grid(
    latitude: float = Query(
        ...,
        ge=-90.0,
        le=90.0,
        description="Center latitude in degrees (-90.0 to 90.0)",
        examples=[13.0827],
    ),
    longitude: float = Query(
        ...,
        ge=-180.0,
        le=180.0,
        description="Center longitude in degrees (-180.0 to 180.0)",
        examples=[80.2707],
    ),
    radius_km: float = Query(
        default=25.0,
        ge=1.0,
        le=200.0,
        description="Bounding search radius in kilometers (1.0 to 200.0)",
        examples=[25.0],
    ),
    grid_size: int = Query(
        default=4,
        ge=2,
        le=6,
        description="Grid resolution along each axis (2 to 6, default 4 = 16 points)",
        examples=[4],
    ),
) -> AirQualityGridResponse:
    """
    Retrieves genuine atmospheric model estimates across a bounded spatial grid
    around the center coordinates for rendering an accurate geospatial heatmap.
    """
    try:
        data = await fetch_air_quality_grid(
            latitude=latitude,
            longitude=longitude,
            radius_km=radius_km,
            grid_size=grid_size,
        )
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
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INTERNAL_SERVER_ERROR",
                "message": f"An unexpected error occurred while sampling spatial grid: {exc}",
                "retryable": False,
            },
        )

