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
  AlertTriangle,
  ChevronDown
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Slider } from "./ui/slider";
import { Switch } from "./ui/switch";
import { Checkbox } from "./ui/checkbox";
import { Map as GoogleMap, useMap } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';

// Fire Perimeters Overlay Component
function HistoricalFirePerimetersOverlay({
  enabled,
  opacity,
  selectedYears
}: {
  enabled: boolean;
  opacity: number;
  selectedYears: number[];
}) {
  const map = useMap();
  const [overlay, setOverlay] = useState<GoogleMapsOverlay | null>(null);
  const [fireData, setFireData] = useState<any>(null);
  const [selectedFire, setSelectedFire] = useState<any>(null);
  const [hoveredFire, setHoveredFire] = useState<any>(null);

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

    // Filter data by selected years
    let filteredData = fireData;
    if (selectedYears.length > 0 && selectedYears.length < fireData.features.length) {
      filteredData = {
        ...fireData,
        features: fireData.features.filter((f: any) => selectedYears.includes(f.properties.YEAR_))
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
          autoHighlight: true,

          // Polygon fill - color by fire size (acres)
          getFillColor: (d: any) => {
            const acres = d.properties.GIS_ACRES || 0;
            const baseOpacity = opacity * 1.5;

            // Color ramp by acres
            if (acres >= 10000) return [139, 0, 0, baseOpacity];     // Dark red - 10k+
            if (acres >= 1000) return [220, 38, 38, baseOpacity];    // Red - 1k-10k
            if (acres >= 100) return [249, 115, 22, baseOpacity];    // Orange - 100-1k
            return [234, 179, 8, baseOpacity];                       // Yellow - <100
          },

          // Outline - white normally, bright on hover
          getLineColor: (d: any) => {
            if (hoveredFire && d.properties.OBJECTID === hoveredFire.OBJECTID) {
              return [0, 255, 255, 255]; // Cyan highlight on hover
            }
            return [255, 255, 255, 200]; // White normally
          },

          getLineWidth: (d: any) => {
            if (hoveredFire && d.properties.OBJECTID === hoveredFire.OBJECTID) {
              return 4; // Thicker on hover
            }
            return 2;
          },
          lineWidthMinPixels: 1,

          // Hover handler
          onHover: (info: any) => {
            if (info.object) {
              setHoveredFire(info.object.properties);
            } else {
              setHoveredFire(null);
            }
          },

          // Click handler
          onClick: (info: any) => {
            if (info.object) {
              setSelectedFire(info.object.properties);
            }
          },

          // Update triggers
          updateTriggers: {
            getFillColor: [opacity, selectedYears],
            getLineColor: [hoveredFire],
            getLineWidth: [hoveredFire]
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
  }, [map, fireData, enabled, opacity, selectedYears, hoveredFire]);

  // Render tooltips
  return (
    <>
      {/* Hover tooltip - small tooltip on hover */}
      {hoveredFire && !selectedFire && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '4px',
            fontSize: '14px',
            zIndex: 1000,
            pointerEvents: 'none',
            maxWidth: '250px'
          }}
        >
          <div className="font-bold">{hoveredFire.FIRE_NAME || 'Unknown Fire'}</div>
          <div className="text-xs mt-1">
            {hoveredFire.GIS_ACRES ? `${hoveredFire.GIS_ACRES.toLocaleString()} acres` : 'Size unknown'}
            {hoveredFire.YEAR_ && ` • ${hoveredFire.YEAR_}`}
          </div>
        </div>
      )}

      {/* Click tooltip - detailed info */}
      {selectedFire && (
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
      )}
    </>
  );
}

// DINS Damage Overlay Component
function DINSDamageOverlay({
  enabled,
  opacity
}: {
  enabled: boolean;
  opacity: number;
}) {
  const map = useMap();
  const [overlay, setOverlay] = useState<GoogleMapsOverlay | null>(null);
  const [dinsData, setDinsData] = useState<any[]>([]);
  const [hoveredStructure, setHoveredStructure] = useState<any>(null);
  const [selectedStructure, setSelectedStructure] = useState<any>(null);

  // Damage color mapping — accepts opacityVal explicitly to avoid stale closure in useEffect
  const getDamageColor = (damage: string, opacityVal: number): [number, number, number, number] => {
    const alpha = opacityVal * 255;
    if (damage?.includes('Destroyed')) return [220, 38, 38, alpha];
    if (damage?.includes('Major'))     return [249, 115, 22, alpha];
    if (damage?.includes('Minor'))     return [234, 179, 8,  alpha];
    if (damage?.includes('Affected'))  return [34, 197, 94,  alpha];
    if (damage?.includes('No Damage')) return [59, 130, 246, alpha];
    return [156, 163, 175, alpha];
  };

  // Load DINS data
  useEffect(() => {
    fetch('/Data/POSTFIRE_MASTER_DATA.geojson')
      .then(response => response.json())
      .then(data => {
        console.log('Loaded DINS structures:', data.features?.length || 0);
        setDinsData(data.features || []);
      })
      .catch(error => {
        console.error('Error loading DINS data:', error);
      });
  }, []);

  // Update overlay
  useEffect(() => {
    if (!map || !enabled || dinsData.length === 0) {
      if (overlay) {
        overlay.setMap(null);
        overlay.finalize();
        setOverlay(null);
      }
      return;
    }

    if (overlay) {
      overlay.setMap(null);
      overlay.finalize();
    }

    const deckOverlay = new GoogleMapsOverlay({
      layers: [
        new ScatterplotLayer({
          id: 'dins-damage',
          data: dinsData,
          pickable: true,
          stroked: true,
          filled: true,
          radiusScale: 1,
          radiusMinPixels: 3,
          radiusMaxPixels: 15,
          lineWidthMinPixels: 1,

          getPosition: (d: any) => [d.properties.LONGITUDE, d.properties.LATITUDE],

          getRadius: (d: any) => {
            const damage = d.properties?.DAMAGE || '';
            if (damage.includes('Destroyed')) return 10;
            if (damage.includes('Major')) return 8;
            if (damage.includes('Minor')) return 6;
            if (damage.includes('Affected')) return 5;
            return 4;
          },

          getFillColor: (d: any) => getDamageColor(d.properties?.DAMAGE || '', opacity),

          getLineColor: (d: any) => {
            if (hoveredStructure && d.properties?.OBJECTID === hoveredStructure.OBJECTID) {
              return [0, 255, 255, 255];
            }
            return [255, 255, 255, 200];
          },

          getLineWidth: (d: any) => {
            if (hoveredStructure && d.properties?.OBJECTID === hoveredStructure.OBJECTID) {
              return 3;
            }
            return 1;
          },

          onHover: (info: any) => {
            if (info.object) {
              setHoveredStructure(info.object.properties);
            } else {
              setHoveredStructure(null);
            }
          },

          onClick: (info: any) => {
            if (info.object) {
              setSelectedStructure(info.object.properties);
            }
          },

          updateTriggers: {
            getFillColor: [opacity],
            getLineColor: [hoveredStructure],
            getLineWidth: [hoveredStructure]
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
  }, [map, dinsData, enabled, opacity, hoveredStructure]);

  return (
    <>
      {hoveredStructure && !selectedStructure && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            color: 'white',
            padding: '10px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            zIndex: 1000,
            pointerEvents: 'none',
            maxWidth: '280px'
          }}
        >
          <div className="font-bold mb-1">{hoveredStructure.SITEADDRESS}</div>
          <div className="text-xs">
            <div><strong>Damage:</strong> {hoveredStructure.DAMAGE}</div>
            <div><strong>Fire:</strong> {hoveredStructure.FIRENAME}</div>
          </div>
        </div>
      )}

      {selectedStructure && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            zIndex: 1000,
            pointerEvents: 'auto',
            backgroundColor: 'white',
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            maxWidth: '350px',
            maxHeight: '500px',
            overflowY: 'auto'
          }}
        >
          <button
            onClick={() => setSelectedStructure(null)}
            className="absolute top-2 right-2 text-gray-500 hover:text-gray-700 text-xl"
          >
            ×
          </button>
          <h3 className="font-bold text-base mb-3 pr-6">{selectedStructure.SITEADDRESS}</h3>
          <div className="space-y-2 text-sm">
            <div>
              <strong>Damage:</strong>{' '}
              <span className={
                selectedStructure.DAMAGE?.includes('Destroyed') ? 'text-red-600 font-semibold' :
                selectedStructure.DAMAGE?.includes('Major') ? 'text-orange-600 font-semibold' :
                selectedStructure.DAMAGE?.includes('Minor') ? 'text-yellow-600 font-semibold' :
                'text-green-600 font-semibold'
              }>
                {selectedStructure.DAMAGE}
              </span>
            </div>
            <div><strong>Fire:</strong> {selectedStructure.FIRENAME}</div>
            <div><strong>Type:</strong> {selectedStructure.STRUCTURETYPE}</div>
            <div><strong>Year Built:</strong> {selectedStructure.YEARBUILT || 'N/A'}</div>
            {selectedStructure.ASSESSEDIMPROVEDVALUE && (
              <div><strong>Value:</strong> ${selectedStructure.ASSESSEDIMPROVEDVALUE.toLocaleString()}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function History() {
  const [selectedYears, setSelectedYears] = useState<number[]>([2025]); // Start with 2025 selected
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'satellite' | 'hybrid' | 'terrain'>('satellite');
  const [searchQuery, setSearchQuery] = useState("");
  const [opacity, setOpacity] = useState(60);
  const [showPerimeters, setShowPerimeters] = useState(true);
  const [showDINS, setShowDINS] = useState(false); // DINS damage layer toggle
  const [fireData, setFireData] = useState<any>(null); // Store full dataset
  const [availableYears, setAvailableYears] = useState<number[]>([]); // All years in dataset
  const [showYearDropdown, setShowYearDropdown] = useState(false); // Year filter dropdown visibility

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

        // Extract all unique years and sort
        const features = data.features;
        const years = [...new Set(features.map((f: any) => f.properties.YEAR_).filter(Boolean))].sort((a, b) => b - a);
        setAvailableYears(years as number[]);

        // Calculate stats for initial year (2025)
        const filteredFeatures = features.filter((f: any) => f.properties.YEAR_ === 2025);

        const totalFires = filteredFeatures.length;
        const totalAcres = filteredFeatures.reduce((sum: number, f: any) => sum + (f.properties.GIS_ACRES || 0), 0);
        const minYear = Math.min(...(years as number[]));
        const maxYear = Math.max(...(years as number[]));

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
    const filteredFeatures = selectedYears.length === 0 || selectedYears.length === availableYears.length
      ? features  // All years selected or none selected = show all
      : features.filter((f: any) => selectedYears.includes(f.properties.YEAR_));

    const totalFires = filteredFeatures.length;
    const totalAcres = filteredFeatures.reduce((sum: number, f: any) => sum + (f.properties.GIS_ACRES || 0), 0);

    setStats(prev => ({
      ...prev,
      totalFires,
      totalAcres,
      averageSize: totalFires > 0 ? Math.round(totalAcres / totalFires) : 0
    }));
  }, [selectedYears, fireData, availableYears]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showYearDropdown && !target.closest('.year-filter-dropdown')) {
        setShowYearDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showYearDropdown]);

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
                  Total Fires {selectedYears.length === availableYears.length || selectedYears.length === 0
                    ? '(All Years)'
                    : selectedYears.length === 1
                      ? `(${selectedYears[0]})`
                      : `(${selectedYears.length} years)`}
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
                  Acres Burned {selectedYears.length === availableYears.length || selectedYears.length === 0
                    ? '(All Years)'
                    : selectedYears.length === 1
                      ? `(${selectedYears[0]})`
                      : `(${selectedYears.length} years)`}
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
                  Avg Size {selectedYears.length === availableYears.length || selectedYears.length === 0
                    ? '(All Years)'
                    : selectedYears.length === 1
                      ? `(${selectedYears[0]})`
                      : `(${selectedYears.length} years)`}
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

                  {/* Year Filter - Multi-select with checkboxes */}
                  <div className="relative year-filter-dropdown">
                    <Button
                      variant="outline"
                      className="w-48 justify-between"
                      onClick={() => setShowYearDropdown(!showYearDropdown)}
                    >
                      <span className="text-sm">
                        {selectedYears.length === 0 || selectedYears.length === availableYears.length
                          ? 'All Years'
                          : selectedYears.length === 1
                          ? selectedYears[0]
                          : `${selectedYears.length} years selected`}
                      </span>
                      <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
                    </Button>

                    {showYearDropdown && (
                      <Card className="absolute top-full mt-1 w-56 p-3 z-50 shadow-lg">
                        <div className="space-y-2">
                          <div className="font-medium text-sm mb-2">Filter by Year</div>

                          {/* Select/Deselect All */}
                          <div className="flex items-center space-x-2 pb-2 border-b">
                            <Checkbox
                              id="all-years"
                              checked={selectedYears.length === availableYears.length}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedYears([...availableYears]);
                                } else {
                                  setSelectedYears([]);
                                }
                              }}
                            />
                            <label
                              htmlFor="all-years"
                              className="text-sm font-medium leading-none cursor-pointer"
                            >
                              All Years
                            </label>
                          </div>

                          {/* Individual years */}
                          {availableYears.map((year) => (
                            <div key={year} className="flex items-center space-x-2">
                              <Checkbox
                                id={`year-${year}`}
                                checked={selectedYears.includes(year)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedYears([...selectedYears, year].sort((a, b) => b - a));
                                  } else {
                                    setSelectedYears(selectedYears.filter(y => y !== year));
                                  }
                                }}
                              />
                              <label
                                htmlFor={`year-${year}`}
                                className="text-sm leading-none cursor-pointer"
                              >
                                {year}
                              </label>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}
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
                    selectedYears={selectedYears}
                  />

                  {/* DINS Damage Layer */}
                  <DINSDamageOverlay
                    enabled={showDINS}
                    opacity={1}
                  />
                </GoogleMap>
              </div>

              {/* Map Legend */}
              <div className="mt-4 bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-base mb-3">Fire Size Legend</h4>
                <div className="grid grid-cols-2 md:grid-cols-2 gap-3 text-base">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-4 border border-white rounded" style={{ backgroundColor: 'rgb(234, 179, 8)' }}></div>
                    <span>&lt;100 acres</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-4 border border-white rounded" style={{ backgroundColor: 'rgb(249, 115, 22)' }}></div>
                    <span>100–1k acres</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-4 border border-white rounded" style={{ backgroundColor: 'rgb(220, 38, 38)' }}></div>
                    <span>1k–10k acres</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-4 border border-white rounded" style={{ backgroundColor: 'rgb(139, 0, 0)' }}></div>
                    <span>10k+ acres</span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-3">
                  💡 Hover for fire name. Click for details. Cyan outline = hovered fire.
                </p>

                {/* DINS Damage Legend - show when enabled */}
                {showDINS && (
                  <div className="mt-4 pt-4 border-t">
                    <h4 className="font-semibold text-base mb-3">Structure Damage Levels</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgb(220, 38, 38)' }}></div>
                        <span>Destroyed (&gt;50%)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgb(249, 115, 22)' }}></div>
                        <span>Major (26-50%)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgb(234, 179, 8)' }}></div>
                        <span>Minor (11-25%)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgb(34, 197, 94)' }}></div>
                        <span>Affected (&lt;10%)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgb(59, 130, 246)' }}></div>
                        <span>No Damage</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      💡 Hover structure for details. Data: CAL FIRE DINS inspections
                    </p>
                  </div>
                )}
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

                {/* DINS Damage Layer Toggle */}
                <div className="flex items-center justify-between pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <span className="text-sm">Show Structure Damage</span>
                  </div>
                  <Switch
                    checked={showDINS}
                    onCheckedChange={setShowDINS}
                  />
                </div>
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