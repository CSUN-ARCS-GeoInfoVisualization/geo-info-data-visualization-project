import { useEffect, useRef, useState } from 'react';
import { Map, useMap } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { ScatterplotLayer } from '@deck.gl/layers';

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

  useEffect(() => {
    fetch('https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List?inactive=false')
      .then((r) => r.json())
      .then((data: CalFireIncident[]) => setFires(data.filter((f) => f.Latitude && f.Longitude)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!map || fires.length === 0) return;
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

  return null;
}

interface GoogleRiskMapProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: string;
}

export function GoogleRiskMap({
  center = { lat: 36.7783, lng: -119.4179 },
  zoom = 6,
  height = "h-[420px]",
}: GoogleRiskMapProps) {
  return (
    <div className={`w-full ${height} rounded-lg overflow-hidden border`}>
      <Map
        style={{ width: '100%', height: '100%' }}
        defaultCenter={center}
        defaultZoom={zoom}
        gestureHandling="greedy"
        disableDefaultUI
      >
        <ActiveFiresOverlay />
      </Map>
    </div>
  );
}
