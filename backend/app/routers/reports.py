"""
FastAPI router for Environmental Reports and CSV export.
Exposes GET /api/reports and GET /api/reports/export with coordinate validation.
"""
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Response

from app.schemas import EnvironmentalReport, ErrorResponse
from app.services.reports import generate_environmental_report, generate_report_csv

router = APIRouter(prefix="/api/reports", tags=["Environmental Reports"])


@router.get(
    "",
    response_model=EnvironmentalReport,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid query parameters"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
    summary="Generate comprehensive environmental report for location",
)
async def get_environmental_report(
    latitude: float = Query(
        ...,
        ge=-90.0,
        le=90.0,
        description="Target latitude in degrees (-90.0 to 90.0)",
        examples=[13.0827],
    ),
    longitude: float = Query(
        ...,
        ge=-180.0,
        le=180.0,
        description="Target longitude in degrees (-180.0 to 180.0)",
        examples=[80.2707],
    ),
    radius_meters: int = Query(
        default=25000,
        ge=1000,
        le=100000,
        description="Search radius for nearby ground stations in meters (1,000 to 100,000)",
        examples=[25000],
    ),
) -> EnvironmentalReport:
    """
    Generates a unified environmental report aggregating Open-Meteo atmospheric model estimates,
    OpenAQ ground-station observations, and local ML forecasting status.
    Maintains strict source separation and graceful fallback when OpenAQ credentials are absent.
    """
    report = await generate_environmental_report(
        latitude=latitude,
        longitude=longitude,
        radius_meters=radius_meters,
    )
    return report


@router.get(
    "/export",
    responses={
        200: {
            "content": {"text/csv": {}},
            "description": "Structured RFC 4180 CSV export of environmental report",
        },
        400: {"model": ErrorResponse, "description": "Invalid query parameters"},
    },
    summary="Export environmental report in RFC 4180 CSV format",
)
async def export_environmental_report(
    latitude: float = Query(
        ...,
        ge=-90.0,
        le=90.0,
        description="Target latitude in degrees (-90.0 to 90.0)",
        examples=[13.0827],
    ),
    longitude: float = Query(
        ...,
        ge=-180.0,
        le=180.0,
        description="Target longitude in degrees (-180.0 to 180.0)",
        examples=[80.2707],
    ),
    radius_meters: int = Query(
        default=25000,
        ge=1000,
        le=100000,
        description="Search radius in meters (1,000 to 100,000)",
    ),
    format: str = Query(
        default="csv",
        description="Export file format ('csv')",
    ),
) -> Response:
    """
    Renders the environmental report into a downloadable, RFC 4180 CSV file preserving
    source attribution, timestamps, measurement units, and scientific disclaimers.
    """
    if format.lower() != "csv":
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_FORMAT",
                "message": f"Unsupported export format '{format}'. Only 'csv' is currently supported.",
                "retryable": False,
            },
        )

    report = await generate_environmental_report(
        latitude=latitude,
        longitude=longitude,
        radius_meters=radius_meters,
    )
    csv_content = generate_report_csv(report)
    filename = f"breathewise_report_{latitude:.4f}_{longitude:.4f}.csv"

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )
