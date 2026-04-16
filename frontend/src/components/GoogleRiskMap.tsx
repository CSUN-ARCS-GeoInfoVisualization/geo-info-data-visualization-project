import { useEffect, useRef, useState } from 'react';
import { Map, useMap } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { ScatterplotLayer } from '@deck.gl/layers';
import { apiFetch } from '../services/api';
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

function ActiveFiresOverlay() {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const [fires, setFires] = useState<CalFireIncident[]>([]);
  const [selected, setSelected] = useState<(CalFireIncident & { x: number; y: number }) | null>(null);

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
    if (!map) return;
    if (fires.length === 0) { return; }
    if (overlayRef.current) {
      overlayRef.current.setMap(null);
      overlayRef.current.finalize();
    }
    const overlay = new GoogleMapsOverlay({
      layers: [
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
  }, [map, fires]);

  if (!selected) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: selected.x + 10,
        top: selected.y + 10,
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
  );
}

interface GoogleRiskMapProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: string;
}

type ZoneLevel = "counties" | "zip-codes" | "census-tracts" | "neighborhoods";

export function GoogleRiskMap({
  center = { lat: 36.7783, lng: -119.4179 },
  zoom = 6,
  height = "h-[420px]",
}: GoogleRiskMapProps) {
  const [zoneLevel, setZoneLevel] = useState<ZoneLevel>("counties");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Risk Zone Level:</span>
        <select
          value={zoneLevel}
          onChange={(e) => setZoneLevel(e.target.value as ZoneLevel)}
          className="text-xs border rounded px-2 py-1 bg-background"
        >
          <option value="counties">Counties (58)</option>
          <option value="zip-codes">ZIP Codes (1,769)</option>
          <option value="neighborhoods">Neighborhoods (1,521)</option>
          <option value="census-tracts">Census Tracts (8,041)</option>
        </select>
      </div>
      <div style={{ height: 420 }} className="w-full rounded-lg overflow-hidden border">
        <Map
          style={{ width: '100%', height: '100%' }}
          defaultCenter={center}
          defaultZoom={zoom}
          gestureHandling="greedy"
          disableDefaultUI
        >
          {zoneLevel === "counties" && <CountyRiskOverlay />}
          {zoneLevel === "zip-codes" && <ZipCodeRiskOverlay />}
          {zoneLevel === "census-tracts" && <CensusTractRiskOverlay />}
          {zoneLevel === "neighborhoods" && <NeighborhoodRiskOverlay />}
        </Map>
      </div>
    </div>
  );
}
