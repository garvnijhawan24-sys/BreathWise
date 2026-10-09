"""
OpenAQ API v3 Historical Data Acquisition Service.
Handles fetching historical observations by sensor/station ID with time bounds, pagination,
authentication checks, rate limits, and fallback CSV ingestion.
"""
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
import httpx
import pandas as pd

from app.config import settings
from app.services.openaq import get_openaq_headers


class HistoricalDataError(Exception):
    """Custom exception for historical acquisition issues."""
    pass


async def fetch_sensor_historical_measurements(
    sensor_id: int,
    datetime_from: datetime,
    datetime_to: datetime,
    limit: int = 1000,
    max_pages: int = 5,
    client: Optional[httpx.AsyncClient] = None,
) -> List[Dict[str, Any]]:
    """
    Fetches historical measurements for a specific OpenAQ sensor.
    Enforces OPENAQ_API_KEY requirement for OpenAQ API v3.
    Returns list of dicts: [{"timestamp": datetime, "value": float, "unit": str, "sensor_id": int}]
    """
    if not settings.openaq_api_key or not settings.openaq_api_key.strip():
        raise PermissionError(
            "OpenAQ API key is not configured. Set OPENAQ_API_KEY in backend/.env to query historical data."
        )

    if datetime_from >= datetime_to:
        raise ValueError("datetime_from must be strictly earlier than datetime_to")

    url = f"{settings.openaq_base_url.rstrip('/')}/sensors/{sensor_id}/measurements"
    results: List[Dict[str, Any]] = []

    # Format ISO 8601 UTC strings
    from_iso = datetime_from.astimezone(timezone.utc).isoformat()
    to_iso = datetime_to.astimezone(timezone.utc).isoformat()

    async def _fetch_page(c: httpx.AsyncClient, page: int) -> Dict[str, Any]:
        params = {
            "datetime_from": from_iso,
            "datetime_to": to_iso,
            "limit": min(limit, 1000),
            "page": page,
        }
        resp = await c.get(
            url,
            params=params,
            headers=get_openaq_headers(),
            timeout=httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0),
        )
        resp.raise_for_status()
        return resp.json()

    for page in range(1, max_pages + 1):
        if client is not None:
            raw = await _fetch_page(client, page)
        else:
            async with httpx.AsyncClient() as new_client:
                raw = await _fetch_page(new_client, page)

        page_results = raw.get("results", [])
        if not page_results:
            break

        for item in page_results:
            val = item.get("value")
            if val is None:
                continue

            # Extract timestamp
            dt_raw = item.get("datetime")
            dt_utc = None
            if isinstance(dt_raw, dict):
                dt_utc = dt_raw.get("utc")
            elif isinstance(dt_raw, str):
                dt_utc = dt_raw
            else:
                period = item.get("period", {})
                if isinstance(period, dict):
                    dt_to = period.get("datetimeTo", {})
                    if isinstance(dt_to, dict):
                        dt_utc = dt_to.get("utc")

            if not dt_utc:
                continue

            try:
                parsed_time = pd.to_datetime(dt_utc, utc=True).to_pydatetime()
            except Exception:
                continue

            param_info = item.get("parameter", {})
            param_units = (
                param_info.get("units", "µg/m³")
                if isinstance(param_info, dict)
                else "µg/m³"
            )

            results.append({
                "timestamp": parsed_time,
                "value": float(val),
                "unit": param_units,
                "sensor_id": sensor_id,
            })

        meta = raw.get("meta", {})
        found = meta.get("found", 0)
        if len(results) >= found or len(page_results) < limit:
            break

    return results


def load_historical_observations_from_csv(
    file_path: Path | str,
    timestamp_col: str = "timestamp",
    pm25_col: str = "pm2_5",
    unit_col: Optional[str] = "unit",
    sensor_id_col: Optional[str] = "sensor_id",
) -> pd.DataFrame:
    """
    Ingests an offline historical observations CSV (e.g. CPCB station data or OpenAQ export).
    Validates presence of timestamp and PM2.5 columns, normalizes UTC timestamps.
    """
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"Historical observations file not found: {path}")

    try:
        df = pd.read_csv(path, encoding="utf-8")
    except UnicodeDecodeError:
        df = pd.read_csv(path, encoding="latin-1")
    if timestamp_col not in df.columns:
        raise ValueError(f"CSV missing mandatory timestamp column '{timestamp_col}'")
    if pm25_col not in df.columns:
        raise ValueError(f"CSV missing mandatory PM2.5 column '{pm25_col}'")

    # Standardize column names
    rename_map = {timestamp_col: "timestamp", pm25_col: "pm2_5"}
    if unit_col and unit_col in df.columns:
        rename_map[unit_col] = "unit"
    if sensor_id_col and sensor_id_col in df.columns:
        rename_map[sensor_id_col] = "sensor_id"

    standardized = df.rename(columns=rename_map)

    # Standardize types and normalize to UTC
    standardized["timestamp"] = pd.to_datetime(standardized["timestamp"], utc=True)
    standardized["pm2_5"] = pd.to_numeric(standardized["pm2_5"], errors="coerce")
    if "unit" not in standardized.columns:
        standardized["unit"] = "µg/m³"
    if "sensor_id" not in standardized.columns:
        standardized["sensor_id"] = 0

    return standardized[["timestamp", "pm2_5", "unit", "sensor_id"]].dropna(subset=["timestamp"])
