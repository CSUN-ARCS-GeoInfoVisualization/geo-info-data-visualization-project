import { useState, useEffect, useRef } from "react";
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
import { apiFetch } from "../services/api";
import { Switch } from "./ui/switch";
import { Checkbox } from "./ui/checkbox";
import { Map as GoogleMap, useMap } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';

// Historical fire perimeters overlay — mirrors the research page's
// `UnifiedResearchOverlay` pattern: a single GoogleMapsOverlay per map,
// data passed in as a prop (no internal fetch), layers rebuilt in one effect.
function HistoricalFirePerimetersOverlay({ fireData }: { fireData: any }) {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const [selectedFire, setSelectedFire] = useState<any>(null);
  // Keep the latest selectedFire in a ref so the layer's line-color accessor
  // (and the onClick handler) can see it without re-running the setProps
  // effect on every click — which would re-hydrate the GeoJSON and flash.
  const selectedFireRef = useRef<any>(null);
  selectedFireRef.current = selectedFire;

  // Create the overlay ONCE per map, destroy only on unmount. Switching map
  // types (roadmap/terrain/satellite/hybrid) mustn't rebuild this — otherwise
  // the deck.gl canvas is torn down and recreated on every related re-render,
  // causing the polygons to disappear and flash back.
  useEffect(() => {
    if (!map) return;
    const deckOverlay = new GoogleMapsOverlay({ layers: [] });
    deckOverlay.setMap(map);
    overlayRef.current = deckOverlay;
    return () => {
      deckOverlay.setMap(null);
      deckOverlay.finalize();
      overlayRef.current = null;
    };
  }, [map]);

  // Rebuild layers when data OR selection changes. Layer data uses the
  // parent's stable fireData ref, so switching map type doesn't re-hydrate.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    if (!fireData?.features?.length) {
      overlay.setProps({ layers: [] });
      return;
    }
    const colorForAcres = (acres: number): [number, number, number, number] => {
      if (acres >= 10000) return [139, 0, 0, 240];
      if (acres >= 1000) return [220, 38, 38, 240];
      if (acres >= 100) return [249, 115, 22, 240];
      return [234, 179, 8, 240];
    };
    overlay.setProps({
      layers: [
        new GeoJsonLayer({
          id: 'historical-fire-perimeters',
          data: fireData,
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 3,
          getLineWidth: (f: any) => {
            const sel = selectedFireRef.current;
            return sel && (f.properties.OBJECTID ?? `${f.properties.FIRE_NAME}-${f.properties.YEAR_}-${f.properties.INC_NUM}`) === (sel.OBJECTID ?? `${sel.FIRE_NAME}-${sel.YEAR_}-${sel.INC_NUM}`) ? 6 : 3;
          },
          // Selection uses the same tier color as the fire's fill, just with
          // a thicker outline (see getLineWidth). No cyan.
          getLineColor: (f: any) => colorForAcres(f.properties.GIS_ACRES || 0),
          getFillColor: (f: any) => colorForAcres(f.properties.GIS_ACRES || 0),
          onClick: (info: any) => { if (info.object) setSelectedFire(info.object.properties); },
          updateTriggers: {
            getFillColor: [fireData],
            getLineColor: [fireData, (selectedFire ? `${selectedFire.OBJECTID ?? ''}-${selectedFire.FIRE_NAME ?? ''}-${selectedFire.YEAR_ ?? ''}-${selectedFire.INC_NUM ?? ''}` : '')],
            getLineWidth: [fireData, (selectedFire ? `${selectedFire.OBJECTID ?? ''}-${selectedFire.FIRE_NAME ?? ''}-${selectedFire.YEAR_ ?? ''}-${selectedFire.INC_NUM ?? ''}` : '')],
          },
        }),
      ],
    });
  }, [fireData, selectedFire]);

  /* -----------------------------------------------------------------------
     Legacy props-based setter, kept commented so nothing else references it.
     Replaced with the single-effect pattern above that mirrors research-page.
  ----------------------------------------------------------------------- */
  if (false) {
    // @ts-ignore
    (overlayRef.current as any)?.setProps({
      layers: [],
    });
  }

  // Render tooltips
  return (
    <>
      {/* Hover tooltip - small tooltip on hover */}
      {false && (
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
  opacity,
  radius
}: {
  enabled: boolean;
  opacity: number;
  radius: number;
}) {
  const map = useMap();
  // Ref so the overlay is created once — no new WebGL context on re-renders
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const [dinsData, setDinsData] = useState<any[]>([]);
  const [hoveredStructure, setHoveredStructure] = useState<any>(null);
  const [selectedStructure, setSelectedStructure] = useState<any>(null);

  const getDamageColor = (damage: string, opacityVal: number): [number, number, number, number] => {
    const alpha = opacityVal * 255;
    if (damage?.includes('Destroyed')) return [220, 38, 38, alpha];
    if (damage?.includes('Major'))     return [249, 115, 22, alpha];
    if (damage?.includes('Minor'))     return [234, 179, 8,  alpha];
    if (damage?.includes('Affected'))  return [34, 197, 94,  alpha];
    if (damage?.includes('No Damage')) return [59, 130, 246, alpha];
    return [156, 163, 175, alpha];
  };

  // Load DINS data — runs once
  useEffect(() => {
    apiFetch('/history/dins')
      .then(response => response.json())
      .then(data => {
        console.log('Loaded DINS structures:', data.features?.length || 0);
        setDinsData(data.features || []);
      })
      .catch(error => {
        console.error('Error loading DINS data:', error);
      });
  }, []);

  // Create the overlay ONCE when the map is ready, destroy only on unmount
  useEffect(() => {
    if (!map) return;
    const deckOverlay = new GoogleMapsOverlay({ layers: [] });
    deckOverlay.setMap(map);
    overlayRef.current = deckOverlay;
    return () => {
      deckOverlay.setMap(null);
      deckOverlay.finalize();
      overlayRef.current = null;
    };
  }, [map]);

  // Update layers via setProps — reuses the same WebGL context, no leak
  useEffect(() => {
    if (!overlayRef.current) return;

    if (!enabled || dinsData.length === 0) {
      overlayRef.current.setProps({ layers: [] });
      return;
    }

    overlayRef.current.setProps({
      layers: [
        new ScatterplotLayer({
          id: 'dins-damage',
          data: dinsData,
          pickable: true,
          stroked: true,
          filled: true,
          radiusScale: 1,
          radiusMinPixels: 2,
          radiusMaxPixels: 50,
          lineWidthMinPixels: 1,

          getPosition: (d: any) => [d.properties.LONGITUDE, d.properties.LATITUDE],

          getRadius: (d: any) => {
            const damage = d.properties?.DAMAGE || '';
            if (damage.includes('Destroyed')) return radius * 2.5;
            if (damage.includes('Major'))     return radius * 2;
            if (damage.includes('Minor'))     return radius * 1.5;
            if (damage.includes('Affected'))  return radius * 1.25;
            return radius;
          },

          getFillColor: (d: any) => getDamageColor(d.properties?.DAMAGE || '', opacity),

          getLineColor: (d: any) => {
            if (hoveredStructure && d.properties?.OBJECTID === hoveredStructure.OBJECTID) {
              return [0, 255, 255, 255];
            }
            return [255, 255, 255, 200];
          },

          getLineWidth: (d: any) => {
            if (hoveredStructure && d.properties?.OBJECTID === hoveredStructure.OBJECTID) return 3;
            return 1;
          },

          onHover: (info: any) => {
            setHoveredStructure(info.object ? info.object.properties : null);
          },

          onClick: (info: any) => {
            if (info.object) setSelectedStructure(info.object.properties);
          },

          updateTriggers: {
            getFillColor: [opacity],
            getRadius: [radius],
            getLineColor: [hoveredStructure],
            getLineWidth: [hoveredStructure]
          }
        })
      ]
    });
  }, [dinsData, enabled, opacity, radius, hoveredStructure]);

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
            {hoveredStructure.INCIDENTSTARTDATE && (
              <div><strong>Year:</strong> {new Date(hoveredStructure.INCIDENTSTARTDATE).getFullYear()}</div>
            )}
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
            {selectedStructure.INCIDENTSTARTDATE && (
              <div><strong>Year:</strong> {new Date(selectedStructure.INCIDENTSTARTDATE).getFullYear()}</div>
            )}
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
  // Default to the most recent *complete* fire year (current year − 1) so the
  // map opens on a year that actually has full CAL FIRE records.
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear() - 1);
  const selectedYears = [selectedYear]; // kept as an array locally so the existing overlay contract still works
  const mapTypeId: 'roadmap' = 'roadmap';
  const [searchQuery, setSearchQuery] = useState("");
  // Display controls removed — perimeters are always shown at full opacity,
  // structure damage (DINS) is intentionally not rendered on the history map.
  const opacity = 100;
  const showPerimeters = true;
  const [fireData, setFireData] = useState<any>(null); // Merged features for selected years
  const [availableYears, setAvailableYears] = useState<number[]>([]); // All years from backend (1878-current)
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [loadingYears, setLoadingYears] = useState(false);
  const yearCacheRef = useRef<Record<number, any[]>>({}); // in-memory per-year GeoJSON feature cache

  const [stats, setStats] = useState({
    totalFires: 0,
    totalAcres: 0,
    yearRange: '',
    averageSize: 0,
  });

  // 1. Load the available-year list once (min..max from ArcGIS stats), clamped
  //    to 1950+ because CAL FIRE's older records are sparse and noisy.
  useEffect(() => {
    apiFetch('/history/perimeters/years')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.years) && data.years.length) {
          const floor = 1950;
          const clipped = data.years.filter((y: number) => y >= floor);
          const maxY = clipped[0] ?? data.max;
          setAvailableYears(clipped);
          setStats((s) => ({ ...s, yearRange: `${floor}-${maxY}` }));
          // Ensure the initial selection is actually in the list
          setSelectedYear((y) => (clipped.includes(y) ? y : clipped[0]));
        }
      })
      .catch((e) => console.warn('Year list fetch failed:', e));
  }, []);

  // 2. When the user's year selection changes, fetch each selected year
  //    (cached) and merge into fireData. This is how the "largest-extent
  //    per-year polygons" layer refreshes as years are toggled.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (selectedYears.length === 0) {
        setFireData({ type: 'FeatureCollection', features: [] });
        return;
      }
      setLoadingYears(true);
      const results = await Promise.all(
        selectedYears.map(async (y) => {
          if (yearCacheRef.current[y]) return yearCacheRef.current[y];
          try {
            const r = await apiFetch(`/history/perimeters?year=${y}&min_acres=100`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            const feats = Array.isArray(data?.features) ? data.features : [];
            yearCacheRef.current[y] = feats;
            return feats;
          } catch (e) {
            console.warn(`history year ${y} fetch failed:`, e);
            return [];
          }
        })
      );
      if (cancelled) return;
      const features = results.flat();
      setFireData({ type: 'FeatureCollection', features });
      const totalFires = features.length;
      const totalAcres = features.reduce((sum: number, f: any) => sum + (f.properties?.GIS_ACRES || 0), 0);
      setStats((s) => ({
        ...s,
        totalFires,
        totalAcres,
        averageSize: totalFires > 0 ? Math.round(totalAcres / totalFires) : 0,
      }));
      setLoadingYears(false);
    };
    load();
    return () => { cancelled = true; };
  }, [selectedYears]);

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

                  {/* Year Filter — native single-select, scrolls after 6 rows */}
                  <div className="flex items-center gap-2">
                    <label htmlFor="history-year" className="text-sm text-muted-foreground">Year:</label>
                    <select
                      id="history-year"
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(Number(e.target.value))}
                      size={1}
                      className="text-sm border rounded px-2 py-1.5 bg-background w-28"
                    >
                      {availableYears.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                    {loadingYears && <span className="text-[11px] text-muted-foreground">loading…</span>}
                  </div>
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
                  disableDefaultUI={true}
                >
                  {/* Fire Perimeters Layer — rendered last so it sits on top of the map tiles */}
                  <HistoricalFirePerimetersOverlay fireData={fireData} />
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
                  Hover for fire name. Click for details. Cyan outline = hovered fire.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Quick Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5" />
                Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {(() => {
                const feats: any[] = fireData?.features || [];
                if (feats.length === 0) {
                  return <p className="text-muted-foreground text-xs">Select a year to see stats.</p>;
                }
                let largest = feats[0];
                const countByYear: Record<number, number> = {};
                for (const f of feats) {
                  const p = f.properties || {};
                  if ((p.GIS_ACRES || 0) > (largest.properties?.GIS_ACRES || 0)) largest = f;
                  if (p.YEAR_) countByYear[p.YEAR_] = (countByYear[p.YEAR_] || 0) + 1;
                }
                const mostActive = Object.entries(countByYear).sort((a, b) => b[1] - a[1])[0];
                return (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Largest Fire:</span>
                      <span className="font-medium text-right">
                        {largest.properties?.FIRE_NAME || 'Unknown'} ({largest.properties?.YEAR_})
                        <span className="block text-[10px] text-muted-foreground">{Math.round(largest.properties?.GIS_ACRES || 0).toLocaleString()} ac</span>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Most Active Year:</span>
                      <span className="font-medium">{mostActive?.[0]} ({mostActive?.[1]} fires)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Peak Season:</span>
                      <span className="font-medium">July – October</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Counties in CA:</span>
                      <span className="font-medium">58</span>
                    </div>
                  </>
                );
              })()}
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