import React, { useEffect, useState, useRef } from 'react';
import { 
  AlertCircle, 
  RefreshCw, 
  Compass, 
  Sparkles,
  TrendingUp,
  Cpu,
  FileText,
  Download,
  Printer,
  X,
  Radio,
  CloudSun,
  KeyRound
} from 'lucide-react';

import { 
  checkBackendHealth, 
  fetchCurrentAirQuality, 
  fetchNearbyStations, 
  fetchStationMeasurements,
  fetchAirQualityGrid,
  fetchMLForecast,
  fetchEnvironmentalReport,
  getReportExportUrl,
} from './services/api';
import type { 
  HealthResponse, 
  CurrentAirQualityResponse, 
  StationSummary, 
  StationMeasurementsResponse,
  GridSamplePoint,
  MLForecastResponse,
  EnvironmentalReport,
} from './types/api';

import { Navbar } from './components/Navbar';
import { LocationSearch } from './components/LocationSearch';
import { AirQualityMap } from './components/AirQualityMap';
import { MetricsSidebar } from './components/MetricsSidebar';

export const App: React.FC = () => {
  // Backend Health State
  const [health, setHealth] = useState<HealthResponse | null>(null);

  // Active Query Coordinates & Radius
  const [latitude, setLatitude] = useState<string>('13.0827');
  const [longitude, setLongitude] = useState<string>('80.2707');
  const [radiusKm, setRadiusKm] = useState<number>(25);

  // Air Quality Data (Open-Meteo Current)
  const [aqData, setAqData] = useState<CurrentAirQualityResponse | null>(null);
  const [aqLoading, setAqLoading] = useState<boolean>(false);
  const [aqError, setAqError] = useState<string | null>(null);

  // Spatial Grid Data (Heatmap Sampling)
  const [gridPoints, setGridPoints] = useState<GridSamplePoint[]>([]);
  const [gridLoading, setGridLoading] = useState<boolean>(false);
  const [gridError, setGridError] = useState<string | null>(null);

  // Ground Stations State (OpenAQ)
  const [stations, setStations] = useState<StationSummary[]>([]);
  const [stationsLoading, setStationsLoading] = useState<boolean>(false);
  const [selectedStation, setSelectedStation] = useState<StationSummary | null>(null);
  const [measurementsData, setMeasurementsData] = useState<StationMeasurementsResponse | null>(null);
  const [measurementsLoading, setMeasurementsLoading] = useState<boolean>(false);

  // Machine Learning Forecast State
  const [mlForecast, setMlForecast] = useState<MLForecastResponse | null>(null);
  const [mlLoading, setMlLoading] = useState<boolean>(false);
  const [mlError, setMlError] = useState<string | null>(null);
  const [demoSeedInput, setDemoSeedInput] = useState<string>('35');

  // Environmental Report State
  const [report, setReport] = useState<EnvironmentalReport | null>(null);
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);

  // Request sequence guards (AbortControllers)
  const aqAbortRef = useRef<AbortController | null>(null);
  const gridAbortRef = useRef<AbortController | null>(null);
  const stationsAbortRef = useRef<AbortController | null>(null);
  const measurementsAbortRef = useRef<AbortController | null>(null);
  const mlAbortRef = useRef<AbortController | null>(null);
  const reportAbortRef = useRef<AbortController | null>(null);

  // Check backend health
  const verifyHealth = async () => {
    try {
      const data = await checkBackendHealth();
      setHealth(data);
    } catch {
      setHealth(null);
    }
  };

  // 1. Fetch Current Air Quality
  const loadAirQuality = async (latStr: string, lonStr: string) => {
    const lat = parseFloat(latStr.trim());
    const lon = parseFloat(lonStr.trim());
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;

    if (aqAbortRef.current) aqAbortRef.current.abort();
    const controller = new AbortController();
    aqAbortRef.current = controller;

    setAqLoading(true);
    setAqError(null);

    try {
      const result = await fetchCurrentAirQuality(lat, lon, controller.signal);
      setAqData(result);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setAqError(err instanceof Error ? err.message : 'Failed to retrieve air quality data');
      setAqData(null);
    } finally {
      setAqLoading(false);
    }
  };

  // 2. Fetch Spatial Grid Samples (Genuine Open-Meteo Heatmap)
  const loadAirQualityGrid = async (latStr: string, lonStr: string, radKm: number) => {
    const lat = parseFloat(latStr.trim());
    const lon = parseFloat(lonStr.trim());
    if (isNaN(lat) || isNaN(lon)) return;

    if (gridAbortRef.current) gridAbortRef.current.abort();
    const controller = new AbortController();
    gridAbortRef.current = controller;

    setGridLoading(true);
    setGridError(null);

    try {
      const gridResp = await fetchAirQualityGrid(lat, lon, radKm, 4, controller.signal);
      setGridPoints(gridResp.points);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setGridError(err instanceof Error ? err.message : 'Spatial grid unavailable');
      setGridPoints([]);
    } finally {
      setGridLoading(false);
    }
  };

  // 3. Discover OpenAQ Ground Stations
  const loadNearbyStations = async (latStr: string, lonStr: string, radKm: number) => {
    const lat = parseFloat(latStr.trim());
    const lon = parseFloat(lonStr.trim());
    if (isNaN(lat) || isNaN(lon)) return;

    if (stationsAbortRef.current) stationsAbortRef.current.abort();
    const controller = new AbortController();
    stationsAbortRef.current = controller;

    setStationsLoading(true);
    setSelectedStation(null);
    setMeasurementsData(null);

    try {
      const result = await fetchNearbyStations(lat, lon, radKm, controller.signal);
      setStations(result.stations);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setStations([]);
    } finally {
      setStationsLoading(false);
    }
  };

  // 4. Load Station Measurements
  const loadStationMeasurements = async (station: StationSummary) => {
    setSelectedStation(station);

    if (measurementsAbortRef.current) measurementsAbortRef.current.abort();
    const controller = new AbortController();
    measurementsAbortRef.current = controller;

    setMeasurementsLoading(true);

    try {
      const data = await fetchStationMeasurements(station.id, controller.signal);
      setMeasurementsData(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setMeasurementsData(null);
    } finally {
      setMeasurementsLoading(false);
    }

    loadMLForecast(station.id);
  };

  // 5. Fetch Local ML Forecast
  const loadMLForecast = async (stationId?: number, seedPm25?: number) => {
    if (mlAbortRef.current) mlAbortRef.current.abort();
    const controller = new AbortController();
    mlAbortRef.current = controller;

    setMlLoading(true);
    setMlError(null);

    try {
      const data = await fetchMLForecast(stationId, 24, controller.signal, seedPm25);
      setMlForecast(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setMlError(err instanceof Error ? err.message : 'Failed to retrieve ML forecast status');
      setMlForecast(null);
    } finally {
      setMlLoading(false);
    }
  };

  // 6. Generate Location Report
  const handleGenerateReport = async () => {
    const lat = parseFloat(latitude.trim());
    const lon = parseFloat(longitude.trim());
    if (isNaN(lat) || isNaN(lon)) return;

    if (reportAbortRef.current) reportAbortRef.current.abort();
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
      setReportError(err instanceof Error ? err.message : 'Failed to compile report.');
    } finally {
      setReportLoading(false);
    }
  };

  // Comprehensive Refresh
  const refreshAllData = (latStr: string, lonStr: string, radKm: number) => {
    loadAirQuality(latStr, lonStr);
    loadAirQualityGrid(latStr, lonStr, radKm);
    loadNearbyStations(latStr, lonStr, radKm);
    loadMLForecast(selectedStation?.id);
  };

  // Handle Location Selection (from Search or Map Click)
  const handleCoordinatesSelect = (lat: number | string, lon: number | string) => {
    const latStr = typeof lat === 'number' ? lat.toFixed(4) : lat;
    const lonStr = typeof lon === 'number' ? lon.toFixed(4) : lon;
    setLatitude(latStr);
    setLongitude(lonStr);
    refreshAllData(latStr, lonStr, radiusKm);
  };

  useEffect(() => {
    verifyHealth();
    refreshAllData(latitude, longitude, radiusKm);
    return () => {
      aqAbortRef.current?.abort();
      gridAbortRef.current?.abort();
      stationsAbortRef.current?.abort();
      measurementsAbortRef.current?.abort();
      mlAbortRef.current?.abort();
      reportAbortRef.current?.abort();
    };
  }, []);

  const numLat = parseFloat(latitude) || 13.0827;
  const numLon = parseFloat(longitude) || 80.2707;

  return (
    <div className="min-h-screen bg-slate-50/60 text-slate-800 flex flex-col font-sans selection:bg-blue-100 selection:text-blue-900">
      
      {/* 1. Global Navigation Bar */}
      <Navbar
        health={health}
        onOpenReport={handleGenerateReport}
        reportExportUrl={getReportExportUrl(numLat, numLon, radiusKm * 1000, 'csv')}
      />

      {/* 2. Top Location Search & Quick Controls Bar */}
      <LocationSearch
        latitude={latitude}
        longitude={longitude}
        radiusKm={radiusKm}
        onCoordinatesChange={(newLat, newLon) => handleCoordinatesSelect(newLat, newLon)}
        onRadiusChange={(newRad) => {
          setRadiusKm(newRad);
          refreshAllData(latitude, longitude, newRad);
        }}
        onRefresh={() => refreshAllData(latitude, longitude, radiusKm)}
        isLoading={aqLoading || stationsLoading || gridLoading}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-6">

        {/* Section Heading */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <Compass className="w-5 h-5 text-blue-600" />
              Air Quality Intelligence
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Multi-source environmental platform combining genuine Open-Meteo atmospheric simulations with OpenAQ ground-truth sensors.
            </p>
          </div>
          <div className="text-right text-xs text-slate-400 font-mono hidden sm:block">
            Target: {numLat.toFixed(4)}°N, {numLon.toFixed(4)}°E (±{radiusKm} km)
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PRIMARY GEOSPATIAL MAP & INFORMATION SIDEBAR SECTION                      */}
        {/* ========================================================================= */}
        <section id="map-section" className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          
          {/* Left Column: Interactive Map (occupies ~70% on desktop) */}
          <div className="lg:col-span-8 flex flex-col">
            <AirQualityMap
              latitude={numLat}
              longitude={numLon}
              radiusKm={radiusKm}
              onLocationSelect={(lat, lon) => handleCoordinatesSelect(lat, lon)}
              stations={stations}
              selectedStation={selectedStation}
              onStationSelect={loadStationMeasurements}
              gridPoints={gridPoints}
              gridLoading={gridLoading}
              gridError={gridError}
              currentUsAqi={aqData?.us_aqi?.value}
              currentEuropeanAqi={aqData?.european_aqi?.value}
              currentPm25={aqData?.pollutants['pm2_5']?.value}
            />
          </div>

          {/* Right Column: Compact Metrics Sidebar (occupies ~30% on desktop) */}
          <div className="lg:col-span-4 flex flex-col">
            <MetricsSidebar
              aqData={aqData}
              aqLoading={aqLoading}
              aqError={aqError}
              stations={stations}
              stationsLoading={stationsLoading}
              selectedStation={selectedStation}
              measurementsData={measurementsData}
              measurementsLoading={measurementsLoading}
              onSelectStation={loadStationMeasurements}
              onClearStation={() => {
                setSelectedStation(null);
                setMeasurementsData(null);
                loadMLForecast(undefined);
              }}
            />
          </div>

        </section>

        {/* ========================================================================= */}
        {/* MACHINE LEARNING FORECASTING SECTION                                      */}
        {/* ========================================================================= */}
        <section id="ml-section" aria-labelledby="ml-heading" className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-2">
            <div>
              <h3 id="ml-heading" className="text-base font-bold text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
                Local Machine Learning Short-Term Forecast
              </h3>
              <p className="text-xs text-slate-500">
                Random Forest autoregressive 24h recursive rollout benchmarked against \(t-1\) persistence
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
                    : mlForecast.status === 'insufficient_data'
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-slate-100 text-slate-800 border-slate-300'
                }`}>
                  Status: {mlForecast.status}
                </span>
              )}
            </div>
          </div>

          {mlLoading && (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 shadow-xs">
              <RefreshCw className="w-6 h-6 text-emerald-500 mx-auto mb-2 animate-spin" />
              <p className="text-xs">Computing autoregressive rollout / model status...</p>
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
                  <h4 className="font-semibold text-amber-950">Model Status: Not Trained / Evaluation Pending</h4>
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
                      Mandatory \(t-1\) persistence comparison on chronological held-out test data.
                    </div>
                    <div>
                      <span className="font-semibold block text-slate-800">Atmospheric Forecast:</span>
                      Open-Meteo atmospheric numerical forecasts remain fully active above.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!mlLoading && mlForecast && mlForecast.status === 'insufficient_data' && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
              <div className="p-4 rounded-lg bg-amber-50/70 border border-amber-200 text-xs text-amber-900 flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold text-amber-950">Ground Station History Incomplete for Autoregression</h4>
                  <p className="mt-1 text-slate-700 leading-relaxed">
                    {mlForecast.message}
                  </p>
                  <p className="mt-2 text-slate-600 leading-relaxed">
                    The 24-step recursive rollout requires 24 continuous past hourly readings to construct lag features (t-1, t-3, t-6, t-24). In an academic demonstration without a live OpenAQ historical key, you can initialize the rollout with a demonstration seed observation.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3 pt-3 border-t border-amber-200/60">
                    <div className="flex items-center gap-2">
                      <label htmlFor="demo-seed-input" className="text-xs font-semibold text-slate-700">Seed PM2.5:</label>
                      <input
                        id="demo-seed-input"
                        type="number"
                        min="0"
                        max="500"
                        value={demoSeedInput}
                        onChange={(e) => setDemoSeedInput(e.target.value)}
                        className="w-20 px-2 py-1 text-xs border border-slate-300 rounded bg-white font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                      />
                      <span className="text-xs text-slate-500 font-mono">µg/m³</span>
                    </div>
                    <button
                      onClick={() => {
                        const seed = parseFloat(demoSeedInput);
                        loadMLForecast(selectedStation?.id, isNaN(seed) ? 35.0 : seed);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors shadow-2xs cursor-pointer"
                    >
                      <Cpu className="w-3.5 h-3.5" />
                      Run Demonstration Rollout
                    </button>
                    <span className="text-[11px] text-slate-500">Presets:</span>
                    {[25, 45, 85].map((presetVal) => (
                      <button
                        key={presetVal}
                        type="button"
                        onClick={() => {
                          setDemoSeedInput(presetVal.toString());
                          loadMLForecast(selectedStation?.id, presetVal);
                        }}
                        className="text-[11px] px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                      >
                        {presetVal} µg/m³
                      </button>
                    ))}
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
                    <span className="text-xl font-bold text-slate-900 font-mono">{mlForecast.mae ?? '—'}</span>
                    <span className="text-xs text-slate-500 font-mono">µg/m³</span>
                  </div>
                  <span className="text-[10px] text-emerald-700 font-medium mt-1 block">Held-out chronological test</span>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-xs text-slate-500 font-medium block">Persistence Baseline MAE</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-xl font-bold text-slate-900 font-mono">{mlForecast.baseline_mae ?? '—'}</span>
                    <span className="text-xs text-slate-500 font-mono">µg/m³</span>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1 block">Naive \(t-1\) benchmark</span>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-xs text-slate-500 font-medium block">Model RMSE</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-xl font-bold text-slate-900 font-mono">{mlForecast.rmse ?? '—'}</span>
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
                  <span className="text-[10px] text-blue-700 font-medium mt-1 block">Random Forest Regressor</span>
                </div>
              </div>

              {/* Provenance Notice & Re-rollout Controls */}
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-slate-600">
                  <span className="font-semibold text-slate-800">Provenance Notice:</span>{' '}
                  {mlForecast.message}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={demoSeedInput}
                    onChange={(e) => setDemoSeedInput(e.target.value)}
                    className="w-16 px-2 py-1 text-xs border border-slate-300 rounded bg-white font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-hidden"
                    title="Seed value in µg/m³"
                  />
                  <button
                    onClick={() => {
                      const seed = parseFloat(demoSeedInput);
                      loadMLForecast(selectedStation?.id, isNaN(seed) ? 35.0 : seed);
                    }}
                    className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors shadow-2xs cursor-pointer"
                  >
                    Test Seed
                  </button>
                  {selectedStation && (
                    <button
                      onClick={() => loadMLForecast(selectedStation.id)}
                      className="px-2.5 py-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
                    >
                      Reset to Station
                    </button>
                  )}
                </div>
              </div>

              {/* Autoregressive Trajectory Cards */}
              {mlForecast.predictions.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 pb-2 border-b border-slate-100 flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                    Autoregressive Hourly PM2.5 Trajectory
                  </h4>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2 max-h-56 overflow-y-auto pr-1">
                    {mlForecast.predictions.map((p, idx) => (
                      <div key={idx} className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-center">
                        <span className="text-[10px] font-mono text-slate-500 block">+{p.horizon_hour}h</span>
                        <span className="text-sm font-bold text-slate-900 font-mono">{p.predicted_pm2_5}</span>
                        <span className="text-[9px] text-slate-400 block font-mono">{p.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ========================================================================= */}
        {/* ENVIRONMENTAL DOSSIER REPORT CTA BANNER                                   */}
        {/* ========================================================================= */}
        <section className="bg-gradient-to-r from-blue-900 to-indigo-900 rounded-2xl p-6 text-white shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-800 text-blue-200 text-[11px] font-semibold uppercase tracking-wider">
              <FileText className="w-3 h-3 text-blue-300" />
              Environmental Intelligence Dossier
            </div>
            <h3 className="text-lg font-bold text-white">Consolidated Environmental Report & CSV Export</h3>
            <p className="text-xs text-blue-200 max-w-2xl">
              Compile a complete location audit dossier merging Open-Meteo atmospheric model estimates, OpenAQ ground station records, and ML forecasting transparency notices into a printable view or RFC 4180 CSV export.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0 w-full md:w-auto">
            <button
              onClick={handleGenerateReport}
              disabled={reportLoading}
              className="w-full md:w-auto inline-flex items-center justify-center px-4 py-2 rounded-lg bg-white text-blue-900 hover:bg-blue-50 text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <FileText className="w-4 h-4 mr-2 text-blue-600" />
              {reportLoading ? 'Compiling Dossier...' : 'Generate Location Dossier'}
            </button>
            <a
              href={getReportExportUrl(numLat, numLon, radiusKm * 1000, 'csv')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center p-2 rounded-lg bg-blue-800 hover:bg-blue-700 text-white text-xs font-medium border border-blue-700 transition-colors cursor-pointer"
              title="Direct CSV Export"
            >
              <Download className="w-4 h-4" />
            </a>
          </div>
        </section>

        {/* Architectural Guarantees Card */}
        <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            BreatheWise Data Provenance & Integrity Standards
          </h4>
          <ul className="mt-2 text-xs text-blue-800 space-y-1.5 list-disc list-inside">
            <li><strong>Strict Source Separation:</strong> Continuous atmospheric numerical simulations (Open-Meteo) and empirical ground observations (OpenAQ) are never conflated.</li>
            <li><strong>Genuine Spatial Heatmap:</strong> Map overlays sample live Open-Meteo atmospheric model coordinates rather than simulated or static images.</li>
            <li><strong>Zero Data Leakage:</strong> Lags strictly look backward (\(t-1, t-3, t-6, t-24\)) and rolling statistics are calculated on shifted values to prevent self-target leakage.</li>
            <li><strong>Mandatory Persistence Baseline:</strong> ML forecasting models are benchmarked against naive \(t-1\) persistence before claiming predictive validity.</li>
            <li><strong>Audit & Export Readiness:</strong> Reports and exports preserve UTC timestamps, measurement units, provider attributions (CC BY 4.0), and scientific disclaimers.</li>
          </ul>
        </div>

      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
          <p>© 2026 BreatheWise — Air Quality Intelligence Platform</p>
          <p className="flex items-center gap-4">
            <span>Open-Meteo (CC BY 4.0)</span>
            <span>OpenAQ (CC BY 4.0)</span>
            <span>OpenStreetMap / CARTO</span>
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
                  <h3 id="report-modal-title" className="text-base sm:text-lg font-bold text-slate-900">
                    Location Environmental Dossier
                  </h3>
                  <p className="text-xs text-slate-500">
                    Coordinates: {numLat.toFixed(4)}°, {numLon.toFixed(4)}° • Search Radius: {radiusKm} km
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 print:hidden">
                <button
                  onClick={() => window.print()}
                  className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
                  title="Print Report"
                >
                  <Printer className="w-4 h-4" />
                </button>
                <a
                  href={getReportExportUrl(numLat, numLon, radiusKm * 1000, 'csv')}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
                  title="Download CSV"
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  onClick={() => setIsReportModalOpen(false)}
                  className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
                  title="Close Dialog"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
              {reportLoading && (
                <div className="py-16 text-center text-slate-500 space-y-3">
                  <RefreshCw className="w-8 h-8 text-blue-600 mx-auto animate-spin" />
                  <p className="text-sm font-semibold text-slate-800">Compiling Multi-Source Environmental Dossier...</p>
                  <p className="text-xs text-slate-500">Querying Open-Meteo simulations, OpenAQ ground towers, and ML calibration state...</p>
                </div>
              )}

              {reportError && (
                <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-rose-900">Report Compilation Failed</h4>
                    <p className="mt-0.5">{reportError}</p>
                  </div>
                </div>
              )}

              {!reportLoading && report && (
                <div className="space-y-6">
                  {/* Metadata Dossier Banner */}
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 font-mono text-[10px] uppercase block">Dossier ID</span>
                      <span className="font-mono font-semibold text-slate-800">{report.report_id}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-mono text-[10px] uppercase block">Generated At</span>
                      <span className="font-mono text-slate-800">{new Date(report.generated_at).toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-mono text-[10px] uppercase block">Target Coordinates</span>
                      <span className="font-mono font-semibold text-slate-800">{report.target_latitude.toFixed(4)}°, {report.target_longitude.toFixed(4)}°</span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-mono text-[10px] uppercase block">Monitors Found</span>
                      <span className="font-bold text-slate-900">{report.openaq.stations_found} stations</span>
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {report.open_meteo.european_aqi && (
                            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                              <div>
                                <span className="text-[11px] font-semibold text-slate-500 block">European AQI (EAQI)</span>
                                <span className="text-lg font-bold text-slate-900 font-mono">{report.open_meteo.european_aqi.value ?? 'N/A'}</span>
                                <p className="text-[10px] text-slate-500 mt-0.5">{report.open_meteo.european_aqi.description}</p>
                              </div>
                              <span className="px-2.5 py-1 text-xs font-bold rounded-md border bg-blue-50 text-blue-800 border-blue-200">
                                {report.open_meteo.european_aqi.category}
                              </span>
                            </div>
                          )}
                          {report.open_meteo.us_aqi && (
                            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                              <div>
                                <span className="text-[11px] font-semibold text-slate-500 block">United States AQI (USAQI)</span>
                                <span className="text-lg font-bold text-slate-900 font-mono">{report.open_meteo.us_aqi.value ?? 'N/A'}</span>
                                <p className="text-[10px] text-slate-500 mt-0.5">{report.open_meteo.us_aqi.description}</p>
                              </div>
                              <span className="px-2.5 py-1 text-xs font-bold rounded-md border bg-blue-50 text-blue-800 border-blue-200">
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
                BreatheWise Environmental Intelligence Dossier
              </span>
              <button
                onClick={() => setIsReportModalOpen(false)}
                className="px-4 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Close Dossier
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default App;
