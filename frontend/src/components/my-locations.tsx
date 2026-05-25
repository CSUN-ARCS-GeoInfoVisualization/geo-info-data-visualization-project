import { useEffect, useRef, useState } from "react";
import { MapPin, Plus, Trash2, Loader2, RefreshCw, Home, Building2, School, Briefcase } from "lucide-react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { apiFetch } from "../services/api";

interface SavedLocation {
  id: number;
  name: string;
  address: string | null;
  lat: number;
  lon: number;
}

interface ZoneRisk {
  id: string;
  name: string;
  risk_pct: number | null;
  label: string | null;
}

interface AllZones {
  location_id: number;
  county: ZoneRisk | null;
  zip: ZoneRisk | null;
  neighborhood: ZoneRisk | null;
  census_tract: ZoneRisk | null;
}

type ZoneKey = "county" | "zip" | "neighborhood" | "census_tract";

const ZONE_OPTIONS: { key: ZoneKey; label: string }[] = [
  { key: "county", label: "County" },
  { key: "zip", label: "ZIP code" },
  { key: "neighborhood", label: "Neighborhood" },
  { key: "census_tract", label: "Census tract" },
];

// Map any tier label → the 4 broad color buckets used in the badge.
function colorForLabel(label: string | null): string {
  if (!label) return "bg-gray-100 text-gray-600 border-gray-200";
  if (["Catastrophic", "Critical", "Extreme"].includes(label)) return "bg-red-100 text-red-700 border-red-200";
  if (["Severe", "Very High", "High"].includes(label)) return "bg-orange-100 text-orange-700 border-orange-200";
  if (["Elevated", "Guarded"].includes(label)) return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-green-100 text-green-700 border-green-200";
}

const QUICK_LABELS = [
  { label: "Home", icon: Home },
  { label: "Work", icon: Briefcase },
  { label: "School", icon: School },
  { label: "Other", icon: Building2 },
];

export function MyLocations() {
  const placesLib = useMapsLibrary("places");

  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [zoneRisks, setZoneRisks] = useState<Record<number, AllZones>>({});
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [runningPredictions, setRunningPredictions] = useState(false);
  const [zoneType, setZoneType] = useState<ZoneKey>("county");

  // Add form state
  const [formName, setFormName] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formLat, setFormLat] = useState<number | null>(null);
  const [formLon, setFormLon] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const addressInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  // Wire up Places Autocomplete restricted to California
  useEffect(() => {
    if (!placesLib || !addressInputRef.current) return;

    autocompleteRef.current = new placesLib.Autocomplete(addressInputRef.current, {
      componentRestrictions: { country: "us" },
      fields: ["formatted_address", "geometry", "name"],
      bounds: new google.maps.LatLngBounds(
        { lat: 32.5, lng: -124.5 },
        { lat: 42.0, lng: -114.1 }
      ),
      strictBounds: false,
    });

    autocompleteRef.current.addListener("place_changed", () => {
      const place = autocompleteRef.current!.getPlace();
      if (!place.geometry?.location) return;
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      setFormLat(lat);
      setFormLon(lng);
      setFormAddress(place.formatted_address ?? place.name ?? "");
      if (addressInputRef.current) {
        addressInputRef.current.value = place.formatted_address ?? place.name ?? "";
      }
    });
  }, [placesLib]);

  const fetchLocations = async () => {
    setLoadingLocations(true);
    try {
      const res = await apiFetch("/me/locations");
      if (res.ok) {
        const data = await res.json();
        setLocations(data);
      }
    } finally {
      setLoadingLocations(false);
    }
  };

  useEffect(() => {
    fetchLocations();
  }, []);

  // For each location, hit the new /risk-by-all-zones endpoint (parallel).
  // Each response has county / zip / neighborhood / census_tract risks; the
  // global zoneType selector just picks which one to show.
  const runPredictions = async (locs: SavedLocation[]) => {
    if (locs.length === 0) return;
    setRunningPredictions(true);
    try {
      const responses = await Promise.all(
        locs.map(async (l) => {
          try {
            const res = await apiFetch(`/me/locations/${l.id}/risk-by-all-zones`);
            if (!res.ok) return null;
            return (await res.json()) as AllZones;
          } catch {
            return null;
          }
        })
      );
      setZoneRisks((prev) => {
        const next = { ...prev };
        responses.forEach((r) => {
          if (r) next[r.location_id] = r;
        });
        return next;
      });
    } finally {
      setRunningPredictions(false);
    }
  };

  // Auto-run predictions when locations load
  useEffect(() => {
    if (locations.length > 0) runPredictions(locations);
  }, [locations]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formName.trim()) { setFormError("Please enter a name for this location"); return; }
    if (formLat === null || formLon === null) { setFormError("Please select an address from the dropdown"); return; }

    setAdding(true);
    try {
      const res = await apiFetch("/me/locations", {
        method: "POST",
        body: JSON.stringify({ name: formName.trim(), address: formAddress, lat: formLat, lon: formLon }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || "Failed to save location"); return; }

      const newLoc: SavedLocation = data;
      setLocations((prev) => [...prev, newLoc]);
      // Run prediction for the new location
      runPredictions([newLoc]);

      // Reset form
      setFormName("");
      setFormAddress("");
      setFormLat(null);
      setFormLon(null);
      if (addressInputRef.current) addressInputRef.current.value = "";
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await apiFetch(`/me/locations/${id}`, { method: "DELETE" });
    if (res.ok) {
      setLocations((prev) => prev.filter((l) => l.id !== id));
      setZoneRisks((prev) => { const copy = { ...prev }; delete copy[id]; return copy; });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">My Locations</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Save places you care about and check their wildfire risk
          </p>
        </div>
        {locations.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex rounded-full border bg-muted/40 p-0.5 text-xs">
              {ZONE_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setZoneType(key)}
                  className={`px-2.5 py-1 rounded-full transition-colors ${
                    zoneType === key
                      ? "bg-white shadow text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runPredictions(locations)}
              disabled={runningPredictions}
            >
              {runningPredictions
                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh risk
            </Button>
          </div>
        )}
      </div>

      {/* Add location form */}
      <div className="border rounded-lg p-4 bg-muted/30 space-y-4">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Plus className="h-4 w-4" /> Add a location
        </h3>

        <form onSubmit={handleAdd} className="space-y-3">
          {/* Quick label buttons */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Label</Label>
            <div className="flex gap-2 flex-wrap">
              {QUICK_LABELS.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setFormName(label)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                    formName === label
                      ? "bg-red-500 text-white border-red-500"
                      : "bg-background border-border hover:border-red-300"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              ))}
              <Input
                placeholder="Custom label…"
                value={QUICK_LABELS.some((q) => q.label === formName) ? "" : formName}
                onChange={(e) => setFormName(e.target.value)}
                className="h-8 w-36 text-xs"
              />
            </div>
          </div>

          {/* Address search */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Address in California</Label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                ref={addressInputRef}
                type="text"
                placeholder="Search for an address…"
                className="w-full border rounded-md pl-10 pr-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {formLat !== null && formLon !== null && (
              <p className="text-xs text-muted-foreground pl-1">
                {formLat.toFixed(5)}, {formLon.toFixed(5)}
              </p>
            )}
          </div>

          {formError && <p className="text-xs text-red-500">{formError}</p>}

          <Button type="submit" disabled={adding} size="sm" className="bg-red-500 hover:bg-red-600">
            {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Save location
          </Button>
        </form>
      </div>

      <Separator />

      {/* Saved locations list */}
      {loadingLocations ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading locations…
        </div>
      ) : locations.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <MapPin className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No locations saved yet.</p>
          <p className="text-xs mt-1">Add your home, school, or workplace above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {locations.map((loc) => {
            const all = zoneRisks[loc.id];
            const zone = all ? all[zoneType] : null;
            return (
              <div
                key={loc.id}
                className="flex items-center justify-between p-4 border rounded-lg bg-background hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <MapPin className="h-5 w-5 text-red-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{loc.name}</p>
                    {loc.address && (
                      <p className="text-xs text-muted-foreground truncate max-w-xs">{loc.address}</p>
                    )}
                    {zone && (
                      <p className="text-xs text-muted-foreground">
                        {ZONE_OPTIONS.find((z) => z.key === zoneType)?.label}:{" "}
                        <span className="font-medium text-foreground">{zone.name}</span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {runningPredictions && !all ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : zone && zone.label && zone.risk_pct != null ? (
                    <div className="text-right">
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${colorForLabel(zone.label)}`}>
                        {zone.label}
                      </span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {zone.risk_pct.toFixed(0)}% risk
                      </p>
                    </div>
                  ) : all ? (
                    <span className="text-xs text-muted-foreground italic">no data</span>
                  ) : null}

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(loc.id)}
                    className="text-muted-foreground hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}