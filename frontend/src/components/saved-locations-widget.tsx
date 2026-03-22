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
  risk_level: string;
  risk_probability: number;
}

const RISK_COLORS: Record<string, string> = {
  Low: "bg-green-100 text-green-700 border-green-200",
  Medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  High: "bg-red-100 text-red-700 border-red-200",
  Extreme: "bg-purple-100 text-purple-700 border-purple-200",
};

const RISK_DOT: Record<string, string> = {
  Low: "bg-green-500",
  Medium: "bg-yellow-500",
  High: "bg-red-500",
  Extreme: "bg-purple-500",
};

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
      .finally(() => setLoading(false));
  }, []);

  const fetchPredictions = async (locs: SavedLocation[]) => {
    setPredicting(true);
    try {
      const res = await apiFetch("/predict/batch", {
        method: "POST",
        body: JSON.stringify({ items: locs.map((l) => ({ lat: l.lat, lon: l.lon })) }),
      });
      if (res.ok) {
        const data = await res.json();
        const map: Record<number, PredictionResult> = {};
        data.results.forEach((r: any, i: number) => {
          map[locs[i].id] = {
            risk_level: r.prediction.risk_level,
            risk_probability: r.prediction.risk_probability,
          };
        });
        setPredictions(map);
      }
    } finally {
      setPredicting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">My Locations</CardTitle>
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
                      <span className={`h-2 w-2 rounded-full shrink-0 ${RISK_DOT[pred.risk_level] ?? "bg-gray-400"}`} />
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
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${RISK_COLORS[pred.risk_level] ?? "bg-gray-100 text-gray-700"}`}>
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
