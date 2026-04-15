import { Map, Marker } from '@vis.gl/react-google-maps';
import { MapsKeyLoadingPlaceholder, useMapsConfig } from "../context/maps-config";
import { MapPlaceholder } from "./map-placeholder";
import { DeckOverlayManager } from './maps/DeckOverlayManager';

export interface GoogleRiskMapProps {
  /** Map center (defaults to central California overview). */
  center?: { lat: number; lng: number };
  /** Marker shown at this position (defaults to `center`). */
  markerPosition?: { lat: number; lng: number };
  zoom?: number;
  height?: string;
}

const DEFAULT_CENTER = { lat: 36.7783, lng: -119.4179 };

export function GoogleRiskMap({
  center = DEFAULT_CENTER,
  markerPosition,
  zoom = 6,
  height = "h-[420px]",
}: GoogleRiskMapProps) {
  const { mapsApiKey, mapsKeyLoading } = useMapsConfig();
  const marker = markerPosition ?? center;

  if (mapsKeyLoading) {
    return (
      <div className={`w-full min-h-[240px] flex items-center justify-center`}>
        <MapsKeyLoadingPlaceholder className="min-h-[240px] w-full" />
      </div>
    );
  }

  if (!mapsApiKey) {
    return (
      <div className="w-full min-h-[240px] flex items-stretch">
        <MapPlaceholder className="min-h-[240px] w-full" />
      </div>
    );
  }

  return (
    <div className={`w-full ${height} rounded-lg overflow-hidden border`}>
      <Map
        style={{ width: '100%', height: '100%' }}
        defaultCenter={center}
        defaultZoom={zoom}
        gestureHandling="greedy"
        disableDefaultUI
      >
        <Marker position={marker} />
        <DeckOverlayManager />
      </Map>
    </div>
  );
}
