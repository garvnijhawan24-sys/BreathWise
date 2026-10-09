"""
BreatheWise configuration module.
Loads settings from environment variables using Pydantic Settings.
"""
from typing import List, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "BreatheWise"
    app_env: str = "development"
    log_level: str = "INFO"
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000

    # CORS origins: accepts comma-separated string or list of strings
    cors_origins: Union[str, List[str]] = "http://localhost:5173"

    # Open-Meteo Air Quality Base URL (Deferred to Phase 2 for live requests)
    open_meteo_air_quality_base_url: str = (
        "https://air-quality-api.open-meteo.com/v1/air-quality"
    )
    open_meteo_geocoding_base_url: str = (
        "https://geocoding-api.open-meteo.com/v1/search"
    )

    # OpenAQ Base URL (Deferred to Phase 2)
    openaq_base_url: str = "https://api.openaq.org/v3"
    openaq_api_key: str = ""

    # ML Inference settings
    ml_model_enabled: bool = False
    model_path: str = "backend/models/air_quality_model.joblib"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @field_validator("cors_origins", mode="after")
    @classmethod
    def parse_cors_origins(cls, value: Union[str, List[str]]) -> List[str]:
        if isinstance(value, str):
            origins = [origin.strip() for origin in value.split(",") if origin.strip()]
            return origins if origins else ["*"]
        return value


settings = Settings()
