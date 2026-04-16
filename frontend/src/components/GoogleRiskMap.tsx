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

function ActiveFiresOverlay() {
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
            return pct >= 100 ? [251, 146, 60, 50] : [220, 38, 38, 60];
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
      )}
      {selectedPerimeter && (
        <div
          style={{
            position: 'absolute',
            left: (selectedPerimeter.x ?? 0) + 10,
            top: (selectedPerimeter.y ?? 0) + 10,
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
          <div style={{ fontWeight: 700, marginBottom: 4, paddingRight: 16 }}>{selectedPerimeter.attr_IncidentName || selectedPerimeter.poly_IncidentName || 'Fire Perimeter'}</div>
          {selectedPerimeter.attr_PercentContained != null && <div><strong>Contained:</strong> {selectedPerimeter.attr_PercentContained}%</div>}
          {selectedPerimeter.attr_DailyAcres != null && <div><strong>Acres:</strong> {Number(selectedPerimeter.attr_DailyAcres).toLocaleString()}</div>}
          {selectedPerimeter.attr_FireDiscoveryDateTime && <div><strong>Discovered:</strong> {new Date(selectedPerimeter.attr_FireDiscoveryDateTime).toLocaleDateString()}</div>}
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
          <ActiveFiresOverlay />
        </Map>
      </div>
    </div>
  );
}
