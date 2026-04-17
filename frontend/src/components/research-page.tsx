import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlaskConical, Map as MapIcon, SlidersHorizontal, Layers, Flame, Send, Clock, Loader2,
} from "lucide-react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { firmsPointsToPolygonCollection } from "../utils/firmsPolygons";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { apiFetch } from "../services/api";
import countyGeoJson from "../Data/california-counties.json";

interface ResearchPageProps {
  userRole: string | null;
}

/* ------------------------------------------------------------------ */
/*  Public / Resident view — info + request access                     */
/* ------------------------------------------------------------------ */
function RequestAccessView() {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/me/role-request")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.status === "pending") setPending(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const submit = async () => {
    const r = await apiFetch("/me/role-request", {
      method: "POST",
      body: JSON.stringify({ role: "Researcher", reason }),
    });
    if (r.ok) {
      setSubmitted(true);
      setPending(true);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <FlaskConical className="h-16 w-16 mx-auto text-blue-500" />
        <h1 className="text-3xl font-bold">Research Portal</h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto">
          Explore California fire data with interactive maps, adjust risk parameters,
          and analyze historical fire patterns in real-time.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { icon: MapIcon, title: "Interactive Fire Map", desc: "Visualize FIRMS hotspots, risk predictions, and historical perimeters on an interactive map" },
          { icon: SlidersHorizontal, title: "Adjustable Parameters", desc: "Fine-tune confidence thresholds, fire radiative power, and risk score cutoffs with sliders" },
          { icon: Layers, title: "Multiple Data Layers", desc: "Toggle between FIRMS satellite data, ML risk heatmaps, and historical fire perimeters" },
          { icon: Flame, title: "Real-Time Risk Colors", desc: "See color-coded risk gradients from green (low) to dark red (extreme) across California" },
        ].map(({ icon: Icon, title, desc }) => (
          <Card key={title}>
            <CardContent className="pt-6">
              <Icon className="h-8 w-8 mb-3 text-blue-500" />
              <h3 className="font-semibold mb-1">{title}</h3>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {pending ? (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="pt-6 text-center">
            <Clock className="h-8 w-8 mx-auto mb-3 text-blue-500" />
            <h3 className="font-semibold text-lg">Request Pending</h3>
            <p className="text-muted-foreground mt-1">
              Your request for researcher access is awaiting admin approval.
            </p>
          </CardContent>
        </Card>
      ) : submitted ? (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="pt-6 text-center">
            <h3 className="font-semibold text-lg text-green-700">Request Submitted!</h3>
            <p className="text-muted-foreground mt-1">An admin will review your request shortly.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Request Researcher Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                What do you want to use this tool to research?
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g., Studying fire risk patterns in Southern California for my thesis..."
                className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <Button onClick={submit} disabled={!reason.trim()} className="w-full">
              <Send className="h-4 w-4 mr-2" /> Submit Request
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  deck.gl overlay — renders inside <Map> using useMap()              */
/* ------------------------------------------------------------------ */
interface UnifiedOverlayProps {
  features: any[];
  showHeatmap: boolean;
  zoneGeoJson: any;
  zoneRiskData: Record<string, { risk_score: number; label: string }>;
  zoneNameKey: string;
  onZoneClick?: (name: string, risk: { risk_score: number; label: string }) => void;
  nifcPerimeters?: any;
  showPerimeters?: boolean;
  onPerimeterClick?: (props: any) => void;
}

function getRiskColor(score: number): [number, number, number, number] {
  if (score >= 0.75) return [139, 0, 0, 140];
  if (score >= 0.50) return [220, 38, 38, 120];
  if (score >= 0.25) return [234, 179, 8, 100];
  return [34, 197, 94, 70];
}

function UnifiedResearchOverlay({ features, showHeatmap, zoneGeoJson, zoneRiskData, zoneNameKey, onZoneClick, nifcPerimeters, showPerimeters, onPerimeterClick }: UnifiedOverlayProps) {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);

  useEffect(() => {
    if (!map) return;

    if (overlayRef.current) {
      overlayRef.current.setMap(null);
      overlayRef.current.finalize();
    }

    const layers: any[] = [];

    // 1. FIRMS heatmap (bottom layer)
    if (showHeatmap && features.length > 0) {
      layers.push(
        new HeatmapLayer({
          id: "research-heatmap",
          data: features,
          getPosition: (d: any) => d.geometry.coordinates,
          getWeight: (d: any) => (d.properties.confidence || 50) * (d.properties.frp || 1),
          radiusPixels: 60, intensity: 1.5, threshold: 0.05,
          colorRange: [
            [34, 197, 94, 80], [234, 179, 8, 120], [234, 88, 12, 160],
            [220, 38, 38, 200], [153, 27, 27, 220],
          ],
          updateTriggers: { getWeight: [features.length] },
        })
      );
    }

    // 2. Risk zone polygons (middle layer — clickable)
    if (zoneGeoJson?.features && Object.keys(zoneRiskData).length > 0) {
      const enriched = {
        ...zoneGeoJson,
        features: zoneGeoJson.features.map((f: any) => {
          const name = f.properties?.[zoneNameKey] || f.properties?.name || "";
          const risk = zoneRiskData[name] || { risk_score: 0, label: "Low" };
          return { ...f, properties: { ...f.properties, risk_score: risk.risk_score, risk_label: risk.label, zone_name: name } };
        }),
      };
      layers.push(
        new GeoJsonLayer({
          id: "risk-zones",
          data: enriched,
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 1,
          getLineColor: [255, 255, 255, 160],
          getLineWidth: 1,
          getFillColor: (f: any) => getRiskColor(f.properties.risk_score || 0),
          onClick: (info: any) => {
            if (onZoneClick && info.object) {
              const name = info.object.properties?.zone_name || "";
              onZoneClick(name, {
                risk_score: info.object.properties?.risk_score || 0,
                label: info.object.properties?.risk_label || "Low",
              });
            }
          },
          updateTriggers: { getFillColor: [JSON.stringify(zoneRiskData)] },
        })
      );
    }

    // 3. FIRMS hotspot zones (polygon boundaries sized by FRP) — below perimeters
    if (features.length > 0) {
      const polygonCollection = firmsPointsToPolygonCollection(features);
      layers.push(
        new GeoJsonLayer({
          id: "firms-zones",
          data: polygonCollection,
          pickable: false,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 1,
          getLineColor: [255, 255, 255, 180],
          getFillColor: (f: any) => {
            const c = f.properties?.confidence || 50;
            if (c >= 80) return [220, 38, 38, 160];
            if (c >= 60) return [234, 88, 12, 140];
            if (c >= 40) return [234, 179, 8, 120];
            return [34, 197, 94, 100];
          },
          getLineWidth: 1,
          updateTriggers: { getFillColor: [features.length] },
        })
      );
    }

    // 4. NIFC fire perimeters — rendered LAST so they sit on top of everything
    if (showPerimeters && nifcPerimeters?.features?.length) {
      const colorForPct = (raw: any): [number, number, number, number] => {
        const pct = raw == null ? 0 : Number(raw);
        if (pct >= 100) return [255, 255, 255, 220];
        if (pct >= 50) return [250, 204, 21, 230];
        if (pct >= 25) return [249, 115, 22, 230];
        return [220, 38, 38, 230];
      };
      const centroids = nifcPerimeters.features
        .map((f: any) => {
          const g = f.geometry;
          if (!g) return null;
          let pts: number[][] = [];
          if (g.type === "Polygon") pts = g.coordinates[0] || [];
          else if (g.type === "MultiPolygon") pts = (g.coordinates[0] && g.coordinates[0][0]) || [];
          if (!pts.length) return null;
          let lon = 0, lat = 0;
          for (const [x, y] of pts) { lon += x; lat += y; }
          return { lon: lon / pts.length, lat: lat / pts.length, properties: f.properties };
        })
        .filter(Boolean);
      layers.push(
        new GeoJsonLayer({
          id: "nifc-perimeters",
          data: nifcPerimeters,
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 2,
          getLineColor: [255, 255, 255, 220],
          getFillColor: (f: any) => colorForPct(f.properties?.attr_PercentContained),
          getLineWidth: 2,
          onClick: (info: any) => {
            if (info.object && onPerimeterClick) onPerimeterClick(info.object.properties);
          },
          updateTriggers: { getFillColor: [nifcPerimeters.features.length] },
        })
      );
      layers.push(
        new ScatterplotLayer({
          id: "nifc-markers",
          data: centroids,
          pickable: true,
          stroked: true,
          filled: true,
          radiusMinPixels: 6,
          radiusMaxPixels: 60,
          lineWidthMinPixels: 2,
          getPosition: (d: any) => [d.lon, d.lat],
          getRadius: (d: any) => {
            const acres = Number(d.properties?.poly_GISAcres) || 0.1;
            return Math.max(500, Math.sqrt(acres) * 400);
          },
          getFillColor: (d: any) => colorForPct(d.properties?.attr_PercentContained),
          getLineColor: [255, 255, 255, 255],
          onClick: (info: any) => {
            if (info?.object?.properties && onPerimeterClick) onPerimeterClick(info.object.properties);
          },
        })
      );
    }

    const overlay = new GoogleMapsOverlay({ layers });
    overlay.setMap(map);
    overlayRef.current = overlay;

    return () => {
      if (overlayRef.current) {
        overlayRef.current.setMap(null);
        overlayRef.current.finalize();
        overlayRef.current = null;
      }
    };
  }, [map, features, showHeatmap, zoneGeoJson, zoneRiskData, zoneNameKey, onZoneClick, nifcPerimeters, showPerimeters, onPerimeterClick]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Researcher / Admin view — interactive map with sliders             */
/* ------------------------------------------------------------------ */
function ResearchMapView() {
  const [days, setDays] = useState(7);
  const [confidenceMin, setConfidenceMin] = useState(0);
  const [frpMin, setFrpMin] = useState(0);
  const [features, setFeatures] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeLayer, setActiveLayer] = useState<"fires" | "zones" | "mixed">("mixed");
  const showHeatmap = activeLayer !== "zones";
  const showZones = activeLayer !== "fires";
  const [zoneLevel, setZoneLevel] = useState<"counties" | "zip-codes" | "census-tracts" | "neighborhoods">("counties");
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [selectedZoneRisk, setSelectedZoneRisk] = useState<{ risk_score: number; label: string } | null>(null);
  const [zoneGeoJson, setZoneGeoJson] = useState<any>(countyGeoJson);
  const [zoneRiskData, setZoneRiskData] = useState<Record<string, { risk_score: number; label: string }>>({});
  // Fire perimeters are informational and should be visible in every view — don't hide them in Risk zone view
  const showPerimeters = true;
  const [nifcPerimeters, setNifcPerimeters] = useState<any>(null);
  const [selectedPerimeter, setSelectedPerimeter] = useState<any>(null);
  const [useOverrides, setUseOverrides] = useState(false);
  const [eviSlider, setEviSlider] = useState(500);
  const [lstSlider, setLstSlider] = useState(14000);
  const [windSlider, setWindSlider] = useState(7);
  const [elevSlider, setElevSlider] = useState(500);
  const [zoneOverrides, setZoneOverrides] = useState<Record<string, { evi: number; lst: number; wind: number; elevation: number }>>({});

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 5;
    const loadPerimeters = async () => {
      while (!cancelled && attempt < maxAttempts) {
        attempt += 1;
        try {
          const r = await apiFetch("/fire-perimeters");
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          if (!cancelled && data?.features) {
            console.log(`[research] NIFC perimeters loaded: ${data.features.length}`);
            setNifcPerimeters(data);
            return;
          }
        } catch (e) {
          console.error(`[research] NIFC perimeters attempt ${attempt} failed:`, e);
        }
        await new Promise((res) => setTimeout(res, 3000 * attempt));
      }
    };
    loadPerimeters();
    return () => { cancelled = true; };
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        days: String(days),
        confidence_min: String(confidenceMin),
        frp_min: String(frpMin),
      });
      const r = await apiFetch(`/research/fire-data?${params}`);
      if (r.ok) {
        const data = await r.json();
        setFeatures(data.features || []);
      }
    } catch (e) { console.warn("research fire-data fetch failed:", e); }
    setLoading(false);
  }, [days, confidenceMin, frpMin]);

  useEffect(() => {
    const timer = setTimeout(fetchData, 500);
    return () => clearTimeout(timer);
  }, [fetchData]);

  // Load zone boundaries when level changes
  useEffect(() => {
    if (zoneLevel === "counties") {
      setZoneGeoJson(countyGeoJson);
    } else {
      apiFetch(`/research/boundaries/${zoneLevel}`)
        .then((r) => r.json())
        .then((data) => { if (data?.features) setZoneGeoJson(data); })
        .catch((e) => console.warn(`Failed to load ${zoneLevel}:`, e));
    }
    setZoneRiskData({}); // Clear old risk data
  }, [zoneLevel]);

  // Load risk data for zones (bulk), then apply per-zone overrides
  useEffect(() => {
    if (!zoneGeoJson?.features) return;
    const endpoint = zoneLevel === "counties"
      ? `/research/risk-by-county`
      : `/research/risk-by-zone/${zoneLevel}`;
    apiFetch(endpoint)
      .then((r) => r.json())
      .then(async (data) => {
        const zones = { ...(data?.counties || data?.zones || {}) };
        // Apply per-zone overrides
        const overrideEntries = Object.entries(zoneOverrides);
        if (useOverrides && overrideEntries.length > 0) {
          const results = await Promise.all(
            overrideEntries.map(async ([name, ov]) => {
              try {
                const r = await apiFetch("/predict-custom", {
                  method: "POST",
                  body: JSON.stringify({ ...ov, zone_name: name }),
                });
                if (r.ok) {
                  const resp = await r.json();
                  return { name, risk_score: resp.risk_score, label: resp.label };
                }
              } catch {}
              return null;
            })
          );
          for (const r of results) {
            if (r) zones[r.name] = { risk_score: r.risk_score, label: r.label };
          }
        }
        setZoneRiskData(zones);
      })
      .catch((e) => console.warn("Risk data load failed:", e));
  }, [zoneGeoJson, zoneLevel, useOverrides, zoneOverrides]);

  const zoneNameKey = zoneLevel === "counties" ? "name" : zoneLevel === "zip-codes" ? "zip" : zoneLevel === "census-tracts" ? "tract" : "name";

  const updateZoneOverride = (field: string, val: number) => {
    if (!selectedZone || !useOverrides) return;
    setZoneOverrides((prev) => ({
      ...prev,
      [selectedZone]: {
        evi: eviSlider, lst: lstSlider, wind: windSlider, elevation: elevSlider,
        ...prev[selectedZone],
        [field]: val,
      },
    }));
  };

  // Convert LST encoded value to Celsius for display
  const lstCelsius = Math.round((lstSlider * 0.02 - 273.15) * 10) / 10;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Research Map</h1>
        <p className="text-muted-foreground">
          {features.length} hotspots
          {loading && <Loader2 className="inline h-4 w-4 ml-2 animate-spin" />}
        </p>
      </div>

      {/* Full-width Map */}
      <div className="w-full rounded-lg overflow-hidden border relative" style={{ height: 500 }}>
            <Map
              style={{ width: "100%", height: "100%" }}
              defaultCenter={{ lat: 36.7783, lng: -119.4179 }}
              defaultZoom={6}
              gestureHandling="greedy"
              mapTypeId="terrain"
            >
              <UnifiedResearchOverlay
                features={features}
                showHeatmap={showHeatmap}
                zoneGeoJson={showZones ? zoneGeoJson : null}
                zoneRiskData={zoneRiskData}
                zoneNameKey={zoneNameKey}
                onZoneClick={(name, risk) => {
                  setSelectedZone(name);
                  setSelectedZoneRisk(risk);
                  setUseOverrides(true);
                  const ov = zoneOverrides[name];
                  if (ov) {
                    setEviSlider(ov.evi);
                    setLstSlider(ov.lst);
                    setWindSlider(ov.wind);
                    setElevSlider(ov.elevation);
                  }
                }}
                nifcPerimeters={nifcPerimeters}
                showPerimeters={showPerimeters}
                onPerimeterClick={(props) => setSelectedPerimeter(props)}
              />
            </Map>
            {/* Always-on left in-map control navbar */}
            <div
              className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border overflow-y-auto"
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                bottom: 12,
                width: 280,
                zIndex: 50,
                pointerEvents: 'auto',
              }}
            >
              <div className="p-4 space-y-4 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Map view</div>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-muted rounded-md">
                    {(["fires", "zones", "mixed"] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => { setActiveLayer(opt); if (opt === "fires") { setSelectedZone(null); setSelectedZoneRisk(null); } }}
                        className={`text-xs py-1.5 rounded ${activeLayer === opt ? "bg-white shadow-sm font-semibold" : "text-muted-foreground"}`}
                      >
                        {opt === "fires" ? "Fire" : opt === "zones" ? "Risk zone" : "Mixed"}
                      </button>
                    ))}
                  </div>
                </div>

                {activeLayer !== "fires" && (
                  <>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Zone level</div>
                      <select
                        value={zoneLevel}
                        onChange={(e) => { setZoneLevel(e.target.value as any); setSelectedZone(null); setSelectedZoneRisk(null); }}
                        className="text-xs border rounded px-2 py-1.5 w-full bg-background"
                      >
                        <option value="counties">Counties (58)</option>
                        <option value="zip-codes">ZIP Codes (1,769)</option>
                        <option value="neighborhoods">Neighborhoods (1,521)</option>
                        <option value="census-tracts">Census Tracts (8,041)</option>
                      </select>
                    </div>

                    {selectedZone && selectedZoneRisk && (
                      <div className="pt-3 border-t">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Selected</div>
                          <button
                            onClick={() => { setSelectedZone(null); setSelectedZoneRisk(null); }}
                            aria-label="Deselect"
                            className="text-muted-foreground hover:text-foreground text-lg leading-none"
                          >×</button>
                        </div>
                        <div className="flex items-center gap-2 mb-1">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{
                              backgroundColor: selectedZoneRisk.risk_score >= 0.75 ? "#991b1b"
                                : selectedZoneRisk.risk_score >= 0.5 ? "#dc2626"
                                : selectedZoneRisk.risk_score >= 0.25 ? "#eab308"
                                : "#22c55e",
                            }}
                          />
                          <div className="font-bold text-sm">{selectedZone}</div>
                        </div>
                        <div className="font-semibold text-xs">
                          {Math.round(selectedZoneRisk.risk_score * 100)}% Risk
                          <span className="text-[10px] font-normal text-muted-foreground ml-1">({selectedZoneRisk.label})</span>
                        </div>
                      </div>
                    )}

                    <div className="pt-3 border-t space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Model inputs</div>
                        {useOverrides
                          ? <Badge className="text-[9px] bg-red-100 text-red-700 border-red-200">Override</Badge>
                          : <Badge variant="outline" className="text-[9px]">Live</Badge>}
                      </div>
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox" checked={useOverrides} onChange={(e) => setUseOverrides(e.target.checked)} className="accent-red-500" />
                        Enable custom overrides
                      </label>
                      {useOverrides && !selectedZone && (
                        <p className="text-[10px] text-muted-foreground">Click a zone on the map to apply overrides.</p>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium flex justify-between">🌿 Vegetation (EVI) <span className="text-muted-foreground">{eviSlider}</span></label>
                        <input type="range" min={0} max={5000} step={100} value={eviSlider} onChange={(e) => { const v = Number(e.target.value); setEviSlider(v); updateZoneOverride("evi", v); }} disabled={!useOverrides || !selectedZone} className="w-full mt-1 accent-green-500 disabled:opacity-40" />
                      </div>
                      <div>
                        <label className="text-xs font-medium flex justify-between">🌡️ Temperature <span className="text-muted-foreground">{lstCelsius}°C</span></label>
                        <input type="range" min={13000} max={15500} step={50} value={lstSlider} onChange={(e) => { const v = Number(e.target.value); setLstSlider(v); updateZoneOverride("lst", v); }} disabled={!useOverrides || !selectedZone} className="w-full mt-1 accent-orange-500 disabled:opacity-40" />
                      </div>
                      <div>
                        <label className="text-xs font-medium flex justify-between">💨 Wind <span className="text-muted-foreground">{windSlider} m/s</span></label>
                        <input type="range" min={0} max={30} step={1} value={windSlider} onChange={(e) => { const v = Number(e.target.value); setWindSlider(v); updateZoneOverride("wind", v); }} disabled={!useOverrides || !selectedZone} className="w-full mt-1 accent-blue-500 disabled:opacity-40" />
                      </div>
                      <div>
                        <label className="text-xs font-medium flex justify-between">⛰️ Elevation <span className="text-muted-foreground">{elevSlider}m</span></label>
                        <input type="range" min={0} max={3000} step={50} value={elevSlider} onChange={(e) => { const v = Number(e.target.value); setElevSlider(v); updateZoneOverride("elevation", v); }} disabled={!useOverrides || !selectedZone} className="w-full mt-1 accent-gray-500 disabled:opacity-40" />
                      </div>
                    </div>

                    {useOverrides && selectedZone && zoneOverrides[selectedZone] && (
                      <button
                        onClick={() => setZoneOverrides((prev) => { const next = { ...prev }; delete next[selectedZone!]; return next; })}
                        className="w-full text-xs text-red-500 hover:text-red-700 font-medium py-1.5 border border-red-200 rounded-md hover:bg-red-50"
                      >
                        Reset {selectedZone} to live data
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            {/* Selected fire perimeter info */}
            {selectedPerimeter && (
              <div className="absolute top-3 left-3 z-10 max-w-[260px] bg-white/95 backdrop-blur-sm rounded-xl p-4 shadow-lg text-sm border border-red-200">
                <div className="flex items-center gap-2 mb-2">
                  <Flame className="h-4 w-4 text-red-500" />
                  <span className="font-bold">{selectedPerimeter.poly_IncidentName || "Unknown Fire"}</span>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {selectedPerimeter.poly_GISAcres != null && (
                    <p>Acres: <span className="font-medium text-foreground">{Math.round(selectedPerimeter.poly_GISAcres).toLocaleString()}</span></p>
                  )}
                  {selectedPerimeter.attr_PercentContained != null && (
                    <p>Contained: <span className="font-medium text-foreground">{selectedPerimeter.attr_PercentContained}%</span></p>
                  )}
                  {selectedPerimeter.poly_FeatureCategory && (
                    <p>Type: <span className="font-medium text-foreground">{selectedPerimeter.poly_FeatureCategory}</span></p>
                  )}
                </div>
                <button
                  onClick={() => setSelectedPerimeter(null)}
                  className="mt-2 text-xs text-red-500 hover:text-red-700 font-medium"
                >
                  Dismiss
                </button>
              </div>
            )}
            {/* Map overlay legend */}
            <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-lg text-xs">
              <div className="font-medium mb-1">Risk Zones</div>
              <div className="flex gap-1 mb-1">
                {[
                  { c: "rgba(34,197,94,0.5)", l: "Low" },
                  { c: "rgba(234,179,8,0.6)", l: "Med" },
                  { c: "rgba(220,38,38,0.6)", l: "High" },
                  { c: "rgba(153,27,27,0.7)", l: "Ext" },
                ].map(({ c, l }) => (
                  <div key={l} className="flex items-center gap-1">
                    <div className="w-4 h-3 border border-gray-300" style={{ backgroundColor: c }} />
                    <span>{l}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main export — switches between views based on role                 */
/* ------------------------------------------------------------------ */
export function ResearchPage({ userRole }: ResearchPageProps) {
  if (userRole === "Researcher" || userRole === "Admin") {
    return <ResearchMapView />;
  }
  return <RequestAccessView />;
}
