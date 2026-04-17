/**
 * Convert FIRMS hotspot points into small polygons sized by FRP.
 */

function pointToPolygon(
  lon: number, lat: number, frp: number, sides = 6
): number[][] {
  const radiusDeg = Math.sqrt(Math.max(frp, 1)) * 0.002;
  const cosLat = Math.cos(lat * Math.PI / 180);
  const coords: number[][] = [];
  for (let i = 0; i <= sides; i++) {
    const angle = (2 * Math.PI * i) / sides;
    coords.push([
      lon + radiusDeg * Math.cos(angle) / cosLat,
      lat + radiusDeg * Math.sin(angle),
    ]);
  }
  return coords;
}

export function firmsPointsToPolygonCollection(features: any[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature" as const,
      properties: f.properties,
      geometry: {
        type: "Polygon" as const,
        coordinates: [pointToPolygon(
          f.geometry.coordinates[0],
          f.geometry.coordinates[1],
          f.properties?.frp || 1,
        )],
      },
    })),
  };
}
