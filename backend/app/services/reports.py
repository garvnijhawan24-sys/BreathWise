"""
Environmental Report generation service.
Aggregates Open-Meteo atmospheric model estimates, OpenAQ physical ground station observations,
and local ML forecast status into a unified, source-separated report with CSV export.
"""
import csv
from datetime import datetime, timezone
import io
import logging
from typing import Optional
import uuid

import httpx

from app.config import settings
from app.ml.predict import load_model_and_metadata
from app.schemas import (
    EnvironmentalReport,
    ReportOpenMeteoSection,
    ReportOpenAQSection,
    ReportOpenAQStationSummary,
    ReportMLSection,
)
from app.services.open_meteo import fetch_current_air_quality
from app.services.openaq import (
    discover_nearby_stations,
    fetch_station_measurements,
)

logger = logging.getLogger(__name__)


async def generate_environmental_report(
    latitude: float,
    longitude: float,
    radius_meters: int = 25000,
    client: Optional[httpx.AsyncClient] = None,
) -> EnvironmentalReport:
    """
    Assembles a comprehensive environmental report for the specified coordinates.
    Maintains strict source separation:
      - Open-Meteo continuous atmospheric model estimates
      - OpenAQ physical ground monitoring stations and observations
      - Local ML status and disclaimers
    Gracefully handles partial provider availability without failing the entire report.
    """
    report_id = f"BW-REP-{uuid.uuid4().hex[:8].upper()}"
    generated_at = datetime.now(timezone.utc).isoformat()

    # -------------------------------------------------------------
    # 1. Fetch Open-Meteo Atmospheric Model Estimates
    # -------------------------------------------------------------
    open_meteo_section: ReportOpenMeteoSection
    try:
        om_data = await fetch_current_air_quality(
            latitude=latitude,
            longitude=longitude,
            client=client,
            use_cache=True,
        )
        open_meteo_section = ReportOpenMeteoSection(
            available=True,
            status="operational",
            observed_at=om_data.observed_at,
            retrieved_at=om_data.retrieved_at,
            grid_latitude=om_data.grid_latitude,
            grid_longitude=om_data.grid_longitude,
            elevation=om_data.elevation,
            european_aqi=om_data.european_aqi,
            us_aqi=om_data.us_aqi,
            pollutants=om_data.pollutants,
            attribution=om_data.attribution,
            data_type="atmospheric_model_estimate",
        )
    except httpx.TimeoutException:
        open_meteo_section = ReportOpenMeteoSection(
            available=False,
            status="timeout",
            error_message="Upstream Open-Meteo provider timed out.",
        )
    except httpx.HTTPStatusError as exc:
        open_meteo_section = ReportOpenMeteoSection(
            available=False,
            status="upstream_error",
            error_message=f"Open-Meteo returned HTTP error: {exc.response.status_code}",
        )
    except Exception as exc:
        logger.warning(f"Failed to fetch Open-Meteo for report: {exc}")
        open_meteo_section = ReportOpenMeteoSection(
            available=False,
            status="upstream_error",
            error_message="Atmospheric model data temporarily unavailable.",
        )

    # -------------------------------------------------------------
    # 2. Fetch OpenAQ Physical Ground Observations
    # -------------------------------------------------------------
    openaq_section: ReportOpenAQSection
    if not settings.openaq_api_key or not settings.openaq_api_key.strip():
        openaq_section = ReportOpenAQSection(
            available=False,
            status="unauthenticated",
            message="Ground station monitoring is unavailable: OpenAQ API key is not configured in backend environment.",
            radius_meters=radius_meters,
            stations_found=0,
            stations=[],
        )
    else:
        try:
            stations_resp = await discover_nearby_stations(
                latitude=latitude,
                longitude=longitude,
                radius_meters=radius_meters,
                limit=5,
                client=client,
                use_cache=True,
            )
            stations_found = len(stations_resp.stations)

            if stations_found == 0:
                openaq_section = ReportOpenAQSection(
                    available=True,
                    status="no_stations_found",
                    message=f"No active ground monitoring stations found within {radius_meters // 1000} km radius.",
                    radius_meters=radius_meters,
                    stations_found=0,
                    stations=[],
                )
            else:
                station_summaries: list[ReportOpenAQStationSummary] = []
                # Retrieve measurements for up to the top 2 closest stations
                for st in stations_resp.stations[:2]:
                    dist_km = (
                        round(st.distance_meters / 1000.0, 2)
                        if st.distance_meters is not None
                        else 0.0
                    )
                    meas_list = []
                    try:
                        meas_resp = await fetch_station_measurements(
                            station_id=st.id,
                            limit=10,
                            client=client,
                            use_cache=True,
                        )
                        meas_list = meas_resp.measurements
                    except Exception as meas_exc:
                        logger.debug(
                            f"Could not fetch measurements for station {st.id} in report: {meas_exc}"
                        )

                    station_summaries.append(
                        ReportOpenAQStationSummary(
                            station_id=st.id,
                            station_name=st.name,
                            distance_km=dist_km,
                            coordinates=st.coordinates,
                            measurements=meas_list,
                        )
                    )

                openaq_section = ReportOpenAQSection(
                    available=True,
                    status="operational",
                    message=f"Found {stations_found} monitoring station(s) within {radius_meters // 1000} km radius.",
                    radius_meters=radius_meters,
                    stations_found=stations_found,
                    stations=station_summaries,
                )

        except PermissionError:
            openaq_section = ReportOpenAQSection(
                available=False,
                status="unauthenticated",
                message="Ground station monitoring is unavailable: OpenAQ API key is not configured.",
                radius_meters=radius_meters,
            )
        except httpx.TimeoutException:
            openaq_section = ReportOpenAQSection(
                available=False,
                status="timeout",
                message="OpenAQ upstream service timed out.",
                radius_meters=radius_meters,
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (401, 403):
                openaq_section = ReportOpenAQSection(
                    available=False,
                    status="unauthenticated",
                    message=f"OpenAQ authentication rejected (HTTP {exc.response.status_code}). Verify OPENAQ_API_KEY.",
                    radius_meters=radius_meters,
                )
            else:
                openaq_section = ReportOpenAQSection(
                    available=False,
                    status="upstream_error",
                    message=f"OpenAQ upstream service returned HTTP {exc.response.status_code}.",
                    radius_meters=radius_meters,
                )
        except Exception as exc:
            logger.warning(f"OpenAQ error in report: {exc}")
            openaq_section = ReportOpenAQSection(
                available=False,
                status="upstream_error",
                message="OpenAQ ground station data currently unreachable.",
                radius_meters=radius_meters,
            )

    # -------------------------------------------------------------
    # 3. Local Machine Learning Forecasting Status
    # -------------------------------------------------------------
    model, _ = load_model_and_metadata()
    if not settings.ml_model_enabled:
        ml_section = ReportMLSection(
            status="model_not_trained",
            message="Machine learning forecasting is disabled by feature flag (ML_MODEL_ENABLED=False).",
            disclaimer=(
                "Notice: Local short-term ML forecasting model is uncalibrated. "
                "Predictions are withheld until a verified, leakage-free historical training dataset is established."
            ),
        )
    elif model is None:
        ml_section = ReportMLSection(
            status="model_not_trained",
            message="No validated machine learning forecasting model artifact found.",
            disclaimer=(
                "Notice: Local short-term ML forecasting model is uncalibrated. "
                "Predictions are withheld until a verified, leakage-free historical training dataset is established."
            ),
        )
    else:
        ml_section = ReportMLSection(
            status="operational",
            message="Validated local ML model available.",
            disclaimer="Predictions are subject to local historical training conditions and model uncertainty bounds.",
        )

    return EnvironmentalReport(
        report_id=report_id,
        generated_at=generated_at,
        target_latitude=latitude,
        target_longitude=longitude,
        open_meteo=open_meteo_section,
        openaq=openaq_section,
        ml_forecast=ml_section,
    )


def generate_report_csv(report: EnvironmentalReport) -> str:
    """
    Renders an EnvironmentalReport into a structured, RFC 4180-compliant CSV string.
    Includes metadata headers, separate tables for atmospheric model estimates and
    ground observations, units, timestamps, attributions, and disclaimers.
    """
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\r\n")

    # Header Metadata
    writer.writerow(["# BREATHEWISE ENVIRONMENTAL INTELLIGENCE REPORT"])
    writer.writerow(["# Report ID", report.report_id])
    writer.writerow(["# Generated At (UTC)", report.generated_at])
    writer.writerow(["# Target Latitude", f"{report.target_latitude:.4f}"])
    writer.writerow(["# Target Longitude", f"{report.target_longitude:.4f}"])
    writer.writerow([])

    # SECTION 1: Open-Meteo Atmospheric Model Estimates
    writer.writerow(["# SECTION 1: ATMOSPHERIC MODEL ESTIMATES (OPEN-METEO)"])
    writer.writerow(["# Provider", "Open-Meteo Air Quality API"])
    writer.writerow(["# Data Type", "Continuous atmospheric model estimate / numerical simulation"])
    writer.writerow(["# Attribution", report.open_meteo.attribution])
    if report.open_meteo.grid_latitude is not None and report.open_meteo.grid_longitude is not None:
        writer.writerow([
            "# Model Grid Location",
            f"Lat {report.open_meteo.grid_latitude:.4f}, Lon {report.open_meteo.grid_longitude:.4f}",
            f"Elevation: {report.open_meteo.elevation}m" if report.open_meteo.elevation is not None else ""
        ])
    if report.open_meteo.observed_at:
        writer.writerow(["# Model Observation Time", report.open_meteo.observed_at])
    writer.writerow([])

    if report.open_meteo.available:
        writer.writerow(["Metric / Pollutant", "Value", "Unit", "Category / Scale", "Description", "Data Source"])
        if report.open_meteo.european_aqi:
            eaqi = report.open_meteo.european_aqi
            writer.writerow([
                "European AQI",
                eaqi.value if eaqi.value is not None else "N/A",
                "AQI Index",
                eaqi.category,
                eaqi.description,
                "Open-Meteo Model",
            ])
        if report.open_meteo.us_aqi:
            usaqi = report.open_meteo.us_aqi
            writer.writerow([
                "United States AQI",
                usaqi.value if usaqi.value is not None else "N/A",
                "AQI Index",
                usaqi.category,
                usaqi.description,
                "Open-Meteo Model",
            ])
        for param, pval in sorted(report.open_meteo.pollutants.items()):
            writer.writerow([
                pval.display_name,
                pval.value if pval.value is not None else "N/A",
                pval.unit,
                "",
                f"Concentration for {param}",
                "Open-Meteo Model",
            ])
    else:
        writer.writerow(["Status", "Atmospheric model estimates unavailable", report.open_meteo.error_message or ""])
    writer.writerow([])

    # SECTION 2: OpenAQ Ground Station Observations
    writer.writerow(["# SECTION 2: PHYSICAL GROUND-STATION OBSERVATIONS (OPENAQ)"])
    writer.writerow(["# Provider", "OpenAQ API v3"])
    writer.writerow(["# Data Type", "Physical ground monitoring station observations"])
    writer.writerow(["# Attribution", report.openaq.attribution])
    writer.writerow(["# Search Radius", f"{report.openaq.radius_meters} meters"])
    writer.writerow(["# Stations Found", report.openaq.stations_found])
    writer.writerow(["# Status Message", report.openaq.message])
    writer.writerow([])

    if report.openaq.available and report.openaq.stations:
        writer.writerow([
            "Station ID",
            "Station Name",
            "Distance (km)",
            "Sensor ID",
            "Parameter",
            "Value",
            "Unit",
            "Observed At (UTC)",
            "Data Source",
        ])
        for st in report.openaq.stations:
            if st.measurements:
                for m in st.measurements:
                    writer.writerow([
                        st.station_id,
                        st.station_name,
                        st.distance_km,
                        m.sensor_id,
                        m.parameter,
                        m.value if m.value is not None else "N/A",
                        m.unit,
                        m.observed_at,
                        "OpenAQ Ground Station",
                    ])
            else:
                writer.writerow([
                    st.station_id,
                    st.station_name,
                    st.distance_km,
                    "N/A",
                    "No recent sensor readings",
                    "N/A",
                    "N/A",
                    "N/A",
                    "OpenAQ Ground Station",
                ])
    else:
        writer.writerow(["Status", report.openaq.status, report.openaq.message])
    writer.writerow([])

    # SECTION 3: ML Status & Disclaimers
    writer.writerow(["# SECTION 3: LOCAL MACHINE LEARNING FORECASTING STATUS"])
    writer.writerow(["# Model Status", report.ml_forecast.status])
    writer.writerow(["# Message", report.ml_forecast.message])
    writer.writerow(["# ML Notice", report.ml_forecast.disclaimer])
    writer.writerow([])

    # SECTION 4: Disclaimers
    writer.writerow(["# SECTION 4: METHODOLOGY & SCIENTIFIC DISCLAIMERS"])
    for i, d in enumerate(report.disclaimers, start=1):
        writer.writerow([f"# {i}.", d])

    return output.getvalue()
