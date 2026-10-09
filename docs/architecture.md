# BreatheWise --- System Architecture

## 1. Architecture Goals

-   Separate UI, provider integration, analytics, ML, and report search.
-   Keep API keys and provider credentials on the backend.
-   Normalize provider data into a common schema.
-   Distinguish station observations, external model forecasts, and
    local ML forecasts.
-   Handle absent stations, missing pollutants, upstream failures, and
    stale data gracefully.
-   Support localhost and separate frontend/backend deployment.
-   Keep persistence optional for the recruitment deadline.

## 2. High-Level Architecture

``` mermaid
flowchart TD
    U[User selects location and date window]
    F[React + Vite frontend]
    B[FastAPI backend]
    M[Open-Meteo forecast API]
    O[OpenAQ observations API]
    N[Normalize, validate and label data]
    A[Analytics and ML]
    R[Environmental report service]
    C[Short-lived cache]
    U --> F
    F --> B
    B --> C
    B --> M
    B --> O
    M --> N
    O --> N
    N --> A
    B --> R
    A --> B
    R --> B
    B --> F
```

## 3. Component Responsibilities

### Frontend

React/Vite/TypeScript with Tailwind, Leaflet, and Recharts. It owns user
interaction, location selection, date/pollutant filters, charts,
loading/error states, and presentation. It must not contain secret
provider keys.

### API client

One typed frontend module handles the backend base URL, query
parameters, response parsing, and safe error messages. Avoid scattering
raw `fetch()` calls through UI components.

### FastAPI routers

Validate request inputs, invoke service functions, and shape response
models. Keep provider logic and ML training out of route functions.

### Provider services

`open_meteo.py` and `openaq.py` contain provider-specific request logic,
response parsing, normalization, timeouts, and provider error handling.
Preserve provider IDs and source metadata.

### Analytics

Computes statistics, change, peaks, station rankings, and recommendation
inputs. It must handle empty series and undefined percentage changes.

### ML module

Owns feature engineering, training, baseline, evaluation, model
persistence, metadata, and inference. Do not retrain on each API
request.

### Report service

Retrieves or displays traceable public documents. Each report includes
source URL, publisher, date where available, source type, and factual
summary.

### Cache

Short-lived cache for repeated location/time queries. Cache keys must
include all parameters that affect the result and source. Do not cache
secrets. Use TTLs consistent with source freshness and terms.

### Optional database

PostgreSQL/Supabase stores station metadata, measurements, model runs,
forecasts, and report metadata. It is not necessary for a first working
version.

## 4. Repository Structure

``` text
breathewise/
├── frontend/
│   └── src/
│       ├── components/
│       ├── pages/Dashboard.tsx
│       ├── services/api.ts
│       ├── hooks/
│       ├── types/airQuality.ts
│       ├── App.tsx
│       └── main.tsx
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── schemas/
│   │   ├── routers/
│   │   ├── services/
│   │   ├── analytics/
│   │   ├── ml/
│   │   └── db/                 # optional
│   ├── tests/
│   ├── requirements.txt
│   └── .env.example
├── data/
│   ├── sample_observations.csv
│   └── README.md
├── docs/
│   ├── implementation_plan.md
│   ├── ml_pipeline.md
│   ├── backend_schema.md
│   ├── database_schema.md
│   └── model-card.md
├── rules.md
├── .gitignore
└── README.md
```

## 5. External Data Flow

1.  User selects coordinates and date window.
2.  Frontend sends validated-looking parameters to FastAPI; backend
    validates independently.
3.  Backend requests OpenAQ station metadata/measurements and Open-Meteo
    model data as needed.
4.  Provider payloads are normalized into canonical pollutant names,
    units, timestamps, source IDs, and data types.
5.  Analytics compute historical summaries and peaks.
6.  ML inference is run only if an appropriate trained model is
    available for the supported station/location scope.
7.  Report service returns relevant documents with source links.
8.  Backend returns a stable response schema.
9.  Frontend renders each source/type distinctly.

## 6. Provider Strategy

### Open-Meteo

Docs: <https://open-meteo.com/en/docs/air-quality-api>

Use for hourly modeled forecast data. Example query parameters include
latitude, longitude, hourly pollutant variables, forecast days, and
timezone. Verify current endpoint capabilities and terms. Never label
model output as a physical station observation.

### OpenAQ

Docs: <https://docs.openaq.org/>

Use for available station observations. OpenAQ v3 requires an API key in
the backend. Discover locations, retrieve sensors, and then query the
supported measurement endpoint. Do not confuse location IDs with sensor
IDs.

### Environmental reports

Prefer CPCB, relevant State Pollution Control Boards, official
government notices, and assessment documents. A search-provider
integration is optional. If unavailable, show a curated source explorer
rather than pretending to perform comprehensive live search.

## 7. API Boundary

Recommended routes: - `GET /api/health` - `GET /api/air-quality` -
`GET /api/forecast` - `GET /api/forecast/ml` - `GET /api/trends` -
`GET /api/hotspots` - `GET /api/reports` - `GET /api/recommendations`

Detailed parameters and response models are in `backend_schema.md`.

## 8. Reliability and Failure Modes

  -----------------------------------------------------------------------
  Failure                             Required behaviour
  ----------------------------------- -----------------------------------
  No nearby station                   Return empty station observations
                                      and explanatory status

  Pollutant absent                    Return unavailable/null; never
                                      substitute zero

  OpenAQ key missing/invalid          Safe provider error; do not leak
                                      key

  Open-Meteo timeout                  Return retryable error or cached
                                      response with freshness label

  Invalid date range                  Return 422 with safe message

  Model not trained                   Explicit unavailable status; use
                                      external forecast separately

  Model artifact corrupt              Log server-side, fail safely

  Reports unavailable                 Show curated official source links
                                      if available

  Stale cached data                   Label timestamp and freshness
                                      clearly
  -----------------------------------------------------------------------

## 9. Deployment Architecture

-   Vercel hosts the frontend.
-   Render hosts the FastAPI backend.
-   Frontend environment variable: `VITE_API_BASE_URL`.
-   Backend environment variables include `OPENAQ_API_KEY` and
    `FRONTEND_ORIGIN`.
-   CORS allows the exact deployed frontend origin.
-   Production secrets are configured in host settings, never in Git.
-   Use timeouts and caching to manage quotas and cold starts.

Guides: - <https://vercel.com/docs/frameworks/frontend/vite> -
<https://render.com/docs/deploy-fastapi>

## 10. Architecture Rules

-   No secret keys in browser code.
-   No arbitrary user-provided URL fetching by the backend.
-   No provider logic inside React components.
-   No ML training inside HTTP request handlers.
-   No unlabelled mixing of observations and forecasts.
-   No causal pollution claims without evidence.
-   No database until there is a clear persistence need.
-   Use typed request/response models and automated tests.
