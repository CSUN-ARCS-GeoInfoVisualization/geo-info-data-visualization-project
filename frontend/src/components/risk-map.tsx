import { useState, useEffect } from "react";
import {
  Map,
  Layers,
  Thermometer,
  Wind,
  Droplets,
  Flame,
  AlertTriangle,
  Calendar,
  Clock,
  Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Slider } from "./ui/slider";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { TooltipProvider } from "./ui/tooltip";
import { Alert, AlertDescription } from "./ui/alert";
import { Map as GoogleMap } from '@vis.gl/react-google-maps';
import DeckGL from '@deck.gl/react';
import { LineLayer } from '@deck.gl/layers';
import type { MapViewState, PickingInfo } from '@deck.gl/core';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MapLayer {
  id: string;
  name: string;
  icon: React.ElementType;
  enabled: boolean;
  opacity: number;
  color: string;
}

interface WindPoint {
  position: [number, number];
  u: number;
  v: number;
  speed: number;
}

interface WindArrow {
  sourcePosition: [number, number, number];
  targetPosition: [number, number, number];
  color: [number, number, number, number];
  label?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INITIAL_VIEW_STATE: MapViewState = {
  latitude: 36.7,
  longitude: -119.8,
  zoom: 6,
  maxZoom: 16,
  pitch: 0,
  bearing: 0,
};

function generateGrid(
  latMin: number, latMax: number,
  lngMin: number, lngMax: number,
  step: number
): [number, number][] {
  const pts: [number, number][] = [];
  for (let lat = latMin; lat <= latMax; lat += step)
    for (let lng = lngMin; lng <= lngMax; lng += step)
      pts.push([lng, lat]);
  return pts;
}

const CA_GRID = generateGrid(32.5, 42, -124.5, -114, 0.75);

// ─── Wind helpers ─────────────────────────────────────────────────────────────

function speedToColor(speed: number, alpha: number): [number, number, number, number] {
  const t = Math.min(speed / 15, 1);
  return [
    Math.round(255 * Math.min(t * 2, 1)),
    Math.round(255 * (1 - Math.abs(t * 2 - 1))),
    Math.round(255 * Math.max(1 - t * 2, 0)),
    alpha,
  ];
}

function buildWindArrows(windData: WindPoint[], alpha: number): WindArrow[] {
  const scale = 0.18;
  const arrows: WindArrow[] = [];
  for (const p of windData) {
    const [lng, lat] = p.position;
    const dx = p.u * scale;
    const dy = p.v * scale;
    const color = speedToColor(p.speed, alpha);
    const tipLng = lng + dx;
    const tipLat = lat + dy;
    arrows.push({ sourcePosition: [lng, lat, 0], targetPosition: [tipLng, tipLat, 0], color, label: `${p.speed.toFixed(1)} m/s` });
    const headLen = Math.max(Math.sqrt(dx * dx + dy * dy) * 0.35, 0.04);
    const backAngle = Math.atan2(dy, dx) + Math.PI;
    for (const spread of [-0.45, 0.45]) {
      arrows.push({
        sourcePosition: [tipLng, tipLat, 0],
        targetPosition: [tipLng + Math.cos(backAngle + spread) * headLen, tipLat + Math.sin(backAngle + spread) * headLen, 0],
        color,
      });
    }
  }
  return arrows;
}

function getTooltip({ object }: PickingInfo) {
  const arrow = object as WindArrow | null;
  return arrow?.label ? `Wind: ${arrow.label}` : null;
}

// ─── RiskMap ──────────────────────────────────────────────────────────────────

export function RiskMap() {
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'satellite' | 'hybrid' | 'terrain'>('satellite');
  const [timeframe, setTimeframe] = useState<'current' | 'forecast-6h' | 'forecast-24h'>('current');
  const [searchQuery, setSearchQuery] = useState('');
  const [windData, setWindData] = useState<WindPoint[]>([]);

  const [layers, setLayers] = useState<MapLayer[]>([
    { id: 'wind', name: 'Wind Arrows', icon: Wind, enabled: true, opacity: 80, color: 'purple' },
    { id: 'weather-stations', name: 'Weather Stations', icon: Thermometer, enabled: false, opacity: 100, color: 'blue' },
    { id: 'temperature', name: 'Temperature', icon: Thermometer, enabled: false, opacity: 50, color: 'orange' },
    { id: 'humidity', name: 'Humidity', icon: Droplets, enabled: false, opacity: 50, color: 'blue' },
  ]);

  const toggleLayer = (id: string) =>
    setLayers(ls => ls.map(l => l.id === id ? { ...l, enabled: !l.enabled } : l));

  const updateOpacity = (id: string, opacity: number) =>
    setLayers(ls => ls.map(l => l.id === id ? { ...l, opacity } : l));

  const windLayer = layers.find(l => l.id === 'wind')!;
  const windAlpha = Math.round((windLayer.opacity / 100) * 255);

  useEffect(() => {
    if (!windLayer.enabled) { setWindData([]); return; }
    const lats = CA_GRID.map(p => p[1]).join(',');
    const lngs = CA_GRID.map(p => p[0]).join(',');
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
      `&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timeformat=unixtime`
    )
      .then(r => r.json())
      .then((res: any) => {
        const arr: any[] = Array.isArray(res) ? res : [res];
        setWindData(
          arr.map((d, i) => {
            const speed = d?.current?.wind_speed_10m ?? 0;
            const rad = ((d?.current?.wind_direction_10m ?? 0) * Math.PI) / 180;
            return { position: CA_GRID[i], u: -speed * Math.sin(rad), v: -speed * Math.cos(rad), speed };
          }).filter(p => p.speed > 0)
        );
      })
      .catch(console.error);
  }, [windLayer.enabled]);

  // Exactly like app.tsx — build layers array, pass to DeckGL
  const deckLayers = [
    ...(windLayer.enabled && windData.length > 0
      ? [new LineLayer<WindArrow>({
          id: 'wind-arrows',
          data: buildWindArrows(windData, windAlpha),
          opacity: 0.9,
          getSourcePosition: d => d.sourcePosition,
          getTargetPosition: d => d.targetPosition,
          getColor: d => d.color,
          getWidth: 2,
          widthUnits: 'pixels',
          pickable: true,
        })]
      : []),
  ];

  return (
    <TooltipProvider>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Risk Assessment Map</h1>
            <p className="text-muted-foreground">Real-time wildfire risk zones and active incident monitoring</p>
          </div>
          <div className="flex gap-2">
            <Select value={timeframe} onValueChange={v => setTimeframe(v as any)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Current</SelectItem>
                <SelectItem value="forecast-6h">6-Hour Forecast</SelectItem>
                <SelectItem value="forecast-24h">24-Hour Forecast</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline"><Calendar className="h-4 w-4 mr-2" />Historical</Button>
            <Button><AlertTriangle className="h-4 w-4 mr-2" />Alerts</Button>
          </div>
        </div>

        {/* Alert Banner */}
        <Alert className="border-l-4 border-l-red-500 bg-red-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Red Flag Warning:</strong> Extreme fire risk conditions detected.
            High winds and low humidity expected through tomorrow evening.
          </AlertDescription>
        </Alert>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* Map */}
          <div className="lg:col-span-3">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <Map className="h-5 w-5" />Interactive Risk Map
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search location..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-48 pl-8"
                      />
                    </div>
                    <Select value={mapTypeId} onValueChange={v => setMapTypeId(v as any)}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="satellite">Satellite</SelectItem>
                        <SelectItem value="terrain">Terrain</SelectItem>
                        <SelectItem value="roadmap">Roadmap</SelectItem>
                        <SelectItem value="hybrid">Hybrid</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>

                {/* DeckGL — same structure as app.tsx */}
                <div className="w-full h-96 rounded-lg overflow-hidden border">
                  <DeckGL
                    initialViewState={INITIAL_VIEW_STATE}
                    controller={true}
                    layers={deckLayers}
                    pickingRadius={5}
                    getTooltip={getTooltip}
                    parameters={{
                      blendColorOperation: 'add',
                      blendColorSrcFactor: 'src-alpha',
                      blendColorDstFactor: 'one',
                      blendAlphaOperation: 'add',
                      blendAlphaSrcFactor: 'one-minus-dst-alpha',
                      blendAlphaDstFactor: 'one',
                    }}
                    style={{ position: 'relative', width: '100%', height: '100%' }}
                  >
                    <GoogleMap
                      style={{ width: '100%', height: '100%' }}
                      defaultCenter={{ lat: INITIAL_VIEW_STATE.latitude, lng: INITIAL_VIEW_STATE.longitude }}
                      defaultZoom={INITIAL_VIEW_STATE.zoom}
                      mapTypeId={mapTypeId}
                      gestureHandling="none"
                      disableDefaultUI={true}
                    />
                  </DeckGL>
                </div>

                {/* Legend */}
                <div className="mt-4 bg-gray-50 rounded-lg p-4">
                  <h4 className="font-semibold text-sm mb-3">Wind Speed Legend</h4>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="h-0.5 w-8 rounded" style={{ backgroundColor: 'rgb(0,128,255)' }} />
                      <span>Calm (&lt;3 m/s)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-0.5 w-8 rounded" style={{ backgroundColor: 'rgb(255,255,0)' }} />
                      <span>Moderate (~7 m/s)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-0.5 w-8 rounded" style={{ backgroundColor: 'rgb(255,0,0)' }} />
                      <span>Strong (15+ m/s)</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    💡 Arrows show wind direction and speed. Hover for m/s value. Data: Open-Meteo (live).
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="h-5 w-5" />Map Layers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {layers.map(layer => {
                  const Icon = layer.icon;
                  return (
                    <div key={layer.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span className="text-sm">{layer.name}</span>
                        </div>
                        <Switch checked={layer.enabled} onCheckedChange={() => toggleLayer(layer.id)} />
                      </div>
                      {layer.enabled && (
                        <div className="ml-6">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>Opacity</span>
                            <Slider
                              value={[layer.opacity]}
                              onValueChange={v => updateOpacity(layer.id, v[0])}
                              max={100} step={10} className="flex-1"
                            />
                            <span>{layer.opacity}%</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Summary Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <div>
                  <div className="text-2xl font-bold">-</div>
                  <div className="text-sm text-muted-foreground">Active Fires</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-500" />
                <div>
                  <div className="text-2xl font-bold">-</div>
                  <div className="text-sm text-muted-foreground">Total Incidents</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Thermometer className="h-5 w-5 text-blue-500" />
                <div>
                  <div className="text-2xl font-bold">{windData.length > 0 ? windData.length : '-'}</div>
                  <div className="text-sm text-muted-foreground">Wind Points</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-green-500" />
                <div>
                  <div className="text-2xl font-bold">Live</div>
                  <div className="text-sm text-muted-foreground">Data Feed</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </TooltipProvider>
  );
}