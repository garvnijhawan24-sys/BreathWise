"""
BreatheWise Model Training and Artifact Serialization Module.
Trains a Scikit-Learn RandomForestRegressor on regularized hourly air-quality data,
evaluates on a held-out chronological test interval against the persistence baseline
for both one-step-ahead and multi-step rollout horizons, and serializes trusted
model artifacts and companion metadata using joblib.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, Optional
import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import sklearn

from app.ml.preprocessing import (
    FEATURE_COLUMNS,
    TARGET_COLUMN,
    DatasetQualitySummary,
    prepare_training_dataset,
)
from app.ml.evaluate import (
    chronological_train_test_split,
    compute_persistence_baseline,
    evaluate_predictions,
    compare_model_with_baseline,
    evaluate_rolling_multistep_rollout,
)


def train_and_evaluate_model(
    df: pd.DataFrame,
    output_dir: Path | str = "backend/models",
    station_id: Optional[str | int] = None,
    provider: str = "OpenAQ Ground Station",
    train_ratio: float = 0.8,
    min_required_samples: int = 48,
    n_estimators: int = 100,
    max_depth: int = 12,
    random_state: int = 42,
) -> Dict[str, Any]:
    """
    Executes the complete training pipeline:
    1. Prepares dataset (cleans, regularizes hourly with past-only fill, engineers past-only features).
    2. Chronologically splits data (e.g. 80% train, 20% test).
    3. Computes the mandatory persistence baseline on the test interval.
    4. Trains the RandomForestRegressor on the train interval.
    5. Evaluates model predictions on the held-out test interval (1-step and 24h rollout).
    6. Saves trusted model artifact and detailed metadata.
    """
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # Step 1: Preprocess and engineer features using past-only fill
    featured_df, quality_summary = prepare_training_dataset(
        df, min_required_samples=min_required_samples
    )

    # Step 2: Strict chronological train/test split
    train_df, test_df = chronological_train_test_split(featured_df, train_ratio=train_ratio)

    # Step 3: Compute mandatory 1-step persistence baseline
    baseline_one_step = compute_persistence_baseline(test_df, lag_col="lag_1")

    # Step 4: Fit Random Forest Regressor
    X_train = train_df[FEATURE_COLUMNS]
    y_train = train_df[TARGET_COLUMN]
    X_test = test_df[FEATURE_COLUMNS]
    y_test = test_df[TARGET_COLUMN]

    model = RandomForestRegressor(
        n_estimators=n_estimators,
        max_depth=max_depth,
        random_state=random_state,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    # Step 5: Evaluate model on held-out future interval
    # 5a: Single-step evaluation
    test_preds = model.predict(X_test)
    model_one_step = evaluate_predictions(y_test, test_preds)
    comparison_one_step = compare_model_with_baseline(model_one_step, baseline_one_step)

    # 5b: Rolling-origin multi-step rollout evaluation (24h horizon)
    rollout_metrics = evaluate_rolling_multistep_rollout(
        model, test_df, horizon_hours=24, stride_hours=6
    )

    # Build comprehensive metadata document
    train_start = pd.to_datetime(train_df["timestamp"]).min().isoformat()
    train_end = pd.to_datetime(train_df["timestamp"]).max().isoformat()
    test_start = pd.to_datetime(test_df["timestamp"]).min().isoformat()
    test_end = pd.to_datetime(test_df["timestamp"]).max().isoformat()

    metadata: Dict[str, Any] = {
        "model_name": "RandomForestRegressor",
        "model_version": "v1.0",
        "pollutant": "pm2_5",
        "unit": "µg/m³",
        "station_id": str(station_id) if station_id is not None else "aggregate",
        "data_provider": provider,
        "features": FEATURE_COLUMNS,
        "parameters": {
            "n_estimators": n_estimators,
            "max_depth": max_depth,
            "random_state": random_state,
        },
        "quality_summary": {
            "total_expected_hours": quality_summary.total_expected_hours,
            "observed_hours": quality_summary.observed_hours,
            "missing_hours": quality_summary.missing_hours,
            "missing_percentage": quality_summary.missing_percentage,
            "timeline_start": quality_summary.timeline_start,
            "timeline_end": quality_summary.timeline_end,
        },
        "train_interval": {"start": train_start, "end": train_end, "samples": len(train_df)},
        "test_interval": {"start": test_start, "end": test_end, "samples": len(test_df)},
        "metrics": {
            # Single-step metrics (1-hour ahead)
            "mae": model_one_step["mae"],
            "rmse": model_one_step["rmse"],
            "baseline_mae": baseline_one_step["mae"],
            "baseline_rmse": baseline_one_step["rmse"],
            "beats_baseline": comparison_one_step["beats_baseline"],
            "mae_improvement": comparison_one_step["mae_improvement"],
            "mae_improvement_percent": comparison_one_step["mae_improvement_percent"],
            # Multi-step metrics (24-hour autoregressive rollout)
            "rollout_24h": rollout_metrics,
        },
        "scikit_learn_version": sklearn.__version__,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "status": "operational" if comparison_one_step["beats_baseline"] else "sub_baseline",
    }

    # Step 6: Save artifacts securely
    artifact_model_file = out_path / "air_quality_model.joblib"
    artifact_meta_file = out_path / "air_quality_model_meta.json"

    joblib.dump(model, artifact_model_file)
    with open(artifact_meta_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    return {
        "model_path": str(artifact_model_file),
        "metadata_path": str(artifact_meta_file),
        "metadata": metadata,
    }
