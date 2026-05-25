import { useEffect, useState } from "react";
import { MapPin, Loader2, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { apiFetch } from "../services/api";

interface SavedLocation {
  id: number;
  name: string;
  address: string | null;
  lat: number;
  lon: number;
}

interface PredictionResult {
  risk_level: string;       // 9-tier label, normalized into the 4 visual buckets via colorForLabel
  risk_probability: number; // 0..1
}

// Server returns a 9-tier label; compress to 4 visual buckets to keep the
// badge scannable and consistent with my-locations.tsx + dashboard badge.
function colorForLabel(label: string): string {
  if (["Catastrophic", "Critical", "Extreme"].includes(label)) return "bg-red-100 text-red-700 border-red-200";
  if (["Severe", "Very High", "High"].includes(label)) return "bg-orange-100 text-orange-700 border-orange-200";
  if (["Elevated", "Guarded", "Medium"].includes(label)) return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-green-100 text-green-700 border-green-200";
}

function dotForLabel(label: string): string {
  if (["Catastrophic", "Critical", "Extreme"].includes(label)) return "bg-red-500";
  if (["Severe", "Very High", "High"].includes(label)) return "bg-orange-500";
  if (["Elevated", "Guarded", "Medium"].includes(label)) return "bg-yellow-500";
  return "bg-green-500";
}

interface SavedLocationsWidgetProps {
  onAddLocation?: () => void;
}

export function SavedLocationsWidget({ onAddLocation }: SavedLocationsWidgetProps) {
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [predictions, setPredictions] = useState<Record<number, PredictionResult>>({});
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);

  useEffect(() => {
    apiFetch("/me/locations")
      .then(async (r) => {
        if (r.ok) {
          const data: SavedLocation[] = await r.json();
          setLocations(data);
          if (data.length > 0) fetchPredictions(data);
        }
      })
      .catch(() => {
        /* backend unreachable */
      })
      .finally(() => setLoading(false));
  }, []);

  // Read each location's COUNTY risk from the cached map data so the badge
  // matches what the user sees on the dashboard map. Same source of truth
  // as my-locations.tsx, the Dashboard "Current Risk Level" badge, and the
  // alert email body.
  const fetchPredictions = async (locs: SavedLocation[]) => {
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
        if (r && r.county && r.county.label && r.county.risk_pct != null) {
          map[locs[i].id] = {
            risk_level: r.county.label,
            risk_probability: r.county.risk_pct / 100,
          };
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
