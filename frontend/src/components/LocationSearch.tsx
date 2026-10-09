import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  MapPin, 
  Navigation, 
  RefreshCw, 
  ChevronDown, 
  SlidersHorizontal,
  X
} from 'lucide-react';
import { searchLocations } from '../services/api';
import type { GeocodingResultItem } from '../types/api';

interface LocationSearchProps {
  latitude: string;
  longitude: string;
  radiusKm: number;
  onCoordinatesChange: (lat: string, lon: string) => void;
  onRadiusChange: (rad: number) => void;
  onRefresh: () => void;
  isLoading: boolean;
  selectedPlaceName?: string;
}

const PRESETS = [
  { name: 'Chennai', lat: 13.0827, lon: 80.2707, country: 'IN' },
  { name: 'New Delhi', lat: 28.6139, lon: 77.2090, country: 'IN' },
  { name: 'London', lat: 51.5074, lon: -0.1278, country: 'GB' },
  { name: 'New York', lat: 40.7128, lon: -74.0060, country: 'US' },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503, country: 'JP' },
];

export const LocationSearch: React.FC<LocationSearchProps> = ({
  latitude,
  longitude,
  radiusKm,
  onCoordinatesChange,
  onRadiusChange,
  onRefresh,
  isLoading,
  selectedPlaceName,
}) => {
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<GeocodingResultItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [showCoordInputs, setShowCoordInputs] = useState<boolean>(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const debounceTimerRef = useRef<number | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Debounced geocoding search
  const handleQueryChange = (text: string) => {
    setQuery(text);
    setGeoError(null);

    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }

    if (text.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    debounceTimerRef.current = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const resp = await searchLocations(text.trim(), 5);
        setResults(resp.results);
        setIsOpen(true);
      } catch (err: unknown) {
        setGeoError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const handleSelectLocation = (loc: GeocodingResultItem) => {
    onCoordinatesChange(loc.latitude.toFixed(4), loc.longitude.toFixed(4));
    setQuery(`${loc.name}${loc.country ? `, ${loc.country}` : ''}`);
    setIsOpen(false);
  };

  // Browser Geolocation
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser');
      return;
    }
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onCoordinatesChange(
          pos.coords.latitude.toFixed(4),
          pos.coords.longitude.toFixed(4)
        );
        setQuery('My Current Location');
      },
      (err) => {
        setGeoError(`Location access denied: ${err.message}`);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  return (
    <div className="bg-white border-b border-slate-200 sticky top-14 z-30 shadow-2xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        
        {/* Left: Search input with Autocomplete */}
        <div ref={containerRef} className="relative flex-1 max-w-lg">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onFocus={() => {
                if (results.length > 0) setIsOpen(true);
              }}
              placeholder="Search city, region, or address (e.g. Chennai, London, Tokyo)..."
              className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('');
                  setResults([]);
                  setIsOpen(false);
                }}
                className="absolute right-2.5 p-0.5 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {isSearching && (
              <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin absolute right-8" />
            )}
          </div>

          {/* Autocomplete Dropdown */}
          {isOpen && results.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden divide-y divide-slate-100 max-h-60 overflow-y-auto">
              {results.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => handleSelectLocation(loc)}
                  className="w-full px-3.5 py-2.5 text-left text-xs hover:bg-blue-50/70 flex items-center justify-between group transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    <div>
                      <span className="font-semibold text-slate-800 group-hover:text-blue-900">
                        {loc.name}
                      </span>
                      {loc.admin1 && (
                        <span className="text-slate-500 text-[11px] ml-1">
                          • {loc.admin1}
                        </span>
                      )}
                      {loc.country && (
                        <span className="text-slate-400 text-[11px] ml-1">
                          ({loc.country})
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 group-hover:text-blue-600">
                    {loc.latitude.toFixed(2)}°, {loc.longitude.toFixed(2)}°
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Center: Quick Presets */}
        <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-500">
          <span className="text-[11px] font-medium text-slate-400 mr-1">Presets:</span>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => {
                onCoordinatesChange(p.lat.toString(), p.lon.toString());
                setQuery(`${p.name}, ${p.country}`);
              }}
              className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium transition-colors cursor-pointer border border-slate-200"
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* Right: Actions (Current Location, Coord Overrides, Refresh) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleUseCurrentLocation}
            title="Use My Current GPS Location"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors shadow-2xs cursor-pointer"
          >
            <Navigation className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden sm:inline">My Location</span>
          </button>

          <button
            onClick={() => setShowCoordInputs(!showCoordInputs)}
            title="Toggle Precise Coordinates & Radius"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors shadow-2xs cursor-pointer ${
              showCoordInputs
                ? 'bg-blue-50 text-blue-700 border-blue-300'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Coordinates</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showCoordInputs ? 'rotate-180' : ''}`} />
          </button>

          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Expandable Manual Coordinate & Radius Bar */}
      {showCoordInputs && (
        <div className="bg-slate-50 border-t border-slate-200 px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <label className="font-medium text-slate-700">Latitude:</label>
            <input
              type="number"
              step="any"
              value={latitude}
              onChange={(e) => onCoordinatesChange(e.target.value, longitude)}
              className="w-24 px-2 py-1 text-xs border border-slate-300 rounded bg-white font-mono focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="font-medium text-slate-700">Longitude:</label>
            <input
              type="number"
              step="any"
              value={longitude}
              onChange={(e) => onCoordinatesChange(latitude, e.target.value)}
              className="w-24 px-2 py-1 text-xs border border-slate-300 rounded bg-white font-mono focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="font-medium text-slate-700">Radius:</label>
            <select
              value={radiusKm}
              onChange={(e) => onRadiusChange(parseInt(e.target.value, 10))}
              className="px-2 py-1 text-xs border border-slate-300 rounded bg-white focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
            >
              <option value={10}>10 km</option>
              <option value={25}>25 km (Default)</option>
              <option value={50}>50 km</option>
              <option value={100}>100 km</option>
            </select>
          </div>
          {selectedPlaceName && (
            <span className="text-slate-500 text-[11px] italic">
              Active location: <strong className="text-slate-700">{selectedPlaceName}</strong>
            </span>
          )}
        </div>
      )}

      {geoError && (
        <div className="bg-rose-50 border-t border-rose-200 px-4 py-1.5 text-xs text-rose-700">
          {geoError}
        </div>
      )}
    </div>
  );
};
