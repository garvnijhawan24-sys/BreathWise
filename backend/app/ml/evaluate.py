"""
BreatheWise Baseline and Chronological Evaluation Module.
Enforces chronological train/test splitting (zero temporal leakage), computes the mandatory
persistence baseline, and calculates both single-step (1-hour ahead) and rolling-origin multi-step
(24-hour horizon) metrics against identical ground-truth targets.
"""
from datetime import timedelta
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error

from app.ml.preprocessing import FEATURE_COLUMNS, TARGET_COLUMN


def chronological_train_test_split(
    df: pd.DataFrame,
    train_ratio: float = 0.8,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Performs a strict chronological train/test split.
    Guarantees no shuffling and verifies that all training timestamps
    strictly precede testing timestamps.
    """
    if df.empty:
        raise ValueError("Cannot split an empty DataFrame.")
    if not (0.1 <= train_ratio <= 0.9):
        raise ValueError("train_ratio must be between 0.1 and 0.9.")

    df_sorted = df.sort_values("timestamp").reset_index(drop=True)
    split_idx = int(len(df_sorted) * train_ratio)

    if split_idx == 0 or split_idx == len(df_sorted):
        raise ValueError(
            f"Dataset length {len(df_sorted)} is too small for chronological split ratio {train_ratio}."
        )

    train_df = df_sorted.iloc[:split_idx].copy()
    test_df = df_sorted.iloc[split_idx:].copy()

    # Temporal leakage verification
    train_max_ts = pd.to_datetime(train_df["timestamp"]).max()
    test_min_ts = pd.to_datetime(test_df["timestamp"]).min()
    if train_max_ts >= test_min_ts:
        raise ValueError(
            f"Temporal leakage detected: train_max ({train_max_ts}) >= test_min ({test_min_ts})"
        )

    return train_df, test_df


def compute_persistence_baseline(
    test_df: pd.DataFrame,
    lag_col: str = "lag_1",
) -> Dict[str, Any]:
    """
    Computes the 1-step persistence baseline (predicting t as the latest observation t-1).
    Calculates MAE and RMSE on the held-out test set.
    """
    if test_df.empty:
        raise ValueError("Test set is empty for baseline evaluation.")
    if lag_col not in test_df.columns:
        raise ValueError(f"Lag column '{lag_col}' not found in test set for baseline.")

    y_true = test_df[TARGET_COLUMN].to_numpy()
    y_pred = test_df[lag_col].to_numpy()

    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))

    return {
        "baseline_name": "Persistence 1-step (t-1)",
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "sample_count": len(test_df),
    }


def evaluate_predictions(
    y_true: np.ndarray | pd.Series,
    y_pred: np.ndarray | pd.Series,
) -> Dict[str, float]:
    """
    Computes standard regression metrics (MAE, RMSE) for evaluation.
    """
    y_true_arr = np.asarray(y_true, dtype=float)
    y_pred_arr = np.asarray(y_pred, dtype=float)

    if len(y_true_arr) == 0:
        raise ValueError("Cannot evaluate empty prediction array.")

    mae = float(mean_absolute_error(y_true_arr, y_pred_arr))
    rmse = float(np.sqrt(mean_squared_error(y_true_arr, y_pred_arr)))

    return {
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
    }


def compare_model_with_baseline(
    model_metrics: Dict[str, float],
    baseline_metrics: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Compares ML model performance against the persistence baseline.
    Computes absolute and percentage improvement.
    """
    b_mae = baseline_metrics["mae"]
    m_mae = model_metrics["mae"]

    mae_diff = b_mae - m_mae
    pct_imp = (mae_diff / b_mae * 100.0) if b_mae > 0 else 0.0

    return {
        "model_mae": m_mae,
        "baseline_mae": b_mae,
        "model_rmse": model_metrics["rmse"],
        "baseline_rmse": baseline_metrics["rmse"],
        "beats_baseline": m_mae < b_mae,
        "mae_improvement": round(mae_diff, 2),
        "mae_improvement_percent": round(pct_imp, 2),
    }


def evaluate_rolling_multistep_rollout(
    model: Any,
    test_df: pd.DataFrame,
    horizon_hours: int = 24,
    stride_hours: int = 6,
) -> Dict[str, Any]:
    """
    Performs rolling-origin multi-step autoregressive evaluation on the held-out test interval.
    
    At each forecast origin T_origin:
    1. Uses the preceding contiguous 24 hours of observations to construct initial lags.
    2. Recursively rolls out the ML model for 1..horizon_hours without seeing true future targets.
    3. Multi-step persistence baseline predicts the latest observation at T_origin for all 1..horizon_hours.
    4. Compares ML rollout against persistence baseline on the EXACT identical ground truth targets.

    Returns multi-step MAE/RMSE and explicit sample count, or an insufficient data status.
    """
    test_sorted = test_df.sort_values("timestamp").reset_index(drop=True)
    n_rows = len(test_sorted)

    # Need at least 24 hours of past history + horizon_hours of future targets
    min_required = 24 + horizon_hours
    if n_rows < min_required:
        return {
            "status": "insufficient_samples_for_rollout_evaluation",
            "required_samples": min_required,
            "available_samples": n_rows,
            "rollout_mae": None,
            "rollout_rmse": None,
            "baseline_rollout_mae": None,
            "baseline_rollout_rmse": None,
            "rollout_beats_baseline": False,
            "evaluated_origins": 0,
            "total_evaluated_points": 0,
        }

    all_y_true: List[float] = []
    all_y_model: List[float] = []
    all_y_base: List[float] = []
    origins_count = 0

    # Slide origin across test set
    for origin_idx in range(24, n_rows - horizon_hours + 1, stride_hours):
        origins_count += 1
        history_vals = test_sorted.iloc[origin_idx - 24 : origin_idx][TARGET_COLUMN].tolist()
        origin_time = pd.to_datetime(test_sorted.iloc[origin_idx - 1]["timestamp"], utc=True)
        baseline_val = history_vals[-1]  # Latest observation at forecast origin

        curr_vals = list(history_vals)
        for step in range(1, horizon_hours + 1):
            target_idx = origin_idx - 1 + step
            true_val = float(test_sorted.iloc[target_idx][TARGET_COLUMN])
            target_time = origin_time + timedelta(hours=step)

            # Autoregressive feature construction (strictly past-only)
            hr = target_time.hour
            dow = target_time.weekday()
            lag_1 = curr_vals[-1]
            lag_3 = curr_vals[-3] if len(curr_vals) >= 3 else curr_vals[-1]
            lag_6 = curr_vals[-6] if len(curr_vals) >= 6 else curr_vals[-1]
            lag_24 = curr_vals[-24] if len(curr_vals) >= 24 else curr_vals[-1]
            r6 = float(np.mean(curr_vals[-6:]))
            r24 = float(np.mean(curr_vals[-24:]))

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
            feat_df = pd.DataFrame([feat_dict])[FEATURE_COLUMNS]
            pred_val = max(0.0, float(model.predict(feat_df)[0]))

            curr_vals.append(pred_val)

            all_y_true.append(true_val)
            all_y_model.append(pred_val)
            all_y_base.append(baseline_val)

    if not all_y_true:
        return {
            "status": "no_valid_rollout_windows",
            "rollout_mae": None,
            "rollout_rmse": None,
            "baseline_rollout_mae": None,
            "baseline_rollout_rmse": None,
            "rollout_beats_baseline": False,
            "evaluated_origins": 0,
            "total_evaluated_points": 0,
        }

    m_mae = float(mean_absolute_error(all_y_true, all_y_model))
    m_rmse = float(np.sqrt(mean_squared_error(all_y_true, all_y_model)))
    b_mae = float(mean_absolute_error(all_y_true, all_y_base))
    b_rmse = float(np.sqrt(mean_squared_error(all_y_true, all_y_base)))

    return {
        "status": "evaluated",
        "horizon_hours": horizon_hours,
        "rollout_mae": round(m_mae, 2),
        "rollout_rmse": round(m_rmse, 2),
        "baseline_rollout_mae": round(b_mae, 2),
        "baseline_rollout_rmse": round(b_rmse, 2),
        "rollout_beats_baseline": m_mae < b_mae,
        "evaluated_origins": origins_count,
        "total_evaluated_points": len(all_y_true),
        "stride_hours": stride_hours,
    }
