# BreatheWise — Machine Learning Pipeline

## 1. Objective

Implement a mathematically rigorous and defensible short-term PM2.5 prediction pipeline. The pipeline focuses on ground-station PM2.5 observations and establishes an empirical bar using a naive persistence baseline before any local model can be marked operational.

External atmospheric-model forecasts (Open-Meteo) and empirical local ML predictions (Scikit-Learn) are strictly separated in architecture, schemas, and UI components.

---

## 2. Data Requirements & Minimum Thresholds

### Required Fields
- UTC normalized Timestamp
- Station and provider identifier
- PM2.5 concentration and verified physical unit (`µg/m³`)

### Sample Count & Minimum Limitations
- **Operational Requirement (30+ Days / 720+ Contiguous Hours):**  
  To learn diurnal cycles (24-hour diurnal peaks) and day-of-week patterns (168 hours) with sufficient holdout samples for rolling-origin evaluation, a minimum of 30+ days of contiguous hourly ground observations is mandatory.
- **Technical Floor (48 Hours):**  
  The feature engineering pipeline requires 25 initial hours to populate the first complete feature row (`lag_24` and `rolling_mean_24` shifted by 1). A 48-hour dataset yields only ~23 feature rows (~18 train rows, ~5 test rows). While 48 hours prevents index errors during unit testing, **it is completely inadequate to validate operational predictive accuracy.**
- **No Data Fabrication:**  
  If real ground data is missing or unauthenticated, the pipeline strictly halts training and keeps public status as `model_not_trained`.

---

## 3. Preprocessing & Zero-Leakage Policy

### 1. Data Cleaning
- UTC normalization and chronological sorting.
- Rejection of physically impossible values ($\text{PM}_{2.5} < 0$).
- Deduplication of timestamp collisions by computing the mean.
- Retention of genuine measured zero values ($0.0 \ne \text{NaN}$).

### 2. Strictly Past-Only Gap Policy
- **No Two-Sided Interpolation:** Two-sided time interpolation (e.g. `interpolate(method="time")`) looks forward into future timestamps, which leaks future information and is physically impossible at inference origin $T_0$.
- **Bounded Past-Only Forward-Fill:** Gaps $\le 2$ hours may be forward-filled (`ffill(limit=2)`) exclusively for feature lag series to preserve time-series continuity. Target values are **never** forward-filled.
- **Long Gaps:** Missing intervals $> 2$ hours remain `NaN` and are dropped from training rows.

### 3. Boundary Independence
- The past-only forward-fill policy ensures that observations at time $t+k$ have mathematically zero influence on features at or before time $t$.
- Modifying future test-set values cannot alter earlier training-set features across the train/test boundary.

---

## 4. Feature Engineering

Features look strictly backwards:
- `hour` (0–23): Target hour
- `day_of_week` (0–6): Target day of week
- `lag_1`: Observation at $t - 1\text{h}$
- `lag_3`: Observation at $t - 3\text{h}$
- `lag_6`: Observation at $t - 6\text{h}$
- `lag_24`: Observation at $t - 24\text{h}$
- `rolling_mean_6`: Rolling 6-hour mean computed on `.shift(1)` (strictly past-only)
- `rolling_mean_24`: Rolling 24-hour mean computed on `.shift(1)` (strictly past-only)

**Target:** Actual observed PM2.5 concentration at timestamp $t$.

---

## 5. Chronological Splitting & Dual-Horizon Evaluation

### 1. Split Policy
- Strict chronological 80% train / 20% test split. Shuffling is prohibited.
- Boundary assertion: $\max(\text{train\_timestamps}) < \min(\text{test\_timestamps})$.

### 2. Persistence Baseline Definitions
- **Single-Step Baseline ($t+1$):** Predicts $y_t = y_{t-1}$.
- **Multi-Step Persistence Baseline ($1 \dots H$):** Predicts the latest observation at forecast origin $T_0$ for all future steps $h \in [1, H]$: $\hat{y}_{T_0+h} = y_{T_0}$.

### 3. Dual-Horizon Metrics
To prevent presenting single-step accuracy as proof of 24-hour performance, the pipeline reports two distinct evaluation tiers:
1. **Single-Step (1-Hour Ahead):** Evaluates one-step accuracy on all held-out test rows (`one_step_mae`, `one_step_rmse` vs `baseline_one_step_mae`).
2. **Rolling-Origin Multi-Step Rollout (24-Hour Horizon):** Rolls out recursive 24-step predictions across test set origins (strided by 6 hours) against multi-step persistence on identical target ground-truth points (`rollout_24h_mae` vs `baseline_rollout_24h_mae`).

---

## 6. Model Readiness & Operational Gates

A model artifact is marked `"operational"` **only if all of the following gates pass**:
1. `ML_MODEL_ENABLED=True` in backend configuration.
2. Artifact file (`air_quality_model.joblib`) and companion metadata (`air_quality_model_meta.json`) exist in trusted local paths.
3. Metadata feature order matches `FEATURE_COLUMNS` exactly.
4. Target pollutant matches `pm2_5`.
5. Model evaluation demonstrates that the model outperforms the persistence baseline (`beats_baseline: true`).
6. If any gate fails, the model is marked `"sub_baseline"`, `"uncalibrated"`, or `"model_not_trained"`.

---

## 7. Inference Data Flow & Recent History Requirements

### Endpoint: `GET /api/forecast/ml?station_id=...&hours=24`
- **History Requirement:** To construct autoregressive features (`lag_24` and `rolling_mean_24`), the inference engine requires at least 24 hours of recent continuous ground observations for the requested station.
- **Data Flow:** The endpoint fetches recent station readings via the authorized OpenAQ client (`fetch_station_measurements`), filters PM2.5 readings, regularizes hourly, and passes them to `predict.py`.
- **Missing History Policy:** If fewer than 24 hours of observations are available (or if no station ID is supplied), the endpoint honestly returns `status: "insufficient_data"`. It **never** invents or fabricates readings.
- **Rollout Mechanism:** The model recursively predicts step $k$, appends predicted concentration $\hat{y}_{t+k}$ to the recent buffer, recomputes past-only lags, and advances to step $k+1$.
