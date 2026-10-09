"""
BreatheWise API schemas for Phase 3.
"""
from typing import Literal, Optional, Dict, List, Any
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["healthy"] = Field(
        default="healthy", description="Overall application status"
    )
    service: str = Field(
        default="breathewise-backend", description="Service identifier"
    )
    environment: str = Field(
        default="development", description="Current operating environment"
    )
    version: str = Field(
        default="0.5.0", description="API version"
    )
    features: dict[str, str] = Field(
        default_factory=lambda: {
            "open_meteo": "operational",
            "openaq": "operational",
            "ml_predictions": "model_not_trained",
            "database": "disabled",
            "reports": "operational",
        },
        description="Current status of platform components",
    )


class ErrorResponse(BaseModel):
    code: str
    message: str
    retryable: bool = False


# ==========================================
# Open-Meteo Air Quality Models
# ==========================================

class AQIReading(BaseModel):
    value: Optional[float] = None
    scale: str
    category: str
    description: str


class PollutantValue(BaseModel):
    value: Optional[float] = None
    unit: str
    display_name: str


class CurrentAirQualityResponse(BaseModel):
    # Requested coordinates
    latitude: float
    longitude: float
    # Provider atmospheric model grid coordinates
    grid_latitude: Optional[float] = None
    grid_longitude: Optional[float] = None
    elevation: Optional[float] = None
    timezone: str
    observed_at: str
    retrieved_at: str
    source: str = "Open-Meteo Air Quality API"
    data_type: Literal["atmospheric_model_estimate"] = "atmospheric_model_estimate"
    attribution: str = "Data provided by Open-Meteo.com under CC BY 4.0"
    
    # Air Quality Indices
    european_aqi: AQIReading
    us_aqi: AQIReading
    
    # Specific Pollutants
    pollutants: Dict[str, PollutantValue]
    cached: bool = False


# ==========================================
# OpenAQ Ground Station Models (API v3)
# ==========================================

class StationCoordinates(BaseModel):
    latitude: float
    longitude: float


class StationSensorSummary(BaseModel):
    id: int
    name: str
    parameter: str
    units: str


class StationSummary(BaseModel):
    id: int
    name: str
    coordinates: StationCoordinates
    distance_meters: Optional[float] = None
    locality: Optional[str] = None
    country: Optional[str] = None
    timezone: Optional[str] = None
    sensors: List[StationSensorSummary] = Field(default_factory=list)


class NearbyStationsResponse(BaseModel):
    latitude: float
    longitude: float
    radius_meters: int
    source: str = "OpenAQ API v3"
    data_type: Literal["monitoring_station_locations"] = "monitoring_station_locations"
    attribution: str = "Data provided by OpenAQ (openaq.org) under CC BY 4.0"
    stations: List[StationSummary] = Field(default_factory=list)
    total_found: int = 0
    cached: bool = False


class GroundMeasurement(BaseModel):
    parameter: str
    value: Optional[float] = None
    unit: str
    observed_at: str
    sensor_id: int


class StationMeasurementsResponse(BaseModel):
    station_id: int
    station_name: str
    coordinates: Optional[StationCoordinates] = None
    source: str = "OpenAQ API v3"
    data_type: Literal["ground_station_observations"] = "ground_station_observations"
    attribution: str = "Data provided by OpenAQ (openaq.org) under CC BY 4.0"
    retrieved_at: str
    measurements: List[GroundMeasurement] = Field(default_factory=list)
    cached: bool = False


# ==========================================
# ML Local Forecasting Models
# ==========================================

class MLForecastPoint(BaseModel):
    timestamp: str
    predicted_pm2_5: float
    unit: str = "µg/m³"
    horizon_hour: int


class MLForecastResponse(BaseModel):
    pollutant: str = "pm2_5"
    unit: str = "µg/m³"
    horizon_hours: int = 24
    model: Optional[str] = "RandomForestRegressor"
    model_version: Optional[str] = "v1.0"
    mae: Optional[float] = None
    rmse: Optional[float] = None
    baseline_mae: Optional[float] = None
    baseline_rmse: Optional[float] = None
    status: Literal["operational", "model_not_trained", "insufficient_data"] = "model_not_trained"
    message: str
    predictions: List[MLForecastPoint] = Field(default_factory=list)
    metadata: Optional[Dict[str, Any]] = None


# ==========================================
# Environmental Report Models
# ==========================================

class ReportOpenMeteoSection(BaseModel):
    available: bool = True
    status: Literal["operational", "upstream_error", "timeout"] = "operational"
    observed_at: Optional[str] = None
    retrieved_at: Optional[str] = None
    grid_latitude: Optional[float] = None
    grid_longitude: Optional[float] = None
    elevation: Optional[float] = None
    european_aqi: Optional[AQIReading] = None
    us_aqi: Optional[AQIReading] = None
    pollutants: Dict[str, PollutantValue] = Field(default_factory=dict)
    attribution: str = "Data provided by Open-Meteo.com under CC BY 4.0"
    data_type: Literal["atmospheric_model_estimate"] = "atmospheric_model_estimate"
    error_message: Optional[str] = None


class ReportOpenAQStationSummary(BaseModel):
    station_id: int
    station_name: str
    distance_km: float
    coordinates: StationCoordinates
    measurements: List[GroundMeasurement] = Field(default_factory=list)


class ReportOpenAQSection(BaseModel):
    available: bool = False
    status: Literal["operational", "unauthenticated", "no_stations_found", "upstream_error", "timeout"] = "operational"
    message: str
    radius_meters: int = 25000
    stations_found: int = 0
    stations: List[ReportOpenAQStationSummary] = Field(default_factory=list)
    attribution: str = "Data provided by OpenAQ (openaq.org) under CC BY 4.0"
    data_type: Literal["ground_station_observations"] = "ground_station_observations"


class ReportMLSection(BaseModel):
    status: Literal["operational", "model_not_trained", "insufficient_data"] = "model_not_trained"
    message: str
    disclaimer: str = (
        "Notice: Local short-term ML forecasting model is uncalibrated. "
        "Predictions are withheld until a verified, leakage-free historical training dataset is established."
    )


class EnvironmentalReport(BaseModel):
    report_id: str
    generated_at: str  # ISO 8601 UTC string
    target_latitude: float
    target_longitude: float
    open_meteo: ReportOpenMeteoSection
    openaq: ReportOpenAQSection
    ml_forecast: ReportMLSection
    disclaimers: List[str] = Field(
        default_factory=lambda: [
            "Atmospheric model estimates are continuous numerical simulations and may diverge from local microclimates.",
            "Ground observations reflect physical sensor instruments and are subject to sensor calibration, placement, and reporting latency.",
            "This report is generated for informational and research purposes only and must not be used for regulatory compliance certification or medical decisions.",
        ]
    )


