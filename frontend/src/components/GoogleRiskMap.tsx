import { useEffect, useRef, useState } from 'react';
import { Map, useMap } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { ScatterplotLayer, GeoJsonLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { apiFetch } from '../services/api';
import { firmsPointsToPolygonCollection } from '../utils/firmsPolygons';
import { CountyRiskOverlay } from './CountyRiskOverlay';
import { ZipCodeRiskOverlay } from './ZipCodeRiskOverlay';
import { CensusTractRiskOverlay } from './CensusTractRiskOverlay';
import { NeighborhoodRiskOverlay } from './NeighborhoodRiskOverlay';

interface CalFireIncident {
  Name: string;
  County: string;
  Latitude: number;
  Longitude: number;
  AcresBurned: number | null;
  PercentContained: number | null;
}

interface SavedLocation { id: number; name: string; lat: number; lon: number; }

export function SavedLocationsOverlay() {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
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
    if (!map || locations.length === 0) return;
    if (overlayRef.current) {
      overlayRef.current.setMap(null);
      overlayRef.current.finalize();
    }
    const overlay = new GoogleMapsOverlay({
      layers: [
        new ScatterplotLayer({
          id: 'saved-locations',
          data: locations,
          pickable: false,
          stroked: true,
          filled: true,
          radiusMinPixels: 7,
          radiusMaxPixels: 12,
          lineWidthMinPixels: 2,
          getPosition: (d: SavedLocation) => [d.lon, d.lat],
          getFillColor: [37, 99, 235, 230],
          getLineColor: [255, 255, 255, 255],
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
  }, [map, locations]);

  return null;
}

export function FirePerimetersOverlay() {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const [fires, setFires] = useState<CalFireIncident[]>([]);
  const [selected, setSelected] = useState<(CalFireIncident & { x: number; y: number }) | null>(null);
  const [firmsFeatures, setFirmsFeatures] = useState<any[]>([]);
  const [nifcPerimeters, setNifcPerimeters] = useState<any>(null);
  const [selectedPerimeter, setSelectedPerimeter] = useState<any>(null);

  useEffect(() => {
    apiFetch('/calfire/incidents?inactive=false')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setFires(
            data.filter(
              (f: any) =>
                f.Latitude &&
                f.Longitude &&
                f.IsActive !== false &&
                Number(f.PercentContained ?? 0) < 100
            )
          );
        }
      })
      .catch((e) => console.warn("CAL FIRE fetch failed:", e));
  }, []);

  useEffect(() => {
    apiFetch('/research/fire-data')
      .then((r) => r.json())
      .then((data) => {
        if (data?.features && Array.isArray(data.features)) {
          setFirmsFeatures(data.features);
        }
      })
      .catch((e) => console.warn("FIRMS fire-data fetch failed:", e));
  }, []);

  useEffect(() => {
    apiFetch('/fire-perimeters')
      .then((r) => r.json())
      .then((data) => {
        if (data?.features) {
          setNifcPerimeters(data);
        }
      })
      .catch((e) => console.warn("NIFC perimeters fetch failed:", e));
  }, []);

  useEffect(() => {
    if (!map) return;
    if (fires.length === 0 && firmsFeatures.length === 0 && !nifcPerimeters) return;

    if (overlayRef.current) {
      overlayRef.current.setMap(null);
      overlayRef.current.finalize();
    }

    const layers: any[] = [];

    if (fires.length > 0) {
      layers.push(
        new ScatterplotLayer({
          id: 'calfire-active',
          data: fires,
          pickable: true,
          opacity: 0.9,
          stroked: true,
          filled: true,
          radiusMinPixels: 6,
          radiusMaxPixels: 20,
          getPosition: (d: CalFireIncident) => [d.Longitude, d.Latitude],
          getRadius: (d: CalFireIncident) => Math.sqrt(d.AcresBurned || 10) * 300,
          getFillColor: [220, 38, 38, 200],
          getLineColor: [255, 255, 255, 255],
          getLineWidth: 2,
          onClick: (info: any) => {
            if (info?.object && info?.x != null && info?.y != null) {
              setSelected({ ...info.object, x: info.x, y: info.y });
              return true;
            }
            return false;
          },
        }),
      );
    }

    if (firmsFeatures.length > 0) {
      layers.push(
        new HeatmapLayer({
          id: 'firms-heatmap',
          data: firmsFeatures,
          getPosition: (d: any) => d.geometry.coordinates,
          getWeight: (d: any) => d.properties?.confidence_num ?? 50,
          radiusPixels: 40,
          intensity: 1,
          threshold: 0.05,
          colorRange: [
            [34, 197, 94, 80], [234, 179, 8, 120], [234, 88, 12, 160],
            [220, 38, 38, 200], [153, 27, 27, 220],
          ],
          updateTriggers: { getWeight: [firmsFeatures.length] },
        }),
      );

      const polygonCollection = firmsPointsToPolygonCollection(firmsFeatures);
      layers.push(
        new GeoJsonLayer({
          id: 'firms-zones',
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
          updateTriggers: { getFillColor: [firmsFeatures.length] },
        }),
      );
    }

    if (nifcPerimeters?.features?.length) {
      layers.push(
        new GeoJsonLayer({
          id: 'nifc-perimeters',
          data: nifcPerimeters,
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 2,
          getLineColor: [220, 38, 38, 220],
          getFillColor: (f: any) => {
            const pct = f.properties?.attr_PercentContained ?? 0;
            if (pct >= 100) return [255, 255, 255, 160];
            if (pct >= 50) return [250, 204, 21, 160];
            if (pct >= 25) return [249, 115, 22, 160];
            return [220, 38, 38, 180];
          },
          getLineWidth: 2,
          onClick: (info: any) => {
            if (info.object) {
              setSelectedPerimeter({ ...info.object.properties, x: info.x, y: info.y });
              return true;
            }
            return false;
          },
          updateTriggers: { getFillColor: [] },
        }),
      );
    }

    const overlay = new GoogleMapsOverlay({ layers });
    overlay.setMap(map);
    overlayRef.current = overlay;
    return () => {
      if (overlayRef.current) {
        overlayRef.current.setMap(null);
        overlayRef.current.finalize();
        overlayRef.current = null;
      }
    };
  }, [map, fires, firmsFeatures, nifcPerimeters]);

  return (
    <>
      {selected && (
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
            maxWidth: 260,
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <button
            onClick={() => setSelected(null)}
            style={{ position: 'absolute', top: 4, right: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#6b7280' }}
          >×</button>
          <div style={{ fontWeight: 700, marginBottom: 4, paddingRight: 16 }}>{selected.Name || 'Unknown Fire'}</div>
          {selected.County && <div><strong>County:</strong> {selected.County}</div>}
          {selected.AcresBurned != null && <div><strong>Acres:</strong> {selected.AcresBurned.toLocaleString()}</div>}
          {selected.PercentContained != null && <div><strong>Contained:</strong> {selected.PercentContained}%</div>}
        </div>
      )}
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
                setSelectedZone({ name, risk_score: risk.risk_score, label: risk.label, level: "ZIP Code" })
              }
            />
          )}
          {zoneLevel === "census-tracts" && (
            <CensusTractRiskOverlay
              onZoneClick={(name, risk) =>
                setSelectedZone({ name, risk_score: risk.risk_score, label: risk.label, level: "Census Tract" })
              }
            />
          )}
          {zoneLevel === "neighborhoods" && (
            <NeighborhoodRiskOverlay
              onZoneClick={(name, risk) =>
                setSelectedZone({ name, risk_score: risk.risk_score, label: risk.label, level: "Neighborhood" })
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
              <div style={{ fontSize: 11, color: '#6b7280' }}>Parameter breakdown loading — switch to Counties for full detail.</div>
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
        <p className="text-xs text-muted-foreground">CAL FIRE incidents, NIFC perimeters, and NASA FIRMS hotspots — click any fire for details</p>
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
