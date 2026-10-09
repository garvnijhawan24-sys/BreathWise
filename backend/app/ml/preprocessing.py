"""
BreatheWise Time-Series Preprocessing and Past-Only Feature Engineering.
Enforces strict chronological causality (zero future-data leakage):
- Rejects negative concentrations and deduplicates timestamps.
- Regularizes to regular hourly timeline with explicit missingness accounting.
- Bounded past-only gap policy: forward-fill (ffill) only, strictly bounded (<= 2h).
  NO two-sided interpolation (no looking forward into future timestamps).
- Distinguishes observed zeros from missing data. Target values are never imputed.
- All lag features and rolling statistics strictly reference past observations (t - 1 or earlier).
"""
from dataclasses import dataclass
from typing import Dict, List, Tuple
import numpy as np
import pandas as pd


FEATURE_COLUMNS: List[str] = [
    "hour",
    "day_of_week",
    "lag_1",
    "lag_3",
    "lag_6",
    "lag_24",
    "rolling_mean_6",
    "rolling_mean_24",
]

TARGET_COLUMN: str = "pm2_5"


@dataclass
class DatasetQualitySummary:
    total_raw_rows: int
    cleaned_rows: int
    timeline_start: str
    timeline_end: str
    total_expected_hours: int
    observed_hours: int
    missing_hours: int
    missing_percentage: float
    usable_feature_rows: int


def clean_raw_observations(df: pd.DataFrame) -> pd.DataFrame:
    """
    Cleans raw observation records:
    1. Validates presence of 'timestamp' and 'pm2_5'.
    2. Parses timestamps and normalizes to UTC.
    3. Rejects physically impossible negative values (PM2.5 < 0).
    4. Sorts chronologically.
    5. Deduplicates on timestamp by computing mean of conflicting records.
    6. Preserves valid observed zero values without converting to NaN.
    """
    if "timestamp" not in df.columns or "pm2_5" not in df.columns:
        raise ValueError("DataFrame must contain 'timestamp' and 'pm2_5' columns.")

    cleaned = df.copy()
    cleaned["timestamp"] = pd.to_datetime(cleaned["timestamp"], utc=True)
    cleaned["pm2_5"] = pd.to_numeric(cleaned["pm2_5"], errors="coerce")

    # Drop null timestamps or null PM2.5
    cleaned = cleaned.dropna(subset=["timestamp", "pm2_5"])

    # Discard impossible negative concentrations
    cleaned = cleaned[cleaned["pm2_5"] >= 0.0]

    # Sort chronologically
    cleaned = cleaned.sort_values("timestamp")

    # Deduplicate on timestamp by averaging any collisions
    cleaned = cleaned.groupby("timestamp", as_index=False)["pm2_5"].mean()

    return cleaned


def regularize_hourly_timeline(
    df: pd.DataFrame,
    max_forward_fill_hours: int = 2,
) -> Tuple[pd.DataFrame, Dict[str, float]]:
    """
    Aligns observations to a regular 1-hour interval.
    Tracks missing hours explicitly without confusing zero readings with missing data.

    STRICT PAST-ONLY GAP POLICY:
    - Absolutely NO two-sided interpolation (which would look ahead into future values).
    - Uses strictly bounded past-only forward-fill (ffill with max_forward_fill_hours limit)
      to maintain series continuity for lag calculations.
    - Missing hours exceeding the limit remain NaN and will not produce training rows.
    - The prediction target 'pm2_5' is NEVER forward-filled; it retains only genuine observations.
    """
    if df.empty:
        raise ValueError("Cannot regularize an empty dataset.")

    df_sorted = df.sort_values("timestamp").copy()
    df_indexed = df_sorted.set_index("timestamp")

    # Resample to strict hourly frequency
    hourly = df_indexed.resample("1h").mean()

    total_expected = len(hourly)
    observed_count = int(hourly["pm2_5"].notna().sum())
    missing_count = total_expected - observed_count
    missing_pct = (missing_count / total_expected * 100.0) if total_expected > 0 else 0.0

    missing_stats = {
        "total_expected_hours": total_expected,
        "observed_hours": observed_count,
        "missing_hours": missing_count,
        "missing_percentage": round(missing_pct, 2),
        "timeline_start": hourly.index.min().isoformat(),
        "timeline_end": hourly.index.max().isoformat(),
    }

    # Past-only bounded forward-fill for feature lag series only
    if max_forward_fill_hours > 0:
        hourly["pm2_5_past_filled"] = hourly["pm2_5"].ffill(limit=max_forward_fill_hours)
    else:
        hourly["pm2_5_past_filled"] = hourly["pm2_5"]

    hourly_df = hourly.reset_index()
    return hourly_df, missing_stats


def create_past_only_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Generates time-series features using STRICTLY past values (zero data leakage):
    - hour (0-23): extracted from target timestamp t
    - day_of_week (0-6): extracted from target timestamp t
    - lag_1: observation at t - 1h
    - lag_3: observation at t - 3h
    - lag_6: observation at t - 6h
    - lag_24: observation at t - 24h
    - rolling_mean_6: rolling 6-hour mean shifted by 1 hour (strictly past only)
    - rolling_mean_24: rolling 24-hour mean shifted by 1 hour (strictly past only)

    Crucial leakage prevention:
    - shift(1) before rolling ensures target at time t does not leak into rolling statistics.
    - All lags look strictly backwards.
    - Modifying future rows (t+1, t+2...) has mathematically zero effect on row t.
    """
    df_feat = df.sort_values("timestamp").copy()
    ts = pd.to_datetime(df_feat["timestamp"], utc=True)

    df_feat["hour"] = ts.dt.hour
    df_feat["day_of_week"] = ts.dt.dayofweek

    # Base series for lag creation: use past-filled series if present, otherwise raw pm2_5
    series = (
        df_feat["pm2_5_past_filled"]
        if "pm2_5_past_filled" in df_feat.columns
        else df_feat["pm2_5"]
    )

    # Explicit past-only lags
    df_feat["lag_1"] = series.shift(1)
    df_feat["lag_3"] = series.shift(3)
    df_feat["lag_6"] = series.shift(6)
    df_feat["lag_24"] = series.shift(24)

    # Past-only rolling statistics: shifted by 1 so current t is excluded
    shifted_1 = series.shift(1)
    df_feat["rolling_mean_6"] = shifted_1.rolling(window=6, min_periods=3).mean()
    df_feat["rolling_mean_24"] = shifted_1.rolling(window=24, min_periods=12).mean()

    # Target is strictly the actual observed PM2.5 concentration at timestamp t
    return df_feat


def prepare_training_dataset(
    raw_df: pd.DataFrame,
    max_forward_fill_hours: int = 2,
    min_required_samples: int = 48,
) -> Tuple[pd.DataFrame, DatasetQualitySummary]:
    """
    Full pipeline to clean, regularize, create past-only features, and validate readiness:
    1. Cleans raw observations.
    2. Regularizes to regular hourly timeline with past-only bounded fill.
    3. Generates past-only features.
    4. Drops rows with missing features or missing actual target.
    5. Returns ready-to-train DataFrame and comprehensive quality summary.
    """
    raw_count = len(raw_df)
    cleaned = clean_raw_observations(raw_df)
    regularized, stats = regularize_hourly_timeline(
        cleaned, max_forward_fill_hours=max_forward_fill_hours
    )
    featured = create_past_only_features(regularized)

    # Keep only rows where all features and the actual target are present
    required_cols = FEATURE_COLUMNS + [TARGET_COLUMN, "timestamp"]
    model_ready = featured[required_cols].dropna().reset_index(drop=True)

    summary = DatasetQualitySummary(
        total_raw_rows=raw_count,
        cleaned_rows=len(cleaned),
        timeline_start=stats["timeline_start"],
        timeline_end=stats["timeline_end"],
        total_expected_hours=int(stats["total_expected_hours"]),
        observed_hours=int(stats["observed_hours"]),
        missing_hours=int(stats["missing_hours"]),
        missing_percentage=stats["missing_percentage"],
        usable_feature_rows=len(model_ready),
    )

    if len(model_ready) < min_required_samples:
        raise ValueError(
            f"Insufficient valid feature rows ({len(model_ready)}) for training. "
            f"Minimum required is {min_required_samples} samples."
        )

    return model_ready, summary
