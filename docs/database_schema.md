# BreatheWise --- Database Schema (Optional PostgreSQL)

## 1. Database Decision

PostgreSQL/Supabase is optional for a 3--5 day recruitment task. Start
without a database if provider calls plus short-lived caching are
sufficient. Add persistence only if it supports station metadata,
normalized readings, forecast history, model evaluation records, or
report metadata.

External providers remain the source of truth for original data.
Preserve source identifiers and retrieval timestamps.

## 2. Logical Entities

-   `locations`: selected or named geographic points.
-   `monitoring_stations`: provider monitoring locations.
-   `sensors`: pollutant-specific sensors attached to stations.
-   `measurements`: timestamped station readings.
-   `model_runs`: training metadata and held-out metrics.
-   `forecasts`: external or local predictions.
-   `environmental_reports`: source-linked public documents.

## 3. Relationship Diagram

``` mermaid
erDiagram
    locations ||--o{ monitoring_stations : contains
    monitoring_stations ||--o{ sensors : has
    sensors ||--o{ measurements : records
    locations ||--o{ forecasts : receives
    monitoring_stations ||--o{ forecasts : supports
    model_runs ||--o{ forecasts : generates
    monitoring_stations ||--o{ model_runs : trains_for
```

A report may be associated with a region through a region name or a
future location/report join table. Keep the first version simple.

## 4. PostgreSQL DDL

``` sql
CREATE TABLE locations (
    id BIGSERIAL PRIMARY KEY,
    name TEXT,
    latitude DOUBLE PRECISION NOT NULL
        CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL
        CHECK (longitude BETWEEN -180 AND 180),
    region_name TEXT,
    country_code CHAR(2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE monitoring_stations (
    id BIGSERIAL PRIMARY KEY,
    location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    provider_location_id TEXT NOT NULL,
    station_name TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    timezone_name TEXT,
    last_seen_at TIMESTAMPTZ,
    UNIQUE (provider, provider_location_id),
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE sensors (
    id BIGSERIAL PRIMARY KEY,
    station_id BIGINT NOT NULL
        REFERENCES monitoring_stations(id) ON DELETE CASCADE,
    provider_sensor_id TEXT NOT NULL,
    parameter TEXT NOT NULL,
    canonical_pollutant TEXT NOT NULL
        CHECK (canonical_pollutant IN (
            'pm2_5', 'pm10', 'nitrogen_dioxide',
            'sulphur_dioxide', 'ozone', 'other'
        )),
    unit TEXT NOT NULL,
    UNIQUE (station_id, provider_sensor_id)
);

CREATE TABLE measurements (
    id BIGSERIAL PRIMARY KEY,
    sensor_id BIGINT NOT NULL
        REFERENCES sensors(id) ON DELETE CASCADE,
    observed_at TIMESTAMPTZ NOT NULL,
    value DOUBLE PRECISION,
    unit TEXT NOT NULL,
    source TEXT NOT NULL,
    quality_status TEXT,
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sensor_id, observed_at),
    CHECK (value IS NULL OR value >= 0)
);

CREATE INDEX idx_measurements_sensor_time
    ON measurements(sensor_id, observed_at DESC);

CREATE TABLE model_runs (
    id BIGSERIAL PRIMARY KEY,
    model_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    pollutant TEXT NOT NULL,
    station_id BIGINT REFERENCES monitoring_stations(id) ON DELETE SET NULL,
    training_started_at TIMESTAMPTZ,
    training_ended_at TIMESTAMPTZ,
    training_data_start TIMESTAMPTZ,
    training_data_end TIMESTAMPTZ,
    training_rows INTEGER,
    test_rows INTEGER,
    mae DOUBLE PRECISION,
    rmse DOUBLE PRECISION,
    baseline_mae DOUBLE PRECISION,
    baseline_rmse DOUBLE PRECISION,
    artifact_uri TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE forecasts (
    id BIGSERIAL PRIMARY KEY,
    location_id BIGINT REFERENCES locations(id) ON DELETE CASCADE,
    station_id BIGINT REFERENCES monitoring_stations(id) ON DELETE SET NULL,
    model_run_id BIGINT REFERENCES model_runs(id) ON DELETE SET NULL,
    pollutant TEXT NOT NULL,
    forecast_for TIMESTAMPTZ NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    value DOUBLE PRECISION,
    unit TEXT NOT NULL,
    source TEXT NOT NULL,
    data_type TEXT NOT NULL CHECK (
        data_type IN ('external_model_forecast', 'local_ml_forecast')
    ),
    lower_bound DOUBLE PRECISION,
    upper_bound DOUBLE PRECISION,
    CHECK (value IS NULL OR value >= 0),
    CHECK (lower_bound IS NULL OR lower_bound >= 0),
    CHECK (upper_bound IS NULL OR upper_bound >= 0),
    CHECK (
        lower_bound IS NULL OR upper_bound IS NULL
        OR lower_bound <= upper_bound
    )
);

CREATE INDEX idx_forecasts_location_time
    ON forecasts(location_id, pollutant, forecast_for DESC);

CREATE TABLE environmental_reports (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    publisher TEXT,
    published_at TIMESTAMPTZ,
    region_name TEXT,
    issue_category TEXT,
    summary TEXT,
    source_url TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL CHECK (
        source_type IN ('official', 'news', 'other')
    ),
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 5. Schema Notes

### Locations

Store the geographic point and optional region metadata. If arbitrary
user-selected points are not persistent, they need not be saved to this
table.

### Monitoring stations

Provider plus provider location ID is the natural uniqueness key. A
station may not have every pollutant. Store provider coordinates
separately from the selected search point.

### Sensors

A station may have multiple sensors. Store provider sensor ID,
parameter, canonical pollutant, and unit.

### Measurements

Use timezone-aware timestamps. `UNIQUE(sensor_id, observed_at)` is a
starting deduplication strategy; if the provider can deliver multiple
valid samples for the same hour, include the appropriate
aggregation/measurement identifier instead. Do not silently overwrite
conflicting observations without a policy.

### Model runs

Store actual training interval, sample counts, model version, test
metrics, baseline metrics, and artifact location. Metrics remain
nullable until evaluated.

### Forecasts

Keep external forecast and local ML forecast types distinct. If a
forecast is regenerated for the same target time, `generated_at` lets
the application distinguish forecast vintages. Add retention policies if
the table grows.

### Environmental reports

Keep source URL unique where appropriate, but consider canonical URL
normalization before deduplication. Clearly distinguish official
findings from news and other sources.

## 6. Indexing and Retention

-   Index measurements by sensor and time.
-   Index forecasts by location, pollutant, and forecast time.
-   Add geographic indexes only if distance queries require them.
-   Consider PostGIS for substantial geospatial querying; it is
    unnecessary for a simple demo.
-   Set a retention policy for raw measurements and cached payloads.
-   Avoid storing every provider response forever without a product
    need.

## 7. Database Security

-   Use parameterized queries or a trusted ORM.
-   Use a dedicated least-privilege application role.
-   Keep credentials in backend environment variables.
-   Require TLS for remote database connections.
-   Use migrations for schema changes.
-   Do not store API keys in data rows.
-   If using Supabase client-side access, configure and test row-level
    security; never expose a service-role key in the frontend.
-   If all database access passes through FastAPI, keep the database
    private and validate every request.

## 8. If No Database Is Implemented

Use normalized Pydantic models and a short-lived cache. Document that
historical records are fetched on demand and that the app does not
persist user location history. The project remains valid without a
database if its core data flow and analysis work.
