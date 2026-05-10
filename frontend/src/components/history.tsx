import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { loadGeoJson } from "../lib/geojsonCache";
import { apiFetch } from "../services/api";
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

// Historical fire perimeters overlay — mirrors the research page's
// `UnifiedResearchOverlay` pattern: a single GoogleMapsOverlay per map,
// data passed in as a prop (no internal fetch), layers rebuilt in one effect.
// Build a stable key for a fire feature (OBJECTID when present, otherwise
// composite of name/year/incident).
const keyFor = (p: any) => `${p?.OBJECTID ?? ''}-${p?.FIRE_NAME ?? ''}-${p?.YEAR_ ?? ''}-${p?.INC_NUM ?? ''}`;

// CAL FIRE CAUSE codes (FRAP perimeters schema).
const CAUSE_LABELS: Record<number, string> = {
  1: 'Lightning',
  2: 'Equipment Use',
  3: 'Smoking',
  4: 'Campfire',
  5: 'Debris Burning',
  6: 'Railroad',
  7: 'Arson',
  8: 'Playing with Fire',
  9: 'Miscellaneous',
  10: 'Vehicle',
  11: 'Powerline',
  12: 'Firefighter Training',
  13: 'Non-Firefighter Training',
  14: 'Unknown / Unidentified',
  15: 'Structure',
  16: 'Aircraft',
  17: 'Volcanic',
  18: 'Escaped Prescribed Burn',
  19: 'Illegal Alien Campfire',
};
const causeLabel = (v: any): string => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (Number.isFinite(n) && CAUSE_LABELS[n]) return `${CAUSE_LABELS[n]} (${n})`;
  return String(v);
};

const HistoricalFirePerimetersOverlay = memo(function HistoricalFirePerimetersOverlay({ fireData, selectedFire, onSelect }: { fireData: any; selectedFire: any; onSelect: (props: any | null) => void }) {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  // Keep the latest onSelect / selectedFire in refs so the deck.gl layer's
  // click handler and line-color accessor can read them without the layer
  // being rebuilt on every parent re-render.

  // Create the overlay ONCE per map, destroy only on unmount.
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

  // Rebuild layer ONLY when fireData changes — exactly the same contract the
  // research map's UnifiedResearchOverlay uses for its NIFC perimeter layer.
  // Selection is popup-only; no per-feature highlight = no layer rebuild on
  // click = no GeoJSON re-tessellation on the main thread = no freeze.
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
          // pickable is deliberately FALSE. deck.gl's GPU picking pass on a
          // GeoJSON FeatureCollection with hundreds of MultiPolygons is the
          // last remaining freeze vector on this map — every repeatable hang
          // report has been on clicking a polygon. Selection is done via the
          // header dropdown, which is identical behaviour-wise to the research
          // map's navbar pick flow.
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 3,
          getLineWidth: 3,
          getLineColor: (f: any) => colorForAcres(f.properties.GIS_ACRES || 0),
          getFillColor: (f: any) => colorForAcres(f.properties.GIS_ACRES || 0),
          onClick: (info: any) => {
            if (info?.object?.properties) onSelectRef.current(info.object.properties);
          },
          updateTriggers: {
            getFillColor: [fireData.features.length],
            getLineColor: [fireData.features.length],
          },
        }),
      ],
    });
  }, [fireData]);

  // Render tooltips
  // Aggregate stats used when no individual fire is selected. Computed inline
  // because the parent already memoizes fireData per year; the per-render cost
  // here is one pass over fireData.features.
  let aggregate: { count: number; totalAcres: number; avgAcres: number; largest: any; year: number | null } = {
    count: 0, totalAcres: 0, avgAcres: 0, largest: null, year: null,
  };
  if (fireData?.features?.length) {
    let totalAcres = 0;
    let largest = fireData.features[0];
    for (const f of fireData.features) {
      const a = Number(f?.properties?.GIS_ACRES) || 0;
      totalAcres += a;
      if (a > (Number(largest?.properties?.GIS_ACRES) || 0)) largest = f;
    }
    const count = fireData.features.length;
    aggregate = {
      count,
      totalAcres,
      avgAcres: count > 0 ? Math.round(totalAcres / count) : 0,
      largest,
      year: largest?.properties?.YEAR_ ?? null,
    };
  }

  return (
    <>
      {/* Always-on left in-map info card (matches the Research map pattern).
          Aggregate stats when no fire is picked; specific fire info once a
          user clicks one or selects from the dropdown. */}
      <div
        className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border overflow-y-auto"
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          bottom: 12,
          width: 280,
          zIndex: 50,
          pointerEvents: 'auto',
        }}
      >
        <div className="p-4 text-sm space-y-3">
          {selectedFire ? (
            <>
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-red-500 shrink-0" />
                <span className="font-bold text-base">{selectedFire.FIRE_NAME || 'Unknown Fire'}</span>
              </div>
              <div className="space-y-1 text-xs">
                {selectedFire.YEAR_ != null && <div><strong>Year:</strong> {selectedFire.YEAR_}</div>}
                {selectedFire.INC_NUM && <div><strong>Incident #:</strong> {selectedFire.INC_NUM}</div>}
                {selectedFire.GIS_ACRES != null && <div><strong>Acres:</strong> {Number(selectedFire.GIS_ACRES).toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>}
                {selectedFire.AGENCY && <div><strong>Agency:</strong> {selectedFire.AGENCY}</div>}
                {selectedFire.UNIT_ID && <div><strong>Unit:</strong> {selectedFire.UNIT_ID}</div>}
                {selectedFire.ALARM_DATE && (
                  <div><strong>Start:</strong> {new Date(selectedFire.ALARM_DATE).toLocaleDateString()}</div>
                )}
                {selectedFire.CONT_DATE && (
                  <div><strong>Contained:</strong> {new Date(selectedFire.CONT_DATE).toLocaleDateString()}</div>
                )}
                {selectedFire.CAUSE != null && selectedFire.CAUSE !== '' && <div><strong>Cause:</strong> {causeLabel(selectedFire.CAUSE)}</div>}
                {selectedFire.COMPLEX_NAME && <div><strong>Complex:</strong> {selectedFire.COMPLEX_NAME}</div>}
              </div>
              <button
                onClick={() => onSelect(null)}
                className="mt-1 text-xs text-red-500 hover:text-red-700 font-medium"
              >
                ← Back to summary
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-red-500 shrink-0" />
                <span className="font-bold text-base">All fires — summary</span>
              </div>
              {aggregate.count === 0 ? (
                <p className="text-xs text-muted-foreground">Loading fire perimeters…</p>
              ) : (
                <>
                  <div className="space-y-1 text-xs">
                    <div><strong>Year:</strong> {aggregate.year ?? '—'}</div>
                    <div><strong>Total fires:</strong> {aggregate.count.toLocaleString()}</div>
                    <div><strong>Total acres:</strong> {Math.round(aggregate.totalAcres).toLocaleString()}</div>
                    <div><strong>Average size:</strong> {aggregate.avgAcres.toLocaleString()} ac</div>
                    <div className="pt-2 border-t">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Largest fire</div>
                      <div className="font-medium">{aggregate.largest?.properties?.FIRE_NAME || 'Unnamed'}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {Math.round(Number(aggregate.largest?.properties?.GIS_ACRES) || 0).toLocaleString()} ac
                        {aggregate.largest?.properties?.CAUSE != null && aggregate.largest?.properties?.CAUSE !== '' ? ` · ${causeLabel(aggregate.largest.properties.CAUSE)}` : ''}
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground pt-2 border-t">
                    Click a fire on the map or pick one from the dropdown above to see its detail.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
});

// DINS Damage Overlay Component
function DINSDamageOverlay({
  enabled,
  opacity,
  radius,
  year,
  onCountChange,
}: {
  enabled: boolean;
  opacity: number;
  radius: number;
  year: number;
  onCountChange?: (count: number, year: number) => void;
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

  // Load DINS structures for the selected year. CAL FIRE DINS coverage starts
  // 2013 — older years just return empty rather than 404.
  useEffect(() => {
    if (!enabled || !year || year < 2013) {
      setDinsData([]);
      onCountChange?.(0, year);
      return;
    }
    let cancelled = false;
    apiFetch(`/history/dins?year=${year}`)
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((data: any) => {
        if (cancelled) return;
        const feats = data?.features || [];
        // Geometry is GeoJSON Point but the renderer reads LATITUDE/LONGITUDE
        // attributes — keep those, but also normalise so feats from coords work.
        setDinsData(feats);
        onCountChange?.(feats.length, year);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('DINS fetch failed for year', year, e);
        setDinsData([]);
        onCountChange?.(0, year);
      });
    return () => { cancelled = true; };
  }, [year, enabled, onCountChange]);

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
          <div className="font-bold mb-1">{hoveredStructure.SITEADDRESS || 'Unknown address'}</div>
          <div className="text-xs">
            <div><strong>Damage:</strong> {hoveredStructure.DAMAGE}</div>
            {hoveredStructure.CITY && <div><strong>City:</strong> {hoveredStructure.CITY}</div>}
            {hoveredStructure.COUNTY && <div><strong>County:</strong> {hoveredStructure.COUNTY}</div>}
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
          <h3 className="font-bold text-base mb-3 pr-6">{selectedStructure.SITEADDRESS || 'Unknown address'}</h3>
          <div className="space-y-2 text-sm">
            <div>
              <strong>Damage:</strong>{' '}
              <span className={
                selectedStructure.DAMAGE?.includes('Destroyed') ? 'text-red-600 font-semibold' :
                selectedStructure.DAMAGE?.includes('Major') ? 'text-orange-600 font-semibold' :
                selectedStructure.DAMAGE?.includes('Minor') ? 'text-yellow-600 font-semibold' :
                selectedStructure.DAMAGE?.includes('Affected') ? 'text-green-600 font-semibold' :
                'text-gray-600 font-semibold'
              }>
                {selectedStructure.DAMAGE}
              </span>
            </div>
            {selectedStructure.CITY && <div><strong>City:</strong> {selectedStructure.CITY}</div>}
            {selectedStructure.COUNTY && <div><strong>County:</strong> {selectedStructure.COUNTY}</div>}
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
  const [dinsCount, setDinsCount] = useState<number | null>(null);
  const handleDinsCount = useCallback((count: number, _year: number) => {
    setDinsCount(count);
  }, []);
  // Reset count to "loading…" when year changes so the label doesn't show
  // the previous year's number while the new fetch is in flight.
  useEffect(() => { setDinsCount(null); }, [selectedYear]);
  const selectedYears = [selectedYear]; // kept as an array locally so the existing overlay contract still works
  const mapTypeId: 'roadmap' = 'roadmap';
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedFireKey, setFocusedFireKey] = useState<string | null>(null);
  const [selectedFire, setSelectedFire] = useState<any>(null);

  // Display controls — both layers independently toggleable; DINS off by default
  // (30k+ points; user opts in). Perimeters always render filled at full opacity.
  const [showPerimeters, setShowPerimeters] = useState(true);
  const [showDins, setShowDins] = useState(false);
  const [dinsOpacity, setDinsOpacity] = useState(0.85);
  const [dinsRadius, setDinsRadius] = useState(30);
  const [fireData, setFireData] = useState<any>(null); // Filtered features for the selected year
  const [allFeatures, setAllFeatures] = useState<any[] | null>(null); // Full dataset, loaded once
  const [availableYears, setAvailableYears] = useState<number[]>([]); // Derived from loaded data
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [loadingYears, setLoadingYears] = useState(false);

  // Memoize the fire-dropdown options so the heavy sort doesn't re-run on
  // every state change. Declared AFTER fireData to avoid a TDZ ReferenceError.
  const fireOptions = useMemo(() => {
    const feats = (fireData?.features || []).slice();
    feats.sort((a: any, b: any) => (b.properties?.GIS_ACRES || 0) - (a.properties?.GIS_ACRES || 0));
    return feats.map((f: any) => {
      const p = f.properties || {};
      const key = keyFor(p);
      const name = p.FIRE_NAME || 'Unnamed';
      const acres = p.GIS_ACRES ? Math.round(p.GIS_ACRES).toLocaleString() : '?';
      return { key, label: `${name} · ${acres} ac` };
    });
  }, [fireData]);

  const handleOverlaySelect = useCallback((props: any | null) => {
    setSelectedFire(props);
    setFocusedFireKey(props ? `${props.OBJECTID ?? ''}-${props.FIRE_NAME ?? ''}-${props.YEAR_ ?? ''}-${props.INC_NUM ?? ''}` : null);
  }, []);

  // Memoize the option list JSX — 400+ <option> children would otherwise
  // re-reconcile on every parent render, including selection state changes.
  const quickStats = useMemo(() => {
    const feats: any[] = fireData?.features || [];
    if (feats.length === 0) return null;
    let largest = feats[0];
    const countByYear: Record<number, number> = {};
    for (const f of feats) {
      const p = f.properties || {};
      if ((p.GIS_ACRES || 0) > (largest.properties?.GIS_ACRES || 0)) largest = f;
      if (p.YEAR_) countByYear[p.YEAR_] = (countByYear[p.YEAR_] || 0) + 1;
    }
    const mostActive = Object.entries(countByYear).sort((a, b) => b[1] - a[1])[0];
    return { largest, mostActive };
  }, [fireData]);

  const fireOptionElements = useMemo(
    () => fireOptions.map((o: { key: string; label: string }) => (
      <option key={o.key} value={o.key}>{o.label}</option>
    )),
    [fireOptions]
  );

  const [stats, setStats] = useState({
    totalFires: 0,
    totalAcres: 0,
    yearRange: '',
    averageSize: 0,
  });

  // 1. Populate the year dropdown from the backend (CAL FIRE FRAP covers 1878→present).
  //    The trimmed static file we used to load only had 2024-2025; the backend
  //    proxy returns the full historical range with 30-min server-side caching.
  useEffect(() => {
    setLoadingYears(true);
    apiFetch('/history/perimeters/years')
      .then((r) => r.ok ? r.json() : null)
      .then((data: any) => {
        const years: number[] = Array.isArray(data?.years) ? data.years : [];
        if (years.length) {
          setAvailableYears(years);
          const minY = years[years.length - 1];
          const maxY = years[0];
          setStats((s) => ({ ...s, yearRange: minY === maxY ? `${minY}` : `${minY}-${maxY}` }));
          setSelectedYear((y) => (years.includes(y) ? y : years[0]));
        }
      })
      .catch((e) => console.warn('Year list fetch failed:', e))
      .finally(() => setLoadingYears(false));
  }, []);

  // 2. When the year changes, fetch THAT year's perimeters from the backend.
  //    Per-year cache so flipping back and forth between years you've already
  //    viewed is instant. Backend caches each (year, min_acres) for 30 min,
  //    so cold years still come in fast on subsequent dashboard loads.
  const yearCacheRef = useRef<Map<number, any[]>>(new Map());
  useEffect(() => {
    const year = selectedYears[0];
    if (!year) return;

    const cached = yearCacheRef.current.get(year);
    if (cached) {
      setAllFeatures(cached);
      setFireData({ type: 'FeatureCollection', features: cached });
      const totalFires = cached.length;
      const totalAcres = cached.reduce((sum: number, f: any) => sum + (f.properties?.GIS_ACRES || 0), 0);
      setStats((s) => ({
        ...s,
        totalFires,
        totalAcres: Math.round(totalAcres),
        averageSize: totalFires > 0 ? Math.round(totalAcres / totalFires) : 0,
      }));
      return;
    }

    let cancelled = false;
    apiFetch(`/history/perimeters?year=${year}`)
      .then((r) => r.ok ? r.json() : { features: [] })
      .then((data: any) => {
        if (cancelled) return;
        const feats: any[] = Array.isArray(data?.features) ? data.features : [];
        yearCacheRef.current.set(year, feats);
        setAllFeatures(feats);
        setFireData({ type: 'FeatureCollection', features: feats });
        const totalFires = feats.length;
        const totalAcres = feats.reduce((sum: number, f: any) => sum + (f.properties?.GIS_ACRES || 0), 0);
        setStats((s) => ({
          ...s,
          totalFires,
          totalAcres: Math.round(totalAcres),
          averageSize: totalFires > 0 ? Math.round(totalAcres / totalFires) : 0,
        }));
      })
      .catch((e) => console.warn(`Perimeters for ${year} failed:`, e));

    return () => { cancelled = true; };
  }, [selectedYear]);

  // Legacy filter pass kept for code paths that still expect allFeatures to be present.
  // No-op now that the per-year fetch above sets fireData directly.
  useEffect(() => {
    if (!allFeatures) return;
    const features = selectedYears.length
      ? allFeatures.filter((f) => selectedYears.includes(Number(f?.properties?.YEAR_)))
      : allFeatures;
    setFireData({ type: 'FeatureCollection', features });
    const totalFires = features.length;
    const totalAcres = features.reduce((sum: number, f: any) => sum + (f.properties?.GIS_ACRES || 0), 0);
    setStats((s) => ({
      ...s,
      totalFires,
      totalAcres,
      averageSize: totalFires > 0 ? Math.round(totalAcres / totalFires) : 0,
    }));
  }, [selectedYear, allFeatures]);

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
                  {/* Fire-name dropdown — lists every fire for the selected year;
                      browser-native scroll after the first 6 options. Selecting a
                      fire pans the map to that polygon via focusedFireKey. */}
                  <div className="flex items-center gap-2">
                    <label htmlFor="history-fire" className="text-sm text-muted-foreground">Fire:</label>
                    <select
                      id="history-fire"
                      value={focusedFireKey || ""}
                      onChange={(e) => {
                        const key = e.target.value || null;
                        setFocusedFireKey(key);
                        if (!key) { setSelectedFire(null); return; }
                        const feats: any[] = fireData?.features || [];
                        const f = feats.find((ft: any) => keyFor(ft.properties || {}) === key);
                        setSelectedFire(f ? f.properties : null);
                      }}
                      size={1}
                      className="text-sm border rounded px-2 py-1.5 bg-background w-56"
                    >
                      <option value="">All fires ({fireOptions.length})</option>
                      {fireOptionElements}
                    </select>
                  </div>

                  {/* Year Filter — shadcn Select with a fixed-height scrolling
                      popup so the list doesn't run off the page with 75+ years. */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Year:</span>
                    <Select
                      value={String(selectedYear)}
                      onValueChange={(v) => setSelectedYear(Number(v))}
                    >
                      <SelectTrigger className="w-24 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent
                        className="max-h-56"
                        style={{ maxHeight: '14rem' }}
                      >
                        {availableYears.map((y) => (
                          <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                  {/* Fire Perimeters Layer — full FRAP geometry from the trimmed
                      static GeoJSON, filtered client-side by selected year. */}
                  {showPerimeters && (
                    <HistoricalFirePerimetersOverlay
                      fireData={fireData}
                      selectedFire={selectedFire}
                      onSelect={handleOverlaySelect}
                    />
                  )}
                  {/* Structure Damage (DINS) — sits on top of the perimeter
                      polygons so destroyed/damaged structure dots are visible
                      against the burn area. */}
                  <DINSDamageOverlay
                    enabled={showDins}
                    opacity={dinsOpacity}
                    radius={dinsRadius}
                    year={selectedYear}
                    onCountChange={handleDinsCount}
                  />
                </GoogleMap>
              </div>

              {/* Layer Controls */}
              <div className="mt-4 bg-gray-50 rounded-lg p-4 space-y-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <div className="flex items-center gap-2">
                    <Switch id="layer-perim" checked={showPerimeters} onCheckedChange={setShowPerimeters} />
                    <label htmlFor="layer-perim" className="text-sm font-medium cursor-pointer">Fire Perimeters</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="layer-dins" checked={showDins} onCheckedChange={setShowDins} />
                    <label htmlFor="layer-dins" className="text-sm font-medium cursor-pointer">
                      Structure Damage (DINS)
                      {showDins && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {selectedYear < 2013
                            ? '(coverage starts 2013)'
                            : dinsCount === null
                            ? '— loading…'
                            : `— ${dinsCount.toLocaleString()} structures in ${selectedYear}`}
                        </span>
                      )}
                    </label>
                  </div>
                </div>

                {showDins && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t">
                    <div>
                      <label className="text-xs text-muted-foreground flex justify-between mb-1">
                        <span>Point radius</span><span>{dinsRadius}m</span>
                      </label>
                      <Slider value={[dinsRadius]} min={5} max={150} step={5} onValueChange={(v) => setDinsRadius(v[0])} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground flex justify-between mb-1">
                        <span>Opacity</span><span>{Math.round(dinsOpacity * 100)}%</span>
                      </label>
                      <Slider value={[Math.round(dinsOpacity * 100)]} min={20} max={100} step={5} onValueChange={(v) => setDinsOpacity(v[0] / 100)} />
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t">
                  <h4 className="font-semibold text-sm mb-2">Fire size (perimeter color)</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-2"><div className="w-5 h-3 border border-white rounded" style={{ backgroundColor: 'rgb(234, 179, 8)' }} /><span>&lt;100 ac</span></div>
                    <div className="flex items-center gap-2"><div className="w-5 h-3 border border-white rounded" style={{ backgroundColor: 'rgb(249, 115, 22)' }} /><span>100–1k ac</span></div>
                    <div className="flex items-center gap-2"><div className="w-5 h-3 border border-white rounded" style={{ backgroundColor: 'rgb(220, 38, 38)' }} /><span>1k–10k ac</span></div>
                    <div className="flex items-center gap-2"><div className="w-5 h-3 border border-white rounded" style={{ backgroundColor: 'rgb(139, 0, 0)' }} /><span>10k+ ac</span></div>
                  </div>
                </div>

                {showDins && (
                  <div className="pt-3 border-t">
                    <h4 className="font-semibold text-sm mb-2">Structure damage</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgb(220, 38, 38)' }} /><span>Destroyed (&gt;50%)</span></div>
                      <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgb(249, 115, 22)' }} /><span>Major (25–50%)</span></div>
                      <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgb(234, 179, 8)' }} /><span>Minor (10–25%)</span></div>
                      <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgb(34, 197, 94)' }} /><span>Affected (&gt;0–10%)</span></div>
                      <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgb(59, 130, 246)' }} /><span>No Damage</span></div>
                      <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'rgb(156, 163, 175)' }} /><span>Inaccessible</span></div>
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Click a fire perimeter for details. Hover or click a damage point for the structure address.
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
              {!quickStats ? (
                <p className="text-muted-foreground text-xs">Select a year to see stats.</p>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Largest Fire:</span>
                    <span className="font-medium text-right">
                      {quickStats.largest.properties?.FIRE_NAME || 'Unknown'} ({quickStats.largest.properties?.YEAR_})
                      <span className="block text-[10px] text-muted-foreground">{Math.round(quickStats.largest.properties?.GIS_ACRES || 0).toLocaleString()} ac</span>
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Most Active Year:</span>
                    <span className="font-medium">{quickStats.mostActive?.[0]} ({quickStats.mostActive?.[1]} fires)</span>
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
              )}
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
                Perimeters: CAL FIRE FRAP (full polygon geometry).<br />
                Structure damage: CAL FIRE DINS post-fire assessments.
              </p>
              <p className="text-xs text-muted-foreground">
                Data range: <strong>{stats.yearRange || '—'}</strong> · Source files updated periodically; not live.
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