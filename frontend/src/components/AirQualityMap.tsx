import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  Layers, 
  Radio, 
  Sliders, 
  Navigation,
  Eye,
  EyeOff,
  RefreshCw,
  Info
} from 'lucide-react';
import type { StationSummary, GridSamplePoint } from '../types/api';

interface AirQualityMapProps {
  latitude: number;
  longitude: number;
  radiusKm: number;
  onLocationSelect: (lat: number, lon: number) => void;
  stations: StationSummary[];
  selectedStation: StationSummary | null;
  onStationSelect: (station: StationSummary) => void;
  gridPoints: GridSamplePoint[];
  gridLoading: boolean;
  gridError: string | null;
  currentUsAqi?: number | null;
  currentEuropeanAqi?: number | null;
  currentPm25?: number | null;
}

// Map Tile Providers (100% Free, no watermarks, no API keys)
const TILE_PROVIDERS = {
  osm: {
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  esriTopo: {
    name: 'Esri Topo',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community',
  },
  esriStreet: {
    name: 'Esri Streets',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012',
  },
};

type TileTheme = keyof typeof TILE_PROVIDERS;

// EPA Standard AQI Color Palette
export function getAQIColor(val: number | null | undefined, metric: 'us_aqi' | 'european_aqi' | 'pm25' = 'us_aqi') {
  if (val === null || val === undefined) {
    return { hex: '#94a3b8', label: 'Unavailable', rgba: 'rgba(148, 163, 184, ' };
  }

  if (metric === 'pm25') {
    if (val <= 12.0) return { hex: '#10b981', label: 'Good (0–12)', rgba: 'rgba(16, 185, 129, ' };
    if (val <= 35.4) return { hex: '#eab308', label: 'Moderate (12.1–35.4)', rgba: 'rgba(234, 179, 8, ' };
    if (val <= 55.4) return { hex: '#f97316', label: 'Sensitive (35.5–55.4)', rgba: 'rgba(249, 115, 22, ' };
    if (val <= 150.4) return { hex: '#ef4444', label: 'Unhealthy (55.5–150.4)', rgba: 'rgba(239, 68, 68, ' };
    if (val <= 250.4) return { hex: '#8b5cf6', label: 'Very Unhealthy (150.5–250.4)', rgba: 'rgba(139, 92, 246, ' };
    return { hex: '#7f1d1d', label: 'Hazardous (>250.4)', rgba: 'rgba(127, 29, 29, ' };
  }

  if (metric === 'european_aqi') {
    if (val <= 20) return { hex: '#10b981', label: 'Good (0–20)', rgba: 'rgba(16, 185, 129, ' };
    if (val <= 40) return { hex: '#eab308', label: 'Fair (21–40)', rgba: 'rgba(234, 179, 8, ' };
    if (val <= 60) return { hex: '#f97316', label: 'Moderate (41–60)', rgba: 'rgba(249, 115, 22, ' };
    if (val <= 80) return { hex: '#ef4444', label: 'Poor (61–80)', rgba: 'rgba(239, 68, 68, ' };
    if (val <= 100) return { hex: '#8b5cf6', label: 'Very Poor (81–100)', rgba: 'rgba(139, 92, 246, ' };
    return { hex: '#7f1d1d', label: 'Extremely Poor (>100)', rgba: 'rgba(127, 29, 29, ' };
  }

  // Default: US AQI (0 - 500)
  if (val <= 50) return { hex: '#10b981', label: 'Good (0–50)', rgba: 'rgba(16, 185, 129, ' };
  if (val <= 100) return { hex: '#eab308', label: 'Moderate (51–100)', rgba: 'rgba(234, 179, 8, ' };
  if (val <= 150) return { hex: '#f97316', label: 'Sensitive (101–150)', rgba: 'rgba(249, 115, 22, ' };
  if (val <= 200) return { hex: '#ef4444', label: 'Unhealthy (151–200)', rgba: 'rgba(239, 68, 68, ' };
  if (val <= 300) return { hex: '#8b5cf6', label: 'Very Unhealthy (201–300)', rgba: 'rgba(139, 92, 246, ' };
  return { hex: '#7f1d1d', label: 'Hazardous (301+)', rgba: 'rgba(127, 29, 29, ' };
}

export const AirQualityMap: React.FC<AirQualityMapProps> = ({
  latitude,
  longitude,
  radiusKm,
  onLocationSelect,
  stations,
  selectedStation,
  onStationSelect,
  gridPoints,
  gridLoading,
  gridError,
  currentUsAqi,
  currentEuropeanAqi,
  currentPm25,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const centerMarkerRef = useRef<L.Marker | null>(null);
  const stationMarkersRef = useRef<Map<number, L.Marker>>(new Map());
  const gridMarkersRef = useRef<L.CircleMarker[]>([]);

  // Toolbar States
  const [activeTheme, setActiveTheme] = useState<TileTheme>('osm');
  const [showHeatmap, setShowHeatmap] = useState<boolean>(true);
  const [heatmapOpacity, setHeatmapOpacity] = useState<number>(0.65);
  const [activeMetric, setActiveMetric] = useState<'us_aqi' | 'european_aqi' | 'pm25'>('us_aqi');
  const [showStationsLayer, setShowStationsLayer] = useState<boolean>(true);
  const [showGridProbes, setShowGridProbes] = useState<boolean>(false);

  // Active Value & Color Info for Primary Center
  const activeCenterValue = activeMetric === 'pm25' ? currentPm25 : activeMetric === 'european_aqi' ? currentEuropeanAqi : currentUsAqi;
  const activeColorInfo = getAQIColor(activeCenterValue, activeMetric);

  // High-Performance Synchronized Canvas Heatmap Renderer
  const renderHeatmap = useCallback(() => {
    const map = mapInstanceRef.current;
    const canvas = canvasRef.current;
    if (!map || !canvas || !showHeatmap) {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    ctx.clearRect(0, 0, size.x, size.y);

    // Collect spatial points to render
    interface SpatialPoint {
      lat: number;
      lng: number;
      val: number;
      radius: number;
    }

    const points: SpatialPoint[] = [];

    // Calculate dynamic pixel radius based on map zoom and bounding search radius
    const zoom = map.getZoom();
    const pixelRadius = Math.max(50, Math.min(260, 40 * Math.pow(1.35, zoom - 10)));

    // 1. Genuine Open-Meteo Grid Points (if available)
    if (gridPoints && gridPoints.length > 0) {
      gridPoints.forEach((pt) => {
        const val = activeMetric === 'pm25' ? (pt.pm2_5 ?? 25) : activeMetric === 'european_aqi' ? (pt.european_aqi ?? 30) : (pt.us_aqi ?? 65);
        points.push({
          lat: pt.latitude,
          lng: pt.longitude,
          val: val,
          radius: pixelRadius * 1.1,
        });
      });
    } else {
      // Fallback: Center point with atmospheric dispersion
      const centerVal = activeCenterValue ?? 50;
      points.push({
        lat: latitude,
        lng: longitude,
        val: centerVal,
        radius: pixelRadius * 1.2,
      });

      // Synthetic atmospheric dispersion ring
      [0, 60, 120, 180, 240, 300].forEach((ang) => {
        const rad = (ang * Math.PI) / 180;
        const dLat = Math.sin(rad) * (radiusKm / 111.0) * 0.5;
        const dLng = Math.cos(rad) * (radiusKm / 111.0) * 0.5;
        points.push({
          lat: latitude + dLat,
          lng: longitude + dLng,
          val: Math.max(10, centerVal * 0.9),
          radius: pixelRadius,
        });
      });
    }

    // Render smooth radial density blending
    ctx.save();
    ctx.globalAlpha = heatmapOpacity;

    points.forEach((pt) => {
      const screenPt = map.latLngToContainerPoint([pt.lat, pt.lng]);
      const color = getAQIColor(pt.val, activeMetric);
      const r = pt.radius;

      const gradient = ctx.createRadialGradient(screenPt.x, screenPt.y, 0, screenPt.x, screenPt.y, r);
      gradient.addColorStop(0, `${color.rgba}0.85)`);
      gradient.addColorStop(0.35, `${color.rgba}0.55)`);
      gradient.addColorStop(0.7, `${color.rgba}0.20)`);
      gradient.addColorStop(1, `${color.rgba}0.0)`);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(screenPt.x, screenPt.y, r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }, [latitude, longitude, radiusKm, gridPoints, activeCenterValue, activeMetric, heatmapOpacity, showHeatmap]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [latitude, longitude],
        zoom: 11,
        zoomControl: false,
        attributionControl: true,
      });

      L.control.zoom({ position: 'topright' }).addTo(map);

      const initialLayer = L.tileLayer(TILE_PROVIDERS[activeTheme].url, {
        attribution: TILE_PROVIDERS[activeTheme].attribution,
        maxZoom: 19,
      }).addTo(map);
      tileLayerRef.current = initialLayer;

      // Handle Map Click to Update Selected Coordinates
      map.on('click', (e: L.LeafletMouseEvent) => {
        onLocationSelect(
          parseFloat(e.latlng.lat.toFixed(4)),
          parseFloat(e.latlng.lng.toFixed(4))
        );
      });

      map.on('move', renderHeatmap);
      map.on('zoom', renderHeatmap);
      map.on('resize', renderHeatmap);

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update Tile Theme
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const newLayer = L.tileLayer(TILE_PROVIDERS[activeTheme].url, {
      attribution: TILE_PROVIDERS[activeTheme].attribution,
      maxZoom: 19,
    }).addTo(map);
    tileLayerRef.current = newLayer;
  }, [activeTheme]);

  // Update Center Marker & Radius Circle
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    map.panTo([latitude, longitude], { animate: true, duration: 0.5 });

    if (circleRef.current) {
      circleRef.current.setLatLng([latitude, longitude]);
      circleRef.current.setRadius(radiusKm * 1000);
    } else {
      circleRef.current = L.circle([latitude, longitude], {
        radius: radiusKm * 1000,
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 0.06,
        weight: 1.5,
        dashArray: '4, 4',
      }).addTo(map);
    }

    const centerIconHtml = `
      <div class="relative flex items-center justify-center">
        <span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-blue-400 opacity-60"></span>
        <div class="relative w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg border-2 border-white">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 2v3m0 14v3M2 12h3m14 0h3"></path>
          </svg>
        </div>
      </div>
    `;

    const centerIcon = L.divIcon({
      className: 'bw-center-pin',
      html: centerIconHtml,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    if (centerMarkerRef.current) {
      centerMarkerRef.current.setLatLng([latitude, longitude]);
    } else {
      centerMarkerRef.current = L.marker([latitude, longitude], {
        icon: centerIcon,
        zIndexOffset: 1000,
      })
        .addTo(map)
        .bindPopup(`
          <div class="p-1.5 text-xs">
            <div class="font-bold text-slate-900 flex items-center gap-1">
              <span class="w-2 h-2 rounded-full bg-blue-600 inline-block"></span>
              Selected Query Location
            </div>
            <p class="text-slate-500 font-mono text-[11px] mt-0.5">${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°</p>
            <p class="text-blue-600 font-semibold mt-1">Radius: ${radiusKm} km</p>
            <p class="text-slate-400 text-[10px] mt-1 italic">Click anywhere on map to re-center</p>
          </div>
        `);
    }

    renderHeatmap();
  }, [latitude, longitude, radiusKm, renderHeatmap]);

  // Update Ground Station Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    stationMarkersRef.current.forEach((marker) => map.removeLayer(marker));
    stationMarkersRef.current.clear();

    if (!showStationsLayer) return;

    stations.forEach((st) => {
      const isSelected = selectedStation?.id === st.id;
      const distStr = st.distance_meters !== null ? `${(st.distance_meters / 1000).toFixed(1)} km` : '';
      const markerHtml = `
        <div class="relative group cursor-pointer">
          <div class="w-7 h-7 rounded-full ${isSelected ? 'bg-indigo-600 ring-4 ring-indigo-300' : 'bg-slate-800'} text-white flex items-center justify-center shadow-md border-2 border-white transition-transform group-hover:scale-110">
            <svg class="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9m14.2 0c3.9 3.9 3.9 10.3 0 14.2M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5m8.4 0c2.3 2.3 2.3 6.1 0 8.5M12 12h.01"></path>
            </svg>
          </div>
          ${distStr ? `
            <span class="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap px-1.5 py-0.2 rounded bg-slate-900/80 text-[10px] text-white font-mono pointer-events-none">
              ${distStr}
            </span>
          ` : ''}
        </div>
      `;

      const stationIcon = L.divIcon({
        className: 'bw-station-pin',
        html: markerHtml,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const marker = L.marker([st.coordinates.latitude, st.coordinates.longitude], {
        icon: stationIcon,
      }).addTo(map);

      const popupContent = document.createElement('div');
      popupContent.className = 'p-1 text-xs max-w-xs';
      popupContent.innerHTML = `
        <p class="font-bold text-slate-900 leading-snug">${st.name}</p>
        <div class="mt-1 flex items-center gap-2 text-slate-500 font-mono text-[11px]">
          <span>Station ID #${st.id}</span>
          ${distStr ? `<span>•</span><span>${distStr} away</span>` : ''}
        </div>
        <p class="text-slate-500 font-mono text-[10px] mt-0.5">
          ${st.coordinates.latitude.toFixed(4)}°, ${st.coordinates.longitude.toFixed(4)}°
        </p>
        <button id="btn-select-${st.id}" class="mt-2.5 w-full py-1 px-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] font-semibold transition-colors cursor-pointer">
          ${isSelected ? 'Currently Selected' : 'View Station Details'}
        </button>
      `;

      popupContent.querySelector(`#btn-select-${st.id}`)?.addEventListener('click', () => {
        onStationSelect(st);
        map.closePopup();
      });

      marker.bindPopup(popupContent);
      stationMarkersRef.current.set(st.id, marker);
    });

    renderHeatmap();
  }, [stations, selectedStation, showStationsLayer, onStationSelect, renderHeatmap]);

  // Optional: Visual Grid Sample Probes (Subtle dots showing the genuine model grid points)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    gridMarkersRef.current.forEach((m) => map.removeLayer(m));
    gridMarkersRef.current = [];

    if (!showGridProbes || !gridPoints) return;

    gridPoints.forEach((pt) => {
      const color = getAQIColor(pt.us_aqi, 'us_aqi');
      const circleMarker = L.circleMarker([pt.latitude, pt.longitude], {
        radius: 4,
        color: '#ffffff',
        weight: 1.5,
        fillColor: color.hex,
        fillOpacity: 0.9,
      }).addTo(map);

      circleMarker.bindTooltip(`
        <div class="text-[11px] p-0.5 font-sans">
          <strong>Grid Estimate:</strong> ${pt.us_aqi ?? '—'} US AQI<br/>
          <span class="text-slate-400 font-mono text-[9px]">${pt.latitude.toFixed(3)}°, ${pt.longitude.toFixed(3)}°</span>
        </div>
      `, { direction: 'top' });

      gridMarkersRef.current.push(circleMarker);
    });
  }, [gridPoints, showGridProbes]);

  useEffect(() => {
    renderHeatmap();
  }, [renderHeatmap]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs flex flex-col h-full">
      {/* Map Toolbar Header */}
      <div className="p-3 sm:p-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-blue-600 text-white shadow-2xs">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">
                Geospatial Air Quality Heatmap
              </h3>
              {gridLoading && (
                <span className="inline-flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 font-medium animate-pulse">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  Updating Grid Samples...
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              Open-Meteo atmospheric model estimates across a {radiusKm} km radius • Click anywhere to reposition
            </p>
          </div>
        </div>

        {/* Map Toolbar Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Base Map Selector */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
            {(Object.keys(TILE_PROVIDERS) as TileTheme[]).map((theme) => (
              <button
                key={theme}
                onClick={() => setActiveTheme(theme)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  activeTheme === theme
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {TILE_PROVIDERS[theme].name}
              </button>
            ))}
          </div>

          {/* Metric Selector */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
            <button
              onClick={() => setActiveMetric('us_aqi')}
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                activeMetric === 'us_aqi'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              US AQI
            </button>
            <button
              onClick={() => setActiveMetric('european_aqi')}
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                activeMetric === 'european_aqi'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              EAQI
            </button>
            <button
              onClick={() => setActiveMetric('pm25')}
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                activeMetric === 'pm25'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              PM2.5
            </button>
          </div>

          {/* Heatmap Toggle */}
          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
              showHeatmap
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {showHeatmap ? <Eye className="w-3 h-3 text-emerald-600" /> : <EyeOff className="w-3 h-3 text-slate-400" />}
            Heatmap: {showHeatmap ? 'ON' : 'OFF'}
          </button>

          {/* Station Layer Toggle */}
          <button
            onClick={() => setShowStationsLayer(!showStationsLayer)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
              showStationsLayer
                ? 'bg-indigo-50 text-indigo-800 border-indigo-300'
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <Radio className="w-3 h-3 text-indigo-600" />
            Stations ({stations.length})
          </button>

          {/* Grid Probes Toggle */}
          <button
            onClick={() => setShowGridProbes(!showGridProbes)}
            title="Show spatial sample grid coordinate points"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
              showGridProbes
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            Grid Nodes ({gridPoints?.length || 0})
          </button>

          {/* Re-center Button */}
          <button
            onClick={() => {
              if (mapInstanceRef.current) {
                mapInstanceRef.current.setView([latitude, longitude], 11, { animate: true });
              }
            }}
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 transition-colors shadow-2xs cursor-pointer"
            title="Recenter map"
          >
            <Navigation className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Map Canvas Viewport */}
      <div className="relative w-full flex-1 min-h-[480px] bg-slate-100 overflow-hidden">
        {/* Leaflet DOM Node */}
        <div ref={mapContainerRef} className="w-full h-full z-0" />

        {/* Dynamic HTML5 Canvas Heatmap Overlay */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none z-10"
        />

        {/* Heatmap Legend Card */}
        <div className="absolute bottom-4 left-4 z-20 bg-white/95 backdrop-blur-md rounded-xl p-3 border border-slate-200 shadow-md text-xs space-y-1.5 max-w-[220px]">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-800">
            <span>Air Quality Index Scale</span>
            <span className="font-mono text-[10px] text-blue-600 uppercase">{activeMetric}</span>
          </div>
          
          <div className="w-full h-2.5 rounded-full bg-gradient-to-r from-emerald-500 via-yellow-400 via-orange-500 via-red-500 via-purple-500 to-rose-900 border border-slate-200" />

          <div className="grid grid-cols-3 text-[9px] font-mono text-slate-600 text-center">
            <span className="text-left text-emerald-700 font-semibold">Good</span>
            <span className="text-orange-600 font-semibold">Unhealthy</span>
            <span className="text-right text-rose-800 font-semibold">Hazardous</span>
          </div>

          <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
            <span className="flex items-center gap-1 font-medium text-slate-700">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeColorInfo.hex }} />
              {activeColorInfo.label}
            </span>
            <span className="font-bold text-slate-900 font-mono">
              {activeCenterValue !== null && activeCenterValue !== undefined ? activeCenterValue : '—'} {activeMetric === 'pm25' ? 'µg/m³' : ''}
            </span>
          </div>

          {/* Opacity Control */}
          <div className="pt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
            <Sliders className="w-3 h-3 text-slate-400 shrink-0" />
            <input
              type="range"
              min="0.2"
              max="1.0"
              step="0.05"
              value={heatmapOpacity}
              onChange={(e) => setHeatmapOpacity(parseFloat(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer h-1"
              title="Adjust heatmap intensity"
            />
            <span className="font-mono w-6 text-right text-[10px]">{Math.round(heatmapOpacity * 100)}%</span>
          </div>
        </div>

        {/* Data Provenance Badge on Map */}
        <div className="absolute top-4 left-4 z-20 bg-slate-900/85 backdrop-blur-xs text-white px-3 py-1.5 rounded-lg shadow-md text-[11px] flex items-center gap-2 pointer-events-none">
          <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span>Layer: <strong>Atmospheric model estimate</strong> (Open-Meteo)</span>
        </div>

        {gridError && (
          <div className="absolute top-14 left-4 z-20 bg-amber-50 text-amber-900 border border-amber-200 px-3 py-1.5 rounded-lg shadow-md text-xs">
            Spatial grid warning: {gridError}. Falling back to radial simulation.
          </div>
        )}
      </div>

      {/* Map Footer Attribution & Info Bar */}
      <div className="p-3 bg-slate-50/80 border-t border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2 text-slate-600">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" />
            Target Coordinates ({latitude.toFixed(4)}°, {longitude.toFixed(4)}°)
          </span>
          <span className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-800 inline-block" />
            Ground Stations ({stations.length} detected)
          </span>
          <span className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            Spatial Grid ({gridPoints?.length || 0} samples)
          </span>
        </div>
        <p className="text-[10px] text-slate-400 font-mono">
          Tiles: CartoDB & OpenStreetMap • Atmosphere: Open-Meteo CC BY 4.0
        </p>
      </div>
    </div>
  );
};
