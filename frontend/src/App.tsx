import React, { useEffect, useState, useRef, useId } from 'react';
import { 
  Wind, 
  AlertCircle, 
  RefreshCw, 
  MapPin, 
  Clock, 
  CloudSun, 
  Compass, 
  Sparkles,
  Radio,
  Building2,
  Navigation,
  KeyRound,
  Cpu,
  TrendingUp,
  FileText,
  Download,
  Printer,
  X,
} from 'lucide-react';

import { 
  checkBackendHealth, 
  fetchCurrentAirQuality, 
  fetchNearbyStations, 
  fetchStationMeasurements,
  fetchMLForecast,
  fetchEnvironmentalReport,
  getReportExportUrl,
} from './services/api';
import type { 
  HealthResponse, 
  CurrentAirQualityResponse, 
  PollutantValue,
  StationSummary,
  StationMeasurementsResponse,
  MLForecastResponse,
  EnvironmentalReport,
} from './types/api';


// Verified Preset Coordinates for Quick Selection
const PRESET_LOCATIONS = [
  { name: 'Chennai, India', lat: 13.0827, lon: 80.2707 },
  { name: 'New Delhi, India', lat: 28.6139, lon: 77.2090 },
  { name: 'London, UK', lat: 51.5074, lon: -0.1278 },
  { name: 'New York, USA', lat: 40.7128, lon: -74.0060 },
  { name: 'Tokyo, Japan', lat: 35.6762, lon: 139.6503 },
];

export const App: React.FC = () => {
  const latInputId = useId();
  const lonInputId = useId();
  const radiusInputId = useId();

  // Backend Health State
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Location Coordinate State
  const [latitude, setLatitude] = useState<string>('13.0827');
  const [longitude, setLongitude] = useState<string>('80.2707');
  const [radiusKm, setRadiusKm] = useState<number>(25);
  const [coordError, setCoordError] = useState<string | null>(null);

  // Open-Meteo Air Quality Data State
  const [aqData, setAqData] = useState<CurrentAirQualityResponse | null>(null);
  const [aqLoading, setAqLoading] = useState<boolean>(false);
  const [aqError, setAqError] = useState<string | null>(null);
  const [displayedCoords, setDisplayedCoords] = useState<{ lat: number; lon: number } | null>(null);

  // OpenAQ Ground Stations State
  const [stations, setStations] = useState<StationSummary[]>([]);
  const [stationsLoading, setStationsLoading] = useState<boolean>(false);
  const [stationsError, setStationsError] = useState<string | null>(null);
  const [selectedStation, setSelectedStation] = useState<StationSummary | null>(null);

  // Station Measurements State
  const [measurementsData, setMeasurementsData] = useState<StationMeasurementsResponse | null>(null);
  const [measurementsLoading, setMeasurementsLoading] = useState<boolean>(false);
  const [measurementsError, setMeasurementsError] = useState<string | null>(null);

  // Local ML Forecast State
  const [mlForecast, setMlForecast] = useState<MLForecastResponse | null>(null);
  const [mlLoading, setMlLoading] = useState<boolean>(false);
  const [mlError, setMlError] = useState<string | null>(null);

  // Environmental Report State
  const [report, setReport] = useState<EnvironmentalReport | null>(null);
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);

  // Request sequence guards (AbortControllers) to prevent race conditions on rapid switching
  const aqAbortRef = useRef<AbortController | null>(null);
  const stationsAbortRef = useRef<AbortController | null>(null);
  const measurementsAbortRef = useRef<AbortController | null>(null);
  const mlAbortRef = useRef<AbortController | null>(null);
  const reportAbortRef = useRef<AbortController | null>(null);

  // Generate Environmental Report with graceful cancellation
  const handleGenerateReport = async () => {
    const lat = parseFloat(latitude.trim());
    const lon = parseFloat(longitude.trim());

    if (isNaN(lat) || lat < -90 || lat > 90) {
      setCoordError('Latitude must be a valid number between -90.0 and 90.0');
      return;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      setCoordError('Longitude must be a valid number between -180.0 and 180.0');
      return;
    }

    if (reportAbortRef.current) {
      reportAbortRef.current.abort();
    }
    const controller = new AbortController();
    reportAbortRef.current = controller;

    setReportLoading(true);
    setReportError(null);
    setIsReportModalOpen(true);

    try {
      const rep = await fetchEnvironmentalReport(lat, lon, radiusKm * 1000, controller.signal);
      setReport(rep);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setReportError(err instanceof Error ? err.message : 'Failed to generate environmental report.');
    } finally {
      setReportLoading(false);
    }
  };


  // Check backend health
  const verifyHealth = async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const data = await checkBackendHealth();
      setHealth(data);
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : 'Backend connection failed');
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  };

  // Fetch current Open-Meteo air quality with race cancellation
  const loadAirQuality = async (latStr: string, lonStr: string) => {
    const lat = parseFloat(latStr.trim());
    const lon = parseFloat(lonStr.trim());

    if (isNaN(lat) || lat < -90 || lat > 90) {
      setCoordError('Latitude must be a valid number between -90.0 and 90.0');
      return;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      setCoordError('Longitude must be a valid number between -180.0 and 180.0');
      return;
    }

    setCoordError(null);

    // Cancel in-flight Open-Meteo request
    if (aqAbortRef.current) {
      aqAbortRef.current.abort();
    }
    const controller = new AbortController();
    aqAbortRef.current = controller;

    setAqLoading(true);
    setAqError(null);

    try {
      const result = await fetchCurrentAirQuality(lat, lon, controller.signal);
      setAqData(result);
      setDisplayedCoords({ lat, lon });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return; // Discard superseded request silently
      }
      setAqError(err instanceof Error ? err.message : 'Failed to retrieve air quality data');
      setAqData(null);
      setDisplayedCoords(null);
    } finally {
      setAqLoading(false);
    }
  };

  // Discover OpenAQ Ground Stations with race cancellation
  const loadNearbyStations = async (latStr: string, lonStr: string, radKm: number) => {
    const lat = parseFloat(latStr.trim());
    const lon = parseFloat(lonStr.trim());
    if (isNaN(lat) || isNaN(lon)) return;

    // Cancel in-flight stations request
    if (stationsAbortRef.current) {
      stationsAbortRef.current.abort();
    }
    const controller = new AbortController();
    stationsAbortRef.current = controller;

    setStationsLoading(true);
    setStationsError(null);
    setSelectedStation(null);
    setMeasurementsData(null);

    try {
      const result = await fetchNearbyStations(lat, lon, radKm, controller.signal);
      setStations(result.stations);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStationsError(err instanceof Error ? err.message : 'Failed to retrieve ground stations');
      setStations([]);
    } finally {
      setStationsLoading(false);
    }
  };

  // Fetch specific station measurements with race cancellation
  const loadStationMeasurements = async (station: StationSummary) => {
    setSelectedStation(station);

    if (measurementsAbortRef.current) {
      measurementsAbortRef.current.abort();
    }
    const controller = new AbortController();
    measurementsAbortRef.current = controller;

    setMeasurementsLoading(true);
    setMeasurementsError(null);

    try {
      const data = await fetchStationMeasurements(station.id, controller.signal);
      setMeasurementsData(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setMeasurementsError(err instanceof Error ? err.message : 'Failed to retrieve station measurements');
      setMeasurementsData(null);
    } finally {
      setMeasurementsLoading(false);
    }

    // Load ML forecast for selected station
    loadMLForecast(station.id);
  };

  // Fetch local ML forecast with race cancellation
  const loadMLForecast = async (stationId?: number) => {
    if (mlAbortRef.current) {
      mlAbortRef.current.abort();
    }
    const controller = new AbortController();
    mlAbortRef.current = controller;

    setMlLoading(true);
    setMlError(null);

    try {
      const data = await fetchMLForecast(stationId, 24, controller.signal);
      setMlForecast(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setMlError(err instanceof Error ? err.message : 'Failed to retrieve ML forecast status');
      setMlForecast(null);
    } finally {
      setMlLoading(false);
    }
  };

  // Load all data for coordinates
  const refreshAllData = (latStr: string, lonStr: string, radKm: number) => {
    loadAirQuality(latStr, lonStr);
    loadNearbyStations(latStr, lonStr, radKm);
    loadMLForecast(selectedStation?.id);
  };

  useEffect(() => {
    verifyHealth();
    refreshAllData(latitude, longitude, radiusKm);
    return () => {
      aqAbortRef.current?.abort();
      stationsAbortRef.current?.abort();
      measurementsAbortRef.current?.abort();
      mlAbortRef.current?.abort();
    };
  }, []);


  const handleCoordinateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    refreshAllData(latitude, longitude, radiusKm);
  };

  const handlePresetSelect = (preset: typeof PRESET_LOCATIONS[0]) => {
    setLatitude(preset.lat.toString());
    setLongitude(preset.lon.toString());
    refreshAllData(preset.lat.toString(), preset.lon.toString(), radiusKm);
  };

  // Helper for AQI category badge colors
  const getAqiColorClasses = (category: string) => {
    switch (category) {
      case 'Good':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Fair':
      case 'Moderate':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'Poor':
      case 'Unhealthy for Sensitive Groups':
        return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'Very Poor':
      case 'Unhealthy':
      case 'Very Unhealthy':
      case 'Hazardous':
      case 'Extremely Poor':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white shadow-xs">
              <Wind className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                BreatheWise
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  Phase 5 Environmental Intelligence
                </span>
              </h1>
              <p className="text-xs text-slate-500">Multi-Source Air Quality: Atmospheric Models • Ground Stations • Environmental Reports</p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              onClick={handleGenerateReport}
              disabled={reportLoading}
              className="inline-flex items-center px-3 py-1.5 border border-blue-600 text-xs font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
              title="Generate comprehensive, printable environmental report with CSV export"
            >
              <FileText className="w-3.5 h-3.5 mr-1.5" />
              Environmental Report
            </button>
            <button
              onClick={() => {
                verifyHealth();
                refreshAllData(latitude, longitude, radiusKm);
              }}
              disabled={aqLoading || stationsLoading || healthLoading}
              className="inline-flex items-center px-3 py-1.5 border border-slate-300 text-xs font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${aqLoading || stationsLoading ? 'animate-spin' : ''}`} />
              Refresh Data
            </button>
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600 border-l border-slate-200 pl-3">
              {health?.status === 'healthy' ? (
                <span className="inline-flex items-center text-emerald-700 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 mr-1.5"></span>
                  FastAPI Online
                </span>
              ) : (
                <span className="inline-flex items-center text-rose-600 font-medium">
                  <span className="w-2 h-2 rounded-full bg-rose-500 mr-1.5 animate-pulse"></span>
                  FastAPI Offline
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full space-y-8">
        
        {/* Backend Status Notice if down */}
        {healthError && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-900">Backend Server Unreachable</p>
              <p className="mt-0.5">{healthError}</p>
              <p className="mt-1 text-slate-600">
                Ensure the FastAPI backend is running locally on port 8000 (<code>uvicorn app.main:app --reload --port 8000</code>).
              </p>
            </div>
          </div>
        )}

        {/* Location Selector Card */}
        <section aria-labelledby="location-heading" className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 id="location-heading" className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <MapPin className="w-4.5 h-4.5 text-blue-600" />
                Select Geographic Region
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Coordinates are queried against Open-Meteo model grid and OpenAQ station radius
              </p>
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-slate-400 font-medium mr-1 flex items-center gap-1">
                <Compass className="w-3.5 h-3.5" /> Presets:
              </span>
              {PRESET_LOCATIONS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => handlePresetSelect(preset)}
                  className="px-2.5 py-1 text-xs font-medium rounded-md bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                >
                  {preset.name.split(',')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Coordinate Form */}
          <form onSubmit={handleCoordinateSubmit} className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
            <div>
              <label htmlFor={latInputId} className="block text-xs font-medium text-slate-700">Latitude (-90.0 to 90.0)</label>
              <input
                id={latInputId}
                type="number"
                step="any"
                required
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="13.0827"
                className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-md shadow-2xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
              />
            </div>
            <div>
              <label htmlFor={lonInputId} className="block text-xs font-medium text-slate-700">Longitude (-180.0 to 180.0)</label>
              <input
                id={lonInputId}
                type="number"
                step="any"
                required
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="80.2707"
                className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-md shadow-2xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
              />
            </div>
            <div>
              <label htmlFor={radiusInputId} className="block text-xs font-medium text-slate-700">Ground Station Radius</label>
              <select
                id={radiusInputId}
                value={radiusKm}
                onChange={(e) => setRadiusKm(parseInt(e.target.value, 10))}
                className="mt-1 block w-full px-3 py-2 text-xs border border-slate-300 rounded-md shadow-2xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value={10}>10 km</option>
                <option value={25}>25 km (Default)</option>
                <option value={50}>50 km</option>
                <option value={100}>100 km</option>
              </select>
            </div>
            <div>
              <button
                type="submit"
                disabled={aqLoading || stationsLoading}
                className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-xs font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors shadow-2xs cursor-pointer"
              >
                {aqLoading || stationsLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Querying Providers...
                  </>
                ) : (
                  'Query Environmental Data'
                )}
              </button>
            </div>
          </form>

          {coordError && (
            <p className="text-xs text-rose-600 mt-2 flex items-center gap-1 font-medium">
              <AlertCircle className="w-3.5 h-3.5" /> {coordError}
            </p>
          )}
        </section>

        {/* ========================================================================= */}
        {/* SECTION 1: Open-Meteo Atmospheric Model Estimates                        */}
        {/* ========================================================================= */}
        <section aria-labelledby="model-heading" className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div>
              <h2 id="model-heading" className="text-base font-bold text-slate-900 flex items-center gap-2">
                <CloudSun className="w-5 h-5 text-blue-600" />
                Atmospheric Model Estimates
              </h2>
              <p className="text-xs text-slate-500">
                Hourly numerical forecasts and estimates provided by Open-Meteo Air Quality API
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200">
              Provider: Open-Meteo
            </span>
          </div>

          {aqError && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-center text-xs text-rose-900 shadow-xs">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
              <h3 className="text-sm font-semibold text-rose-900">Model Query Failed</h3>
              <p className="mt-1 text-rose-700">{aqError}</p>
            </div>
          )}

          {aqLoading && !aqData && (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500 shadow-xs">
              <RefreshCw className="w-8 h-8 text-blue-500 mx-auto mb-3 animate-spin" />
              <h3 className="text-sm font-semibold text-slate-800">Fetching Open-Meteo Model Data</h3>
              <p className="text-xs text-slate-500 mt-1">Retrieving atmospheric parameters...</p>
            </div>
          )}

          {aqData && (
            <div className="space-y-4">
              {/* Metadata Bar */}
              <div className="bg-white rounded-xl border border-slate-200 px-6 py-3 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-blue-600" />
                    Target Coordinates:
                  </span>
                  <span className="font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                    {displayedCoords?.lat.toFixed(4)}°, {displayedCoords?.lon.toFixed(4)}°
                  </span>
                  {aqData.grid_latitude && aqData.grid_longitude && (
                    <span className="text-slate-400 text-[11px]">
                      (Model Grid: {aqData.grid_latitude.toFixed(4)}°, {aqData.grid_longitude.toFixed(4)}°)
                    </span>
                  )}
                  {aqData.elevation !== null && (
                    <span className="text-slate-500">({aqData.elevation}m elev.)</span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-slate-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    Model Time: <strong className="text-slate-700 font-mono">{aqData.observed_at} ({aqData.timezone})</strong>
                  </span>
                  {aqData.cached && (
                    <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[11px] font-medium">
                      Cache Hit (TTL 15m)
                    </span>
                  )}
                </div>
              </div>

              {/* AQI Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* European AQI */}
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        {aqData.european_aqi.scale}
                      </span>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${getAqiColorClasses(aqData.european_aqi.category)}`}>
                        {aqData.european_aqi.category}
                      </span>
                    </div>
                    <div className="mt-3 flex items-baseline gap-3">
                      <span className="text-3xl font-extrabold tracking-tight text-slate-900">
                        {aqData.european_aqi.value !== null ? aqData.european_aqi.value : 'N/A'}
                      </span>
                      <span className="text-xs text-slate-500">EAQI Index</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                      {aqData.european_aqi.description}
                    </p>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-100 text-[11px] text-slate-400">
                    Scale: 0–20 Good, 20–40 Fair, 40–60 Moderate, 60–80 Poor, 80–100 Very Poor, 100+ Extremely Poor
                  </div>
                </div>

                {/* US AQI */}
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        {aqData.us_aqi.scale}
                      </span>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${getAqiColorClasses(aqData.us_aqi.category)}`}>
                        {aqData.us_aqi.category}
                      </span>
                    </div>
                    <div className="mt-3 flex items-baseline gap-3">
                      <span className="text-3xl font-extrabold tracking-tight text-slate-900">
                        {aqData.us_aqi.value !== null ? aqData.us_aqi.value : 'N/A'}
                      </span>
                      <span className="text-xs text-slate-500">USAQI Index</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                      {aqData.us_aqi.description}
                    </p>
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-100 text-[11px] text-slate-400">
                    Scale: 0–50 Good, 51–100 Moderate, 101–150 Sensitive, 151–200 Unhealthy, 201–300 Very Unhealthy, 301+ Hazardous
                  </div>
                </div>
              </div>

              {/* Pollutant Concentrations Grid */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 pb-3 border-b border-slate-100">
                  Model Estimated Pollutants
                </h3>
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {Object.entries(aqData.pollutants).map(([key, item]: [string, PollutantValue]) => (
                    <div key={key} className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                      <span className="text-xs font-medium text-slate-500 block">
                        {item.display_name}
                      </span>
                      <div className="mt-1.5 flex items-baseline gap-1">
                        <span className="text-lg font-bold text-slate-900">
                          {item.value !== null ? item.value : '—'}
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {item.unit}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
                  <span>Source: {aqData.source} ({aqData.data_type})</span>
                  <span>{aqData.attribution}</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ========================================================================= */}
        {/* SECTION 2: OpenAQ Physical Ground Monitoring Stations                     */}
        {/* ========================================================================= */}
        <section aria-labelledby="ground-heading" className="space-y-4 pt-4 border-t border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div>
              <h2 id="ground-heading" className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Radio className="w-5 h-5 text-indigo-600" />
                Physical Ground Monitoring Stations
              </h2>
              <p className="text-xs text-slate-500">
                Real surface observations from government and research monitoring stations indexed by OpenAQ
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
              Provider: OpenAQ API v3
            </span>
          </div>

          {/* Configuration alert if API key is not configured */}
          {stationsError && stationsError.includes('API key') && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-3">
              <KeyRound className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-950">OpenAQ API Key Required</p>
                <p className="mt-0.5">
                  OpenAQ API v3 enforces mandatory authentication. To enable live ground station querying:
                </p>
                <p className="mt-1 font-mono bg-white/80 p-2 rounded border border-amber-200 text-[11px]">
                  1. Get a free API key at <strong>openaq.org</strong><br />
                  2. Add <code>OPENAQ_API_KEY=your_key</code> into <code>backend/.env</code><br />
                  3. Restart the FastAPI server.
                </p>
                <p className="mt-1 text-slate-600">
                  Note: Open-Meteo atmospheric model forecasts above continue to function independently without any key.
                </p>
              </div>
            </div>
          )}

          {/* General station discovery error */}
          {stationsError && !stationsError.includes('API key') && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{stationsError}</span>
            </div>
          )}

          {stationsLoading && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 shadow-xs">
              <RefreshCw className="w-6 h-6 text-indigo-500 mx-auto mb-2 animate-spin" />
              <p className="text-xs">Searching for monitoring stations within {radiusKm} km...</p>
            </div>
          )}

          {!stationsLoading && !stationsError && stations.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 shadow-xs">
              <Building2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-semibold text-slate-700">No Ground Stations Found</h3>
              <p className="text-xs text-slate-500 mt-1">
                No active OpenAQ ground stations detected within {radiusKm} km of coordinates. Try increasing search radius or selecting another region.
              </p>
            </div>
          )}

          {/* Station Cards Grid & Measurements Viewer */}
          {!stationsLoading && stations.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Station List */}
              <div className="lg:col-span-1 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium pb-1">
                  <span>Found {stations.length} Station(s)</span>
                  <span>Sorted by distance</span>
                </div>

                <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
                  {stations.map((st) => {
                    const isSelected = selectedStation?.id === st.id;
                    return (
                      <div
                        key={st.id}
                        onClick={() => loadStationMeasurements(st)}
                        className={`p-4 rounded-xl border text-xs cursor-pointer transition-all ${
                          isSelected 
                            ? 'bg-indigo-50/70 border-indigo-400 ring-1 ring-indigo-400 shadow-xs' 
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50 shadow-2xs'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-semibold text-slate-900 leading-snug">
                            {st.name}
                          </h4>
                          {st.distance_meters !== null && (
                            <span className="shrink-0 px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px] flex items-center gap-1">
                              <Navigation className="w-2.5 h-2.5" />
                              {(st.distance_meters / 1000).toFixed(1)} km
                            </span>
                          )}
                        </div>

                        <div className="mt-2 text-slate-500 space-y-0.5 text-[11px]">
                          <p>Locality: <span className="text-slate-700">{st.locality || 'N/A'}, {st.country || ''}</span></p>
                          <p className="font-mono text-slate-400">
                            Coords: {st.coordinates.latitude.toFixed(4)}°, {st.coordinates.longitude.toFixed(4)}°
                          </p>
                          <p className="text-indigo-600 font-medium mt-1">
                            {st.sensors.length} sensor(s) installed
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Station Details & Measurements Inspector */}
              <div className="lg:col-span-2">
                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs h-full flex flex-col">
                  {selectedStation ? (
                    <div className="space-y-4 flex-1">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-slate-900">{selectedStation.name}</h3>
                            <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px] font-mono">
                              ID: #{selectedStation.id}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Station coordinates: {selectedStation.coordinates.latitude.toFixed(4)}°, {selectedStation.coordinates.longitude.toFixed(4)}° 
                            {selectedStation.distance_meters && ` (${(selectedStation.distance_meters / 1000).toFixed(2)} km away)`}
                          </p>
                        </div>
                        <button
                          onClick={() => loadStationMeasurements(selectedStation)}
                          disabled={measurementsLoading}
                          className="self-start sm:self-auto px-2.5 py-1 text-xs border border-slate-200 rounded text-slate-600 hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className={`w-3 h-3 ${measurementsLoading ? 'animate-spin' : ''}`} />
                          Refresh Station
                        </button>
                      </div>

                      {measurementsLoading && (
                        <div className="p-8 text-center text-slate-500">
                          <RefreshCw className="w-6 h-6 text-indigo-500 mx-auto mb-2 animate-spin" />
                          <p className="text-xs">Fetching live station observations...</p>
                        </div>
                      )}

                      {measurementsError && (
                        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                          {measurementsError}
                        </div>
                      )}

                      {measurementsData && !measurementsLoading && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span>Recent Sensor Measurements:</span>
                            {measurementsData.cached && (
                              <span className="text-[11px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-200">
                                Cache Hit (TTL 10m)
                              </span>
                            )}
                          </div>

                          {measurementsData.measurements.length === 0 ? (
                            <div className="p-6 text-center text-slate-400 text-xs border border-dashed rounded-lg">
                              No recent observation records published by this station.
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                              {measurementsData.measurements.map((m, idx) => (
                                <div key={idx} className="p-3.5 rounded-lg bg-indigo-50/40 border border-indigo-100">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold uppercase text-indigo-950">
                                      {m.parameter}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-mono">
                                      Sensor #{m.sensor_id}
                                    </span>
                                  </div>
                                  <div className="mt-2 flex items-baseline gap-1">
                                    <span className="text-2xl font-bold text-slate-900">
                                      {m.value !== null ? m.value : '—'}
                                    </span>
                                    <span className="text-xs text-slate-600 font-mono">
                                      {m.unit}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-slate-400 mt-2 truncate" title={m.observed_at}>
                                    Observed: {m.observed_at}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
                            <span>Data Type: {measurementsData.data_type}</span>
                            <span>{measurementsData.attribution}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-400">
                      <Radio className="w-10 h-10 text-slate-300 mb-2" />
                      <p className="text-xs font-semibold text-slate-600">Select a Station</p>
                      <p className="text-xs text-slate-400 mt-1 max-w-xs">
                        Click any monitoring station from the list on the left to inspect its physical ground-sensor measurements.
                      </p>
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}
        </section>

        {/* ========================================================================= */}
        {/* SECTION 3: Evaluated Machine Learning Forecast (Scikit-Learn)            */}
        {/* ========================================================================= */}
        <section aria-labelledby="ml-forecast-heading" className="space-y-4 pt-4 border-t border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div>
              <h2 id="ml-forecast-heading" className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-emerald-600" />
                Local Machine Learning Forecast (PM2.5)
              </h2>
              <p className="text-xs text-slate-500">
                Short-term PM2.5 autoregressive forecast evaluated against chronological persistence baselines
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                Model: Random Forest Regressor
              </span>
              {mlForecast && (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded border ${
                  mlForecast.status === 'operational'
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}>
                  Status: {mlForecast.status}
                </span>
              )}
            </div>
          </div>

          {mlLoading && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 shadow-xs">
              <RefreshCw className="w-6 h-6 text-emerald-500 mx-auto mb-2 animate-spin" />
              <p className="text-xs">Checking local model artifact and metrics...</p>
            </div>
          )}

          {mlError && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{mlError}</span>
            </div>
          )}

          {!mlLoading && mlForecast && mlForecast.status === 'model_not_trained' && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
              <div className="p-4 rounded-lg bg-amber-50/70 border border-amber-200 text-xs text-amber-900 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-amber-950">Model Status: Not Trained / Calibration Pending</h4>
                  <p className="mt-1 text-slate-700 leading-relaxed">
                    {mlForecast.message}
                  </p>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-amber-200/60 text-slate-600">
                    <div>
                      <span className="font-semibold block text-slate-800">Leakage Guard:</span>
                      Past-only lag shifts (t-1, t-3, t-6, t-24) and un-leaked rolling windows.
                    </div>
                    <div>
                      <span className="font-semibold block text-slate-800">Baseline Audit:</span>
                      Mandatory t-1 persistence comparison on chronological held-out test data.
                    </div>
                    <div>
                      <span className="font-semibold block text-slate-800">Primary Forecast:</span>
                      Open-Meteo atmospheric numerical forecasts remain fully active above.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!mlLoading && mlForecast && mlForecast.status === 'operational' && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-5">
              {/* Evaluated Metrics Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-lg bg-emerald-50/50 border border-emerald-100">
                  <span className="text-xs text-slate-500 font-medium block">Model MAE</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-xl font-bold text-slate-900">{mlForecast.mae ?? '—'}</span>
                    <span className="text-xs text-slate-500 font-mono">µg/m³</span>
                  </div>
                  <span className="text-[10px] text-emerald-700 font-medium mt-1 block">Held-out chronological test</span>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-xs text-slate-500 font-medium block">Persistence Baseline MAE</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-xl font-bold text-slate-900">{mlForecast.baseline_mae ?? '—'}</span>
                    <span className="text-xs text-slate-500 font-mono">µg/m³</span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 block">Naive t-1 benchmark</span>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-xs text-slate-500 font-medium block">Model RMSE</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-xl font-bold text-slate-900">{mlForecast.rmse ?? '—'}</span>
                    <span className="text-xs text-slate-500 font-mono">µg/m³</span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 block">Root mean squared error</span>
                </div>

                <div className="p-3.5 rounded-lg bg-blue-50/50 border border-blue-100">
                  <span className="text-xs text-slate-500 font-medium block">Horizon / Algorithm</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-base font-bold text-blue-950">{mlForecast.horizon_hours}h</span>
                    <span className="text-xs text-slate-500 font-mono">Rollout</span>
                  </div>
                  <span className="text-[10px] text-blue-700 font-medium mt-1 block">Random Forest (Scikit-Learn)</span>
                </div>
              </div>

              {/* Predictions Grid */}
              {mlForecast.predictions.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 pb-2 border-b border-slate-100 flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                    Autoregressive Hourly PM2.5 Trajectory
                  </h4>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-56 overflow-y-auto pr-1">
                    {mlForecast.predictions.map((p, idx) => (
                      <div key={idx} className="p-2.5 rounded-md bg-slate-50 border border-slate-200 text-center">
                        <span className="text-[10px] font-mono text-slate-500 block">+{p.horizon_hour}h</span>
                        <span className="text-base font-bold text-slate-900">{p.predicted_pm2_5}</span>
                        <span className="text-[10px] text-slate-400 block font-mono">{p.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Phase 5 Environmental Report Quick CTA Banner */}
        <section className="bg-gradient-to-r from-blue-900 to-indigo-900 rounded-2xl p-6 text-white shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-800 text-blue-200 text-[11px] font-semibold uppercase tracking-wider">
              <FileText className="w-3 h-3 text-blue-300" />
              Phase 5A Feature
            </div>
            <h3 className="text-lg font-bold text-white">Full Environmental Intelligence Report & Export</h3>
            <p className="text-xs text-blue-200 max-w-2xl">
              Compile a complete location dossier merging Open-Meteo atmospheric model estimates, OpenAQ ground station sensor records, and ML forecasting transparency notices into a printable layout or RFC 4180 CSV export.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0 w-full md:w-auto">
            <button
              onClick={handleGenerateReport}
              disabled={reportLoading}
              className="w-full md:w-auto inline-flex items-center justify-center px-4 py-2 rounded-lg bg-white text-blue-900 hover:bg-blue-50 text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <FileText className="w-4 h-4 mr-2 text-blue-600" />
              {reportLoading ? 'Compiling Dossier...' : 'Generate Location Report'}
            </button>
            <a
              href={getReportExportUrl(parseFloat(latitude) || 13.0827, parseFloat(longitude) || 80.2707, radiusKm * 1000, 'csv')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center p-2 rounded-lg bg-blue-800 hover:bg-blue-700 text-white text-xs font-medium border border-blue-700 transition-colors cursor-pointer"
              title="Direct CSV Export"
            >
              <Download className="w-4 h-4" />
            </a>
          </div>
        </section>

        {/* Architectural principles card */}
        <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            Phase 5 Scope & Provenance Guarantees
          </h4>
          <ul className="mt-2 text-xs text-blue-800 space-y-1.5 list-disc list-inside">
            <li>Strict Source Separation: Atmospheric numerical simulations (Open-Meteo) and empirical ground observations (OpenAQ) are maintained in distinct sections.</li>
            <li>Partial Provider Availability: Missing OpenAQ API keys or upstream station timeouts do not degrade Open-Meteo reporting.</li>
            <li>Zero Data Leakage Features: Lags look strictly backward (t-1, t-3, t-6, t-24) and rolling statistics are calculated on shifted values to prevent self-target leakage.</li>
            <li>Mandatory Persistence Baseline: ML models are benchmarked against naive t-1 persistence before claiming predictive validity.</li>
            <li>Audit & Export Readiness: Reports and exports preserve UTC timestamps, measurement units, provider attributions (CC BY 4.0), and scientific disclaimers.</li>
          </ul>
        </div>

      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
          <p>© 2026 BreatheWise — Air Quality Intelligence & Forecasting</p>
          <p className="flex items-center gap-4">
            <span>Open-Meteo (CC BY 4.0)</span>
            <span>OpenAQ (CC BY 4.0)</span>
            <span>Zero Client Secrets</span>
          </p>
        </div>
      </footer>

      {/* Environmental Report Modal Dialog */}
      {isReportModalOpen && (
        <div 
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 print:p-0 print:bg-white print:static"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-modal-title"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200 print:max-h-none print:shadow-none print:border-none print:rounded-none">
            
            {/* Modal Header */}
            <div className="p-4 sm:p-6 border-b border-slate-200 flex items-center justify-between bg-slate-50/70 shrink-0 print:border-b-2 print:border-slate-800 print:bg-white">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-600 text-white shadow-2xs print:border print:border-blue-900">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h2 id="report-modal-title" className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    Environmental Intelligence Report
                    {report && (
                      <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200">
                        {report.report_id}
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Location: {latitude}°N, {longitude}°E • Radius: {radiusKm} km
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 print:hidden">
                {report && (
                  <>
                    <button
                      onClick={() => window.print()}
                      className="inline-flex items-center px-3 py-1.5 border border-slate-300 text-xs font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50 transition-colors cursor-pointer shadow-2xs"
                      title="Print or Save as PDF"
                    >
                      <Printer className="w-3.5 h-3.5 mr-1.5 text-slate-600" />
                      Print
                    </button>
                    <a
                      href={getReportExportUrl(report.target_latitude, report.target_longitude, report.openaq.radius_meters, 'csv')}
                      className="inline-flex items-center px-3 py-1.5 border border-blue-600 text-xs font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer shadow-2xs"
                      download={`breathewise_report_${report.target_latitude}_${report.target_longitude}.csv`}
                      title="Download RFC 4180 CSV Export"
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      Export CSV
                    </a>
                  </>
                )}
                <button
                  onClick={() => setIsReportModalOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                  aria-label="Close report modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-6 text-slate-900 print:overflow-visible">
              
              {/* Loading State */}
              {reportLoading && (
                <div className="py-16 text-center space-y-3">
                  <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <h4 className="text-sm font-semibold text-slate-800">Generating Environmental Report...</h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Retrieving atmospheric model simulations from Open-Meteo and querying nearby physical monitoring stations from OpenAQ.
                  </p>
                </div>
              )}

              {/* Error State */}
              {!reportLoading && reportError && (
                <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-rose-900">Failed to Generate Report</h4>
                    <p className="mt-1">{reportError}</p>
                    <button
                      onClick={handleGenerateReport}
                      className="mt-3 inline-flex items-center px-3 py-1 rounded bg-rose-600 text-white font-medium hover:bg-rose-700 transition-colors"
                    >
                      Retry Generation
                    </button>
                  </div>
                </div>
              )}

              {/* Report Content */}
              {!reportLoading && report && (
                <div className="space-y-6">

                  {/* Header Meta Overview */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Report ID</span>
                      <span className="font-mono font-semibold text-slate-800">{report.report_id}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Generated (UTC)</span>
                      <span className="font-mono text-slate-800">{new Date(report.generated_at).toISOString().replace('T', ' ').substring(0, 19)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Target Coordinates</span>
                      <span className="font-mono text-slate-800">{report.target_latitude.toFixed(4)}°, {report.target_longitude.toFixed(4)}°</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Search Radius</span>
                      <span className="font-mono text-slate-800">{(report.openaq.radius_meters / 1000).toFixed(0)} km</span>
                    </div>
                  </div>

                  {/* SECTION 1: Open-Meteo Atmospheric Models */}
                  <div className="p-4 sm:p-5 rounded-xl border border-blue-200 bg-white space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-3 border-b border-slate-100">
                      <div>
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold uppercase tracking-wider">
                          <CloudSun className="w-3 h-3 text-blue-600" />
                          Section 1: Atmospheric Model Estimates
                        </div>
                        <h4 className="text-sm font-bold text-slate-900 mt-1">Open-Meteo Air Quality Numerical Simulation</h4>
                      </div>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {report.open_meteo.grid_latitude ? `Grid: ${report.open_meteo.grid_latitude.toFixed(2)}°N, ${report.open_meteo.grid_longitude?.toFixed(2)}°E` : ''}
                      </span>
                    </div>

                    {report.open_meteo.available ? (
                      <div className="space-y-4">
                        {/* AQI Highlights */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {report.open_meteo.european_aqi && (
                            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                              <div>
                                <span className="text-[11px] font-semibold text-slate-500 block">European AQI (EAQI)</span>
                                <span className="text-lg font-bold text-slate-900">{report.open_meteo.european_aqi.value ?? 'N/A'}</span>
                                <p className="text-[10px] text-slate-500 mt-0.5">{report.open_meteo.european_aqi.description}</p>
                              </div>
                              <span className={`px-2.5 py-1 text-xs font-bold rounded-md border ${getAqiColorClasses(report.open_meteo.european_aqi.category)}`}>
                                {report.open_meteo.european_aqi.category}
                              </span>
                            </div>
                          )}
                          {report.open_meteo.us_aqi && (
                            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                              <div>
                                <span className="text-[11px] font-semibold text-slate-500 block">United States AQI (USAQI)</span>
                                <span className="text-lg font-bold text-slate-900">{report.open_meteo.us_aqi.value ?? 'N/A'}</span>
                                <p className="text-[10px] text-slate-500 mt-0.5">{report.open_meteo.us_aqi.description}</p>
                              </div>
                              <span className={`px-2.5 py-1 text-xs font-bold rounded-md border ${getAqiColorClasses(report.open_meteo.us_aqi.category)}`}>
                                {report.open_meteo.us_aqi.category}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Pollutants Table */}
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-slate-200 text-xs">
                            <thead className="bg-slate-50 font-semibold text-slate-600">
                              <tr>
                                <th scope="col" className="px-3 py-2 text-left">Pollutant</th>
                                <th scope="col" className="px-3 py-2 text-left">Estimated Concentration</th>
                                <th scope="col" className="px-3 py-2 text-left">Unit</th>
                                <th scope="col" className="px-3 py-2 text-left">Data Nature</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                              {Object.entries(report.open_meteo.pollutants).map(([key, p]) => (
                                <tr key={key} className="hover:bg-slate-50/50">
                                  <td className="px-3 py-2 font-sans font-medium text-slate-900">{p.display_name}</td>
                                  <td className="px-3 py-2 font-bold">{p.value ?? '—'}</td>
                                  <td className="px-3 py-2 text-slate-500">{p.unit}</td>
                                  <td className="px-3 py-2 font-sans text-slate-500 text-[11px]">Atmospheric Model</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <p className="text-[10px] text-slate-400">
                          Attribution: {report.open_meteo.attribution} • Observed: {report.open_meteo.observed_at}
                        </p>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                        {report.open_meteo.error_message || 'Atmospheric model estimates unavailable.'}
                      </div>
                    )}
                  </div>

                  {/* SECTION 2: OpenAQ Physical Ground Stations */}
                  <div className="p-4 sm:p-5 rounded-xl border border-emerald-200 bg-white space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-3 border-b border-slate-100">
                      <div>
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase tracking-wider">
                          <Radio className="w-3 h-3 text-emerald-600" />
                          Section 2: Physical Ground Observations
                        </div>
                        <h4 className="text-sm font-bold text-slate-900 mt-1">OpenAQ In-Situ Ground Monitoring Stations</h4>
                      </div>
                      <span className="text-[11px] text-slate-500 font-mono">
                        Found: {report.openaq.stations_found} station(s)
                      </span>
                    </div>

                    {report.openaq.available && report.openaq.stations.length > 0 ? (
                      <div className="space-y-4">
                        {report.openaq.stations.map((st) => (
                          <div key={st.station_id} className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <div>
                                <span className="font-bold text-slate-900">{st.station_name}</span>
                                <span className="text-slate-500 ml-2 font-mono">#{st.station_id}</span>
                              </div>
                              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold text-[11px] border border-emerald-200 font-mono">
                                {st.distance_km} km away
                              </span>
                            </div>

                            {st.measurements.length > 0 ? (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                                {st.measurements.map((m, idx) => (
                                  <div key={idx} className="p-2 rounded bg-white border border-slate-200 text-center">
                                    <span className="text-[10px] font-medium text-slate-500 block uppercase">{m.parameter}</span>
                                    <span className="text-sm font-bold text-slate-900">{m.value ?? '—'}</span>
                                    <span className="text-[10px] text-slate-400 block font-mono">{m.unit}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-500 italic">No recent sensor observations returned for this monitor.</p>
                            )}
                          </div>
                        ))}
                        <p className="text-[10px] text-slate-400">
                          Attribution: {report.openaq.attribution}
                        </p>
                      </div>
                    ) : (
                      <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-start gap-2.5">
                        <KeyRound className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-slate-800">Ground Station Status: {report.openaq.status}</p>
                          <p className="text-slate-600 mt-0.5">{report.openaq.message}</p>
                          <p className="text-[11px] text-slate-500 mt-1">
                            Note: Open-Meteo atmospheric model estimates remain fully operational and unaffected.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* SECTION 3: ML Status & Disclaimers */}
                  <div className="p-4 sm:p-5 rounded-xl border border-purple-200 bg-white space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-[10px] font-bold uppercase tracking-wider">
                        <Cpu className="w-3 h-3 text-purple-600" />
                        Section 3: Machine Learning Forecasting Status
                      </div>
                      <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                        {report.ml_forecast.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700">{report.ml_forecast.message}</p>
                    <div className="p-3 rounded-lg bg-purple-50/70 border border-purple-100 text-xs text-purple-900 font-medium">
                      {report.ml_forecast.disclaimer}
                    </div>
                  </div>

                  {/* SECTION 4: Methodology & Scientific Disclaimers */}
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Methodology & Scientific Disclaimers
                    </h5>
                    <ol className="text-xs text-slate-600 space-y-1.5 list-decimal list-inside">
                      {report.disclaimers.map((disc, idx) => (
                        <li key={idx} className="leading-relaxed">{disc}</li>
                      ))}
                    </ol>
                  </div>

                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between shrink-0 print:hidden">
              <span className="text-xs text-slate-500">
                BreatheWise Phase 5 Environmental Dossier
              </span>
              <button
                onClick={() => setIsReportModalOpen(false)}
                className="px-4 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Close Report
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default App;

