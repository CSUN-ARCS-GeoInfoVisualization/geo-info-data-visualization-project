import { useEffect, useRef, useState } from 'react';
import { Map, useMap } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { GeoJsonLayer } from '@deck.gl/layers';
import { apiFetch } from '../services/api';
import { CountyRiskOverlay } from './CountyRiskOverlay';
import { ZipCodeRiskOverlay } from './ZipCodeRiskOverlay';
import { CensusTractRiskOverlay } from './CensusTractRiskOverlay';
import { NeighborhoodRiskOverlay } from './NeighborhoodRiskOverlay';

interface SavedLocation { id: number; name: string; lat: number; lon: number; }

// Up to 20 saved locations are rendered per map. If a user has more, only the
// first 20 (most recently added) are drawn and the map is framed around those.
export const MAX_SAVED_LOCATIONS = 20;

export function SavedLocationsOverlay() {
  const map = useMap();
  const markersRef = useRef<google.maps.Marker[]>([]);
  const didInitialFitRef = useRef(false);
  const [locations, setLocations] = useState<SavedLocation[]>([]);

  useEffect(() => {
    apiFetch('/me/locations')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          const valid = data.filter((l: any) => typeof l?.lat === 'number' && typeof l?.lon === 'number');
          setLocations(valid.slice(0, MAX_SAVED_LOCATIONS));
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

    // Frame the map around the user's saved locations the first time they load
    // so the user starts at the area they care about. Only fit once — subsequent
    // re-renders (from other overlays / state changes) should not override pan/zoom.
    if (!didInitialFitRef.current) {
      didInitialFitRef.current = true;
      if (locations.length === 1) {
        map.setCenter({ lat: locations[0].lat, lng: locations[0].lon });
        map.setZoom(11);
      } else {
        const bounds = new google.maps.LatLngBounds();
        locations.forEach((l) => bounds.extend({ lat: l.lat, lng: l.lon }));
        map.fitBounds(bounds, 80);
      }
    }

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
      if (pct >= 100) return [255, 255, 255, 230];
      if (pct >= 50) return [250, 204, 21, 240];
      if (pct >= 25) return [249, 115, 22, 240];
      return [220, 38, 38, 240];
    };

    const overlay = new GoogleMapsOverlay({
      layers: [
        new GeoJsonLayer({
          id: 'nifc-perimeters',
          data: nifcPerimeters,
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 3,
          getLineColor: (f: any) => colorForPct(f.properties?.attr_PercentContained),
          getFillColor: (f: any) => colorForPct(f.properties?.attr_PercentContained),
          getLineWidth: 3,
          onClick: (info: any) => {
            if (info.object) {
              setSelectedPerimeter({ ...info.object.properties, x: info.x, y: info.y });
              return true;
            }
            return false;
          },
          updateTriggers: {
            getFillColor: [nifcPerimeters.features.length],
            getLineColor: [nifcPerimeters.features.length],
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
          {selectedPerimeter.poly_GISAcres != null && <div><strong>Acres:</strong> {Number(selectedPerimeter.poly_GISAcres).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>}
          {(() => {
            const raw = selectedPerimeter.attr_PercentContained;
            const pct = raw == null ? null : Number(raw);
            const tier = pct == null ? 'Unknown (0–24%)' : pct >= 100 ? '100%' : pct >= 50 ? `${pct}% (50–99%)` : pct >= 25 ? `${pct}% (25–49%)` : `${pct}% (0–24%)`;
            const color = pct == null ? '#dc2626' : pct >= 100 ? '#ffffff' : pct >= 50 ? '#facc15' : pct >= 25 ? '#f97316' : '#dc2626';
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: color, border: '1px solid #d1d5db', display: 'inline-block' }} />
                <div><strong>Contained:</strong> {tier}</div>
              </div>
            );
          })()}
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
  features?: { evi: number; air_temp_encoded: number; wind: number; humidity?: number; elevation: number; kbdi?: number };
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
                    <span><strong>🌡️ Air Temperature:</strong><br /><span style={{ color: '#6b7280', fontSize: 11 }}>Hotter air dries fuel</span></span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Number.isFinite(selectedZone.features.air_temp_encoded) ? (((selectedZone.features.air_temp_encoded as number) * 0.02) - 273.15).toFixed(1) + '°C' : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span><strong>💨 Wind Speed:</strong><br /><span style={{ color: '#6b7280', fontSize: 11 }}>Faster wind spreads fire</span></span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{selectedZone.features.wind?.toFixed(1) ?? '—'} m/s</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span><strong>💧 Humidity:</strong><br /><span style={{ color: '#6b7280', fontSize: 11 }}>Moist air slows ignition</span></span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{selectedZone.features.humidity?.toFixed(0) ?? '—'}%</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span><strong>⛰️ Elevation:</strong><br /><span style={{ color: '#6b7280', fontSize: 11 }}>Slope + altitude affect burn</span></span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(selectedZone.features.elevation ?? 0)} m</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span><strong>🥵 Drought (KBDI):</strong><br /><span style={{ color: '#6b7280', fontSize: 11 }}>0=saturated, 800=severe</span></span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{selectedZone.features.kbdi?.toFixed(0) ?? '—'}</span>
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 10, color: '#9ca3af' }}>Calibrated Random Forest · MODIS EVI + Open-Meteo + USGS 3DEP + NASA POWER (KBDI).</div>
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
