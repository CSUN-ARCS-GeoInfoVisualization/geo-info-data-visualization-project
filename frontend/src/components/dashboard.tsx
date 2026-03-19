import { useEffect, useState } from "react";
import { Thermometer, Droplets, Wind, Eye, MapPin } from "lucide-react";
import { RiskLevelBadge, RiskLevel } from "./risk-level-badge";
import { ConditionCard } from "./condition-card";
import { RiskChart } from "./risk-chart";
import { ActiveAlerts } from "./active-alerts";
import { GoogleRiskMap } from "./GoogleRiskMap";
import { SavedLocationsWidget } from "./saved-locations-widget";
import { FIRMSMap } from "./FIRMSMap";
import { NewsTicker } from "./news-ticker";
export function Dashboard({ onAddLocation }: DashboardProps) {
  const [email, setEmail] = useState<string | null>(null);
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [riskLevel, setRiskLevel] = useState<RiskLevel | null>(null);
  const [usingDefault, setUsingDefault] = useState(false);
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
      {/* News Ticker */}
      <NewsTicker />

      {/* Default location hint */}
      {usingDefault && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-blue-500 shrink-0" />
          <p className="text-sm text-blue-800">
            Showing data for <strong>Los Angeles</strong> (default). Save a location to see personalized weather and fire risk for your area.
          </p>
        </div>
      )}

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