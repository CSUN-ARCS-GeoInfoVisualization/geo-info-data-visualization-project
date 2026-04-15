import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlaskConical, Map as MapIcon, SlidersHorizontal, Layers, Flame, Send, Clock, Loader2,
} from "lucide-react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { apiFetch } from "../services/api";

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

    // Risk prediction grid layer — colored circles showing ML risk scores
    if (riskGrid.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: "risk-grid",
          data: riskGrid,
          pickable: true,
          opacity: 0.6,
          stroked: false,
          filled: true,
          radiusMinPixels: 20,
          radiusMaxPixels: 40,
          getPosition: (d: any) => d.geometry.coordinates,
          getRadius: 40000,
          getFillColor: (d: any) => {
            const s = d.properties.risk_score || 0;
            if (s >= 0.75) return [153, 27, 27, 180];    // extreme — dark red
            if (s >= 0.50) return [220, 38, 38, 160];    // high — red
            if (s >= 0.25) return [234, 179, 8, 140];    // medium — yellow
            return [34, 197, 94, 120];                     // low — green
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showRiskGrid, setShowRiskGrid] = useState(true);
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
    } catch { /* ignore */ }
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
    } catch { /* ignore */ }
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Research Map</h1>
          <p className="text-muted-foreground">
            {features.length} hotspots loaded
            {loading && <Loader2 className="inline h-4 w-4 ml-2 animate-spin" />}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSidebarOpen(!sidebarOpen)}>
          <SlidersHorizontal className="h-4 w-4 mr-2" />
          {sidebarOpen ? "Hide" : "Show"} Controls
        </Button>
      </div>

      <div className="flex gap-4">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="w-72 shrink-0 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Parameters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <label className="text-sm font-medium flex justify-between">
                    Date Range <span className="text-muted-foreground">{days} days</span>
                  </label>
                  <input
                    type="range" min={1} max={30} value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    className="w-full mt-1 accent-red-500"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium flex justify-between">
                    Min Confidence <span className="text-muted-foreground">{confidenceMin}%</span>
                  </label>
                  <input
                    type="range" min={0} max={100} value={confidenceMin}
                    onChange={(e) => setConfidenceMin(Number(e.target.value))}
                    className="w-full mt-1 accent-red-500"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium flex justify-between">
                    Min FRP (MW) <span className="text-muted-foreground">{frpMin}</span>
                  </label>
                  <input
                    type="range" min={0} max={500} step={10} value={frpMin}
                    onChange={(e) => setFrpMin(Number(e.target.value))}
                    className="w-full mt-1 accent-red-500"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Layers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} className="accent-red-500" />
                  FIRMS heatmap
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={showRiskGrid} onChange={(e) => setShowRiskGrid(e.target.checked)} className="accent-red-500" />
                  ML risk prediction grid
                </label>
              </CardContent>
            </Card>

            {showRiskGrid && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Risk Model Parameters</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={useOverrides} onChange={(e) => setUseOverrides(e.target.checked)} className="accent-red-500" />
                    Override with sliders
                  </label>
                  {useOverrides && (
                    <div className="space-y-4 pt-2">
                      <div>
                        <label className="text-xs font-medium flex justify-between">
                          Vegetation (EVI) <span className="text-muted-foreground">{eviSlider}</span>
                        </label>
                        <input type="range" min={0} max={5000} step={100} value={eviSlider} onChange={(e) => setEviSlider(Number(e.target.value))} className="w-full mt-1 accent-green-500" />
                        <div className="flex justify-between text-[10px] text-muted-foreground"><span>Bare</span><span>Dense</span></div>
                      </div>
                      <div>
                        <label className="text-xs font-medium flex justify-between">
                          Temperature <span className="text-muted-foreground">{lstCelsius}°C</span>
                        </label>
                        <input type="range" min={13000} max={15500} step={50} value={lstSlider} onChange={(e) => setLstSlider(Number(e.target.value))} className="w-full mt-1 accent-orange-500" />
                        <div className="flex justify-between text-[10px] text-muted-foreground"><span>-10°C</span><span>35°C</span></div>
                      </div>
                      <div>
                        <label className="text-xs font-medium flex justify-between">
                          Wind Speed <span className="text-muted-foreground">{windSlider} m/s</span>
                        </label>
                        <input type="range" min={0} max={30} step={1} value={windSlider} onChange={(e) => setWindSlider(Number(e.target.value))} className="w-full mt-1 accent-blue-500" />
                        <div className="flex justify-between text-[10px] text-muted-foreground"><span>Calm</span><span>Storm</span></div>
                      </div>
                      <div>
                        <label className="text-xs font-medium flex justify-between">
                          Elevation <span className="text-muted-foreground">{elevSlider}m</span>
                        </label>
                        <input type="range" min={0} max={3000} step={50} value={elevSlider} onChange={(e) => setElevSlider(Number(e.target.value))} className="w-full mt-1 accent-gray-500" />
                        <div className="flex justify-between text-[10px] text-muted-foreground"><span>Sea level</span><span>Mountain</span></div>
                      </div>
                    </div>
                  )}
                  {!useOverrides && (
                    <p className="text-xs text-muted-foreground">Using interpolated live data from 9 California sample locations. Toggle overrides to experiment with different conditions.</p>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Legend</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs font-medium mb-1">FIRMS Hotspots</p>
                  {[
                    { color: "#22c55e", label: "Low confidence (< 40%)" },
                    { color: "#eab308", label: "Medium (40-60%)" },
                    { color: "#ea580c", label: "High (60-80%)" },
                    { color: "#dc2626", label: "Very High (80%+)" },
                  ].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-2 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      {label}
                    </div>
                  ))}
                </div>
                {showRiskGrid && (
                  <div>
                    <p className="text-xs font-medium mb-1">ML Risk Prediction</p>
                    {[
                      { color: "#22c55e", label: "Low (< 25%)" },
                      { color: "#eab308", label: "Medium (25-50%)" },
                      { color: "#dc2626", label: "High (50-75%)" },
                      { color: "#991b1b", label: "Extreme (75%+)" },
                    ].map(({ color, label }) => (
                      <div key={label} className="flex items-center gap-2 text-xs">
                        <div className="w-2.5 h-2.5 rounded shrink-0" style={{ backgroundColor: color }} />
                        {label}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">Data Sources</p>
                  <p>NASA FIRMS VIIRS satellite hotspot detections for California.</p>
                  <p className="mt-2">Adjust sliders to filter by confidence and fire radiative power (FRP).</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Map */}
        <div className="flex-1 relative">
          <div className="w-full h-[calc(100vh-220px)] min-h-[500px] rounded-lg overflow-hidden border">
            <Map
              style={{ width: "100%", height: "100%" }}
              defaultCenter={{ lat: 36.7783, lng: -119.4179 }}
              defaultZoom={6}
              gestureHandling="greedy"
              mapTypeId="terrain"
            >
              <ResearchOverlay features={features} showHeatmap={showHeatmap} riskGrid={showRiskGrid ? riskGrid : []} />
            </Map>
          </div>
          {features.length > 0 && (
            <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-lg text-sm">
              <div className="font-medium mb-1">{features.length} hotspots</div>
              <div className="flex gap-1">
                {["#22c55e", "#eab308", "#ea580c", "#dc2626"].map((c) => (
                  <div key={c} className="w-6 h-2 rounded" style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="text-xs text-muted-foreground">Low → Extreme risk</div>
            </div>
          )}
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
