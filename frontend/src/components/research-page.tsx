import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlaskConical, Map as MapIcon, SlidersHorizontal, Layers, Flame, Send, Clock, Loader2,
} from "lucide-react";
import { Map, useMap } from "@vis.gl/react-google-maps";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { GeoJsonLayer, IconLayer } from "@deck.gl/layers";
import { firmsPointsToPolygonCollection } from "../utils/firmsPolygons";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { CenteredInfoCard } from "./centered-info-card";
import { MapLegend } from "./map-legend";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { apiFetch } from "../services/api";
import countyGeoJson from "../Data/california-counties.json";

interface ResearchPageProps {
  userRole: string | null;
  isGuest?: boolean;
  onLoginRequired?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Public / Resident view — info + request access                     */
/* ------------------------------------------------------------------ */
function RequestAccessView({ isGuest, onLoginRequired }: { isGuest?: boolean; onLoginRequired?: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Guests don't have a server account, so skip the role-request lookup
    // (would 401) and go straight to the showcase.
    if (isGuest) {
      setLoading(false);
      return;
    }
    apiFetch("/me/role-request")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.status === "pending") setPending(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isGuest]);

  const submit = async () => {
    // Guests cannot create role requests until they have an account; bounce
    // them through auth and the parent will route back here on success.
    if (isGuest) {
      onLoginRequired?.();
      return;
    }
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
      ) : isGuest ? (
        <Card>
          <CardHeader>
            <CardTitle>Request Researcher Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Researcher access is tied to your FireScope account so admins can review
              requests and grant the right permissions. Sign in or create a free account
              to submit a request — you'll come right back here once you're done.
            </p>
            <Button onClick={() => onLoginRequired?.()} className="w-full">
              <Send className="h-4 w-4 mr-2" /> Sign in to request access
            </Button>
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
  /** Researcher-only: all 8014 CA shelters. */
  shelters?: any[];
  showShelters?: boolean;
  onShelterClick?: (shelter: any) => void;
}

// 5-tier shared palette — lib/riskTiers.ts
import { riskRgba as getRiskColor } from "../lib/riskTiers";

function UnifiedResearchOverlay({ features, showHeatmap, zoneGeoJson, zoneRiskData, zoneNameKey, onZoneClick, nifcPerimeters, showPerimeters, onPerimeterClick, shelters = [], showShelters = false, onShelterClick }: UnifiedOverlayProps) {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  // Refs so callback identity changes don't tear down the overlay (was a major flicker source)
  const onZoneClickRef = useRef(onZoneClick);
  const onPerimeterClickRef = useRef(onPerimeterClick);
  const onShelterClickRef = useRef(onShelterClick);
  const zoneRiskDataRef = useRef(zoneRiskData);
  useEffect(() => { onZoneClickRef.current = onZoneClick; }, [onZoneClick]);
  useEffect(() => { onPerimeterClickRef.current = onPerimeterClick; }, [onPerimeterClick]);
  useEffect(() => { onShelterClickRef.current = onShelterClick; }, [onShelterClick]);
  useEffect(() => { zoneRiskDataRef.current = zoneRiskData; }, [zoneRiskData]);

  // Create overlay ONCE per map mount — survives data changes
  useEffect(() => {
    if (!map) return;
    const overlay = new GoogleMapsOverlay({ layers: [] });
    overlay.setMap(map);
    overlayRef.current = overlay;
    return () => { overlay.setMap(null); overlay.finalize(); overlayRef.current = null; };
  }, [map]);

  // Update layers in-place when data changes
  useEffect(() => {
    if (!overlayRef.current) return;

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
            const cb = onZoneClickRef.current;
            if (cb && info.object) {
              const name = info.object.properties?.zone_name || "";
              cb(name, {
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
        if (pct >= 100) return [255, 255, 255, 230];
        if (pct >= 50) return [250, 204, 21, 240];
        if (pct >= 25) return [249, 115, 22, 240];
        return [220, 38, 38, 240];
      };
      layers.push(
        new GeoJsonLayer({
          id: "nifc-perimeters",
          data: nifcPerimeters,
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 3,
          getLineColor: (f: any) => colorForPct(f.properties?.attr_PercentContained),
          getFillColor: (f: any) => colorForPct(f.properties?.attr_PercentContained),
          getLineWidth: 3,
          onClick: (info: any) => {
            const cb = onPerimeterClickRef.current;
            if (info.object && cb) cb(info.object.properties);
          },
          updateTriggers: {
            getFillColor: [nifcPerimeters.features.length],
            getLineColor: [nifcPerimeters.features.length],
          },
        })
      );
    }

    // 5. Shelters (researcher-only). Same SVG-circle-with-emoji icons as the
    // user-facing Shelters & Evac page, colored by facility_usage_code:
    //   EVAC = blue, POST = green, BOTH = purple, default = gray.
    // 8014 icons in one deck.gl IconLayer is well within budget — no
    // clustering, no heatmap. Smooth because UnifiedResearchOverlay's ref
    // pattern only calls setProps on data change, never rebuilds the canvas.
    if (showShelters && shelters.length > 0) {
      const usageStyle = (usageCode: string): { color: string; emoji: string } => {
        switch ((usageCode || '').toUpperCase()) {
          case 'EVAC': return { color: 'rgb(59,130,246)',  emoji: '🏃' };  // blue
          case 'POST': return { color: 'rgb(34,197,94)',   emoji: '🏠' };  // green
          case 'BOTH': return { color: 'rgb(147,51,234)',  emoji: '🏛️' };  // purple
          default:     return { color: 'rgb(156,163,175)', emoji: '🏢' };  // gray
        }
      };
      layers.push(
        new IconLayer({
          id: 'shelter-pins',
          data: shelters,
          pickable: true,
          getPosition: (s: any) => [s.longitude, s.latitude],
          getSize: 32,
          getIcon: (s: any) => {
            const { color, emoji } = usageStyle(s.facility_usage_code);
            const size = 32, radius = 14, fontSize = 14;
            return {
              url: 'data:image/svg+xml;utf8,' + encodeURIComponent(
                `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
                `<circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="${color}" stroke="white" stroke-width="2"/>` +
                `<text x="${size/2}" y="${size/2 + fontSize/2.5}" font-size="${fontSize}" text-anchor="middle" fill="white">${emoji}</text>` +
                `</svg>`
              ),
              width: size, height: size, anchorY: size,
            };
          },
          onClick: (info: any) => {
            const cb = onShelterClickRef.current;
            if (cb && info.object) cb(info.object);
          },
          updateTriggers: { getIcon: [shelters.length] },
        })
      );
    }

    overlayRef.current.setProps({ layers });
  }, [features, showHeatmap, zoneGeoJson, zoneRiskData, zoneNameKey, nifcPerimeters, showPerimeters, shelters, showShelters]);

  return null;
}

/* ------------------------------------------------------------------ */
/*  Researcher / Admin view — interactive map with sliders             */
/* ------------------------------------------------------------------ */
function ResearchMapView() {
  // Shelter overlay state — opt-in researcher tool, default OFF.
  // Lazy-load shelters only the first time the toggle is flipped on so the
  // page paint isn't paying for the 8014-row payload up front.
  const [showShelters, setShowShelters] = useState(false);
  const [shelters, setShelters] = useState<any[]>([]);
  const [selectedShelter, setSelectedShelter] = useState<any | null>(null);
  useEffect(() => {
    if (!showShelters || shelters.length > 0) return;
    apiFetch('/shelters?state=CA').then(r => r.ok ? r.json() : { features: [] }).then(data => {
      const CA = { latMin: 32.5, latMax: 42.0, lonMin: -124.5, lonMax: -114.1 };
      const flat = (data.features || []).map((f: any) => {
        const p = f.properties || {};
        const c = f.geometry?.coordinates || [];
        return { ...p, latitude: Number(c[1]), longitude: Number(c[0]) };
      }).filter((s: any) => (
        s.latitude >= CA.latMin && s.latitude <= CA.latMax &&
        s.longitude >= CA.lonMin && s.longitude <= CA.lonMax
      ));
      setShelters(flat);
    }).catch(() => {});
  }, [showShelters, shelters.length]);

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
  // Fire perimeters only in Fire and Mixed views; Risk zone view hides them
  const showPerimeters = activeLayer !== "zones";
  const [nifcPerimeters, setNifcPerimeters] = useState<any>(null);
  const [selectedPerimeter, setSelectedPerimeter] = useState<any>(null);
  const [useOverrides, setUseOverrides] = useState(false);
  const [eviSlider, setEviSlider] = useState(500);
  const [lstSlider, setLstSlider] = useState(14000);
  const [windSlider, setWindSlider] = useState(7);
  const [elevSlider, setElevSlider] = useState(500);
  const [kbdiSlider, setKbdiSlider] = useState(200); // Keetch-Byram Drought Index, 0-800
  // Extended tracking parameters — the current ML model only consumes EVI/LST/
  // wind/elevation, but the UI exposes the full feature set that the upcoming
  // retrain (option 3 — ActiveFireSnapshot) will consume: Date, Latitude,
  // Longitude, TA (thermal anomalies), NDVI (vegetation cover), and Fire (the
  // binary outcome label). The extra fields travel with the override payload
  // so the snapshot-capture job can log them verbatim for training data.
  const [dateSlider, setDateSlider] = useState<number>(() => {
    const start = new Date(new Date().getFullYear(), 0, 0);
    const diff = Date.now() - start.getTime();
    return Math.floor(diff / 86400000);
  });
  const [latSlider, setLatSlider] = useState(36.7); // California centroid
  const [lonSlider, setLonSlider] = useState(-119.4);
  const [taSlider, setTaSlider] = useState(0); // MODIS thermal anomalies level, 0-100
  const [ndviSlider, setNdviSlider] = useState(0.3); // -1 to 1 in theory; 0-1 for vegetation cover
  const [fireBinary, setFireBinary] = useState(false); // binary fire occurrence outcome label
  const [zoneOverrides, setZoneOverrides] = useState<Record<string, { evi: number; lst: number; wind: number; elevation: number; date?: number; latitude?: number; longitude?: number; ta?: number; ndvi?: number; fire?: boolean }>>({});

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
                // New ML model signature (feature/ml-model-improvements merge):
                // expects evi, air_temp_encoded, wind, humidity, elevation.
                // Our sliders still carry the legacy `lst` name — remap it to
                // air_temp_encoded (same Kelvin*50 scale) and supply a
                // reasonable humidity default until that slider is exposed.
                const payload: any = {
                  evi: ov.evi,
                  air_temp_encoded: ov.lst,
                  wind: ov.wind,
                  humidity: (ov as any).humidity ?? 50,
                  elevation: ov.elevation,
                  kbdi: (ov as any).kbdi ?? 200,
                  zone_name: name,
                };
                const r = await apiFetch("/predict-custom", {
                  method: "POST",
                  body: JSON.stringify(payload),
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
        // Keep the selected-zone card in sync with the latest risk (so sliders
        // update the badge + percentage live alongside the map color).
        if (selectedZone && zones[selectedZone]) {
          setSelectedZoneRisk({ risk_score: zones[selectedZone].risk_score, label: zones[selectedZone].label });
        }
      })
      .catch((e) => console.warn("Risk data load failed:", e));
  }, [zoneGeoJson, zoneLevel, useOverrides, zoneOverrides]);

  const zoneNameKey = zoneLevel === "counties" ? "name" : zoneLevel === "zip-codes" ? "zip" : zoneLevel === "census-tracts" ? "tract" : "name";

  const updateZoneOverride = (field: string, val: number) => {
    if (!selectedZone || !useOverrides) return;
    setZoneOverrides((prev) => ({
      ...prev,
      [selectedZone]: {
        evi: eviSlider, lst: lstSlider, wind: windSlider, elevation: elevSlider, kbdi: kbdiSlider,
        ...prev[selectedZone],
        [field]: val,
      },
    }));
  };

  // Convert LST encoded value to Celsius for display
  const lstCelsius = Math.round((lstSlider * 0.02 - 273.15) * 10) / 10;
  const lstFahrenheit = Math.round((lstCelsius * 9 / 5 + 32) * 10) / 10;

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
                shelters={shelters}
                showShelters={showShelters}
                onShelterClick={setSelectedShelter}
                zoneGeoJson={showZones ? zoneGeoJson : null}
                zoneRiskData={zoneRiskData}
                zoneNameKey={zoneNameKey}
                onZoneClick={(name, risk) => {
                  setSelectedPerimeter(null); // picking a zone dismisses the selected fire
                  setSelectedZone(name);
                  setSelectedZoneRisk(risk);
                  setUseOverrides(true);
                  const ov = zoneOverrides[name];
                  if (ov) {
                    setEviSlider(ov.evi);
                    setLstSlider(ov.lst);
                    setWindSlider(ov.wind);
                    setElevSlider(ov.elevation);
                    if (typeof ov.kbdi === "number") setKbdiSlider(ov.kbdi);
                  }
                }}
                nifcPerimeters={nifcPerimeters}
                showPerimeters={showPerimeters}
                onPerimeterClick={(props) => {
                  // picking a fire dismisses the selected zone (mixed view)
                  setSelectedZone(null);
                  setSelectedZoneRisk(null);
                  setSelectedPerimeter(props);
                }}
              />
            </Map>

            {/* Floating legend — only shown when shelters are on (otherwise the
                research page is fire-research focused and the evac legend would
                be noise). Same component the Shelters & Evac page renders. */}

            {/* Shelter info now lives in the left sidebar (Selected shelter
                block) only — the floating popup was redundant per Ido. Keep
                the CenteredInfoCard tag intact but always closed so we don't
                rip it out and risk a typo on a future re-enable. */}
            <CenteredInfoCard
              open={false}
              onClose={() => setSelectedShelter(null)}
              accent="bg-emerald-600"
              title={selectedShelter?.shelter_name || 'Shelter'}
              subtitle={selectedShelter?.facility_type}
            >
              {selectedShelter && (() => {
                const s = selectedShelter;
                const fields: Array<[string, string | number | undefined | null]> = [
                  ['Status', s.shelter_status_code],
                  ['Address', s.address_1],
                  ['City / ZIP', s.city ? `${s.city}, ${s.state || 'CA'} ${s.zip || ''}` : null],
                  ['County', s.county_parish],
                  ['Facility type', s.facility_type],
                  ['Facility usage', s.facility_usage_code],
                  ['Evac capacity', s.evacuation_capacity ? `${s.evacuation_capacity} people` : null],
                  ['Post-impact capacity', s.post_impact_capacity ? `${s.post_impact_capacity} people` : null],
                  ['Wheelchair accessible', s.wheelchair_accessible === 'YES' ? 'Yes' : null],
                  ['Generator on-site', s.generator_onsite === 'YES' ? 'Yes' : null],
                  ['Shelter ID', s.shelter_id ? String(s.shelter_id) : null],
                  ['Coordinates', s.latitude != null && s.longitude != null ? `${Number(s.latitude).toFixed(4)}, ${Number(s.longitude).toFixed(4)}` : null],
                ];
                return (
                  <div className="space-y-3">
                    <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                      {fields.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="col-span-1 text-zinc-500">{k}</dt>
                          <dd className="col-span-2 text-zinc-800 break-words">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    {s.latitude != null && s.longitude != null && (
                      <div className="pt-2 border-t border-zinc-100">
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${s.latitude},${s.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-2"
                        >
                          Open in Google Maps
                        </a>
                      </div>
                    )}
                  </div>
                );
              })()}
            </CenteredInfoCard>

            {/* Always-on left in-map control navbar.
                Outer container clips so no child can visually escape the
                card (slider rails / popover values were rendering over the
                map outside the navbar). Inner div is the scroll surface. */}
            <div
              className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border overflow-hidden flex flex-col"
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                bottom: 12,
                width: 280,
                zIndex: 40, // below the top nav (z-100) so it doesn't cover Dashboard/News/etc links
                pointerEvents: 'auto',
              }}
            >
              <div className="p-4 space-y-4 text-sm overflow-y-auto flex-1 min-h-0">
                {/* Researcher-only shelter overlay toggle. Default OFF.
                    Literal red/green switch — absolute thumb in fixed-width
                    track so the layout doesn't shift between states. */}
                <div className={`rounded-md border-2 px-3 py-3 flex items-center justify-between gap-3 transition-colors ${
                  showShelters ? 'border-emerald-500 bg-emerald-50' : 'border-red-300 bg-red-50/50'
                }`}>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900">Shelter overlay</div>
                    <div className="text-[11px] text-zinc-600 mt-0.5">
                      {showShelters
                        ? `Showing ${shelters.length || '…'} shelters across CA`
                        : 'Click to show all 8,014 CA shelters'}
                    </div>
                  </div>
                  {/* Using <div role="switch"> instead of <button> so browser
                      button defaults can't repaint the background white.
                      backgroundColor (not shorthand 'background') so no other
                      CSS shorthand override sneaks in. */}
                  <div
                    role="switch"
                    tabIndex={0}
                    aria-checked={showShelters}
                    onClick={() => setShowShelters(v => !v)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowShelters(v => !v); } }}
                    style={{
                      backgroundColor: showShelters ? '#16a34a' : '#ef4444',
                      width: 68, height: 28,
                    }}
                    className="relative shrink-0 rounded-full cursor-pointer select-none border-2 border-white shadow-inner outline-none focus:ring-2 focus:ring-offset-1 focus:ring-emerald-500"
                  >
                    <span
                      className="absolute top-1/2 -translate-y-1/2 text-[10px] font-bold text-white pointer-events-none"
                      style={{ left: showShelters ? 10 : 'auto', right: showShelters ? 'auto' : 8 }}
                    >
                      {showShelters ? 'ON' : 'OFF'}
                    </span>
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        top: 2, left: 2,
                        width: 18, height: 18,
                        background: 'white',
                        borderRadius: '50%',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                        transform: showShelters ? 'translateX(40px)' : 'translateX(0)',
                        transition: 'transform 0.15s',
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Map view</div>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-muted rounded-md">
                    {(["fires", "zones", "mixed"] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          setActiveLayer(opt);
                          // Every view switch starts with a clean sidebar
                          setSelectedPerimeter(null);
                          setSelectedZone(null);
                          setSelectedZoneRisk(null);
                        }}
                        className={`text-xs py-1.5 rounded ${activeLayer === opt ? "bg-white shadow-sm font-semibold" : "text-muted-foreground"}`}
                      >
                        {opt === "fires" ? "Fire" : opt === "zones" ? "Risk zone" : "Mixed"}
                      </button>
                    ))}
                  </div>
                </div>

                {activeLayer !== "zones" && selectedPerimeter && (
                  <div className="pt-3 border-t">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Selected fire</div>
                    <div className="flex items-center gap-2 mb-2">
                      <Flame className="h-4 w-4 text-red-500 shrink-0" />
                      <div className="font-bold text-sm">
                        {selectedPerimeter.poly_IncidentName || "Unknown Fire"}
                      </div>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {selectedPerimeter.poly_GISAcres != null && (
                        <div>Acres: <span className="font-medium text-foreground">{Number(selectedPerimeter.poly_GISAcres).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
                      )}
                      {(() => {
                        const raw = selectedPerimeter.attr_PercentContained;
                        const pct = raw == null ? null : Number(raw);
                        const label = pct == null
                          ? 'Unknown (treated as 0–24%)'
                          : pct >= 100 ? `${pct}% (100%)`
                          : pct >= 50 ? `${pct}% (50–99%)`
                          : pct >= 25 ? `${pct}% (25–49%)`
                          : `${pct}% (0–24%)`;
                        const color = pct == null ? '#dc2626'
                          : pct >= 100 ? '#ffffff'
                          : pct >= 50 ? '#facc15'
                          : pct >= 25 ? '#f97316'
                          : '#dc2626';
                        return (
                          <div className="flex items-center gap-1.5">
                            <span style={{ width: 10, height: 10, borderRadius: 2, background: color, border: '1px solid #d1d5db', display: 'inline-block' }} />
                            <span>Contained: <span className="font-medium text-foreground">{label}</span></span>
                          </div>
                        );
                      })()}
                      {selectedPerimeter.poly_FeatureCategory && (
                        <div>Type: <span className="font-medium text-foreground">{selectedPerimeter.poly_FeatureCategory}</span></div>
                      )}
                      {selectedPerimeter.attr_FireDiscoveryDateTime && (
                        <div>Discovered: <span className="font-medium text-foreground">{new Date(Number(selectedPerimeter.attr_FireDiscoveryDateTime)).toLocaleString()}</span></div>
                      )}
                      <div className="pt-1">Source: <a href="https://data-nifc.opendata.arcgis.com/" target="_blank" rel="noopener noreferrer" className="underline">NIFC WFIGS</a></div>
                    </div>
                  </div>
                )}

                {/* Selected shelter — same sidebar pattern as Selected fire,
                    populated when a shelter pin is clicked. */}
                {showShelters && selectedShelter && (
                  <div className="pt-3 border-t">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Selected shelter</div>
                      <button onClick={() => setSelectedShelter(null)} className="text-[10px] text-muted-foreground hover:text-foreground">clear</button>
                    </div>
                    <div className="font-bold text-sm mb-1.5">{selectedShelter.shelter_name || 'Shelter'}</div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {selectedShelter.shelter_status_code && (
                        <div>Status: <span className={`font-medium ${String(selectedShelter.shelter_status_code).toUpperCase() === 'OPEN' ? 'text-emerald-700' : 'text-zinc-700'}`}>{selectedShelter.shelter_status_code}</span></div>
                      )}
                      {selectedShelter.address_1 && <div>Address: <span className="font-medium text-foreground">{selectedShelter.address_1}</span></div>}
                      {selectedShelter.city && <div>City / ZIP: <span className="font-medium text-foreground">{selectedShelter.city}, {selectedShelter.state || 'CA'} {selectedShelter.zip || ''}</span></div>}
                      {selectedShelter.county_parish && <div>County: <span className="font-medium text-foreground">{selectedShelter.county_parish}</span></div>}
                      {selectedShelter.facility_type && <div>Facility: <span className="font-medium text-foreground">{selectedShelter.facility_type}</span></div>}
                      {selectedShelter.facility_usage_code && <div>Usage: <span className="font-medium text-foreground">{selectedShelter.facility_usage_code}</span></div>}
                      {selectedShelter.evacuation_capacity ? <div>Evac capacity: <span className="font-medium text-foreground">{selectedShelter.evacuation_capacity} people</span></div> : null}
                      {selectedShelter.post_impact_capacity ? <div>Post-impact capacity: <span className="font-medium text-foreground">{selectedShelter.post_impact_capacity} people</span></div> : null}
                      {selectedShelter.wheelchair_accessible === 'YES' && <div className="text-emerald-700">♿ Wheelchair accessible</div>}
                      {selectedShelter.generator_onsite === 'YES' && <div className="text-emerald-700">⚡ Generator on-site</div>}
                      {selectedShelter.latitude != null && selectedShelter.longitude != null && (
                        <div className="pt-1">
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${selectedShelter.latitude},${selectedShelter.longitude}`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs underline text-blue-600"
                          >Open in Google Maps</a>
                        </div>
                      )}
                      <div className="pt-1">Source: <a href="https://data.ca.gov/" target="_blank" rel="noopener noreferrer" className="underline">CalOES CA Shelter system</a></div>
                    </div>
                  </div>
                )}

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
                              backgroundColor: selectedZoneRisk.risk_score >= 0.66 ? "#dc2626"
                                : selectedZoneRisk.risk_score >= 0.33 ? "#eab308"
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
                        <label className="text-xs font-medium flex justify-between">🌡️ Temperature <span className="text-muted-foreground">{lstFahrenheit}°F</span></label>
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
                      <div>
                        <label className="text-xs font-medium flex justify-between" title="Keetch-Byram Drought Index: 0 = saturated soil, 800 = severe drought">🥵 Drought (KBDI) <span className="text-muted-foreground">{kbdiSlider}</span></label>
                        <input type="range" min={0} max={800} step={10} value={kbdiSlider} onChange={(e) => { const v = Number(e.target.value); setKbdiSlider(v); updateZoneOverride("kbdi", v); }} disabled={!useOverrides || !selectedZone} className="w-full mt-1 accent-amber-600 disabled:opacity-40" />
                      </div>
                      <div>
                        <label className="text-xs font-medium flex justify-between">🔥 TA (Thermal Anomalies) <span className="text-muted-foreground">{taSlider}</span></label>
                        <input type="range" min={0} max={100} step={1} value={taSlider} onChange={(e) => { const v = Number(e.target.value); setTaSlider(v); updateZoneOverride("ta", v); }} disabled={!useOverrides || !selectedZone} className="w-full mt-1 accent-red-500 disabled:opacity-40" />
                      </div>
                      <div>
                        <label className="text-xs font-medium flex justify-between">🌳 NDVI (Vegetation cover) <span className="text-muted-foreground">{ndviSlider.toFixed(2)}</span></label>
                        <input type="range" min={-1} max={1} step={0.01} value={ndviSlider} onChange={(e) => { const v = Number(e.target.value); setNdviSlider(v); updateZoneOverride("ndvi", v); }} disabled={!useOverrides || !selectedZone} className="w-full mt-1 accent-emerald-500 disabled:opacity-40" />
                      </div>
                      <label className="flex items-center justify-between gap-2 text-xs cursor-pointer pt-1">
                        <span className="font-medium">🔥 Fire (binary outcome)</span>
                        <input type="checkbox" checked={fireBinary} onChange={(e) => { const v = e.target.checked; setFireBinary(v); updateZoneOverride("fire", v as any); }} disabled={!useOverrides || !selectedZone} className="accent-red-500 disabled:opacity-40" />
                      </label>
                      <p className="text-[10px] text-muted-foreground">
                        EVI · LST · Wind · Elevation drive the current model. TA · NDVI · Fire are logged for the next retrain (see ActiveFireSnapshot in backend/routes/history.py).
                      </p>
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
          </div>

      {/* Identical map legend block as the Shelters & Evac page.
          showCluster=false because research uses individual pins, not the
          clustered IconLayer; showHowTo=false because researchers don't
          need the "click blue clusters" guidance. */}
      <MapLegend showHowTo={false} showCluster={false} />

    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main export — switches between views based on role                 */
/* ------------------------------------------------------------------ */
export function ResearchPage({ userRole, isGuest, onLoginRequired }: ResearchPageProps) {
  if (userRole === "Researcher" || userRole === "Admin") {
    return <ResearchMapView />;
  }
  return <RequestAccessView isGuest={isGuest} onLoginRequired={onLoginRequired} />;
}
