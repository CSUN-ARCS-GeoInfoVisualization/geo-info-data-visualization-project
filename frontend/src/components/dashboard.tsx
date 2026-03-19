import { useEffect, useState } from "react";
import { Thermometer, Droplets, Wind, Eye, MapPin } from "lucide-react";
import { RiskLevelBadge, RiskLevel } from "./risk-level-badge";
import { ConditionCard } from "./condition-card";
import { RiskChart } from "./risk-chart";
import { ActiveAlerts } from "./active-alerts";
import { GoogleRiskMap } from "./GoogleRiskMap";
import { SavedLocationsWidget } from "./saved-locations-widget";
import { apiFetch } from "../services/api";

interface DashboardProps {
  onAddLocation?: () => void;
}

interface SavedLocation {
  id: number;
  name: string;
  address: string | null;
  lat: number;
  lon: number;
}

interface WeatherData {
  temperature: string;
  humidity: string;
  windSpeed: string;
  windGusts: string;
  visibility: string;
}

async function fetchWeather(lat: number, lng: number): Promise<WeatherData> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m` +
    `&hourly=visibility` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
    `&timezone=auto&forecast_days=1`;

  const res = await fetch(url);
  const data = await res.json();
  const c = data.current;
  const visibilityMeters: number = data.hourly.visibility[0] ?? 0;

  return {
    temperature: Math.round(c.temperature_2m).toString(),
    humidity: Math.round(c.relative_humidity_2m).toString(),
    windSpeed: Math.round(c.wind_speed_10m).toString(),
    windGusts: Math.round(c.wind_gusts_10m).toString(),
    visibility: (visibilityMeters / 1609.34).toFixed(1),
  };
}

function toRiskLevel(apiLevel: string): RiskLevel {
  const map: Record<string, RiskLevel> = {
    Low: "low",
    Medium: "moderate",
    High: "high",
    Extreme: "extreme",
  };
  return map[apiLevel] ?? "low";
}

export function Dashboard({ onAddLocation }: DashboardProps) {
  const [email, setEmail] = useState<string | null>(null);
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [riskLevel, setRiskLevel] = useState<RiskLevel | null>(null);

  useEffect(() => {
    apiFetch("/me")
      .then(async (r) => { if (r.ok) { const d = await r.json(); setEmail(d.email); } })
      .catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch("/me/locations")
      .then(async (r) => {
        if (r.ok) {
          const data: SavedLocation[] = await r.json();
          setLocations(data);
          if (data.length > 0) setSelectedId(data[0].id);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch weather and risk whenever the selected location changes
  useEffect(() => {
    const loc = locations.find((l) => l.id === selectedId);
    if (!loc) return;

    setWeatherLoading(true);
    setWeather(null);
    fetchWeather(loc.lat, loc.lon)
      .then(setWeather)
      .catch(() => {})
      .finally(() => setWeatherLoading(false));

    setRiskLevel(null);
    apiFetch("/predict/batch", {
      method: "POST",
      body: JSON.stringify({ items: [{ lat: loc.lat, lon: loc.lon }] }),
    })
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json();
          const level = data.results[0]?.prediction?.risk_level;
          if (level) setRiskLevel(toRiskLevel(level));
        }
      })
      .catch(() => {});
  }, [selectedId, locations]);

  const selectedLocation = locations.find((l) => l.id === selectedId) ?? null;

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          {email && (
            <p className="text-sm text-muted-foreground mt-1">
              Welcome back, <span className="font-medium text-foreground">{email}</span>
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground mb-1">Current Risk Level</p>
          {riskLevel ? (
            <RiskLevelBadge level={riskLevel} size="lg" />
          ) : (
            <span className="text-sm text-muted-foreground">{selectedId ? "Loading…" : "—"}</span>
          )}
        </div>
      </div>

      {/* Current Conditions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {locations.length === 0
              ? "No saved locations — add one in Settings"
              : selectedLocation
              ? `Current conditions · ${selectedLocation.name}${selectedLocation.address ? ` · ${selectedLocation.address}` : ""}`
              : "Loading…"}
          </p>

          {locations.length > 1 && (
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="text-xs border rounded-md px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <ConditionCard
            title="Temperature"
            value={weatherLoading ? "…" : (weather?.temperature ?? "—")}
            unit="°F"
            icon={Thermometer}
            trend="stable"
            trendValue={weather ? "Live data" : weatherLoading ? "Loading…" : "No location"}
          />
          <ConditionCard
            title="Humidity"
            value={weatherLoading ? "…" : (weather?.humidity ?? "—")}
            unit="%"
            icon={Droplets}
            trend="stable"
            trendValue={weather ? "Live data" : weatherLoading ? "Loading…" : "No location"}
          />
          <ConditionCard
            title="Wind Speed"
            value={weatherLoading ? "…" : (weather?.windSpeed ?? "—")}
            unit="mph"
            icon={Wind}
            trend="up"
            trendValue={weather ? `Gusts up to ${weather.windGusts} mph` : weatherLoading ? "Loading…" : "No location"}
          />
          <ConditionCard
            title="Visibility"
            value={weatherLoading ? "…" : (weather?.visibility ?? "—")}
            unit="miles"
            icon={Eye}
            trend="stable"
            trendValue={weather ? "Live data" : weatherLoading ? "Loading…" : "No location"}
          />
        </div>

        {locations.length === 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            <button onClick={onAddLocation} className="text-red-500 hover:underline">
              Add a location
            </button>{" "}
            to see live weather conditions.
          </p>
        )}
      </div>

      {/* Map + My Locations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <GoogleRiskMap height="h-[420px]" />
        </div>
        <SavedLocationsWidget onAddLocation={onAddLocation} />
      </div>

      {/* 7-Day Forecast + Active Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RiskChart title="7-Day Risk Forecast" type="area" />
        </div>
        <ActiveAlerts />
      </div>
    </div>
  );
}