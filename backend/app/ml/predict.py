"""
BreatheWise Model Inference and Forecasting Service.
Loads trusted model artifacts and companion metadata securely via joblib,
enforces the feature flag (ML_MODEL_ENABLED) and model validation policy (baseline superiority),
executes recursive multi-step forecasting given genuine recent observations,
and returns transparent status ('model_not_trained', 'operational', or 'insufficient_data').
"""
from datetime import datetime, timedelta, timezone
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import joblib
import numpy as np
import pandas as pd

from app.config import settings
from app.ml.preprocessing import FEATURE_COLUMNS, TARGET_COLUMN

logger = logging.getLogger(__name__)


def validate_model_metadata(metadata: Dict[str, Any]) -> Tuple[bool, str]:
    """
    Validates model artifact and metadata consistency:
    - Feature list and order must match FEATURE_COLUMNS exactly.
    - Pollutant must match target 'pm2_5'.
    - Evaluation metrics must demonstrate that the model beats the persistence baseline.
    """
    if metadata.get("features") != FEATURE_COLUMNS:
        return False, "Model feature list or ordering does not match current system schema."

    if metadata.get("pollutant") != TARGET_COLUMN:
        return False, f"Model target pollutant '{metadata.get('pollutant')}' is not '{TARGET_COLUMN}'."

    metrics = metadata.get("metrics", {})
    if not metrics.get("beats_baseline", False):
        return False, "Model did not outperform the persistence baseline on held-out evaluation."

    return True, "Valid"


def load_model_and_metadata(
    model_path_str: Optional[str] = None,
    meta_path_str: Optional[str] = None,
    enforce_feature_flag: bool = True,
) -> Tuple[Optional[Any], Optional[Dict[str, Any]]]:
    """
    Safely loads the trained model artifact and its metadata.
    Enforces settings.ml_model_enabled unless explicitly overridden (e.g. for testing).
    Returns (None, None) if the artifact does not exist, loading fails, or validation fails.
    """
    # Enforce configuration feature flag
    if enforce_feature_flag and not settings.ml_model_enabled and model_path_str is None:
        return None, None

    model_p = Path(model_path_str or settings.model_path)
    if not model_p.is_file():
        # Fallback if running from within backend/ or workspace root
        candidates = [
            Path("models") / model_p.name,
            Path("backend/models") / model_p.name,
            Path(__file__).resolve().parent.parent.parent / "models" / model_p.name,
            Path(__file__).resolve().parent.parent / "models" / model_p.name,
        ]
        for cand in candidates:
            if cand.is_file():
                model_p = cand
                break

    meta_p = (
        Path(meta_path_str)
        if meta_path_str
        else model_p.parent / "air_quality_model_meta.json"
    )

    if not model_p.is_file() or not meta_p.is_file():
        return None, None

    try:
        model = joblib.load(model_p)
        with open(meta_p, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        is_valid, reason = validate_model_metadata(metadata)
        if not is_valid:
            logger.warning(f"Model validation failed: {reason}")
            return None, None

        return model, metadata
    except Exception as exc:
        logger.warning(f"Failed to load model artifact safely: {exc}")
        return None, None


def get_ml_forecast(
    station_id: Optional[int] = None,
    horizon_hours: int = 24,
    recent_series: Optional[pd.DataFrame] = None,
    model_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Generates an ML forecast response:
    - If feature flag is disabled or model artifact is not trained, returns 'model_not_trained'.
    - If model is valid but recent observation series is missing/insufficient (<24h), returns 'insufficient_data'.
    - If model is valid and recent observations are present, executes autoregressive rollout up to horizon_hours.
    """
    # Enforce horizon bounds
    horizon_hours = max(1, min(72, horizon_hours))

    # Check configuration flag first
    if not settings.ml_model_enabled and model_path is None:
        return {
            "pollutant": "pm2_5",
            "unit": "µg/m³",
            "horizon_hours": horizon_hours,
            "model": "RandomForestRegressor",
            "model_version": "v1.0",
            "mae": None,
            "rmse": None,
            "baseline_mae": None,
            "baseline_rmse": None,
            "status": "model_not_trained",
            "message": (
                "Local ML forecasting is currently disabled in backend configuration (ML_MODEL_ENABLED=False). "
                "Open-Meteo atmospheric numerical forecasts remain the active forecast source."
            ),
            "predictions": [],
            "metadata": None,
        }

    model, metadata = load_model_and_metadata(
        model_path_str=model_path,
        enforce_feature_flag=(model_path is None),
    )

    if model is None or metadata is None:
        return {
            "pollutant": "pm2_5",
            "unit": "µg/m³",
            "horizon_hours": horizon_hours,
            "model": "RandomForestRegressor",
            "model_version": "v1.0",
            "mae": None,
            "rmse": None,
            "baseline_mae": None,
            "baseline_rmse": None,
            "status": "model_not_trained",
            "message": (
                "Local ML Random Forest model has not yet been trained on validated historical ground observations "
                "for this station. Open-Meteo atmospheric numerical forecasts remain the primary forecast source."
            ),
            "predictions": [],
            "metadata": None,
        }

    metrics = metadata.get("metrics", {})
    model_mae = metrics.get("mae")
    model_rmse = metrics.get("rmse")
    baseline_mae = metrics.get("baseline_mae")
    baseline_rmse = metrics.get("baseline_rmse")

    # If recent observations are missing or insufficient (< 24 continuous hours)
    if recent_series is None or recent_series.empty:
        return {
            "pollutant": "pm2_5",
            "unit": "µg/m³",
            "horizon_hours": horizon_hours,
            "model": metadata.get("model_name", "RandomForestRegressor"),
            "model_version": metadata.get("model_version", "v1.0"),
            "mae": model_mae,
            "rmse": model_rmse,
            "baseline_mae": baseline_mae,
            "baseline_rmse": baseline_rmse,
            "status": "insufficient_data",
            "message": (
                f"Trained model is available, but no recent ground observations were provided "
                f"for station #{station_id or 'unknown'}. At least 24 hours of real readings are required "
                f"for autoregressive rollout."
            ),
            "predictions": [],
            "metadata": metadata,
        }

    # Clean and check recent observations length
    hist = recent_series.sort_values("timestamp").copy()
    hist["timestamp"] = pd.to_datetime(hist["timestamp"], utc=True)
    hist["pm2_5"] = pd.to_numeric(hist["pm2_5"], errors="coerce")
    hist = hist.dropna(subset=["timestamp", "pm2_5"])
    hist = hist.set_index("timestamp").resample("1h")["pm2_5"].mean().ffill(limit=2).dropna().reset_index()

    if len(hist) < 24:
        return {
            "pollutant": "pm2_5",
            "unit": "µg/m³",
            "horizon_hours": horizon_hours,
            "model": metadata.get("model_name", "RandomForestRegressor"),
            "model_version": metadata.get("model_version", "v1.0"),
            "mae": model_mae,
            "rmse": model_rmse,
            "baseline_mae": baseline_mae,
            "baseline_rmse": baseline_rmse,
            "status": "insufficient_data",
            "message": (
                f"Trained model is available, but recent observation series has only {len(hist)} valid continuous hours "
                f"(minimum 24 hours required) for station #{station_id or 'unknown'}."
            ),
            "predictions": [],
            "metadata": metadata,
        }

    # Execute recursive multi-step rollout
    origin_time = hist["timestamp"].max()
    current_vals = hist["pm2_5"].tolist()
    predictions: List[Dict[str, Any]] = []

    for step in range(1, horizon_hours + 1):
        target_time = origin_time + timedelta(hours=step)
        hr = target_time.hour
        dow = target_time.weekday()

        lag_1 = current_vals[-1]
        lag_3 = current_vals[-3] if len(current_vals) >= 3 else current_vals[-1]
        lag_6 = current_vals[-6] if len(current_vals) >= 6 else current_vals[-1]
        lag_24 = current_vals[-24] if len(current_vals) >= 24 else current_vals[-1]

        r6 = float(np.mean(current_vals[-6:]))
        r24 = float(np.mean(current_vals[-24:]))

        feat_dict = {
            "hour": hr,
            "day_of_week": dow,
            "lag_1": lag_1,
            "lag_3": lag_3,
            "lag_6": lag_6,
            "lag_24": lag_24,
            "rolling_mean_6": r6,
            "rolling_mean_24": r24,
        }
        feat_row = pd.DataFrame([feat_dict])[FEATURE_COLUMNS]

        pred_val = float(model.predict(feat_row)[0])
        pred_val = max(0.0, round(pred_val, 2))  # Physically bounded concentration

        predictions.append({
            "timestamp": target_time.isoformat(),
            "predicted_pm2_5": pred_val,
            "unit": "µg/m³",
            "horizon_hour": step,
        })
        current_vals.append(pred_val)

    return {
        "pollutant": "pm2_5",
        "unit": "µg/m³",
        "horizon_hours": horizon_hours,
        "model": metadata.get("model_name", "RandomForestRegressor"),
        "model_version": metadata.get("model_version", "v1.0"),
        "mae": model_mae,
        "rmse": model_rmse,
        "baseline_mae": baseline_mae,
        "baseline_rmse": baseline_rmse,
        "status": "operational",
        "message": (
            f"Operational Random Forest forecast evaluated against chronological persistence baseline. "
            f"Model 1-step MAE: {model_mae} µg/m³ vs Baseline MAE: {baseline_mae} µg/m³."
        ),
        "predictions": predictions,
        "metadata": metadata,
    }
