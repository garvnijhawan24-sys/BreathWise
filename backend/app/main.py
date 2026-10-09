"""
BreatheWise FastAPI application entry point.
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.schemas import HealthResponse, ErrorResponse
from app.routers.air_quality import router as air_quality_router
from app.routers.stations import router as stations_router
from app.routers.forecast_ml import router as forecast_ml_router
from app.routers.reports import router as reports_router
from app.routers.geocoding import router as geocoding_router
from app.ml.predict import load_model_and_metadata

app = FastAPI(
    title=settings.app_name,
    description="Air Quality Intelligence & Forecasting Backend",
    version="0.5.0",
)

# Configure CORS middleware using standardized CORS_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(air_quality_router)
app.include_router(stations_router)
app.include_router(forecast_ml_router)
app.include_router(reports_router)
app.include_router(geocoding_router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Catch-all exception handler to avoid leaking tracebacks or secrets.
    """
    error = ErrorResponse(
        code="INTERNAL_SERVER_ERROR",
        message="An unexpected server error occurred.",
        retryable=False,
    )
    return JSONResponse(status_code=500, content=error.model_dump())


@app.get("/api/health", response_model=HealthResponse, tags=["Health"])
async def get_health() -> HealthResponse:
    """
    Health check endpoint reporting API health.
    Transparently reports Open-Meteo, OpenAQ, and ML model status.
    """
    model, _ = load_model_and_metadata()
    ml_status = "operational" if model is not None else "model_not_trained"

    return HealthResponse(
        status="healthy",
        service="breathewise-backend",
        environment=settings.app_env,
        version="0.5.0",
        features={
            "open_meteo": "operational",
            "openaq": "operational",
            "ml_predictions": ml_status,
            "database": "disabled",
            "reports": "operational",
        },
    )

