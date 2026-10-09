"""
Automated Test Suite for Phase 4 Machine Learning Pipeline.
Tests data validation, past-only gap policy, zero-leakage regression guards,
chronological splitting, persistence baseline, multi-step rollout evaluation,
model training & artifact serialization, feature-flag enforcement,
and the FastAPI ML forecast endpoint contracts.
"""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
from unittest.mock import patch
import httpx
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.schemas import StationMeasurementsResponse, GroundMeasurement
from app.ml.preprocessing import (
    FEATURE_COLUMNS,
    TARGET_COLUMN,
    clean_raw_observations,
    regularize_hourly_timeline,
    create_past_only_features,
    prepare_training_dataset,
)
from app.ml.evaluate import (
    chronological_train_test_split,
    compute_persistence_baseline,
    evaluate_predictions,
    compare_model_with_baseline,
    evaluate_rolling_multistep_rollout,
)
from app.ml.train import train_and_evaluate_model
from app.ml.predict import (
    load_model_and_metadata,
    get_ml_forecast,
    validate_model_metadata,
)
from app.services.openaq_history import (
    fetch_sensor_historical_measurements,
    load_historical_observations_from_csv,
)

client = TestClient(app)


def _generate_synthetic_hourly_data(hours: int = 720, base_val: float = 35.0) -> pd.DataFrame:
    """Helper fixture: Generates synthetic hourly dataset with diurnal cycle."""
    start = datetime(2026, 8, 1, 0, 0, tzinfo=timezone.utc)
    records = []
    for h in range(hours):
        ts = start + timedelta(hours=h)
        # Diurnal pattern (sine wave peaking in morning/evening) + small trend
        diurnal = 15.0 * np.sin(2 * np.pi * ts.hour / 24.0)
        noise = (h % 5) - 2.0
        val = max(5.0, base_val + diurnal + noise)
        records.append({
            "timestamp": ts.isoformat(),
            "pm2_5": val,
            "unit": "µg/m³",
            "sensor_id": 101,
        })
    return pd.DataFrame(records)


def test_clean_raw_observations():
    """Verify negative PM2.5 values are dropped, duplicates averaged, and timestamps normalized."""
    df = pd.DataFrame([
        {"timestamp": "2026-09-01T00:00:00Z", "pm2_5": 25.0},
        {"timestamp": "2026-09-01T00:00:00Z", "pm2_5": 35.0},  # Duplicate at 00:00 (avg = 30.0)
        {"timestamp": "2026-09-01T01:00:00Z", "pm2_5": -10.0}, # Negative impossible reading (drop)
        {"timestamp": "2026-09-01T02:00:00Z", "pm2_5": 0.0},   # Zero reading (valid, keep)
        {"timestamp": "2026-09-01T03:00:00Z", "pm2_5": 40.0},
    ])
    cleaned = clean_raw_observations(df)
    assert len(cleaned) == 3  # 00:00, 02:00, 03:00
    assert cleaned.iloc[0]["pm2_5"] == 30.0  # Averaged
    assert cleaned.iloc[1]["pm2_5"] == 0.0   # Zero preserved


def test_regularize_hourly_timeline_and_missingness():
    """Verify gap detection, missingness percentages, and past-only forward-fill policy."""
    # 5 hour interval with a 1 hour gap at 02:00
    df = pd.DataFrame([
        {"timestamp": "2026-09-01T00:00:00Z", "pm2_5": 20.0},
        {"timestamp": "2026-09-01T01:00:00Z", "pm2_5": 22.0},
        # Missing 02:00:00
        {"timestamp": "2026-09-01T03:00:00Z", "pm2_5": 26.0},
        {"timestamp": "2026-09-01T04:00:00Z", "pm2_5": 28.0},
    ])
    cleaned = clean_raw_observations(df)
    regularized, stats = regularize_hourly_timeline(cleaned, max_forward_fill_hours=1)

    assert stats["total_expected_hours"] == 5
    assert stats["observed_hours"] == 4
    assert stats["missing_hours"] == 1
    assert stats["missing_percentage"] == 20.0
    # 02:00 gap <= 1 hour so forward-fill value from 01:00 (22.0) should exist in pm2_5_past_filled
    row_02 = regularized[regularized["timestamp"] == pd.Timestamp("2026-09-01 02:00:00+0000")].iloc[0]
    assert pd.isna(row_02["pm2_5"])  # Target remains NaN (un-fabricated!)
    assert row_02["pm2_5_past_filled"] == 22.0  # Feature lag base is forward-filled from past (22.0)


def test_past_only_gap_fill_does_not_leak_future_values():
    """
    CRITICAL REGRESSION TEST:
    Proves that modifying future observations cannot change features at earlier timestamps.
    """
    start = datetime(2026, 9, 1, 0, 0, tzinfo=timezone.utc)
    base_records = [{"timestamp": (start + timedelta(hours=i)).isoformat(), "pm2_5": 30.0} for i in range(60)]
    # Create missing gap at index 10
    base_records[10]["pm2_5"] = None

    df_a = pd.DataFrame(base_records).dropna(subset=["pm2_5"])
    ready_a, _ = prepare_training_dataset(df_a, min_required_samples=10)

    # Now create dataset B where future observations at hours 45-59 are drastically changed
    modified_records = [dict(r) for r in base_records]
    for i in range(45, 60):
        if modified_records[i]["pm2_5"] is not None:
            modified_records[i]["pm2_5"] = 9999.0

    df_b = pd.DataFrame(modified_records).dropna(subset=["pm2_5"])
    ready_b, _ = prepare_training_dataset(df_b, min_required_samples=10)

    # Check rows up to hour 35 in both datasets: they MUST be 100% identical!
    cutoff_time = start + timedelta(hours=35)
    sub_a = ready_a[ready_a["timestamp"] <= cutoff_time][FEATURE_COLUMNS]
    sub_b = ready_b[ready_b["timestamp"] <= cutoff_time][FEATURE_COLUMNS]


    pd.testing.assert_frame_equal(sub_a, sub_b)



def test_gap_spanning_train_test_boundary():
    """Verify that a gap at the train/test boundary does not cause test observations to leak into train."""
    raw_df = _generate_synthetic_hourly_data(hours=100)
    # Introduce gap near the 80% boundary (index 78, 79, 80)
    raw_df.loc[78:80, "pm2_5"] = np.nan
    raw_clean = raw_df.dropna(subset=["pm2_5"])

    ready, _ = prepare_training_dataset(raw_clean, min_required_samples=40)
    train_df, test_df = chronological_train_test_split(ready, train_ratio=0.8)

    train_max_ts = pd.to_datetime(train_df["timestamp"]).max()
    test_min_ts = pd.to_datetime(test_df["timestamp"]).min()
    assert train_max_ts < test_min_ts


def test_leakage_prevention_past_only_features():
    """
    CRITICAL TEST: Verify feature engineering uses STRICTLY past values.
    Rolling statistics must NOT include the target value at timestamp t.
    """
    start = datetime(2026, 9, 1, 0, 0, tzinfo=timezone.utc)
    data = [{"timestamp": (start + timedelta(hours=i)).isoformat(), "pm2_5": float(100 + i)} for i in range(30)]
    df = clean_raw_observations(pd.DataFrame(data))
    reg, _ = regularize_hourly_timeline(df, max_forward_fill_hours=0)
    feat = create_past_only_features(reg)

    # Inspect row 25 (t = 25h, target value = 125)
    row_25 = feat.iloc[25]
    assert row_25["pm2_5"] == 125.0
    assert row_25["lag_1"] == 124.0   # t - 1
    assert row_25["lag_3"] == 122.0   # t - 3
    assert row_25["lag_6"] == 119.0   # t - 6
    assert row_25["lag_24"] == 101.0  # t - 24

    # Rolling mean 6: must be mean of [119, 120, 121, 122, 123, 124] = 121.5
    expected_rolling_6 = np.mean([119.0, 120.0, 121.0, 122.0, 123.0, 124.0])
    assert row_25["rolling_mean_6"] == pytest.approx(expected_rolling_6)
    assert row_25["rolling_mean_6"] < row_25["pm2_5"]


def test_chronological_train_test_split():
    """Verify split is purely chronological with no temporal leakage."""
    df = _generate_synthetic_hourly_data(hours=100)
    ready, _ = prepare_training_dataset(df, min_required_samples=40)

    train_df, test_df = chronological_train_test_split(ready, train_ratio=0.8)
    assert len(train_df) == int(len(ready) * 0.8)
    assert len(train_df) + len(test_df) == len(ready)

    train_max_ts = pd.to_datetime(train_df["timestamp"]).max()
    test_min_ts = pd.to_datetime(test_df["timestamp"]).min()
    assert train_max_ts < test_min_ts


def test_persistence_baseline_computation():
    """Verify the persistence baseline computes correct 1-step MAE and RMSE."""
    test_df = pd.DataFrame({
        "timestamp": pd.date_range("2026-09-01", periods=5, freq="h"),
        "pm2_5": [50.0, 60.0, 55.0, 70.0, 65.0],
        "lag_1": [45.0, 50.0, 60.0, 55.0, 70.0],
    })
    res = compute_persistence_baseline(test_df, lag_col="lag_1")
    assert res["mae"] == 8.0
    assert res["rmse"] == pytest.approx(8.94, abs=0.01)
    assert res["sample_count"] == 5


def test_multistep_rollout_evaluation():
    """Verify rolling-origin multi-step rollout evaluation on held-out test data."""
    raw_df = _generate_synthetic_hourly_data(hours=300)
    with tempfile.TemporaryDirectory() as tmp_dir:
        train_res = train_and_evaluate_model(
            raw_df,
            output_dir=tmp_dir,
            n_estimators=10,
            max_depth=4,
        )
        meta = train_res["metadata"]
        assert "rollout_24h" in meta["metrics"]
        rollout = meta["metrics"]["rollout_24h"]
        assert rollout["status"] == "evaluated"
        assert rollout["horizon_hours"] == 24
        assert rollout["rollout_mae"] > 0.0
        assert rollout["baseline_rollout_mae"] > 0.0
        assert rollout["evaluated_origins"] > 0


def test_model_training_and_artifact_serialization():
    """Train Random Forest model on synthetic fixture and verify saved artifacts and metadata."""
    raw_df = _generate_synthetic_hourly_data(hours=240)

    with tempfile.TemporaryDirectory() as tmp_dir:
        train_res = train_and_evaluate_model(
            raw_df,
            output_dir=tmp_dir,
            station_id=999,
            n_estimators=20,
            max_depth=5,
        )

        model_file = Path(train_res["model_path"])
        meta_file = Path(train_res["metadata_path"])
        assert model_file.is_file()
        assert meta_file.is_file()

        meta = train_res["metadata"]
        assert meta["model_name"] == "RandomForestRegressor"
        assert meta["pollutant"] == "pm2_5"
        assert "mae" in meta["metrics"]
        assert "baseline_mae" in meta["metrics"]

        # Validate loaded metadata
        is_valid, _ = validate_model_metadata(meta)
        assert is_valid == meta["metrics"]["beats_baseline"]


def test_insufficient_data_rejection():
    """Ensure training fails safely when dataset is smaller than required minimum."""
    short_df = _generate_synthetic_hourly_data(hours=12)
    with tempfile.TemporaryDirectory() as tmp_dir:
        with pytest.raises(ValueError, match="Insufficient valid feature rows"):
            train_and_evaluate_model(short_df, output_dir=tmp_dir, min_required_samples=48)


def test_feature_flag_ml_model_enabled():
    """Verify settings.ml_model_enabled=False prevents serving model as operational."""
    with patch.object(settings, "ml_model_enabled", False):
        res = get_ml_forecast(station_id=101, horizon_hours=24)
        assert res["status"] == "model_not_trained"
        assert "ML_MODEL_ENABLED=False" in res["message"]


def test_sub_baseline_model_disqualification():
    """Verify metadata validation rejects models that fail to beat the baseline."""
    bad_meta = {
        "model_name": "RandomForestRegressor",
        "pollutant": "pm2_5",
        "features": FEATURE_COLUMNS,
        "metrics": {"beats_baseline": False, "mae": 10.0, "baseline_mae": 8.0},
    }
    is_valid, reason = validate_model_metadata(bad_meta)
    assert not is_valid
    assert "outperform the persistence baseline" in reason


def test_ml_forecast_endpoint_model_not_trained():
    """Verify GET /api/forecast/ml returns 'model_not_trained' when no model artifact is present."""
    with patch.object(settings, "ml_model_enabled", True):
        with patch.object(settings, "model_path", "backend/models/non_existent.joblib"):
            response = client.get("/api/forecast/ml?hours=24")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "model_not_trained"
            assert data["mae"] is None
            assert data["predictions"] == []


def test_ml_forecast_endpoint_insufficient_history():
    """Verify endpoint returns 'insufficient_data' when model is valid but recent history is absent."""
    raw_df = _generate_synthetic_hourly_data(hours=200)

    with tempfile.TemporaryDirectory() as tmp_dir:
        train_res = train_and_evaluate_model(
            raw_df,
            output_dir=tmp_dir,
            n_estimators=10,
            max_depth=4,
        )
        with patch.object(settings, "ml_model_enabled", True):
            with patch.object(settings, "model_path", train_res["model_path"]):
                # Call endpoint with no station measurements
                response = client.get("/api/forecast/ml?hours=24")
                assert response.status_code == 200
                data = response.json()
                assert data["status"] == "insufficient_data"
                assert "no recent ground observations" in data["message"]


def test_ml_forecast_inference_valid_rollout():
    """Verify recursive multi-step rollout given a valid 24+ hour recent observation series."""
    raw_df = _generate_synthetic_hourly_data(hours=200)

    with tempfile.TemporaryDirectory() as tmp_dir:
        train_res = train_and_evaluate_model(
            raw_df,
            output_dir=tmp_dir,
            n_estimators=10,
            max_depth=4,
        )
        recent_df = _generate_synthetic_hourly_data(hours=30)
        res = get_ml_forecast(
            station_id=101,
            horizon_hours=24,
            recent_series=recent_df,
            model_path=train_res["model_path"],
        )
        assert res["status"] == "operational"
        assert len(res["predictions"]) == 24
        assert res["predictions"][0]["horizon_hour"] == 1
        assert res["predictions"][23]["horizon_hour"] == 24
        for p in res["predictions"]:
            assert p["predicted_pm2_5"] >= 0.0
            assert p["unit"] == "µg/m³"


@pytest.mark.anyio
async def test_forecast_endpoint_receives_openaq_history():
    """Verify endpoint extracts recent PM2.5 measurements from OpenAQ and feeds inference."""
    raw_df = _generate_synthetic_hourly_data(hours=200)

    with tempfile.TemporaryDirectory() as tmp_dir:
        train_res = train_and_evaluate_model(
            raw_df,
            output_dir=tmp_dir,
            n_estimators=10,
            max_depth=4,
        )
        # Create 30 hourly ground measurements
        start = datetime(2026, 9, 1, 0, 0, tzinfo=timezone.utc)
        mock_meas = [
            GroundMeasurement(
                parameter="pm25",
                value=30.0 + (i % 5),
                unit="µg/m³",
                observed_at=(start + timedelta(hours=i)).isoformat(),
                sensor_id=555,
            )
            for i in range(30)
        ]
        mock_station_resp = StationMeasurementsResponse(
            station_id=10425,
            station_name="Test Station",
            source="OpenAQ API v3",
            data_type="ground_station_observations",
            attribution="CC BY 4.0",
            retrieved_at=datetime.now(timezone.utc).isoformat(),
            measurements=mock_meas,
        )

        with patch.object(settings, "ml_model_enabled", True):
            with patch.object(settings, "model_path", train_res["model_path"]):
                with patch("app.services.openaq.fetch_station_measurements", return_value=mock_station_resp):
                    response = client.get("/api/forecast/ml?station_id=10425&hours=24")
                    assert response.status_code == 200
                    data = response.json()
                    assert data["status"] == "operational"
                    assert len(data["predictions"]) == 24


def test_api_forecast_ml_endpoint_seed_pm25_demonstration():
    """Verify endpoint provides operational multi-step rollout using seed_pm25 without station history."""
    raw_df = _generate_synthetic_hourly_data(hours=360)
    with tempfile.TemporaryDirectory() as tmp_dir:
        train_res = train_and_evaluate_model(
            raw_df,
            output_dir=tmp_dir,
            n_estimators=10,
            max_depth=4,
        )
        with patch.object(settings, "ml_model_enabled", True):
            with patch.object(settings, "model_path", train_res["model_path"]):
                # Call endpoint with seed_pm25 and no station_id
                response = client.get("/api/forecast/ml?seed_pm25=42.0&hours=24")
                assert response.status_code == 200
                data = response.json()
                assert data["status"] == "operational"
                assert len(data["predictions"]) == 24
                assert data["predictions"][0]["horizon_hour"] == 1
                assert all(p["unit"] == "µg/m³" for p in data["predictions"])
                assert all(p["predicted_pm2_5"] >= 0.0 for p in data["predictions"])
                assert "Demonstration Baseline" in data["message"] or "seed" in data["message"]


def test_api_forecast_ml_endpoint_no_station_no_seed_insufficient():
    """Verify endpoint returns insufficient_data when model is enabled but neither station nor seed is supplied."""
    with patch.object(settings, "ml_model_enabled", True):
        response = client.get("/api/forecast/ml?hours=24")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "insufficient_data"
        assert len(data["predictions"]) == 0
        assert "no recent ground observations were provided" in data["message"].lower() or "required" in data["message"].lower()


def test_historical_csv_loader():
    """Verify loading and parsing of offline historical observations CSV."""
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".csv", delete=False) as f:
        f.write("timestamp,pm2_5,unit,sensor_id\n")
        f.write("2026-09-01T00:00:00Z,42.5,µg/m³,101\n")
        f.write("2026-09-01T01:00:00Z,45.0,µg/m³,101\n")
        f_name = f.name

    try:
        df = load_historical_observations_from_csv(f_name)
        assert len(df) == 2
        assert "pm2_5" in df.columns
        assert df.iloc[0]["pm2_5"] == 42.5
    finally:
        Path(f_name).unlink()


@pytest.mark.anyio
async def test_fetch_sensor_historical_measurements_unauthenticated():
    """Verify OpenAQ historical fetch raises PermissionError when API key is missing."""
    orig_key = settings.openaq_api_key
    settings.openaq_api_key = ""
    try:
        t_from = datetime(2026, 9, 1, 0, 0, tzinfo=timezone.utc)
        t_to = datetime(2026, 9, 2, 0, 0, tzinfo=timezone.utc)
        with pytest.raises(PermissionError, match="OpenAQ API key is not configured"):
            await fetch_sensor_historical_measurements(
                sensor_id=101,
                datetime_from=t_from,
                datetime_to=t_to,
            )
    finally:
        settings.openaq_api_key = orig_key


@pytest.mark.anyio
async def test_fetch_sensor_historical_measurements_mocked():
    """Verify parsing of OpenAQ v3 historical sensor measurements response."""
    orig_key = settings.openaq_api_key
    settings.openaq_api_key = "test_key"

    mock_resp = {
        "meta": {"found": 2, "limit": 1000, "page": 1},
        "results": [
            {
                "datetime": {"utc": "2026-09-01T00:00:00Z"},
                "value": 38.2,
                "parameter": {"name": "pm25", "units": "µg/m³"},
            },
            {
                "datetime": {"utc": "2026-09-01T01:00:00Z"},
                "value": 41.0,
                "parameter": {"name": "pm25", "units": "µg/m³"},
            },
        ],
    }

    class MockTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            assert request.headers.get("X-API-Key") == "test_key"
            return httpx.Response(200, json=mock_resp)

    try:
        async with httpx.AsyncClient(transport=MockTransport()) as test_client:
            t_from = datetime(2026, 9, 1, 0, 0, tzinfo=timezone.utc)
            t_to = datetime(2026, 9, 2, 0, 0, tzinfo=timezone.utc)
            data = await fetch_sensor_historical_measurements(
                sensor_id=101,
                datetime_from=t_from,
                datetime_to=t_to,
                client=test_client,
            )
            assert len(data) == 2
            assert data[0]["value"] == 38.2
            assert data[1]["value"] == 41.0
            assert data[0]["sensor_id"] == 101
    finally:
        settings.openaq_api_key = orig_key
