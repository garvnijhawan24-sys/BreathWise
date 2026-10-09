# BreatheWise — Production Deployment Guide

This guide details the preparation and deployment process for BreatheWise:
- **FastAPI Backend:** Deployed to **Render** as a Python Web Service
- **React Frontend:** Deployed to **Vercel** as a static Single Page Application (SPA)

> **Important Deployment Principle:**
> Do NOT deploy publicly until authorization is explicitly confirmed. Ensure no real API keys, secrets, or `.env` files are tracked in version control.

---

## 1. System Architecture Overview

```
                                  +---------------------------+
                                  |   Vercel Edge Network     |
                                  |   (React 19 + Vite SPA)   |
                                  +-------------+-------------+
                                                |
                                    HTTPS REST Requests
                                    (VITE_API_BASE_URL)
                                                v
                                  +-------------+-------------+
                                  |    Render Web Service     |
                                  |   (FastAPI + Uvicorn)     |
                                  +------+-------------+------+
                                         |             |
                   +---------------------+             +---------------------+
                   v                                                         v
    +--------------+---------------+                          +--------------+---------------+
    |  Open-Meteo Air Quality API  |                          |      OpenAQ API v3           |
    |  (Atmospheric Model Data)    |                          |  (Physical Ground Stations)  |
    |  Attribution: CC BY 4.0      |                          |  Attribution: CC BY 4.0      |
    +------------------------------+                          +------------------------------+
```

---

## 2. Backend Deployment: Render

The FastAPI backend is defined in `render.yaml` or can be created manually via the Render dashboard.

### 2.1 Option A: Blueprint Deployment (`render.yaml`)
1. Connect your Git repository to Render.
2. Navigate to **Blueprints** and click **New Blueprint Instance**.
3. Select the BreatheWise repository. Render automatically reads `render.yaml`.
4. Render provisions the `breathewise-backend` web service.

### 2.2 Option B: Manual Web Service Setup
1. Log in to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** > **Web Service**.
3. Select your repository.
4. Configure service settings:
   - **Name:** `breathewise-backend`
   - **Root Directory:** `backend`
   - **Runtime:** `Python`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path:** `/api/health`
5. Configure Environment Variables in the **Environment** tab:

| Variable Name | Recommended Value | Notes |
| :--- | :--- | :--- |
| `APP_ENV` | `production` | Enables production mode |
| `APP_NAME` | `BreatheWise` | Application identifier |
| `LOG_LEVEL` | `INFO` | Standard logging |
| `CORS_ORIGINS` | `https://your-app.vercel.app,http://localhost:5173` | Comma-separated list of authorized client origins |
| `OPEN_METEO_AIR_QUALITY_BASE_URL` | `https://air-quality-api.open-meteo.com/v1/air-quality` | Upstream atmospheric model provider |
| `OPENAQ_BASE_URL` | `https://api.openaq.org/v3` | Upstream ground station provider |
| `OPENAQ_API_KEY` | *(Secret value)* | Set securely in Render dashboard. Never commit to Git |
| `ML_MODEL_ENABLED` | `false` | Kept false until a validated historical model is trained |
| `MODEL_PATH` | `backend/models/air_quality_model.joblib` | Model path |

---

## 3. Frontend Deployment: Vercel

The React/Vite frontend uses `frontend/vercel.json` for SPA client-side routing.

### 3.1 Setup via Vercel Dashboard
1. Log in to [Vercel Dashboard](https://vercel.com).
2. Click **Add New...** > **Project**.
3. Import the BreatheWise Git repository.
4. Set the **Root Directory** to `frontend`.
5. Framework Preset will auto-detect **Vite**.
6. Build and Output Settings:
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
7. Environment Variables:
   - Add `VITE_API_BASE_URL`: The full URL of your Render backend service, e.g. `https://breathewise-backend.onrender.com` (no trailing slash).
8. Click **Deploy**.

---

## 4. Synchronizing CORS & Domain Configuration

Cross-Origin Resource Sharing (CORS) must be synchronized between the frontend and backend:

1. Obtain your frontend domain from Vercel (e.g., `https://breathewise.vercel.app` or a custom domain).
2. In the Render backend service settings:
   - Update `CORS_ORIGINS` to include the exact Vercel URL:
     ```
     CORS_ORIGINS=https://breathewise.vercel.app,http://localhost:5173
     ```
3. In local development:
   - Default allows `http://localhost:5173`.
   - Backend gracefully accepts comma-separated origins without wildcards in production.

---

## 5. Security & Secret Safeguards

- **No Secrets in Git:**
  - `OPENAQ_API_KEY`, Supabase keys, or passwords must never exist in repository files or frontend client code.
  - The repository's `.gitignore` explicitly excludes `.env`, `*.env`, `backend/models/*.json`, and cache files.
- **Client Bundles:**
  - Only variables prefixed with `VITE_` are bundled into the frontend.
  - Never prefix sensitive tokens or private keys with `VITE_`.
- **Health Check Protection:**
  - `/api/health` discloses only operational status strings (`operational`, `disabled`, `model_not_trained`), never secrets or sensitive paths.

---

## 6. Pre-Flight Verification Checklist

Before releasing the deployment to users, complete this checklist:

- [ ] **1. Backend Health Check:**
  - Request `GET https://<render-url>/api/health`
  - Expect HTTP 200 with JSON:
    ```json
    {
      "status": "healthy",
      "service": "breathewise-backend",
      "environment": "production",
      "version": "0.5.0",
      "features": {
        "open_meteo": "operational",
        "openaq": "operational",
        "ml_predictions": "model_not_trained",
        "database": "disabled",
        "reports": "operational"
      }
    }
    ```

- [ ] **2. Atmospheric Model Endpoint:**
  - Request `GET https://<render-url>/api/air-quality/current?latitude=13.0827&longitude=80.2707`
  - Verify EAQI, USAQI, 6 pollutants, and CC BY 4.0 attribution.

- [ ] **3. Ground Station Endpoint:**
  - Request `GET https://<render-url>/api/stations/nearby?latitude=13.0827&longitude=80.2707&radius_km=25`
  - If `OPENAQ_API_KEY` is configured: returns station list.
  - If `OPENAQ_API_KEY` is missing: returns HTTP 401 with informative notice; other services remain functional.

- [ ] **4. ML Forecast Status:**
  - Request `GET https://<render-url>/api/forecast/ml?hours=24`
  - Verify `status: "model_not_trained"` and that no synthetic or unvalidated predictions are presented.

- [ ] **5. Environmental Report & CSV Export:**
  - Request `GET https://<render-url>/api/reports?latitude=13.0827&longitude=80.2707`
  - Request `GET https://<render-url>/api/reports/export?latitude=13.0827&longitude=80.2707&format=csv`
  - Confirm file download, RFC 4180 parsing, and CC BY 4.0 attribution for both Open-Meteo and OpenAQ.

- [ ] **6. Frontend Integration:**
  - Open Vercel URL in browser.
  - Verify header reports `FastAPI Online`.
  - Enter coordinates and click "Fetch Air Quality".
  - Click "Environmental Report", test printable preview and CSV download.
  - Verify browser DevTools console has zero CORS or network errors.
