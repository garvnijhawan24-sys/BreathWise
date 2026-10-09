# BreatheWise --- Implementation Plan

**Project:** Real-Time Air Quality Monitoring and Prediction for
User-Selected Regions\
**Purpose:** Code Nexus club recruitment technical task\
**Timeline:** 3--5 days\
**Level:** Intermediate\
**Delivery:** Localhost and live deployment\
**Product name:** BreatheWise --- Air Quality Intelligence & Forecasting

## 1. Product Goal

Build a location-based air-quality intelligence platform that helps a
user understand available pollutant data, historical changes, likely
future conditions, documented environmental issues, and practical ways
to reduce exposure.

The product should answer: 1. What air-quality information is available
for this region? 2. How have pollutant levels changed over a selected
time window? 3. What might happen in the next 24--72 hours? 4. How
reliable is the available information? 5. Are there relevant public
environmental reports or official notices? 6. What practical actions are
appropriate given the available data?

**Core principle:** distinguish physical monitoring-station observations
from atmospheric-model forecasts and local ML predictions. Never invent
measurements, source claims, or model metrics.

## 2. Exact Feature Scope

### P0 --- Required

-   Location search and interactive map selection.
-   Capture latitude/longitude and optionally configure a search radius.
-   Date/time window selection for historical analysis.
-   Display available PM2.5, PM10, NO₂, SO₂ and O₃ values.
-   External forecast timeline for a supported horizon.
-   Historical trend charts and summary statistics.
-   Source, timestamp, unit, and data-availability labels.
-   Loading, empty-data, stale-data, and error states.
-   FastAPI backend with input validation, provider timeouts, and basic
    caching.
-   Responsive UI and deployment instructions.

### P1 --- Technical differentiators

-   PM2.5 ML forecasting when sufficient consistent historical data
    exists.
-   Baseline-versus-model evaluation with MAE/RMSE.
-   Trend direction and peak detection.
-   Nearby station ranking when comparable measurements exist.
-   Environmental report explorer with source links and dates.
-   Rules-based recommendations based on observations/forecasts.
-   Explicit uncertainty or a statement that uncertainty is not
    calibrated.

### P2 --- Optional polish

-   CSV export.
-   Two-location comparison.
-   Recent-location history.
-   Downloadable summary report.
-   Sample data for reproducible offline demos.
-   PostgreSQL/Supabase persistence if useful.

### Do not prioritize for a 3--5 day deadline

-   Deep learning.
-   A crawler of every environmental website.
-   Unsupported causal attribution to a factory or road.
-   Forecasting every pollutant with separate models before PM2.5 works.
-   Authentication or complex user management unless required.
-   A database merely for the sake of using one.

## 3. Technology Stack

  -----------------------------------------------------------------------
  Layer                   Technology              Purpose
  ----------------------- ----------------------- -----------------------
  Frontend                React + Vite +          UI and interaction
                          TypeScript              

  Styling                 Tailwind CSS            Responsive styling

  Maps                    Leaflet + React         Location selection and
                          Leaflet + OpenStreetMap station markers
                          tiles                   

  Charts                  Recharts                Historical and forecast
                                                  plots

  Icons                   Lucide React            UI icons

  Backend                 Python + FastAPI        Validation,
                                                  integrations, business
                                                  logic

  HTTP                    HTTPX                   External requests with
                                                  timeouts

  Data                    Pandas + NumPy          Cleaning, aggregation,
                                                  features

  ML                      scikit-learn            Baseline and Random
                                                  Forest

  Model artifact          joblib                  Persist trusted model

  Tests                   pytest + FastAPI        API/unit tests
                          TestClient              

  Forecast                Open-Meteo Air Quality  Hourly
                          API                     atmospheric-model
                                                  forecasts

  Observations            OpenAQ API              Available
                                                  station/sensor
                                                  measurements

  Environmental evidence  CPCB, State Pollution   Traceable public
                          Control Boards,         information
                          official reports;       
                          optional search         
                          provider                

  Database                Optional                Persistence and cache
                          PostgreSQL/Supabase     

  Hosting                 Vercel frontend +       Public deployment
                          Render backend          

  Version control         Git + GitHub            Code history and
                                                  submission
  -----------------------------------------------------------------------

Avoid a database at first if on-demand API calls and short-lived caching
satisfy the task.

## 4. Data Source Plan

### Open-Meteo

Docs: <https://open-meteo.com/en/docs/air-quality-api>

Use for a working hourly forecast experience. Available variables can
include PM2.5, PM10, nitrogen dioxide, sulphur dioxide, and ozone.
Verify current supported variables, horizons, historical options, and
terms during implementation.

Example request:

``` http
GET https://air-quality-api.open-meteo.com/v1/air-quality
    ?latitude=13.0827
    &longitude=80.2707
    &hourly=pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone
    &forecast_days=5
    &timezone=Asia%2FKolkata
```

Coordinates are an illustrative Chennai example. Label returned values
as model output, not sensor observations. Preserve source and data type,
validate response structure, set timeouts, and handle absent arrays
without replacing missing values with zero.

### OpenAQ

Docs: <https://docs.openaq.org/>

OpenAQ v3 requires an API key. Keep it server-side and send it in
`X-API-Key`. Verify current endpoint parameters in the official docs.

Illustrative nearby-location query:

``` http
GET https://api.openaq.org/v3/locations
    ?coordinates=13.0827,80.2707
    &radius=10000
    &limit=100
X-API-Key: <server-side secret>
```

Integration sequence: 1. Find nearby monitoring locations. 2. Retrieve
location and sensor metadata. 3. Map sensor parameters to canonical
pollutant names. 4. Fetch supported hourly/historical measurements. 5.
Normalize units and timestamps. 6. Preserve provider IDs and source
metadata. 7. Return station observations separately from forecasts.

A location ID is not necessarily a sensor ID. If no station is
available, show an empty observation state while still allowing a
separately labeled model forecast.

### Environmental reports

Prioritize CPCB, relevant State Pollution Control Boards, government
environmental notices, official assessments, and clearly labeled
reputable news sources. Each report should include title, publisher,
publication date where available, region relevance, issue category,
factual summary, source URL, and source type. If live search is not
available, show curated official links and describe the module
accurately.

Do not claim a violation or causation unless the source supports that
exact claim.

## 5. UI Plan

Suggested design: light background, blue accents, clear typography,
responsive cards.

Dashboard sections: 1. Header and product identity. 2. Location search,
map, and radius. 3. Date-range and pollutant filters. 4. Pollutant
summary cards. 5. Historical trend chart. 6. Forecast chart with clear
forecast boundary. 7. Nearby station/hotspot list. 8. Environmental
reports. 9. Recommendations. 10. Source/model limitations footer.

All sections should respond to location selection. Include loading,
empty, error, retry, last-updated, and source-attribution states. Keep
units visible and use AQI categories only when applying the correct
jurisdiction-specific method.

## 6. Five-Day Milestones

### Day 1 --- Foundation

-   Create GitHub repo.
-   Scaffold React/Vite/TypeScript.
-   Create FastAPI and `/api/health`.
-   Integrate Open-Meteo.
-   Show real API data on the dashboard.
-   Commit working foundation.

**Deliverable:** frontend receives real data through backend.

### Day 2 --- Location and observations

-   Add Leaflet map.
-   Add date-range controls.
-   Integrate OpenAQ location/sensor metadata and readings.
-   Normalize units and timestamps.
-   Add historical charts and empty-data states.

**Deliverable:** location selection updates dashboard and available
station data.

### Day 3 --- Analytics and ML

-   Add trend/peak calculations.
-   Prepare suitable hourly PM2.5 history.
-   Implement persistence baseline.
-   Train/evaluate Random Forest with chronological split.
-   Show MAE/RMSE and actual-versus-predicted chart.
-   If data is inadequate, keep external forecast as primary and
    document the limitation.

**Deliverable:** evaluated model or honest data-limited fallback.

### Day 4 --- Differentiation and hardening

-   Add station rankings.
-   Add source-backed environmental reports.
-   Add rules-based recommendations.
-   Add provider timeouts, caching, and tests.
-   Review security and Git history.

**Deliverable:** useful intelligence beyond a basic dashboard.

### Day 5 --- Deployment

-   Deploy backend to Render.
-   Deploy frontend to Vercel.
-   Configure environment variables and CORS.
-   Test public endpoints and multiple locations.
-   Finish README, screenshots, model card, and demo.

**Deliverable:** working local setup, live website, and submission
documentation.

### Three-day fallback

-   Day 1: skeleton, Open-Meteo, map, dashboard.
-   Day 2: OpenAQ, trends, baseline/ML if data supports it,
    recommendations.
-   Day 3: deployment, tests, README, demo.

Cut automated report search and persistence before cutting data
provenance, error handling, or deployment.

## 7. Local Setup

Assumes Windows PowerShell; adapt activation syntax on other operating
systems.

### Frontend

``` powershell
mkdir breathewise
cd breathewise
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install leaflet react-leaflet recharts lucide-react
npm install -D tailwindcss @tailwindcss/vite
npm run dev
```

Configure Tailwind using the current Vite integration instructions and
import Leaflet CSS.

### Backend

Open another terminal at repository root:

``` powershell
mkdir backend
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install fastapi "uvicorn[standard]" httpx pandas numpy scikit-learn joblib pytest
pip freeze > requirements.txt
```

Create `backend/app/main.py`:

``` python
from fastapi import FastAPI

app = FastAPI(title="BreatheWise API")

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "breathewise"}
```

Run from the backend directory:

``` powershell
uvicorn app.main:app --reload --port 8000
```

Verify `http://127.0.0.1:8000/api/health` and
`http://127.0.0.1:8000/docs`.

### Environment templates

`backend/.env.example`:

``` dotenv
OPENAQ_API_KEY=replace_me
FRONTEND_ORIGIN=http://localhost:5173
```

`frontend/.env.example`:

``` dotenv
VITE_API_BASE_URL=http://localhost:8000
```

Real `.env` files must be ignored by Git. Never put OpenAQ credentials
in a `VITE_` variable.

## 8. Deployment

### Render backend

-   Connect GitHub repository.
-   Root directory: `backend`.
-   Build: `pip install -r requirements.txt`.
-   Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
-   Configure backend secrets and frontend origin in hosting settings.
-   Test `/api/health` and `/docs`.

Guide: <https://render.com/docs/deploy-fastapi>

### Vercel frontend

-   Import repository.
-   Root directory: `frontend`.
-   Build: `npm run build`.
-   Output: `dist`.
-   Set `VITE_API_BASE_URL` to the actual Render backend URL.
-   Deploy and verify.

Guide: <https://vercel.com/docs/frameworks/frontend/vite>

Production checks: - CORS allows the exact frontend origin. - No key is
exposed in browser assets. - Backend has required dependencies/model
artifacts. - Provider calls have timeouts. - Errors show useful UI
feedback. - First request may be slow if backend hosting sleeps while
idle.

## 9. Testing Checklist

### API/provider

-   Health returns 200.
-   Invalid coordinates return 422.
-   Provider timeout is handled.
-   Malformed provider payload does not crash API.
-   Missing pollutants remain null/unavailable.
-   Valid no-data requests show an empty state.
-   Location IDs and sensor IDs are handled correctly.
-   Duplicate measurements are deduplicated.

### Analytics

-   Mean/min/max work on known data.
-   Empty data returns null statistics and zero count.
-   Percentage change handles zero baseline.
-   Timestamps are sorted and timezone-aware.
-   Hourly alignment and gap policy are tested.

### ML

-   No future leakage in features.
-   Chronological split is used.
-   Metrics are finite for valid test data.
-   Model is compared with persistence baseline.
-   Untrained/missing model returns unavailable status.
-   Forecast horizon matches API contract.

### UI

-   Map selection updates coordinates.
-   Date filter refreshes charts.
-   Forecast and observations are visibly distinct.
-   Missing data does not break UI.
-   Report links work.
-   Mobile layout is usable.

### Deployment/security

-   No secrets in frontend bundle or Git history.
-   Production CORS works.
-   Public frontend reaches backend.
-   Environment variables are configured correctly.
-   Logs do not expose credentials.

## 10. Submission Deliverables

1.  GitHub repository with clean history.
2.  Live frontend URL.
3.  Backend health/API URL.
4.  README with setup, architecture, sources, ML, metrics, limitations,
    deployment.
5.  Architecture diagram.
6.  Screenshots.
7.  Model evaluation and model card.
8.  Short demo video if permitted.
9.  `rules.md`.

Demo sequence: select region; show available observations and source;
change date range; show forecast source; show ML baseline and metrics;
compare stations; open environmental report; show recommendation and an
empty/error state.

## 11. Final Priorities

1.  End-to-end working app.
2.  Reliable real data and map.
3.  Historical analysis and evaluated ML.
4.  Traceable reports and useful recommendations.
5.  Deployment, tests, and documentation.

A small, honest, reliable system is stronger than many unfinished
features.
