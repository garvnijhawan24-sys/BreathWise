import React from 'react';
import { 
  CloudSun, 
  Radio, 
  Clock, 
  AlertCircle, 
  RefreshCw,
  Building2,
  ChevronRight
} from 'lucide-react';
import type { CurrentAirQualityResponse, StationSummary, StationMeasurementsResponse } from '../types/api';
import { getAQIColor } from './AirQualityMap';

interface MetricsSidebarProps {
  aqData: CurrentAirQualityResponse | null;
  aqLoading: boolean;
  aqError: string | null;
  stations: StationSummary[];
  stationsLoading: boolean;
  selectedStation: StationSummary | null;
  measurementsData: StationMeasurementsResponse | null;
  measurementsLoading: boolean;
  onSelectStation: (station: StationSummary) => void;
  onClearStation: () => void;
}

export const MetricsSidebar: React.FC<MetricsSidebarProps> = ({
  aqData,
  aqLoading,
  aqError,
  stations,
  stationsLoading,
  selectedStation,
  measurementsData,
  measurementsLoading,
  onSelectStation,
  onClearStation,
}) => {
  const usAqi = aqData?.us_aqi?.value ?? null;
  const aqiColorInfo = getAQIColor(usAqi, 'us_aqi');

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* 1. Main AQI Status Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <CloudSun className="w-4 h-4 text-blue-600" />
              Atmospheric Index
            </span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
              Open-Meteo Model
            </span>
          </div>

          {aqLoading && (
            <div className="py-8 text-center text-slate-400">
              <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin text-blue-500" />
              <p className="text-xs">Updating atmospheric readings...</p>
            </div>
          )}

          {aqError && (
            <div className="py-4 text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>{aqError}</span>
            </div>
          )}

          {!aqLoading && aqData && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold tracking-tight text-slate-900 font-mono">
                      {usAqi !== null ? usAqi : '—'}
                    </span>
                    <span className="text-xs font-semibold text-slate-500 font-mono">US AQI</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span 
                      className="inline-block w-2.5 h-2.5 rounded-full" 
                      style={{ backgroundColor: aqiColorInfo.hex }} 
                    />
                    <span className="text-xs font-bold text-slate-800">
                      {aqData.us_aqi?.category || 'Not Available'}
                    </span>
                  </div>
                </div>

                {/* European AQI Tag */}
                {aqData.european_aqi?.value !== null && (
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block font-mono">EAQI (Europe)</span>
                    <span className="text-sm font-bold text-slate-700 font-mono">
                      {aqData.european_aqi.value}
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      {aqData.european_aqi.category}
                    </span>
                  </div>
                )}
              </div>

              {/* Description */}
              <p className="mt-3 text-xs text-slate-600 leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                {aqData.us_aqi?.description || 'Real-time numerical simulation from global models.'}
              </p>

              {/* Timestamp & Type banner */}
              <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400 font-mono pt-2 border-t border-slate-100">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {aqData.observed_at ? new Date(aqData.observed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}
                </span>
                <span className="text-slate-500 font-sans">
                  Continuous simulation
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Pollutants Grid */}
      {aqData && !aqLoading && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 pb-2 border-b border-slate-100 mb-3">
            Key Pollutant Concentrations
          </h4>

          <div className="grid grid-cols-2 gap-2.5">
            {[
              { key: 'pm2_5', label: 'PM2.5', value: aqData.pollutants['pm2_5']?.value, unit: 'µg/m³', highlight: true },
              { key: 'pm10', label: 'PM10', value: aqData.pollutants['pm10']?.value, unit: 'µg/m³' },
              { key: 'ozone', label: 'Ozone (O₃)', value: aqData.pollutants['ozone']?.value, unit: 'µg/m³' },
              { key: 'nitrogen_dioxide', label: 'NO₂', value: aqData.pollutants['nitrogen_dioxide']?.value, unit: 'µg/m³' },
              { key: 'carbon_monoxide', label: 'CO', value: aqData.pollutants['carbon_monoxide']?.value, unit: 'µg/m³' },
              { key: 'sulphur_dioxide', label: 'SO₂', value: aqData.pollutants['sulphur_dioxide']?.value, unit: 'µg/m³' },
            ].map((p) => (
              <div 
                key={p.key} 
                className={`p-2.5 rounded-xl border transition-colors ${
                  p.highlight 
                    ? 'bg-blue-50/50 border-blue-200/70' 
                    : 'bg-slate-50 border-slate-200/80'
                }`}
              >
                <span className="text-[11px] font-medium text-slate-500 block">{p.label}</span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-base font-bold text-slate-900 font-mono">
                    {p.value !== null && p.value !== undefined ? p.value : '—'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">{p.unit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Physical Ground Monitoring Stations (OpenAQ) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex-1 flex flex-col">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-1.5">
            <Radio className="w-4 h-4 text-indigo-600" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Ground Stations ({stations.length})
            </h4>
          </div>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
            OpenAQ Physical Sensors
          </span>
        </div>

        {stationsLoading && (
          <div className="py-6 text-center text-slate-400">
            <RefreshCw className="w-5 h-5 mx-auto mb-1.5 animate-spin text-indigo-500" />
            <p className="text-xs">Locating nearby sensor towers...</p>
          </div>
        )}

        {!stationsLoading && stations.length === 0 && (
          <div className="py-6 text-center text-slate-400 text-xs">
            <Building2 className="w-6 h-6 mx-auto mb-1 text-slate-300" />
            <p className="font-medium text-slate-600">No monitoring stations in radius</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Atmospheric models remain operational on the map.</p>
          </div>
        )}

        {!stationsLoading && stations.length > 0 && (
          <div className="mt-3 space-y-2 overflow-y-auto max-h-56 pr-1">
            {stations.map((st) => {
              const isSelected = selectedStation?.id === st.id;
              return (
                <button
                  key={st.id}
                  onClick={() => (isSelected ? onClearStation() : onSelectStation(st))}
                  className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200 shadow-2xs'
                      : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                  }`}
                >
                  <div className="truncate mr-2">
                    <p className="font-semibold text-slate-800 truncate">{st.name}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                      <span>ID #{st.id}</span>
                      <span>•</span>
                      <span>{st.distance_meters !== null ? `${(st.distance_meters / 1000).toFixed(1)} km` : '—'}</span>
                    </div>
                  </div>
                  <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${isSelected ? 'text-indigo-600 rotate-90' : 'text-slate-400'}`} />
                </button>
              );
            })}
          </div>
        )}

        {/* Selected Station Sensor Drawer */}
        {selectedStation && (
          <div className="mt-3 p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 text-xs">
            <div className="flex items-center justify-between font-bold text-indigo-950 pb-1.5 border-b border-indigo-200/60">
              <span className="truncate">{selectedStation.name}</span>
              <button
                onClick={onClearStation}
                className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer ml-2"
              >
                Close
              </button>
            </div>

            {measurementsLoading && (
              <p className="py-2 text-[11px] text-indigo-600 flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3 animate-spin" /> Querying station sensor readings...
              </p>
            )}

            {!measurementsLoading && measurementsData && (
              <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                {measurementsData.measurements.length === 0 ? (
                  <p className="text-[11px] text-slate-500">No active observations reported in the last cycle.</p>
                ) : (
                  measurementsData.measurements.slice(0, 5).map((m, idx) => (
                    <div key={idx} className="flex items-center justify-between py-0.5 text-[11px]">
                      <span className="uppercase font-semibold text-slate-700">{m.parameter}:</span>
                      <span className="font-mono font-bold text-slate-900">
                        {m.value} <span className="text-[10px] text-slate-500">{m.unit}</span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
