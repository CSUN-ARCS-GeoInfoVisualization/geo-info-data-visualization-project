import { useEffect, useState } from "react";
import { MapPin, Loader2, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { apiFetch } from "../services/api";

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

interface PredictionResult {
  risk_level: string;       // 5-tier NFDRS label
  risk_probability: number; // 0..1
}

// 5-tier NFDRS → one distinct badge color per tier (Low=green, Moderate=yellow,
// High=orange, Very High=red, Extreme=dark red). Mirrors my-locations.tsx so
// the badge looks identical on dashboard sidebar and Locations page.
function colorForLabel(label: string): string {
  if (label === "Extreme")   return "bg-red-200 text-red-900 border-red-300";
  if (label === "Very High") return "bg-red-100 text-red-700 border-red-200";
  if (label === "High")      return "bg-orange-100 text-orange-700 border-orange-200";
  if (label === "Moderate")  return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-green-100 text-green-700 border-green-200";
}

function dotForLabel(label: string): string {
  if (label === "Extreme")   return "bg-red-700";
  if (label === "Very High") return "bg-red-500";
  if (label === "High")      return "bg-orange-500";
  if (label === "Moderate")  return "bg-yellow-500";
  return "bg-green-500";
}

type ApiZoneKey = "county" | "zip" | "neighborhood" | "census_tract";

interface SavedLocationsWidgetProps {
  onAddLocation?: () => void;
  // Which zone's risk the badges should display. Driven by the map's selector
  // on the Dashboard so badges + map polygons always agree.
  zoneKey?: ApiZoneKey;
  // Optional: parent already fetched locations with ?include=risk. When
  // provided, skip our own fetch entirely so the badge isn't waiting on a
  // duplicate /me/locations round trip.
  locations?: SavedLocation[];
}

export function SavedLocationsWidget({ onAddLocation, zoneKey = "county", locations: locationsProp }: SavedLocationsWidgetProps) {
  const [locations, setLocations] = useState<SavedLocation[]>(locationsProp ?? []);
  const [predictions, setPredictions] = useState<Record<number, PredictionResult>>({});
  const [loading, setLoading] = useState(locationsProp === undefined);
  const [predicting, setPredicting] = useState(false);

  // Two render paths:
  // 1. Parent provided `locations` (with .risk inlined): use those directly,
  //    no fetch. Recompute badges whenever zoneKey or the list changes.
  // 2. Parent didn't (legacy callers): fall back to fetching ourselves.
  useEffect(() => {
    if (locationsProp !== undefined) {
      setLocations(locationsProp);
      // Use inlined risk straight off each row — no extra round trip.
      const map: Record<number, PredictionResult> = {};
      for (const l of locationsProp) {
        const z = l.risk?.[zoneKey];
        if (z && z.label && z.risk_pct != null) {
          map[l.id] = { risk_level: z.label, risk_probability: z.risk_pct / 100 };
        }
      }
      setPredictions(map);
      setLoading(false);
      return;
    }
    apiFetch("/me/locations?include=risk")
      .then(async (r) => {
        if (r.ok) {
          const data: SavedLocation[] = await r.json();
          setLocations(data);
          if (data.length > 0) fetchPredictions(data, zoneKey);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationsProp, zoneKey]);

  // Read each location's risk for the active zone type from the same cached
  // map data the dashboard map renders. Re-runs whenever zoneKey changes so
  // the badges follow the map selector live.
  const fetchPredictions = async (locs: SavedLocation[], key: ApiZoneKey) => {
    setPredicting(true);
    try {
      const responses = await Promise.all(
        locs.map(async (l) => {
          try {
            const r = await apiFetch(`/me/locations/${l.id}/risk-by-all-zones`);
            if (!r.ok) return null;
            return await r.json();
          } catch {
            return null;
          }
        })
      );
      const map: Record<number, PredictionResult> = {};
      responses.forEach((r, i) => {
        const z = r?.[key];
        if (z && z.label && z.risk_pct != null) {
          map[locs[i].id] = { risk_level: z.label, risk_probability: z.risk_pct / 100 };
        }
      });
      setPredictions(map);
    } finally {
      setPredicting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">My Locations</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">Up to 20 locations shown on the maps</p>
        </div>
        {onAddLocation && (
          <button
            onClick={onAddLocation}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : locations.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <MapPin className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No saved locations yet.</p>
            {onAddLocation && (
              <button
                onClick={onAddLocation}
                className="text-xs text-red-500 hover:underline mt-1"
              >
                Add your first location
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {locations.map((loc) => {
              const pred = predictions[loc.id];
              return (
                <li
                  key={loc.id}
                  className="flex items-center justify-between gap-3 py-2 border-b last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {pred && (
                      <span className={`h-2 w-2 rounded-full shrink-0 ${dotForLabel(pred.risk_level)}`} />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{loc.name}</p>
                      {loc.address && (
                        <p className="text-xs text-muted-foreground truncate">{loc.address}</p>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    {predicting && !pred ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : pred ? (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colorForLabel(pred.risk_level)}`}>
                        {pred.risk_level}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
