import { Map, Marker /* , Heatmap */ } from '@vis.gl/react-google-maps';

type MapPlaceholderProps = {
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: string;   // tailwind height class, e.g., "h-[420px]"
};

export function GoogleRiskMap({
  center = { lat: 36.7783, lng: -119.4179 }, // California
  zoom = 6,
  height = "h-[420px]",
}: MapPlaceholderProps) {
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

        {/*
        // Optional heatmap (requires APIProvider libraries={['visualization']})
        <Heatmap
          data={[
            { location: { lat: 34.05, lng: -118.24 }, weight: 1 },
            { location: { lat: 37.77, lng: -122.42 }, weight: 2 },
          ]}
          options={{ radius: 20 }}
        />
        */}
      </Map>
    </div>
  );
}
