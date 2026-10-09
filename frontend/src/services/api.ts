import type { 
  HealthResponse, 
  CurrentAirQualityResponse, 
  NearbyStationsResponse, 
  StationMeasurementsResponse, 
  MLForecastResponse,
  EnvironmentalReport,
  AirQualityGridResponse,
  GeocodingSearchResponse,
} from '../types/api';


const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export async function checkBackendHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/health`, {
    signal,
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Health check failed with status: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function fetchCurrentAirQuality(
  latitude: number,
  longitude: number,
  signal?: AbortSignal
): Promise<CurrentAirQualityResponse> {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
  });

  const response = await fetch(`${API_BASE_URL}/api/air-quality/current?${params.toString()}`, {
    signal,
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    let errMessage = `HTTP ${response.status} ${response.statusText}`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail?.message) {
        errMessage = errorJson.detail.message;
      } else if (errorJson.message) {
        errMessage = errorJson.message;
      }
    } catch {
      // JSON parse failed, use fallback
    }
    throw new Error(errMessage);
  }

  return response.json();
}

export async function fetchNearbyStations(
  latitude: number,
  longitude: number,
  radiusKm: number = 25,
  signal?: AbortSignal
): Promise<NearbyStationsResponse> {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    radius_km: radiusKm.toString(),
  });

  const response = await fetch(`${API_BASE_URL}/api/stations/nearby?${params.toString()}`, {
    signal,
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    let errMessage = `HTTP ${response.status} ${response.statusText}`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail?.message) {
        errMessage = errorJson.detail.message;
      } else if (errorJson.message) {
        errMessage = errorJson.message;
      }
    } catch {
      // JSON parse failed, use fallback
    }
    throw new Error(errMessage);
  }

  return response.json();
}

export async function fetchStationMeasurements(
  stationId: number,
  signal?: AbortSignal
): Promise<StationMeasurementsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/stations/${stationId}/measurements`, {
    signal,
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    let errMessage = `HTTP ${response.status} ${response.statusText}`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail?.message) {
        errMessage = errorJson.detail.message;
      } else if (errorJson.message) {
        errMessage = errorJson.message;
      }
    } catch {
      // JSON parse failed, use fallback
    }
    throw new Error(errMessage);
  }

  return response.json();
}

export async function fetchMLForecast(
  stationId?: number,
  hours: number = 24,
  signal?: AbortSignal,
  seedPm25?: number
): Promise<MLForecastResponse> {
  const params = new URLSearchParams({
    hours: hours.toString(),
  });
  if (stationId !== undefined) {
    params.set('station_id', stationId.toString());
  }
  if (seedPm25 !== undefined) {
    params.set('seed_pm25', seedPm25.toString());
  }

  const response = await fetch(`${API_BASE_URL}/api/forecast/ml?${params.toString()}`, {
    signal,
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    let errMessage = `HTTP ${response.status} ${response.statusText}`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail?.message) {
        errMessage = errorJson.detail.message;
      } else if (errorJson.message) {
        errMessage = errorJson.message;
      }
    } catch {
      // JSON parse failed, use fallback
    }
    throw new Error(errMessage);
  }

  return response.json();
}

export async function fetchEnvironmentalReport(
  latitude: number,
  longitude: number,
  radiusMeters: number = 25000,
  signal?: AbortSignal
): Promise<EnvironmentalReport> {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    radius_meters: radiusMeters.toString(),
  });

  const response = await fetch(`${API_BASE_URL}/api/reports?${params.toString()}`, {
    signal,
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    let errMessage = `HTTP ${response.status} ${response.statusText}`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail?.message) {
        errMessage = errorJson.detail.message;
      } else if (errorJson.message) {
        errMessage = errorJson.message;
      }
    } catch {
      // JSON parse failed
    }
    throw new Error(errMessage);
  }

  return response.json();
}

export function getReportExportUrl(
  latitude: number,
  longitude: number,
  radiusMeters: number = 25000,
  format: string = 'csv'
): string {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    radius_meters: radiusMeters.toString(),
    format,
  });
  return `${API_BASE_URL}/api/reports/export?${params.toString()}`;
}

export async function fetchAirQualityGrid(
  latitude: number,
  longitude: number,
  radiusKm: number = 25,
  gridSize: number = 4,
  signal?: AbortSignal
): Promise<AirQualityGridResponse> {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    radius_km: radiusKm.toString(),
    grid_size: gridSize.toString(),
  });
  const response = await fetch(`${API_BASE_URL}/api/air-quality/grid?${params.toString()}`, {
    signal,
    headers: { 'Accept': 'application/json' },
  });
  if (!response.ok) {
    let errMessage = `HTTP ${response.status} ${response.statusText}`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail?.message) errMessage = errorJson.detail.message;
    } catch {
      // ignore
    }
    throw new Error(errMessage);
  }
  return response.json();
}

export async function searchLocations(
  query: string,
  count: number = 5,
  signal?: AbortSignal
): Promise<GeocodingSearchResponse> {
  const params = new URLSearchParams({
    q: query,
    count: count.toString(),
  });
  const response = await fetch(`${API_BASE_URL}/api/geocoding/search?${params.toString()}`, {
    signal,
    headers: { 'Accept': 'application/json' },
  });
  if (!response.ok) {
    let errMessage = `HTTP ${response.status} ${response.statusText}`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail?.message) errMessage = errorJson.detail.message;
    } catch {
      // ignore
    }
    throw new Error(errMessage);
  }
  return response.json();
}



