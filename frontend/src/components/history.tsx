import { useState, useEffect } from "react";
import {
  Calendar,
  Filter,
  Search,
  TrendingUp,
  Flame,
  MapPin,
  BarChart3,
  Download,
  Info,
  Clock,
  AlertTriangle
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Slider } from "./ui/slider";
import { Switch } from "./ui/switch";
import { Map as GoogleMap, useMap } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { GeoJsonLayer } from '@deck.gl/layers';

// Fire Perimeters Overlay Component
function HistoricalFirePerimetersOverlay({
  enabled,
  opacity,
  yearFilter
}: {
  enabled: boolean;
  opacity: number;
  yearFilter: number | 'all';
}) {
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

    // Filter data by year if needed
    let filteredData = fireData;
    if (yearFilter !== 'all') {
      filteredData = {
        ...fireData,
        features: fireData.features.filter((f: any) => f.properties.YEAR_ === yearFilter)
      };
    }

    // Create new overlay with GeoJsonLayer
    const deckOverlay = new GoogleMapsOverlay({
      layers: [
        new GeoJsonLayer({
          id: 'historical-fire-perimeters',
          data: filteredData,
          pickable: true,
          stroked: true,
          filled: true,

          // Polygon fill - color by year
          getFillColor: (d: any) => {
            const year = d.properties.YEAR_;
            if (year >= 2025) return [220, 38, 38, opacity * 1.5]; // Bright red - 2025
            if (year >= 2024) return [249, 115, 22, opacity * 1.5]; // Orange - 2024
            if (year >= 2023) return [234, 179, 8, opacity * 1.2]; // Yellow - 2023
            if (year >= 2022) return [34, 197, 94, opacity * 1.0]; // Green - 2022
            if (year >= 2021) return [59, 130, 246, opacity * 0.9]; // Blue - 2021
            return [156, 163, 175, opacity * 0.8]; // Gray - older
          },

          // Outline
          getLineColor: [255, 255, 255, 200],
          getLineWidth: 2,
          lineWidthMinPixels: 1,

          // Tooltip on click
          onClick: (info: any) => {
            if (info.object) {
              setSelectedFire(info.object.properties);
            }
          },

          // Update triggers
          updateTriggers: {
            getFillColor: [opacity, yearFilter]
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
  }, [map, fireData, enabled, opacity, yearFilter]);

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
            className="text-gray-500 hover:text-gray-700 text-xl"
          >
            ×
          </button>
        </div>
        <div className="space-y-1 text-sm">
          <div><strong>Year:</strong> {selectedFire.YEAR_}</div>
          <div><strong>Incident #:</strong> {selectedFire.INC_NUM}</div>
          <div><strong>Acres:</strong> {selectedFire.GIS_ACRES?.toLocaleString()}</div>
          <div><strong>Agency:</strong> {selectedFire.AGENCY}</div>
          <div><strong>Unit:</strong> {selectedFire.UNIT_ID}</div>
          {selectedFire.ALARM_DATE && (
            <div><strong>Start:</strong> {new Date(selectedFire.ALARM_DATE).toLocaleDateString()}</div>
          )}
          {selectedFire.CONT_DATE && (
            <div><strong>Contained:</strong> {new Date(selectedFire.CONT_DATE).toLocaleDateString()}</div>
          )}
          {selectedFire.CAUSE && (
            <div><strong>Cause:</strong> {selectedFire.CAUSE}</div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

export function History() {
  const [yearFilter, setYearFilter] = useState<number | 'all'>(2025); // Start at 2025
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'satellite' | 'hybrid' | 'terrain'>('satellite');
  const [searchQuery, setSearchQuery] = useState("");
  const [opacity, setOpacity] = useState(60);
  const [showPerimeters, setShowPerimeters] = useState(true);
  const [fireData, setFireData] = useState<any>(null); // Store full dataset

  // Calculate statistics from fire data
  const [stats, setStats] = useState({
    totalFires: 0,
    totalAcres: 0,
    yearRange: '2020-2025',
    averageSize: 0
  });

  useEffect(() => {
    // Load fire data to calculate stats
    fetch('/Data/California_Fire_Perimeters.geojson')
      .then(response => response.json())
      .then(data => {
        setFireData(data); // Store full dataset

        // Calculate stats for initial year (2025)
        const features = data.features;
        const filteredFeatures = features.filter((f: any) => f.properties.YEAR_ === 2025);

        const totalFires = filteredFeatures.length;
        const totalAcres = filteredFeatures.reduce((sum: number, f: any) => sum + (f.properties.GIS_ACRES || 0), 0);
        const years = features.map((f: any) => f.properties.YEAR_).filter(Boolean);
        const minYear = Math.min(...years);
        const maxYear = Math.max(...years);

        setStats({
          totalFires,
          totalAcres,
          yearRange: `${minYear}-${maxYear}`,
          averageSize: totalFires > 0 ? Math.round(totalAcres / totalFires) : 0
        });
      })
      .catch(error => {
        console.error('Error loading fire statistics:', error);
      });
  }, []);

  // Recalculate statistics when year filter changes
  useEffect(() => {
    if (!fireData) return;

    const features = fireData.features;
    const filteredFeatures = yearFilter === 'all'
      ? features
      : features.filter((f: any) => f.properties.YEAR_ === yearFilter);

    const totalFires = filteredFeatures.length;
    const totalAcres = filteredFeatures.reduce((sum: number, f: any) => sum + (f.properties.GIS_ACRES || 0), 0);

    setStats(prev => ({
      ...prev,
      totalFires,
      totalAcres,
      averageSize: totalFires > 0 ? Math.round(totalAcres / totalFires) : 0
    }));
  }, [yearFilter, fireData]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Historical Wildfire Data</h1>
          <p className="text-muted-foreground">
            Explore California wildfire history and perimeter data from {stats.yearRange}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export Data
          </Button>
          <Button variant="outline">
            <BarChart3 className="h-4 w-4 mr-2" />
            View Statistics
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" />
              <div>
                <div className="text-2xl font-bold">{stats.totalFires.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">
                  Total Fires {yearFilter !== 'all' ? `(${yearFilter})` : '(All Years)'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-red-500" />
              <div>
                <div className="text-2xl font-bold">{(stats.totalAcres / 1000000).toFixed(2)}M</div>
                <div className="text-sm text-muted-foreground">
                  Acres Burned {yearFilter !== 'all' ? `(${yearFilter})` : '(All Years)'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{stats.averageSize.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">
                  Avg Size {yearFilter !== 'all' ? `(${yearFilter})` : '(All Years)'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{stats.yearRange}</div>
                <div className="text-sm text-muted-foreground">Data Range</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Map Container */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Historical Fire Perimeters Map
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search fire name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-48 pl-8"
                    />
                  </div>

                  {/* Year Filter */}
                  <Select
                    value={yearFilter.toString()}
                    onValueChange={(value) => setYearFilter(value === 'all' ? 'all' : parseInt(value))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Years</SelectItem>
                      <SelectItem value="2025">2025</SelectItem>
                      <SelectItem value="2024">2024</SelectItem>
                      <SelectItem value="2023">2023</SelectItem>
                      <SelectItem value="2022">2022</SelectItem>
                      <SelectItem value="2021">2021</SelectItem>
                      <SelectItem value="2020">2020</SelectItem>
                    </SelectContent>
                  </Select>

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
              <div className="w-full h-96 rounded-lg overflow-hidden border relative">
                <GoogleMap
                  style={{ width: '100%', height: '100%' }}
                  defaultCenter={{ lat: 36.7, lng: -119.8 }}
                  defaultZoom={6}
                  mapTypeId={mapTypeId}
                  gestureHandling="greedy"
                  disableDefaultUI={false}
                >
                  {/* Fire Perimeters Layer */}
                  <HistoricalFirePerimetersOverlay
                    enabled={showPerimeters}
                    opacity={opacity}
                    yearFilter={yearFilter}
                  />
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
                    <div className="w-6 h-4 bg-green-500 border border-white rounded"></div>
                    <span>2022 Fires</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-4 bg-blue-500 border border-white rounded"></div>
                    <span>2021 Fires</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-4 bg-gray-400 border border-white rounded"></div>
                    <span>2020 & Earlier</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  💡 Click fire perimeters for details. Use year filter to focus on specific periods.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Display Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Display Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame className="h-4 w-4" />
                    <span className="text-sm">Show Perimeters</span>
                  </div>
                  <Switch
                    checked={showPerimeters}
                    onCheckedChange={setShowPerimeters}
                  />
                </div>
                {showPerimeters && (
                  <div className="ml-6">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Opacity</span>
                      <Slider
                        value={[opacity]}
                        onValueChange={(value) => setOpacity(value[0])}
                        max={100}
                        step={10}
                        className="flex-1"
                      />
                      <span>{opacity}%</span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" />
                Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Largest Fire:</span>
                <span className="font-medium">August Complex (2020)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Most Active Year:</span>
                <span className="font-medium">2020</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Peak Season:</span>
                <span className="font-medium">July - October</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Counties:</span>
                <span className="font-medium">58</span>
              </div>
            </CardContent>
          </Card>

          {/* Data Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Data Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Fire perimeter data sourced from CAL FIRE and local agencies.
                Perimeters represent the final burned area boundary.
              </p>
              <div className="pt-2 border-t">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    Historical data may not include all incidents. Small fires under 10 acres may be excluded.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}