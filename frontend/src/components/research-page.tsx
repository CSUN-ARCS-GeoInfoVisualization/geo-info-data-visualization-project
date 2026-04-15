import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlaskConical, Map as MapIcon, SlidersHorizontal, Layers, Flame, Send, Clock, Loader2,
} from "lucide-react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { ScatterplotLayer, GeoJsonLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { apiFetch } from "../services/api";
import { CountyRiskOverlay } from "./CountyRiskOverlay";

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
function ResearchOverlay({ features, showHeatmap, riskGrid }: { features: any[]; showHeatmap: boolean; riskGrid: any[] }) {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);

  useEffect(() => {
    if (!map) return;

    if (overlayRef.current) {
      overlayRef.current.setMap(null);
      overlayRef.current.finalize();
    }

    const layers: any[] = [];

    // Scatterplot layer — individual colored circles
    if (features.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: "research-scatter",
          data: features,
          pickable: true,
          opacity: 0.85,
          stroked: true,
          filled: true,
          radiusMinPixels: 4,
          radiusMaxPixels: 25,
          lineWidthMinPixels: 1,
          getPosition: (d: any) => d.geometry.coordinates,
          getRadius: (d: any) => Math.sqrt(d.properties.frp || 1) * 400,
          getFillColor: (d: any) => {
            const c = d.properties.confidence || 50;
            if (c >= 80) return [220, 38, 38, 200];   // red
            if (c >= 60) return [234, 88, 12, 200];    // orange
            if (c >= 40) return [234, 179, 8, 200];    // yellow
            return [34, 197, 94, 200];                  // green
          },
          getLineColor: [255, 255, 255, 200],
          getLineWidth: 1,
          updateTriggers: {
            getRadius: [features.length],
            getFillColor: [features.length],
          },
        })
      );
    }

    // Heatmap layer — risk gradient overlay
    if (showHeatmap && features.length > 0) {
      layers.push(
        new HeatmapLayer({
          id: "research-heatmap",
          data: features,
          getPosition: (d: any) => d.geometry.coordinates,
          getWeight: (d: any) => (d.properties.confidence || 50) * (d.properties.frp || 1),
          radiusPixels: 60,
          intensity: 1.5,
          threshold: 0.05,
          colorRange: [
            [34, 197, 94, 80],     // green
            [234, 179, 8, 120],    // yellow
            [234, 88, 12, 160],    // orange
            [220, 38, 38, 200],    // red
            [153, 27, 27, 220],    // dark red
          ],
          updateTriggers: {
            getWeight: [features.length],
          },
        })
      );
    }

    // Risk prediction grid — zone polygons with colored fills and white/grey borders
    if (riskGrid.length > 0) {
      const HALF_LAT = 0.4;
      const HALF_LON = 0.4;
      const zoneGeoJson = {
        type: "FeatureCollection" as const,
        features: riskGrid.map((pt: any) => {
          const [lon, lat] = pt.geometry.coordinates;
          return {
            type: "Feature" as const,
            geometry: {
              type: "Polygon" as const,
              coordinates: [[
                [lon - HALF_LON, lat - HALF_LAT],
                [lon + HALF_LON, lat - HALF_LAT],
                [lon + HALF_LON, lat + HALF_LAT],
                [lon - HALF_LON, lat + HALF_LAT],
                [lon - HALF_LON, lat - HALF_LAT],
              ]],
            },
            properties: pt.properties,
          };
        }),
      };
      layers.push(
        new GeoJsonLayer({
          id: "risk-zones",
          data: zoneGeoJson,
          pickable: true,
          stroked: true,
          filled: true,
          extruded: false,
          lineWidthMinPixels: 1,
          getLineColor: [200, 200, 200, 180],
          getLineWidth: 1,
          getFillColor: (f: any) => {
            const s = f.properties.risk_score || 0;
            if (s >= 0.75) return [153, 27, 27, 100];
            if (s >= 0.50) return [220, 38, 38, 90];
            if (s >= 0.25) return [234, 179, 8, 80];
            return [34, 197, 94, 60];
          },
          updateTriggers: {
            getFillColor: [riskGrid.length, riskGrid[0]?.properties?.risk_score],
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
  }, [map, features, showHeatmap, riskGrid]);

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
  const [riskGrid, setRiskGrid] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showRiskGrid, setShowRiskGrid] = useState(true);
  const [showCountyZones, setShowCountyZones] = useState(true);
  const [selectedCounty, setSelectedCounty] = useState<string | null>(null);
  const [selectedCountyRisk, setSelectedCountyRisk] = useState<{ risk_score: number; label: string } | null>(null);
  const [useOverrides, setUseOverrides] = useState(false);
  const [eviSlider, setEviSlider] = useState(500);
  const [lstSlider, setLstSlider] = useState(14000);
  const [windSlider, setWindSlider] = useState(7);
  const [elevSlider, setElevSlider] = useState(500);

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

  const fetchRiskGrid = useCallback(async () => {
    if (!showRiskGrid) { setRiskGrid([]); return; }
    try {
      const params = new URLSearchParams();
      if (useOverrides) {
        params.set("evi", String(eviSlider));
        params.set("lst", String(lstSlider));
        params.set("wind", String(windSlider));
        params.set("elevation", String(elevSlider));
      }
      const r = await apiFetch(`/research/risk-grid?${params}`);
      if (r.ok) {
        const data = await r.json();
        setRiskGrid(data.features || []);
      }
    } catch (e) { console.warn("research fetch error:", e); }
  }, [showRiskGrid, useOverrides, eviSlider, lstSlider, windSlider, elevSlider]);

  useEffect(() => {
    const timer = setTimeout(fetchData, 500);
    return () => clearTimeout(timer);
  }, [fetchData]);

  useEffect(() => {
    const timer = setTimeout(fetchRiskGrid, 800);
    return () => clearTimeout(timer);
  }, [fetchRiskGrid]);

  // Convert LST encoded value to Celsius for display
  const lstCelsius = Math.round((lstSlider * 0.02 - 273.15) * 10) / 10;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold mb-2">Research Map</h1>
        <p className="text-muted-foreground">
          {features.length} hotspots · {riskGrid.length} risk zones
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
              {showCountyZones && (
                <CountyRiskOverlay
                  overrides={useOverrides ? { evi: eviSlider, lst: lstSlider, wind: windSlider, elevation: elevSlider } : undefined}
                  onCountyClick={(name, risk) => { setSelectedCounty(name); setSelectedCountyRisk(risk); }}
                />
              )}
              <ResearchOverlay features={features} showHeatmap={showHeatmap} riskGrid={showRiskGrid ? riskGrid : []} />
            </Map>
            {/* Selected county info */}
            {selectedCounty && selectedCountyRisk && (
              <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-sm rounded-lg p-3 shadow-lg text-sm z-10 max-w-[200px]">
                <div className="font-bold">{selectedCounty} County</div>
                <div className="text-muted-foreground">Risk: {Math.round(selectedCountyRisk.risk_score * 100)}% ({selectedCountyRisk.label})</div>
                <button onClick={() => { setSelectedCounty(null); setSelectedCountyRisk(null); }} className="text-xs text-blue-600 hover:underline mt-1">Clear selection</button>
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

      {/* Controls below map */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* FIRMS Hotspot Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">FIRMS Hotspot Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium flex justify-between">Date Range <span className="text-muted-foreground">{days}d</span></label>
              <input type="range" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full mt-1 accent-red-500" />
            </div>
            <div>
              <label className="text-sm font-medium flex justify-between">Min Confidence <span className="text-muted-foreground">{confidenceMin}%</span></label>
              <input type="range" min={0} max={100} value={confidenceMin} onChange={(e) => setConfidenceMin(Number(e.target.value))} className="w-full mt-1 accent-red-500" />
            </div>
            <div>
              <label className="text-sm font-medium flex justify-between">Min FRP <span className="text-muted-foreground">{frpMin} MW</span></label>
              <input type="range" min={0} max={500} step={10} value={frpMin} onChange={(e) => setFrpMin(Number(e.target.value))} className="w-full mt-1 accent-red-500" />
            </div>
          </CardContent>
        </Card>

        {/* Layer Toggles + Risk Model */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Layers & Risk Model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} className="accent-red-500" />
              FIRMS heatmap overlay
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={showCountyZones} onChange={(e) => setShowCountyZones(e.target.checked)} className="accent-red-500" />
              County risk zones (click to select)
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={showRiskGrid} onChange={(e) => setShowRiskGrid(e.target.checked)} className="accent-red-500" />
              ML risk point grid
            </label>
            <hr className="my-2" />
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={useOverrides} onChange={(e) => setUseOverrides(e.target.checked)} className="accent-red-500" />
              Override model inputs with sliders
            </label>
            {!useOverrides && (
              <p className="text-xs text-muted-foreground">Using interpolated live data. Toggle to experiment with custom conditions.</p>
            )}
          </CardContent>
        </Card>

        {/* Model Parameter Sliders */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Model Parameters {!useOverrides && <Badge variant="outline" className="ml-2 text-[10px]">Live Data</Badge>}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-medium flex justify-between">Vegetation (EVI) <span className="text-muted-foreground">{eviSlider}</span></label>
              <input type="range" min={0} max={5000} step={100} value={eviSlider} onChange={(e) => setEviSlider(Number(e.target.value))} disabled={!useOverrides} className="w-full mt-1 accent-green-500 disabled:opacity-40" />
              <div className="flex justify-between text-[10px] text-muted-foreground"><span>Bare</span><span>Dense</span></div>
            </div>
            <div>
              <label className="text-xs font-medium flex justify-between">Temperature <span className="text-muted-foreground">{lstCelsius}°C</span></label>
              <input type="range" min={13000} max={15500} step={50} value={lstSlider} onChange={(e) => setLstSlider(Number(e.target.value))} disabled={!useOverrides} className="w-full mt-1 accent-orange-500 disabled:opacity-40" />
              <div className="flex justify-between text-[10px] text-muted-foreground"><span>-10°C</span><span>35°C</span></div>
            </div>
            <div>
              <label className="text-xs font-medium flex justify-between">Wind Speed <span className="text-muted-foreground">{windSlider} m/s</span></label>
              <input type="range" min={0} max={30} step={1} value={windSlider} onChange={(e) => setWindSlider(Number(e.target.value))} disabled={!useOverrides} className="w-full mt-1 accent-blue-500 disabled:opacity-40" />
              <div className="flex justify-between text-[10px] text-muted-foreground"><span>Calm</span><span>Storm</span></div>
            </div>
            <div>
              <label className="text-xs font-medium flex justify-between">Elevation <span className="text-muted-foreground">{elevSlider}m</span></label>
              <input type="range" min={0} max={3000} step={50} value={elevSlider} onChange={(e) => setElevSlider(Number(e.target.value))} disabled={!useOverrides} className="w-full mt-1 accent-gray-500 disabled:opacity-40" />
              <div className="flex justify-between text-[10px] text-muted-foreground"><span>Sea level</span><span>Mountain</span></div>
            </div>
          </CardContent>
        </Card>
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
