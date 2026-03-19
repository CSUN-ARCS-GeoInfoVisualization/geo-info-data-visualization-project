import { Map, Marker } from '@vis.gl/react-google-maps';
import { DeckOverlayManager } from './maps/DeckOverlayManager';

interface GoogleRiskMapProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: string;
}

export function GoogleRiskMap({
  center = { lat: 36.7783, lng: -119.4179 }, // California
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
        {/* Example marker (Los Angeles). Remove or replace with your data */}
        <Marker position={{ lat: 34.0522, lng: -118.2437 }} />
      </Map>
      <DeckOverlayManager />
    </div>
  );
}
