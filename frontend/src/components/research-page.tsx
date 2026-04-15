import { useCallback, useEffect, useState } from "react";
import {
  FlaskConical, Map as MapIcon, SlidersHorizontal, Layers, Flame, Send, Clock, Loader2,
} from "lucide-react";
import { Map } from "@vis.gl/react-google-maps";
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
/*  Researcher / Admin view — interactive map with sliders             */
/* ------------------------------------------------------------------ */
function ResearchMapView() {
  const [days, setDays] = useState(7);
  const [confidenceMin, setConfidenceMin] = useState(0);
  const [frpMin, setFrpMin] = useState(0);
  const [features, setFeatures] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  useEffect(() => {
    const timer = setTimeout(fetchData, 500);
    return () => clearTimeout(timer);
  }, [fetchData]);

  // Color a point by its confidence level
  const getMarkerColor = (conf: number) => {
    if (conf >= 80) return "#dc2626"; // red
    if (conf >= 60) return "#ea580c"; // orange
    if (conf >= 40) return "#eab308"; // yellow
    return "#22c55e"; // green
  };

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
                <CardTitle className="text-sm">Legend</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { color: "#22c55e", label: "Low confidence (< 40%)" },
                  { color: "#eab308", label: "Medium (40-60%)" },
                  { color: "#ea580c", label: "High (60-80%)" },
                  { color: "#dc2626", label: "Very High (80%+)" },
                ].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-2 text-sm">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    {label}
                  </div>
                ))}
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
        <div className="flex-1">
          <div className="w-full h-[calc(100vh-220px)] min-h-[500px] rounded-lg overflow-hidden border">
            <Map
              style={{ width: "100%", height: "100%" }}
              defaultCenter={{ lat: 36.7783, lng: -119.4179 }}
              defaultZoom={6}
              gestureHandling="greedy"
              mapTypeId="terrain"
            >
              {features.map((f, i) => {
                const [lng, lat] = f.geometry.coordinates;
                const conf = f.properties.confidence || 50;
                return (
                  <div key={i}>
                    {/* Use Advanced Markers or fallback circle overlay */}
                  </div>
                );
              })}
            </Map>
            {/* Color overlay info */}
            {features.length > 0 && (
              <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-lg text-sm">
                <div className="font-medium mb-1">
                  {features.length} hotspots in view
                </div>
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
