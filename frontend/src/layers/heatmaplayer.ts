import { HeatmapLayer } from "@deck.gl/aggregation-layers";

export function buildHeatmapLayer(data: any[]) {
  return new HeatmapLayer({
    id: "risk-heatmap-layer",
    data,
    getPosition: (d) => [d.lng, d.lat],
    getWeight: (d) => d.intensity,
    radiusPixels: 40,
    aggregation: "SUM",
    intensity: 1,
    threshold: 0.05,
    colorRange: [
      [255, 255, 178],
      [254, 204, 92],
      [253, 141, 60],
      [240, 59, 32],
      [189, 0, 38],
      [128, 0, 38],
    ],
  });
}
