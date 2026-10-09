export interface HealthResponse {
  status: 'healthy';
  service: string;
  environment: string;
  version: string;
  features: {
    open_meteo: string;
    openaq: string;
    ml_predictions: string;
    database: string;
  };
}

export interface AQIReading {
  value: number | null;
  scale: string;
  category: string;
  description: string;
}

export interface PollutantValue {
  value: number | null;
  unit: string;
  display_name: string;
}

export interface CurrentAirQualityResponse {
  latitude: number;
  longitude: number;
  grid_latitude?: number | null;
  grid_longitude?: number | null;
  elevation: number | null;
  timezone: string;
  observed_at: string;
  retrieved_at: string;
  source: string;
  data_type: 'atmospheric_model_estimate';
  attribution: string;
  european_aqi: AQIReading;
  us_aqi: AQIReading;
  pollutants: Record<string, PollutantValue>;
  cached: boolean;
}

export interface StationCoordinates {
  latitude: number;
  longitude: number;
}

export interface StationSensorSummary {
  id: number;
  name: string;
  parameter: string;
  units: string;
}

export interface StationSummary {
  id: number;
  name: string;
  coordinates: StationCoordinates;
  distance_meters: number | null;
  locality: string | null;
  country: string | null;
  timezone: string | null;
  sensors: StationSensorSummary[];
}

export interface NearbyStationsResponse {
  latitude: number;
  longitude: number;
  radius_meters: number;
  source: string;
  data_type: 'monitoring_station_locations';
  attribution: string;
  stations: StationSummary[];
  total_found: number;
  cached: boolean;
}

export interface GroundMeasurement {
  parameter: string;
  value: number | null;
  unit: string;
  observed_at: string;
  sensor_id: number;
}

export interface StationMeasurementsResponse {
  station_id: number;
  station_name: string;
  coordinates: StationCoordinates | null;
  source: string;
  data_type: 'ground_station_observations';
  attribution: string;
  retrieved_at: string;
  measurements: GroundMeasurement[];
  cached: boolean;
}

export interface MLForecastPoint {
  timestamp: string;
  predicted_pm2_5: number;
  unit: string;
  horizon_hour: number;
}

export interface MLForecastResponse {
  pollutant: string;
  unit: string;
  horizon_hours: number;
  model: string | null;
  model_version: string | null;
  mae: number | null;
  rmse: number | null;
  baseline_mae: number | null;
  baseline_rmse: number | null;
  status: 'operational' | 'model_not_trained' | 'insufficient_data';
  message: string;
  predictions: MLForecastPoint[];
  metadata?: Record<string, unknown> | null;
}

export interface ApiError {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface ReportOpenMeteoSection {
  available: boolean;
  status: 'operational' | 'upstream_error' | 'timeout';
  observed_at?: string | null;
  retrieved_at?: string | null;
  grid_latitude?: number | null;
  grid_longitude?: number | null;
  elevation?: number | null;
  european_aqi?: AQIReading | null;
  us_aqi?: AQIReading | null;
  pollutants: Record<string, PollutantValue>;
  attribution: string;
  data_type: 'atmospheric_model_estimate';
  error_message?: string | null;
}

export interface ReportOpenAQStationSummary {
  station_id: number;
  station_name: string;
  distance_km: number;
  coordinates: StationCoordinates;
  measurements: GroundMeasurement[];
}

export interface ReportOpenAQSection {
  available: boolean;
  status: 'operational' | 'unauthenticated' | 'no_stations_found' | 'upstream_error' | 'timeout';
  message: string;
  radius_meters: number;
  stations_found: number;
  stations: ReportOpenAQStationSummary[];
  attribution: string;
  data_type: 'ground_station_observations';
}

export interface ReportMLSection {
  status: 'operational' | 'model_not_trained' | 'insufficient_data';
  message: string;
  disclaimer: string;
}

export interface EnvironmentalReport {
  report_id: string;
  generated_at: string;
  target_latitude: number;
  target_longitude: number;
  open_meteo: ReportOpenMeteoSection;
  openaq: ReportOpenAQSection;
  ml_forecast: ReportMLSection;
  disclaimers: string[];
}


