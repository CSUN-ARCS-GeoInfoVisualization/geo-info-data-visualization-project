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
import { ImageWithFallback } from "./figma/ImageWithFallback";

interface MapLayer {
  id: string;
  name: string;
  icon: React.ElementType;
  enabled: boolean;
  opacity: number;
  color: string;
}

interface RiskZone {
  id: string;
  name: string;
  riskLevel: "low" | "moderate" | "high" | "extreme";
  coordinates: { x: number; y: number; width: number; height: number };
  temperature: number;
  humidity: number;
  windSpeed: number;
  lastUpdated: string;
}

interface FireIncident {
  id: string;
  name: string;
  status: "active" | "contained" | "controlled" | "out";
  acres: number;
  containment: number;
  coordinates: { x: number; y: number };
  startDate: string;
  threatLevel: "low" | "moderate" | "high" | "extreme";
}

interface WeatherStation {
  id: string;
  name: string;
  coordinates: { x: number; y: number };
  temperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  lastReading: string;
}

const mockRiskZones: RiskZone[] = [
  {
    id: "zone-1",
    name: "North Valley",
    riskLevel: "extreme",
    coordinates: { x: 15, y: 10, width: 30, height: 25 },
    temperature: 98,
    humidity: 12,
    windSpeed: 35,
    lastUpdated: "5 minutes ago"
  },
  {
    id: "zone-2",
    name: "East Hills",
    riskLevel: "high",
    coordinates: { x: 60, y: 20, width: 25, height: 30 },
    temperature: 89,
    humidity: 18,
    windSpeed: 28,
    lastUpdated: "8 minutes ago"
  },
  {
    id: "zone-3",
    name: "Central Plains",
    riskLevel: "moderate",
    coordinates: { x: 35, y: 45, width: 35, height: 20 },
    temperature: 82,
    humidity: 35,
    windSpeed: 15,
    lastUpdated: "3 minutes ago"
  },
  {
    id: "zone-4",
    name: "South Basin",
    riskLevel: "low",
    coordinates: { x: 20, y: 70, width: 40, height: 20 },
    temperature: 76,
    humidity: 45,
    windSpeed: 8,
    lastUpdated: "12 minutes ago"
  }
];

const mockFireIncidents: FireIncident[] = [
  {
    id: "fire-1",
    name: "Oak Ridge Fire",
    status: "active",
    acres: 2845,
    containment: 25,
    coordinates: { x: 25, y: 18 },
    startDate: "2025-09-15",
    threatLevel: "extreme"
  },
  {
    id: "fire-2",
    name: "Pine Valley Fire",
    status: "contained",
    acres: 156,
    containment: 95,
    coordinates: { x: 70, y: 35 },
    startDate: "2025-09-14",
    threatLevel: "low"
  },
  {
    id: "fire-3",
    name: "Mesa Point Fire",
    status: "controlled",
    acres: 892,
    containment: 80,
    coordinates: { x: 45, y: 55 },
    startDate: "2025-09-13",
    threatLevel: "moderate"
  }
];

const mockWeatherStations: WeatherStation[] = [
  {
    id: "ws-1",
    name: "North Station",
    coordinates: { x: 30, y: 15 },
    temperature: 98,
    humidity: 12,
    windSpeed: 35,
    windDirection: 225,
    lastReading: "2 minutes ago"
  },
  {
    id: "ws-2",
    name: "East Station",
    coordinates: { x: 75, y: 30 },
    temperature: 89,
    humidity: 18,
    windSpeed: 28,
    windDirection: 180,
    lastReading: "4 minutes ago"
  },
  {
    id: "ws-3",
    name: "Central Station",
    coordinates: { x: 50, y: 50 },
    temperature: 82,
    humidity: 35,
    windSpeed: 15,
    windDirection: 135,
    lastReading: "1 minute ago"
  }
];

interface MapViewport {
  x: number;
  y: number;
  zoom: number;
}

interface DrawingShape {
  id: string;
  type: "circle" | "rectangle" | "line";
  coordinates: { x: number; y: number; x2?: number; y2?: number; radius?: number };
  color: string;
  label?: string;
}

export function RiskMap() {
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [mapView, setMapView] = useState<"satellite" | "terrain" | "street">("satellite");
  const [timeframe, setTimeframe] = useState<"current" | "forecast-6h" | "forecast-24h">("current");

  // Interactive features
  const [viewport, setViewport] = useState<MapViewport>({ x: 0, y: 0, zoom: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [mapTool, setMapTool] = useState<"select" | "pan" | "draw-circle" | "draw-rectangle">("select");
  const [drawingShapes, setDrawingShapes] = useState<DrawingShape[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentDrawing, setCurrentDrawing] = useState<Partial<DrawingShape> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(1);

  const mapRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();

  const [layers, setLayers] = useState<MapLayer[]>([
    { id: "risk-zones", name: "Risk Zones", icon: Layers, enabled: true, opacity: 70, color: "multi" },
    { id: "fire-incidents", name: "Fire Incidents", icon: Flame, enabled: true, opacity: 100, color: "red" },
    { id: "weather-stations", name: "Weather Stations", icon: Thermometer, enabled: true, opacity: 100, color: "blue" },
    { id: "wind-patterns", name: "Wind Patterns", icon: Wind, enabled: false, opacity: 60, color: "purple" },
    { id: "evacuation-routes", name: "Evacuation Routes", icon: MapPin, enabled: false, opacity: 80, color: "green" },
    { id: "vegetation", name: "Vegetation Density", icon: Eye, enabled: false, opacity: 50, color: "green" }
  ]);

  const toggleLayer = (layerId: string) => {
    setLayers(prev => prev.map(layer =>
      layer.id === layerId ? { ...layer, enabled: !layer.enabled } : layer
    ));
  };

  const updateLayerOpacity = (layerId: string, opacity: number) => {
    setLayers(prev => prev.map(layer =>
      layer.id === layerId ? { ...layer, opacity } : layer
    ));
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case "extreme": return "bg-red-600/70 border-red-700";
      case "high": return "bg-orange-500/70 border-orange-600";
      case "moderate": return "bg-yellow-500/70 border-yellow-600";
      case "low": return "bg-green-500/70 border-green-600";
      default: return "bg-gray-500/70 border-gray-600";
    }
  };

  const getIncidentColor = (status: string, threatLevel: string) => {
    if (status === "active") {
      return threatLevel === "extreme" ? "bg-red-600" : "bg-orange-500";
    }
    return "bg-gray-500";
  };

  // Interactive handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (mapTool === "pan") {
      setIsDragging(true);
      setDragStart({ x: e.clientX - viewport.x, y: e.clientY - viewport.y });
    } else if (mapTool.startsWith("draw-")) {
      const rect = mapRef.current?.getBoundingClientRect();
      if (rect) {
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        setIsDrawing(true);
        setCurrentDrawing({
          id: `shape-${Date.now()}`,
          type: mapTool.split("-")[1] as "circle" | "rectangle",
          coordinates: { x, y },
          color: "rgba(59, 130, 246, 0.5)"
        });
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && dragStart && mapTool === "pan") {
      setViewport(prev => ({
        ...prev,
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      }));
    } else if (isDrawing && currentDrawing) {
      const rect = mapRef.current?.getBoundingClientRect();
      if (rect) {
        const x2 = ((e.clientX - rect.left) / rect.width) * 100;
        const y2 = ((e.clientY - rect.top) / rect.height) * 100;

        if (currentDrawing.type === "rectangle") {
          setCurrentDrawing(prev => prev ? { ...prev, coordinates: { ...prev.coordinates, x2, y2 } } : null);
        } else if (currentDrawing.type === "circle") {
          const radius = Math.sqrt(Math.pow(x2 - currentDrawing.coordinates!.x, 2) + Math.pow(y2 - currentDrawing.coordinates!.y, 2));
          setCurrentDrawing(prev => prev ? { ...prev, coordinates: { ...prev.coordinates, radius } } : null);
        }
      }
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      setDragStart(null);
    } else if (isDrawing && currentDrawing) {
      setDrawingShapes(prev => [...prev, currentDrawing as DrawingShape]);
      setIsDrawing(false);
      setCurrentDrawing(null);
      setMapTool("select");
    }
  };

  const handleZoom = (direction: "in" | "out") => {
    setViewport(prev => ({
      ...prev,
      zoom: Math.max(0.5, Math.min(3, prev.zoom + (direction === "in" ? 0.2 : -0.2)))
    }));
  };

  const resetView = () => {
    setViewport({ x: 0, y: 0, zoom: 1 });
  };

  const clearDrawings = () => {
    setDrawingShapes([]);
    setCurrentDrawing(null);
    setIsDrawing(false);
  };

  // Animation for fire spread simulation
  useEffect(() => {
    if (isAnimating) {
      const animate = () => {
        // Simulate fire spread animation
        setAnimationSpeed(prev => prev * 0.99 + 0.01); // Gradually slow down
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isAnimating]);

  // Search functionality
  const searchResults = [
    ...mockRiskZones.filter(zone =>
      zone.name.toLowerCase().includes(searchQuery.toLowerCase())
    ).map(zone => ({ ...zone, type: "zone" as const })),
    ...mockFireIncidents.filter(incident =>
      incident.name.toLowerCase().includes(searchQuery.toLowerCase())
    ).map(incident => ({ ...incident, type: "incident" as const })),
    ...mockWeatherStations.filter(station =>
      station.name.toLowerCase().includes(searchQuery.toLowerCase())
    ).map(station => ({ ...station, type: "station" as const }))
  ].slice(0, 5);

  const selectedZoneData = selectedZone ? mockRiskZones.find(z => z.id === selectedZone) : null;
  const selectedIncidentData = selectedIncident ? mockFireIncidents.find(f => f.id === selectedIncident) : null;
  const selectedStationData = selectedStation ? mockWeatherStations.find(s => s.id === selectedStation) : null;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Interactive Risk Map</h1>
            <p className="text-muted-foreground">
              Real-time wildfire risk visualization with weather data and fire incidents
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search locations..."
                className="pl-10 w-48"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && searchResults.length > 0 && (
                <div className="absolute top-full mt-1 w-full bg-white border rounded-lg shadow-lg z-50 max-h-40 overflow-y-auto">
                  {searchResults.map((result, index) => (
                    <button
                      key={index}
                      className="w-full px-3 py-2 text-left hover:bg-muted text-sm border-b last:border-b-0"
                      onClick={() => {
                        if (result.type === "zone") {
                          setSelectedZone(result.id);
                        } else if (result.type === "incident") {
                          setSelectedIncident(result.id);
                        } else if (result.type === "station") {
                          setSelectedStation(result.id);
                        }
                        setSearchQuery("");
                      }}
                    >
                      <div className="font-medium">{result.name}</div>
                      <div className="text-muted-foreground text-xs capitalize">{result.type}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Select value={timeframe} onValueChange={(value) => setTimeframe(value as any)}>
              <SelectTrigger className="w-40">
                <Clock className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Current</SelectItem>
                <SelectItem value="forecast-6h">6hr Forecast</SelectItem>
                <SelectItem value="forecast-24h">24hr Forecast</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAnimating(!isAnimating)}
            >
              {isAnimating ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              {isAnimating ? "Pause" : "Animate"}
            </Button>
          </div>
        </div>

        {/* Alert Banner */}
        <Alert className="border-l-4 border-l-red-500 bg-red-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Critical Fire Weather:</strong> Red Flag Warning in effect. Extreme fire danger conditions with winds up to 45 mph.
          </AlertDescription>
        </Alert>

        {/* Main Map Interface */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Map Canvas */}
          <div className="lg:col-span-3">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Map className="h-5 w-5" />
                    Risk Assessment Map
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {/* Map Tools */}
                    <div className="flex items-center gap-1 border rounded-lg">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant={mapTool === "select" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setMapTool("select")}
                          >
                            <MousePointer className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Select Tool</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant={mapTool === "pan" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setMapTool("pan")}
                          >
                            <Hand className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Pan Tool</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant={mapTool === "draw-circle" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setMapTool("draw-circle")}
                          >
                            <Circle className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Draw Circle</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant={mapTool === "draw-rectangle" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setMapTool("draw-rectangle")}
                          >
                            <Square className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Draw Rectangle</TooltipContent>
                      </Tooltip>
                    </div>

                    <Select value={mapView} onValueChange={(value) => setMapView(value as any)}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="satellite">Satellite</SelectItem>
                        <SelectItem value="terrain">Terrain</SelectItem>
                        <SelectItem value="street">Street</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Map Controls */}
                    <div className="flex items-center gap-1 border rounded-lg">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={() => handleZoom("in")}>
                            <ZoomIn className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Zoom In</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={() => handleZoom("out")}>
                            <ZoomOut className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Zoom Out</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={resetView}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Reset View</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <Locate className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Find My Location</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div
                  ref={mapRef}
                  className="relative w-full h-96 bg-gradient-to-br from-green-100 via-yellow-100 to-red-100 rounded-lg overflow-hidden border select-none"
                  style={{
                    cursor: mapTool === "pan" ? "grab" : mapTool.startsWith("draw-") ? "crosshair" : "default",
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
                  }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
                  {/* Base Map Image */}
                  <ImageWithFallback
                    src="https://images.unsplash.com/photo-1669092557499-093cb88dc249?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3aWxkZmlyZSUyMG1hcCUyMHNhdGVsbGl0ZSUyMHZpZXd8ZW58MXx8fHwxNzU4MTM2MzEzfDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
                    alt="Satellite map view"
                    className="w-full h-full object-cover opacity-40"
                  />

                  {/* Risk Zones Layer */}
                  {layers.find(l => l.id === "risk-zones")?.enabled && mockRiskZones.map((zone) => (
                    <Tooltip key={zone.id}>
                      <TooltipTrigger asChild>
                        <div
                          className={`absolute border-2 cursor-pointer transition-all hover:scale-105 ${getRiskColor(zone.riskLevel)} ${
                            selectedZone === zone.id ? 'ring-2 ring-blue-500 ring-offset-2' : ''
                          }`}
                          style={{
                            left: `${zone.coordinates.x}%`,
                            top: `${zone.coordinates.y}%`,
                            width: `${zone.coordinates.width}%`,
                            height: `${zone.coordinates.height}%`,
                            opacity: layers.find(l => l.id === "risk-zones")?.opacity! / 100
                          }}
                          onClick={() => setSelectedZone(selectedZone === zone.id ? null : zone.id)}
                        >
                          <div className="absolute bottom-1 left-1 text-xs font-bold text-white bg-black/50 px-1 rounded">
                            {zone.name}
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-sm">
                          <div className="font-medium">{zone.name}</div>
                          <div>Risk: {zone.riskLevel}</div>
                          <div>Temp: {zone.temperature}°F</div>
                          <div>Humidity: {zone.humidity}%</div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ))}

                  {/* Fire Incidents Layer */}
                  {layers.find(l => l.id === "fire-incidents")?.enabled && mockFireIncidents.map((incident) => (
                    <Tooltip key={incident.id}>
                      <TooltipTrigger asChild>
                        <div
                          className={`absolute w-4 h-4 rounded-full cursor-pointer border-2 border-white animate-pulse ${getIncidentColor(incident.status, incident.threatLevel)} ${
                            selectedIncident === incident.id ? 'ring-2 ring-blue-500 ring-offset-2' : ''
                          }`}
                          style={{
                            left: `${incident.coordinates.x}%`,
                            top: `${incident.coordinates.y}%`,
                            transform: 'translate(-50%, -50%)'
                          }}
                          onClick={() => setSelectedIncident(selectedIncident === incident.id ? null : incident.id)}
                        >
                          <Flame className="h-3 w-3 text-white m-0.5" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-sm">
                          <div className="font-medium">{incident.name}</div>
                          <div>Status: {incident.status}</div>
                          <div>Size: {incident.acres} acres</div>
                          <div>Contained: {incident.containment}%</div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ))}

                  {/* Weather Stations Layer */}
                  {layers.find(l => l.id === "weather-stations")?.enabled && mockWeatherStations.map((station) => (
                    <Tooltip key={station.id}>
                      <TooltipTrigger asChild>
                        <div
                          className={`absolute w-3 h-3 bg-blue-500 border border-white rounded cursor-pointer ${
                            selectedStation === station.id ? 'ring-2 ring-blue-500 ring-offset-2' : ''
                          }`}
                          style={{
                            left: `${station.coordinates.x}%`,
                            top: `${station.coordinates.y}%`,
                            transform: 'translate(-50%, -50%)'
                          }}
                          onClick={() => setSelectedStation(selectedStation === station.id ? null : station.id)}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-sm">
                          <div className="font-medium">{station.name}</div>
                          <div>Temp: {station.temperature}°F</div>
                          <div>Humidity: {station.humidity}%</div>
                          <div>Wind: {station.windSpeed} mph</div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ))}

                  {/* Map Scale */}
                  <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-8 h-1 bg-black"></div>
                      <span>5 miles</span>
                    </div>
                    <div className="text-muted-foreground">Updated 2 min ago</div>
                  </div>

                  {/* Drawing Shapes */}
                  {drawingShapes.map((shape) => (
                    <div key={shape.id}>
                      {shape.type === "circle" && (
                        <div
                          className="absolute border-2 rounded-full pointer-events-none"
                          style={{
                            left: `${shape.coordinates.x - (shape.coordinates.radius || 0)}%`,
                            top: `${shape.coordinates.y - (shape.coordinates.radius || 0)}%`,
                            width: `${(shape.coordinates.radius || 0) * 2}%`,
                            height: `${(shape.coordinates.radius || 0) * 2}%`,
                            backgroundColor: shape.color,
                            borderColor: shape.color.replace('0.5', '1')
                          }}
                        />
                      )}
                      {shape.type === "rectangle" && shape.coordinates.x2 && shape.coordinates.y2 && (
                        <div
                          className="absolute border-2 pointer-events-none"
                          style={{
                            left: `${Math.min(shape.coordinates.x, shape.coordinates.x2)}%`,
                            top: `${Math.min(shape.coordinates.y, shape.coordinates.y2)}%`,
                            width: `${Math.abs(shape.coordinates.x2 - shape.coordinates.x)}%`,
                            height: `${Math.abs(shape.coordinates.y2 - shape.coordinates.y)}%`,
                            backgroundColor: shape.color,
                            borderColor: shape.color.replace('0.5', '1')
                          }}
                        />
                      )}
                    </div>
                  ))}

                  {/* Current Drawing */}
                  {isDrawing && currentDrawing && (
                    <div>
                      {currentDrawing.type === "circle" && currentDrawing.coordinates.radius && (
                        <div
                          className="absolute border-2 border-dashed rounded-full pointer-events-none"
                          style={{
                            left: `${currentDrawing.coordinates.x - currentDrawing.coordinates.radius}%`,
                            top: `${currentDrawing.coordinates.y - currentDrawing.coordinates.radius}%`,
                            width: `${currentDrawing.coordinates.radius * 2}%`,
                            height: `${currentDrawing.coordinates.radius * 2}%`,
                            backgroundColor: currentDrawing.color,
                            borderColor: "rgb(59, 130, 246)"
                          }}
                        />
                      )}
                      {currentDrawing.type === "rectangle" && currentDrawing.coordinates.x2 && currentDrawing.coordinates.y2 && (
                        <div
                          className="absolute border-2 border-dashed pointer-events-none"
                          style={{
                            left: `${Math.min(currentDrawing.coordinates.x, currentDrawing.coordinates.x2)}%`,
                            top: `${Math.min(currentDrawing.coordinates.y, currentDrawing.coordinates.y2)}%`,
                            width: `${Math.abs(currentDrawing.coordinates.x2 - currentDrawing.coordinates.x)}%`,
                            height: `${Math.abs(currentDrawing.coordinates.y2 - currentDrawing.coordinates.y)}%`,
                            backgroundColor: currentDrawing.color,
                            borderColor: "rgb(59, 130, 246)"
                          }}
                        />
                      )}
                    </div>
                  )}

                  {/* Wind Animation */}
                  {layers.find(l => l.id === "wind-patterns")?.enabled && (
                    <div className="absolute inset-0 pointer-events-none">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div
                          key={i}
                          className="absolute w-8 h-1 bg-purple-400 opacity-60"
                          style={{
                            left: `${15 + i * 10}%`,
                            top: `${20 + (i % 3) * 20}%`,
                            transform: `rotate(${135 + (isAnimating ? Math.sin(Date.now() * 0.001 + i) * 10 : 0)}deg)`,
                            transition: "transform 0.3s ease"
                          }}
                        >
                          <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-0 h-0 border-l-2 border-y-2 border-transparent border-l-purple-400"></div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* North Arrow */}
                  <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm rounded-full w-8 h-8 flex items-center justify-center">
                    <div className="text-xs font-bold">N</div>
                    <div className="absolute top-1 w-0 h-0 border-l-2 border-r-2 border-b-4 border-transparent border-b-black"></div>
                  </div>

                  {/* Zoom Level Indicator */}
                  <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 text-xs">
                    Zoom: {Math.round(viewport.zoom * 100)}%
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Control Panel */}
          <div className="space-y-4">
            {/* Drawing Tools */}
            {drawingShapes.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Pencil className="h-5 w-5" />
                      Annotations ({drawingShapes.length})
                    </div>
                    <Button variant="outline" size="sm" onClick={clearDrawings}>
                      Clear All
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {drawingShapes.map((shape, index) => (
                      <div key={shape.id} className="flex items-center justify-between p-2 border rounded">
                        <div className="flex items-center gap-2">
                          {shape.type === "circle" ? <Circle className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                          <span className="text-sm">Annotation {index + 1}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDrawingShapes(prev => prev.filter(s => s.id !== shape.id))}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Layer Controls */}
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

            {/* Legend */}
            <Card>
              <CardHeader>
                <CardTitle>Risk Level Legend</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-red-600 rounded border"></div>
                  <span className="text-sm">Extreme Risk</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-orange-500 rounded border"></div>
                  <span className="text-sm">High Risk</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-yellow-500 rounded border"></div>
                  <span className="text-sm">Moderate Risk</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-green-500 rounded border"></div>
                  <span className="text-sm">Low Risk</span>
                </div>
                <hr className="my-2" />
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-red-600 rounded-full border animate-pulse"></div>
                  <span className="text-sm">Active Fire</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-blue-500 border rounded"></div>
                  <span className="text-sm">Weather Station</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-1 bg-purple-400 rounded"></div>
                  <span className="text-sm">Wind Direction</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-blue-500 border-dashed bg-blue-500/30 rounded"></div>
                  <span className="text-sm">User Annotation</span>
                </div>
              </CardContent>
            </Card>

            {/* Selected Item Details */}
            {(selectedZoneData || selectedIncidentData || selectedStationData) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Info className="h-5 w-5" />
                    Details
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedZoneData && (
                    <div className="space-y-2">
                      <h3 className="font-medium">{selectedZoneData.name}</h3>
                      <Badge className={getRiskColor(selectedZoneData.riskLevel).replace('/70', '').replace('border-', 'border-').replace('bg-', 'bg-')}>
                        {selectedZoneData.riskLevel} Risk
                      </Badge>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-1">
                          <Thermometer className="h-3 w-3" />
                          {selectedZoneData.temperature}°F
                        </div>
                        <div className="flex items-center gap-1">
                          <Droplets className="h-3 w-3" />
                          {selectedZoneData.humidity}%
                        </div>
                        <div className="flex items-center gap-1">
                          <Wind className="h-3 w-3" />
                          {selectedZoneData.windSpeed} mph
                        </div>
                        <div className="text-xs text-muted-foreground col-span-2">
                          Updated {selectedZoneData.lastUpdated}
                        </div>
                      </div>
                    </div>
                  )}

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
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" className="flex-1">
                          Details
                        </Button>
                        <Button size="sm" variant="outline">
                          <Navigation className="h-4 w-4" />
                        </Button>
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
                      <div className="text-xs text-muted-foreground">
                        Last reading: {selectedStationData.lastReading}
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
                  <div className="text-2xl font-bold">1</div>
                  <div className="text-sm text-muted-foreground">Extreme Risk Zone</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-500" />
                <div>
                  <div className="text-2xl font-bold">3</div>
                  <div className="text-sm text-muted-foreground">Active Incidents</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Thermometer className="h-5 w-5 text-blue-500" />
                <div>
                  <div className="text-2xl font-bold">12</div>
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
                  <div className="text-2xl font-bold">2</div>
                  <div className="text-sm text-muted-foreground">Minutes Ago</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  );
}