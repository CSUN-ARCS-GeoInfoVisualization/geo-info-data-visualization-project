import { useEffect, useRef, useState } from 'react';
import { Map, useMap } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { apiFetch } from '../services/api';
import { CountyRiskOverlay } from './CountyRiskOverlay';
import { ZipCodeRiskOverlay } from './ZipCodeRiskOverlay';
import { CensusTractRiskOverlay } from './CensusTractRiskOverlay';
import { NeighborhoodRiskOverlay } from './NeighborhoodRiskOverlay';

interface SavedLocation { id: number; name: string; lat: number; lon: number; }

export function SavedLocationsOverlay() {
  const map = useMap();
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [locations, setLocations] = useState<SavedLocation[]>([]);

  useEffect(() => {
    apiFetch('/me/locations')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setLocations(
            data.filter((l: any) => typeof l?.lat === 'number' && typeof l?.lon === 'number')
          );
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!map) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    if (locations.length === 0) return;

    const markers = locations.map((loc) =>
      new google.maps.Marker({
        position: { lat: loc.lat, lng: loc.lon },
        map,
        title: loc.name,
        zIndex: 9999,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: '#2563eb',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      })
    );
    markersRef.current = markers;

    return () => {
      markers.forEach((m) => m.setMap(null));
      markersRef.current = [];
    };
  }, [map, locations]);

  return null;
}

export function FirePerimetersOverlay() {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const [nifcPerimeters, setNifcPerimeters] = useState<any>(null);
  const [selectedPerimeter, setSelectedPerimeter] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 5;
    const load = async () => {
      while (!cancelled && attempt < maxAttempts) {
        attempt += 1;
        try {
          const r = await apiFetch('/fire-perimeters');
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          if (cancelled) return;
          const features = Array.isArray(data?.features)
            ? data.features.filter((f: any) => {
                const raw = f?.properties?.attr_PercentContained;
                return raw == null || Number(raw) < 100;
              })
            : [];
          console.log(`[dashboard] NIFC perimeters loaded: ${features.length} active CA fires`);
          setNifcPerimeters({ type: 'FeatureCollection', ...data, features });
          return;
        } catch (e) {
          console.error(`[dashboard] NIFC perimeters attempt ${attempt} failed:`, e);
        }
        await new Promise((res) => setTimeout(res, 3000 * attempt));
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!map || !nifcPerimeters?.features?.length) return;

    if (overlayRef.current) {
      overlayRef.current.setMap(null);
      overlayRef.current.finalize();
    }

    const colorForPct = (raw: any): [number, number, number, number] => {
      const pct = raw == null ? 0 : Number(raw);
      if (pct >= 100) return [255, 255, 255, 220];
      if (pct >= 50) return [250, 204, 21, 230];
      if (pct >= 25) return [249, 115, 22, 230];
      return [220, 38, 38, 230];
    };

    // Compute centroids for a pixel-sized marker so tiny sub-pixel perimeters are still visible
    const centroids = nifcPerimeters.features
      .map((f: any) => {
        const g = f.geometry;
        if (!g) return null;
        let pts: number[][] = [];
        if (g.type === 'Polygon') pts = g.coordinates[0] || [];
        else if (g.type === 'MultiPolygon') pts = (g.coordinates[0] && g.coordinates[0][0]) || [];
        if (!pts.length) return null;
        let lon = 0, lat = 0;
        for (const [x, y] of pts) { lon += x; lat += y; }
        return { lon: lon / pts.length, lat: lat / pts.length, properties: f.properties };
      })
      .filter(Boolean);

    const overlay = new GoogleMapsOverlay({
      layers: [
        new GeoJsonLayer({
          id: 'nifc-perimeters',
          data: nifcPerimeters,
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 2,
          getLineColor: [255, 255, 255, 220],
          getFillColor: (f: any) => colorForPct(f.properties?.attr_PercentContained),
          getLineWidth: 2,
          onClick: (info: any) => {
            if (info.object) {
              setSelectedPerimeter({ ...info.object.properties, x: info.x, y: info.y });
              return true;
            }
            return false;
          },
          updateTriggers: { getFillColor: [nifcPerimeters.features.length] },
        }),
        // Pixel-sized centroid markers so tiny fires stay visible at CA-wide zoom
        new ScatterplotLayer({
          id: 'nifc-markers',
          data: centroids,
          pickable: true,
          stroked: true,
          filled: true,
          radiusMinPixels: 7,
          radiusMaxPixels: 14,
          lineWidthMinPixels: 2,
          getPosition: (d: any) => [d.lon, d.lat],
          getRadius: 8,
          getFillColor: (d: any) => colorForPct(d.properties?.attr_PercentContained),
          getLineColor: [255, 255, 255, 255],
          onClick: (info: any) => {
            if (info?.object?.properties) {
              setSelectedPerimeter({ ...info.object.properties, x: info.x, y: info.y });
              return true;
            }
            return false;
          },
        }),
      ],
    });
    overlay.setMap(map);
    overlayRef.current = overlay;
    return () => {
      if (overlayRef.current) {
        overlayRef.current.setMap(null);
        overlayRef.current.finalize();
        overlayRef.current = null;
      }
    };
  }, [map, nifcPerimeters]);

  return (
    <>
      {selectedPerimeter && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 12,
            transform: 'translateX(-50%)',
            zIndex: 1000,
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 12,
            maxWidth: 280,
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <button
            onClick={() => setSelectedPerimeter(null)}
            style={{ position: 'absolute', top: 4, right: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#6b7280' }}
          >×</button>
          <div style={{ fontWeight: 700, marginBottom: 4, paddingRight: 16 }}>{selectedPerimeter.poly_IncidentName || selectedPerimeter.attr_IncidentName || 'Fire Perimeter'}</div>
          {selectedPerimeter.poly_GISAcres != null && <div><strong>Acres:</strong> {Number(selectedPerimeter.poly_GISAcres).toLocaleString()}</div>}
          {selectedPerimeter.attr_PercentContained != null && <div><strong>Contained:</strong> {selectedPerimeter.attr_PercentContained}%</div>}
          {selectedPerimeter.poly_FeatureCategory && <div><strong>Category:</strong> {selectedPerimeter.poly_FeatureCategory}</div>}
        </div>
      )}
    </>
  );
}

interface GoogleRiskMapProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: string;
}

type ZoneLevel = "counties" | "zip-codes" | "census-tracts" | "neighborhoods";

interface SelectedZone {
  name: string;
  risk_score: number;
  label: string;
  features?: { evi: number; lst: number; wind: number; elevation: number };
  level: string;
}

function labelColor(label: string) {
  const l = label.toLowerCase();
  if (l.includes("extreme")) return "#7f1d1d";
  if (l.includes("high")) return "#dc2626";
  if (l.includes("moderate") || l.includes("medium")) return "#ca8a04";
  return "#16a34a";
}

export function GoogleRiskMap({
  center = { lat: 36.7783, lng: -119.4179 },
  zoom = 6,
}: GoogleRiskMapProps) {
  const [zoneLevel, setZoneLevel] = useState<ZoneLevel>("counties");
  const [selectedZone, setSelectedZone] = useState<SelectedZone | null>(null);

  const levelLabel: Record<ZoneLevel, string> = {
    "counties": "Counties (58)",
    "zip-codes": "ZIP Codes (1,769)",
    "neighborhoods": "Neighborhoods (1,521)",
    "census-tracts": "Census Tracts (8,041)",
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Risk Zones</h3>
          <p className="text-xs text-muted-foreground">ML-predicted wildfire risk — click a zone for details</p>
        </div>
        <select
          value={zoneLevel}
          onChange={(e) => { setZoneLevel(e.target.value as ZoneLevel); setSelectedZone(null); }}
          className="text-xs border rounded-md px-2 py-1.5 bg-background shadow-sm"
          aria-label="Risk zone level"
        >
          {(Object.keys(levelLabel) as ZoneLevel[]).map((k) => (
            <option key={k} value={k}>{levelLabel[k]}</option>
          ))}
        </select>
      </div>
      <div style={{ height: 420, position: 'relative' }} className="w-full rounded-lg overflow-hidden border shadow-sm">
        <Map
          style={{ width: '100%', height: '100%' }}
          defaultCenter={center}
          defaultZoom={zoom}
          gestureHandling="greedy"
          disableDefaultUI
          mapTypeId="roadmap"
        >
          {zoneLevel === "counties" && (
            <CountyRiskOverlay
              onCountyClick={(name, risk) =>
                setSelectedZone({ name, risk_score: risk.risk_score, label: risk.label, features: risk.features, level: "County" })
              }
            />
          )}
          {zoneLevel === "zip-codes" && (
            <ZipCodeRiskOverlay
              onZoneClick={(name, risk) =>
                setSelectedZone({ name, risk_score: risk.risk_score, label: risk.label, features: risk.features, level: "ZIP Code" })
              }
            />
          )}
          {zoneLevel === "census-tracts" && (
            <CensusTractRiskOverlay
              onZoneClick={(name, risk) =>
                setSelectedZone({ name, risk_score: risk.risk_score, label: risk.label, features: risk.features, level: "Census Tract" })
              }
            />
          )}
          {zoneLevel === "neighborhoods" && (
            <NeighborhoodRiskOverlay
              onZoneClick={(name, risk) =>
                setSelectedZone({ name, risk_score: risk.risk_score, label: risk.label, features: risk.features, level: "Neighborhood" })
              }
            />
          )}
          <SavedLocationsOverlay />
        </Map>
        {selectedZone && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 12,
              transform: 'translateX(-50%)',
              zIndex: 1000,
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: 14,
              minWidth: 260,
              maxWidth: 340,
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.05)',
              fontSize: 12,
              lineHeight: 1.55,
            }}
          >
            <button
              onClick={() => setSelectedZone(null)}
              aria-label="Close"
              style={{ position: 'absolute', top: 6, right: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6b7280' }}
            >×</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, paddingRight: 20 }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280' }}>{selectedZone.level}</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{selectedZone.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ background: labelColor(selectedZone.label), color: 'white', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                {selectedZone.label}
              </span>
              <span style={{ color: '#374151', fontWeight: 600 }}>{(selectedZone.risk_score * 100).toFixed(0)}% risk</span>
            </div>
            {selectedZone.features ? (
              <>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280', marginBottom: 6 }}>Why this risk — model inputs</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span><strong>🌿 Vegetation (EVI):</strong><br /><span style={{ color: '#6b7280', fontSize: 11 }}>Greener = more fuel</span></span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{selectedZone.features.evi?.toFixed(3)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span><strong>🌡️ Land Surface Temp:</strong><br /><span style={{ color: '#6b7280', fontSize: 11 }}>Hotter ground dries fuel</span></span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{((selectedZone.features.lst * 0.02) - 273.15).toFixed(1)}°C</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span><strong>💨 Wind Speed:</strong><br /><span style={{ color: '#6b7280', fontSize: 11 }}>Faster wind spreads fire</span></span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{selectedZone.features.wind?.toFixed(1)} m/s</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span><strong>⛰️ Elevation:</strong><br /><span style={{ color: '#6b7280', fontSize: 11 }}>Slope + altitude affect burn</span></span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(selectedZone.features.elevation ?? 0)} m</span>
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 10, color: '#9ca3af' }}>ML model: gradient-boosted on NASA MODIS + NOAA reanalysis.</div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: '#6b7280' }}>Parameter breakdown loading…</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ActiveFiresMap({
  center = { lat: 36.7783, lng: -119.4179 },
  zoom = 6,
}: { center?: { lat: number; lng: number }; zoom?: number } = {}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">Active Fires</h3>
        <p className="text-xs text-muted-foreground">Live NIFC perimeter polygons for active California wildfires (fully contained fires hidden)</p>
      </div>
      <div style={{ height: 420, position: 'relative' }} className="w-full rounded-lg overflow-hidden border shadow-sm">
        <Map
          style={{ width: '100%', height: '100%' }}
          defaultCenter={center}
          defaultZoom={zoom}
          gestureHandling="greedy"
          disableDefaultUI
          mapTypeId="roadmap"
        >
          <FirePerimetersOverlay />
          <SavedLocationsOverlay />
        </Map>
      </div>
    </div>
  );
}
