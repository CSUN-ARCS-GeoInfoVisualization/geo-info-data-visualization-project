import { useEffect, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { PolygonLayer } from '@deck.gl/layers';

interface FirePerimeter {
  type: string;
  id: number;
  geometry: {
    type: string;
    coordinates: number[][][][]; // MultiPolygon coordinates
  };
  properties?: {
    FIRE_NAME?: string;
    ALARM_DATE?: string;
    CONT_DATE?: string;
    GIS_ACRES?: number;
    C_METHOD?: string;
    OBJECTIVE?: string;
    [key: string]: any;
  };
}

interface FirePerimetersLayerProps {
  data: FirePerimeter[];
  visible: boolean;
  opacity: number;
  onFeatureClick?: (feature: FirePerimeter) => void;
  onFeatureHover?: (feature: FirePerimeter | null, x: number, y: number) => void;
}

export function FirePerimetersLayer({
  data,
  visible,
  opacity,
  onFeatureClick,
  onFeatureHover
}: FirePerimetersLayerProps) {
  const map = useMap();
  const [overlay, setOverlay] = useState<GoogleMapsOverlay | null>(null);

  useEffect(() => {
    if (!map) return;

    // Clean up old overlay
    if (overlay) {
      overlay.setMap(null);
      overlay.finalize();
    }

    if (!visible || data.length === 0) {
      setOverlay(null);
      return;
    }

    // Create new overlay with PolygonLayer
    const deckOverlay = new GoogleMapsOverlay({
      layers: [
        new PolygonLayer({
          id: 'fire-perimeters',
          data,
          pickable: true,
          stroked: true,
          filled: true,
          wireframe: false,
          lineWidthMinPixels: 2,
          
          // Get polygon coordinates from GeoJSON
          getPolygon: (d: FirePerimeter) => {
            if (d.geometry.type === 'MultiPolygon') {
              // Return first polygon of MultiPolygon
              return d.geometry.coordinates[0][0];
            } else if (d.geometry.type === 'Polygon') {
              return (d.geometry.coordinates as any)[0];
            }
            return [];
          },
          
          // Fill color - red/orange for active fires
          getFillColor: (d: FirePerimeter) => {
            // Active fires = red, contained = orange, controlled = yellow
            const isActive = !d.properties?.CONT_DATE;
            if (isActive) {
              return [220, 38, 38, opacity * 1.5]; // Red with transparency
            }
            return [251, 146, 60, opacity * 1.5]; // Orange
          },
          
          // Border color
          getLineColor: [255, 255, 255, 200], // White border
          
          // Border width
          getLineWidth: 2,
          
          // Hover interaction
          onHover: (info: any) => {
            if (info.object && onFeatureHover) {
              onFeatureHover(info.object, info.x, info.y);
            } else if (!info.object && onFeatureHover) {
              onFeatureHover(null, 0, 0);
            }
          },
          
          // Click interaction
          onClick: (info: any) => {
            if (info.object && onFeatureClick) {
              onFeatureClick(info.object);
            }
          },
          
          // Update triggers
          updateTriggers: {
            getFillColor: [opacity],
            getLineColor: [],
            getLineWidth: []
          }
        })
      ]
    });

    deckOverlay.setMap(map);
    setOverlay(deckOverlay);

    return () => {
      if (deckOverlay) {
        deckOverlay.setMap(null);
        deckOverlay.finalize();
      }
    };
  }, [map, data, visible, opacity, onFeatureClick, onFeatureHover]);

  return null;
}

// Helper function to load fire perimeters GeoJSON
export async function loadFirePerimeters(): Promise<FirePerimeter[]> {
  try {
    const response = await fetch('/Data/California_Fire_Perimeters.geojson');
    const geojson = await response.json();
    return geojson.features || [];
  } catch (error) {
    console.error('Error loading fire perimeters:', error);
    return [];
  }
}

// Helper function to calculate area in acres from polygon
export function calculateAcres(coordinates: number[][][]): number {
  // Simple approximation using shoelace formula
  // This is approximate - real calculation would use geodesic math
  if (!coordinates || coordinates.length === 0) return 0;
  
  const polygon = coordinates[0];
  let area = 0;
  
  for (let i = 0; i < polygon.length - 1; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  
  area = Math.abs(area) / 2;
  
  // Convert from square degrees to square meters (rough approximation)
  const metersPerDegree = 111320; // at equator
  const squareMeters = area * Math.pow(metersPerDegree, 2);
  
  // Convert to acres (1 acre = 4046.86 square meters)
  return squareMeters / 4046.86;
}
