import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { buildHeatmapLayer } from "../../layers/heatmapLayer";
import { mockRiskData } from "../../Data/mockRiskData";


export function DeckOverlayManager() {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    // Use mock data for testing before backend integration
    const heatmap = buildHeatmapLayer(mockRiskData);

    const overlay = new GoogleMapsOverlay({
      layers: [heatmap],
    });

    overlay.setMap(map);

    return () => overlay.setMap(null);
  }, [map]);

  return null;
}
