import { useState, useRef, useEffect } from "react";
import {
  Map,
  Layers,
  Thermometer,
  Wind,
  Droplets,
  Flame,
  AlertTriangle,
  MapPin,
  ZoomIn,
  ZoomOut,
  Locate,
  Filter,
  Info,
  Eye,
  EyeOff,
  Calendar,
  Clock,
  Search,
  Pencil,
  Hand,
  MousePointer,
  Circle,
  Square,
  Navigation,
  Play,
  Pause,
  RotateCcw
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Switch } from "./ui/switch";
import { Slider } from "./ui/slider";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { Alert, AlertDescription } from "./ui/alert";
import { Map as GoogleMap, useMap } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { GeoJsonLayer } from '@deck.gl/layers';

interface MapLayer {
  id: string;
  name: string;
  icon: React.ElementType;
  enabled: boolean;
  opacity: number;
  color: string;
}

interface FireIncident {
  id: string;
  name: string;
  status: "active" | "contained" | "controlled" | "out";
  acres: number;
  containment: number;
  coordinates: { lat: number; lng: number };
  startDate: string;
  threatLevel: "low" | "moderate" | "high" | "extreme";
}

interface WeatherStation {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number };
  temperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  lastReading: string;
}

// No mock data - will load from real sources

// No mock data - will load from real sources

// Fire Perimeters Overlay Component
function FirePerimetersOverlay({ enabled, opacity }: { enabled: boolean; opacity: number }) {
  const map = useMap();
  const [overlay, setOverlay] = useState<GoogleMapsOverlay | null>(null);
  const [fireData, setFireData] = useState<any>(null);
  const [selectedFire, setSelectedFire] = useState<any>(null);

  // Load fire perimeter GeoJSON
  useEffect(() => {
    fetch('/Data/California_Fire_Perimeters.geojson')
      .then(response => response.json())
      .then(data => {
        console.log('Loaded fire perimeters:', data.features.length);
        setFireData(data);
      })
      .catch(error => {
        console.error('Error loading fire perimeters:', error);
      });
  }, []);

  useEffect(() => {
    if (!map || !fireData || !enabled) {
      if (overlay) {
        overlay.setMap(null);
        overlay.finalize();
        setOverlay(null);
      }
      return;
    }

    // Clean up old overlay
    if (overlay) {
      overlay.setMap(null);
      overlay.finalize();
    }

    // Create new overlay with GeoJsonLayer
    const deckOverlay = new GoogleMapsOverlay({
      layers: [
        new GeoJsonLayer({
          id: 'fire-perimeters',
          data: fireData,
          pickable: true,
          stroked: true,
          filled: true,

          // Polygon fill
          getFillColor: (d: any) => {
            // Color by fire status or year
            const year = d.properties.YEAR_;
            if (year >= 2025) return [220, 38, 38, opacity * 1.5]; // Bright red - 2025 fires
            if (year >= 2024) return [249, 115, 22, opacity * 1.5]; // Orange - 2024
            if (year >= 2023) return [234, 179, 8, opacity * 1.2]; // Yellow - 2023
            return [156, 163, 175, opacity * 0.8]; // Gray - older
          },

          // Outline
          getLineColor: [255, 255, 255, 200],
          getLineWidth: 2,
          lineWidthMinPixels: 1,

          // Tooltip on hover/click
          onClick: (info: any) => {
            if (info.object) {
              setSelectedFire(info.object.properties);
            }
          },

          // Update triggers
          updateTriggers: {
            getFillColor: [opacity]
          }
        })
      ]
    });

    deckOverlay.setMap(map);
    setOverlay(deckOverlay);

    return () => {
      if (deckOverlay) {
        deckOverlay.setMap(null);
        deckOverlay.finalize();
      }
    };
  }, [map, fireData, enabled, opacity]);

  // Render tooltip if fire is selected
  if (selectedFire) {
    return (
      <div
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          backgroundColor: 'white',
          padding: '16px',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          maxWidth: '300px',
          zIndex: 1000,
          pointerEvents: 'auto'
        }}
      >
        <div className="flex justify-between items-start mb-2">
          <h3 className="font-bold text-lg">{selectedFire.FIRE_NAME}</h3>
          <button
            onClick={() => setSelectedFire(null)}
            className="text-gray-500 hover:text-gray-700"
          >
            ×
          </button>
        </div>
        <div className="space-y-1 text-sm">
          <div><strong>Incident:</strong> {selectedFire.INC_NUM}</div>
          <div><strong>Year:</strong> {selectedFire.YEAR_}</div>
          <div><strong>Acres:</strong> {selectedFire.GIS_ACRES?.toLocaleString()}</div>
          <div><strong>Agency:</strong> {selectedFire.AGENCY}</div>
          {selectedFire.ALARM_DATE && (
            <div><strong>Start:</strong> {new Date(selectedFire.ALARM_DATE).toLocaleDateString()}</div>
          )}
          {selectedFire.CONT_DATE && (
            <div><strong>Contained:</strong> {new Date(selectedFire.CONT_DATE).toLocaleDateString()}</div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

// Fire incident marker component
function FireIncidentMarker({ incident, selected, onClick }: { incident: FireIncident; selected: boolean; onClick: () => void }) {
  const map = useMap();
  const [marker, setMarker] = useState<google.maps.Marker | null>(null);

  useEffect(() => {
    if (!map) return;

    const getIncidentColor = () => {
      if (incident.status === 'active') return '#dc2626';
      if (incident.status === 'contained') return '#f97316';
      return '#eab308';
    };

    const marker = new google.maps.Marker({
      position: incident.coordinates,
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: selected ? 12 : 10,
        fillColor: getIncidentColor(),
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2
      },
      title: incident.name
    });

    marker.addListener('click', onClick);
    setMarker(marker);

    return () => {
      marker.setMap(null);
    };
  }, [map, incident, selected, onClick]);

  return null;
}

// Weather station marker component
function WeatherStationMarker({ station, selected, onClick }: { station: WeatherStation; selected: boolean; onClick: () => void }) {
  const map = useMap();
  const [marker, setMarker] = useState<google.maps.Marker | null>(null);

  useEffect(() => {
    if (!map) return;

    const marker = new google.maps.Marker({
      position: station.coordinates,
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: selected ? 8 : 6,
        fillColor: '#3b82f6',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2
      },
      title: station.name
    });

    marker.addListener('click', onClick);
    setMarker(marker);

    return () => {
      marker.setMap(null);
    };
  }, [map, station, selected, onClick]);

  return null;
}

export function RiskMap() {
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'satellite' | 'hybrid' | 'terrain'>('satellite');
  const [timeframe, setTimeframe] = useState<"current" | "forecast-6h" | "forecast-24h">("current");
  const [searchQuery, setSearchQuery] = useState("");

  const [layers, setLayers] = useState<MapLayer[]>([
    { id: "fire-perimeters", name: "Fire Perimeters", icon: Flame, enabled: true, opacity: 60, color: "red" },
    { id: "fire-incidents", name: "Fire Incidents", icon: Flame, enabled: true, opacity: 100, color: "red" },
    { id: "weather-stations", name: "Weather Stations", icon: Thermometer, enabled: true, opacity: 100, color: "blue" },
    { id: "temperature", name: "Temperature", icon: Thermometer, enabled: false, opacity: 50, color: "orange" },
    { id: "humidity", name: "Humidity", icon: Droplets, enabled: false, opacity: 50, color: "blue" },
    { id: "wind", name: "Wind Patterns", icon: Wind, enabled: false, opacity: 50, color: "purple" },
  ]);

  const toggleLayer = (layerId: string) => {
    setLayers(layers.map(layer =>
      layer.id === layerId ? { ...layer, enabled: !layer.enabled } : layer
    ));
  };

  const updateLayerOpacity = (layerId: string, opacity: number) => {
    setLayers(layers.map(layer =>
      layer.id === layerId ? { ...layer, opacity } : layer
    ));
  };

  const selectedIncidentData = null; // Will be populated with real data
  const selectedStationData = null; // Will be populated with real data

  const firePerimetersLayer = layers.find(l => l.id === "fire-perimeters");

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Risk Assessment Map</h1>
            <p className="text-muted-foreground">
              Real-time wildfire risk zones, active incidents, and fire perimeters
            </p>
          </div>
          <div className="flex gap-2">
            <Select value={timeframe} onValueChange={(value) => setTimeframe(value as any)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Current</SelectItem>
                <SelectItem value="forecast-6h">6-Hour Forecast</SelectItem>
                <SelectItem value="forecast-24h">24-Hour Forecast</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline">
              <Calendar className="h-4 w-4 mr-2" />
              Historical
            </Button>
            <Button>
              <AlertTriangle className="h-4 w-4 mr-2" />
              Alerts
            </Button>
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
          {/* Map Container */}
          <div className="lg:col-span-3">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <Map className="h-5 w-5" />
                    Interactive Risk Map
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search location..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-48 pl-8"
                      />
                    </div>

                    {/* Map Type Selector */}
                    <Select value={mapTypeId} onValueChange={(value) => setMapTypeId(value as any)}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
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
                {/* Google Map */}
                <div className="w-full h-screen rounded-lg overflow-hidden border relative">
                  <GoogleMap
                    style={{ width: '100%', height: '100%' }}
                    defaultCenter={{ lat: 36.7, lng: -119.8 }}
                    defaultZoom={7}
                    mapTypeId={mapTypeId}
                    gestureHandling="greedy"
                    disableDefaultUI={false}
                  >
                    {/* Fire Perimeters Layer */}
                    <FirePerimetersOverlay
                      enabled={firePerimetersLayer?.enabled || false}
                      opacity={firePerimetersLayer?.opacity || 60}
                    />

                    {/* Fire Incidents - removed mock data */}
                    {/* Add real fire incident data source here */}

                    {/* Weather Stations - removed mock data */}
                    {/* Add real weather station data source here */}
                  </GoogleMap>
                </div>

                {/* Map Legend */}
                <div className="mt-4 bg-gray-50 rounded-lg p-4">
                  <h4 className="font-semibold text-sm mb-3">Map Legend</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-4 bg-red-600 border border-white rounded"></div>
                      <span>2025 Fires</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-4 bg-orange-500 border border-white rounded"></div>
                      <span>2024 Fires</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-4 bg-yellow-500 border border-white rounded"></div>
                      <span>2023 Fires</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 bg-red-600 rounded-full border-2 border-white"></div>
                      <span>Active Fire</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-blue-500 border-2 border-white rounded-full"></div>
                      <span>Weather Station</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    💡 Click fire perimeters for details. Toggle layers in the sidebar.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Map Layers */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="h-5 w-5" />
                  Map Layers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {layers.map((layer) => {
                  const Icon = layer.icon;
                  return (
                    <div key={layer.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <span className="text-sm">{layer.name}</span>
                        </div>
                        <Switch
                          checked={layer.enabled}
                          onCheckedChange={() => toggleLayer(layer.id)}
                        />
                      </div>
                      {layer.enabled && (
                        <div className="ml-6">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>Opacity</span>
                            <Slider
                              value={[layer.opacity]}
                              onValueChange={(value) => updateLayerOpacity(layer.id, value[0])}
                              max={100}
                              step={10}
                              className="flex-1"
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

            {/* Selected Item Details */}
            {(selectedIncidentData || selectedStationData) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Info className="h-5 w-5" />
                    Details
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedIncidentData && (
                    <div className="space-y-2">
                      <h3 className="font-medium">{selectedIncidentData.name}</h3>
                      <Badge variant={selectedIncidentData.status === "active" ? "destructive" : "secondary"}>
                        {selectedIncidentData.status}
                      </Badge>
                      <div className="text-sm space-y-1">
                        <div>Size: {selectedIncidentData.acres.toLocaleString()} acres</div>
                        <div>Containment: {selectedIncidentData.containment}%</div>
                        <div>Started: {selectedIncidentData.startDate}</div>
                        <div>Threat: {selectedIncidentData.threatLevel}</div>
                      </div>
                    </div>
                  )}

                  {selectedStationData && (
                    <div className="space-y-2">
                      <h3 className="font-medium">{selectedStationData.name}</h3>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-1">
                          <Thermometer className="h-3 w-3" />
                          {selectedStationData.temperature}°F
                        </div>
                        <div className="flex items-center gap-1">
                          <Droplets className="h-3 w-3" />
                          {selectedStationData.humidity}%
                        </div>
                        <div className="flex items-center gap-1">
                          <Wind className="h-3 w-3" />
                          {selectedStationData.windSpeed} mph
                        </div>
                        <div className="text-xs">
                          Dir: {selectedStationData.windDirection}°
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
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
                  <div className="text-sm text-muted-foreground">Active Fires (Load Data)</div>
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
                  <div className="text-2xl font-bold">-</div>
                  <div className="text-sm text-muted-foreground">Weather Stations</div>
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