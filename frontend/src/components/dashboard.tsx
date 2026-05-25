import { useEffect, useState } from "react";
import { Thermometer, Droplets, Wind, Eye, MapPin, Info } from "lucide-react";
import { RiskLevelBadge, RiskLevel } from "./risk-level-badge";
import { ConditionCard } from "./condition-card";
import { RiskChart } from "./risk-chart";
import { ActiveAlerts } from "./active-alerts";
import { GoogleRiskMap, ActiveFiresMap } from "./GoogleRiskMap";
import { SavedLocationsWidget } from "./saved-locations-widget";
import { FIRMSMap } from "./FIRMSMap";
import { NewsTicker } from "./news-ticker";
import { apiFetch } from "../services/api";

interface DashboardProps {
  onAddLocation?: () => void;
}

interface ZoneRisk {
  id: string;
  name: string;
  risk_pct: number | null;
  label: string | null;
}

interface AllZones {
  county: ZoneRisk | null;
  zip: ZoneRisk | null;
  neighborhood: ZoneRisk | null;
  census_tract: ZoneRisk | null;
}

interface SavedLocation {
  id: number;
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  risk?: AllZones;
}

interface WeatherData {
  temperature: string;
  humidity: string;
  windSpeed: string;
  windGusts: string;
  visibility: string;
}

import { fetchOpenMeteo } from "../lib/openMeteoCache";

async function fetchWeather(lat: number, lng: number): Promise<WeatherData> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m` +
    `&hourly=visibility` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
    `&timezone=auto&forecast_days=1`;

  const data = await fetchOpenMeteo<any>(url);
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

function toRiskLevel(apiLevel: string | null | undefined): RiskLevel {
  // Compress the server's 9-tier scale into the 4 visual badge buckets.
  switch (apiLevel) {
    case "Catastrophic":
    case "Critical":
    case "Extreme":
      return "extreme";
    case "Severe":
    case "Very High":
    case "High":
      return "high";
    case "Elevated":
    case "Guarded":
    case "Medium":
      return "moderate";
    case "Low":
    default:
      return "low";
  }
}

const DEFAULT_LOCATION: SavedLocation = {
  id: -1,
  name: "Los Angeles",
  address: "Los Angeles, CA",
  lat: 34.0522,
  lon: -118.2437,
};

// Map's selector uses the cache-key form; risk-by-all-zones uses a tighter
// camel-ish form. Convert once here so every downstream widget agrees.
export type MapZoneLevel = "counties" | "zip-codes" | "neighborhoods" | "census-tracts";
export type ApiZoneKey   = "county"   | "zip"       | "neighborhood"  | "census_tract";

export function apiKeyForMapZone(z: MapZoneLevel): ApiZoneKey {
  switch (z) {
    case "counties":      return "county";
    case "zip-codes":     return "zip";
    case "neighborhoods": return "neighborhood";
    case "census-tracts": return "census_tract";
  }
}

export function Dashboard({ onAddLocation }: DashboardProps) {
  const [email, setEmail] = useState<string | null>(null);
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [riskLevel, setRiskLevel] = useState<RiskLevel | null>(null);
  const [usingDefault, setUsingDefault] = useState(false);
  // The Risk Zones map is now the canonical zone-type selector for the
  // whole dashboard. Badge + per-location widget + 7-day chart baseline
  // all follow whatever the user picks here.
  const [mapZoneLevel, setMapZoneLevel] = useState<MapZoneLevel>("counties");

  useEffect(() => {
    apiFetch("/me")
      .then(async (r) => { if (r.ok) { const d = await r.json(); setEmail(d.email); } })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // include=risk inlines the 4-zone risk payload on every row so the
    // badge + 'My Locations' widget don't need a second waterfall fetch.
    apiFetch("/me/locations?include=risk")
      .then(async (r) => {
        if (r.ok) {
          const data: SavedLocation[] = await r.json();
          if (data.length > 0) {
            setLocations(data);
            setSelectedId(data[0].id);
            setUsingDefault(false);
          } else {
            setLocations([DEFAULT_LOCATION]);
            setSelectedId(DEFAULT_LOCATION.id);
            setUsingDefault(true);
          }
        } else {
          setLocations([DEFAULT_LOCATION]);
          setSelectedId(DEFAULT_LOCATION.id);
          setUsingDefault(true);
        }
      })
      .catch(() => {
        setLocations([DEFAULT_LOCATION]);
        setSelectedId(DEFAULT_LOCATION.id);
        setUsingDefault(true);
      });
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
    // Risk is already inlined on `loc` via ?include=risk — no extra fetch.
    // Falls back to the public county cache only for the default-LA case.
    const apiKey = apiKeyForMapZone(mapZoneLevel);
    if (loc.id > 0) {
      const label = loc.risk?.[apiKey]?.label;
      if (label) setRiskLevel(toRiskLevel(label));
    } else {
      apiFetch("/research/risk-by-county")
        .then(async (r) => {
          if (r.ok) {
            const data = await r.json();
            const label = data.counties?.["Los Angeles"]?.label;
            if (label) setRiskLevel(toRiskLevel(label));
          }
        })
        .catch(() => {});
    }
  }, [selectedId, locations, mapZoneLevel]);

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

      {/* Zone-selector note — only meaningful for users with saved locations
          who are switching the map's zone level. Stays out of the way for
          default-LA users (who get the bigger banner above instead). */}
      {!usingDefault && mapZoneLevel !== "counties" && (
        <div className="rounded-lg bg-zinc-50 border border-zinc-200 px-4 py-2.5 flex items-start gap-2">
          <Info className="h-4 w-4 text-zinc-500 shrink-0 mt-0.5" />
          <p className="text-xs text-zinc-700 leading-relaxed">
            Risk values on this page now reflect the{" "}
            <strong>{mapZoneLevel === "zip-codes" ? "ZIP code" : mapZoneLevel === "neighborhoods" ? "neighborhood" : "census tract"}</strong>{" "}
            your saved location sits inside — the same value shown on the map polygon. Switch the dropdown above the map to compare different scopes.
          </p>
        </div>
      )}

      {/* Default-LA users get a smaller note when they pick a non-county
          zone: we can't resolve their ZIP/neighborhood/tract without a
          saved point, so the badge stays county-level. */}
      {usingDefault && mapZoneLevel !== "counties" && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 flex items-start gap-2">
          <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">
            Risk badges below stay at <strong>county</strong> level until you save a location. ZIP-, neighborhood-, and census-tract-level personalization needs an exact point to look up.
          </p>
        </div>
      )}

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

      </div>

      {/* Risk Zone & Active Fire Maps */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Risk Zone & Active Fire Maps</h2>
            <p className="text-sm text-muted-foreground">California-wide wildfire risk and live fire activity</p>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <GoogleRiskMap zoneLevel={mapZoneLevel} onZoneLevelChange={setMapZoneLevel} />
          </div>
          <SavedLocationsWidget
            onAddLocation={onAddLocation}
            zoneKey={apiKeyForMapZone(mapZoneLevel)}
            locations={usingDefault ? [] : locations}
          />
        </div>
        <ActiveFiresMap />
      </section>

      {/* 7-Day Forecast + Active Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RiskChart
            title="7-Day Risk Forecast"
            type="area"
            lat={selectedLocation?.lat}
            lon={selectedLocation?.lon}
            locationId={selectedLocation && selectedLocation.id > 0 ? selectedLocation.id : undefined}
            zoneKey={apiKeyForMapZone(mapZoneLevel)}
          />
        </div>
        <ActiveAlerts />
      </div>
    </div>
  );
}