import React from 'react';
import { 
  Wind, 
  FileText, 
  Download, 
  TrendingUp, 
  Layers 
} from 'lucide-react';
import type { HealthResponse } from '../types/api';

interface NavbarProps {
  health: HealthResponse | null;
  onOpenReport: () => void;
  reportExportUrl: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  health,
  onOpenReport,
  reportExportUrl,
}) => {
  const isHealthy = health?.status === 'healthy';
  const mlOperational = health?.features?.ml_predictions === 'operational';

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-2xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        
        {/* Brand / Logo */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-600 text-white shadow-xs">
            <Wind className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-extrabold tracking-tight text-slate-900 font-sans">
                BreatheWise
              </h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-mono">
                Spatial IQ
              </span>
            </div>
            <p className="text-[10px] text-slate-500 leading-none hidden sm:block">
              Geospatial Air Quality Intelligence & Multi-Source Forecasting
            </p>
          </div>
        </div>

        {/* Section Navigation Anchors */}
        <nav className="hidden md:flex items-center gap-1 text-xs font-semibold text-slate-600">
          <a
            href="#map-section"
            className="px-3 py-1.5 rounded-lg hover:bg-slate-100 hover:text-blue-600 transition-colors flex items-center gap-1.5"
          >
            <Layers className="w-3.5 h-3.5 text-blue-600" />
            Heatmap & Stations
          </a>
          <a
            href="#ml-section"
            className="px-3 py-1.5 rounded-lg hover:bg-slate-100 hover:text-blue-600 transition-colors flex items-center gap-1.5"
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            ML Forecast
          </a>
          <button
            onClick={onOpenReport}
            className="px-3 py-1.5 rounded-lg hover:bg-slate-100 hover:text-blue-600 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-indigo-600" />
            Location Dossier
          </button>
        </nav>

        {/* Status Pill & Export Actions */}
        <div className="flex items-center gap-2">
          {/* System Status Indicator */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-[11px] font-medium text-slate-700">
            <span className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            <span>{isHealthy ? 'System Active' : 'Connecting...'}</span>
            {mlOperational && (
              <span className="text-[10px] text-emerald-700 font-semibold border-l border-slate-300 pl-1.5">
                ML Ready
              </span>
            )}
          </div>

          {/* Environmental Report CTA */}
          <button
            onClick={onOpenReport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Generate Report</span>
          </button>

          {/* Direct CSV Export */}
          <a
            href={reportExportUrl}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs transition-colors shadow-2xs"
            title="Export RFC 4180 CSV"
          >
            <Download className="w-4 h-4 text-slate-600" />
          </a>
        </div>
      </div>
    </header>
  );
};
