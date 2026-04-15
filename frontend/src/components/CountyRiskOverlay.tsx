/**
 * Shared county-based risk zone overlay for Google Maps.
 * Renders California county polygons colored by ML fire risk prediction.
 * Used by Dashboard, Risk Map, and Research pages.
 */
import { useEffect, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { GeoJsonLayer } from "@deck.gl/layers";
import { apiFetch } from "../services/api";
import countyGeoJson from "../Data/california-counties.json";

interface CountyRiskData {
  [county: string]: { risk_score: number; label: string };
}

function getRiskColor(score: number): [number, number, number, number] {
  if (score >= 0.75) return [139, 0, 0, 140];     // extreme — dark red
  if (score >= 0.50) return [220, 38, 38, 120];    // high — red
  if (score >= 0.25) return [234, 179, 8, 100];    // medium — yellow
  return [34, 197, 94, 70];                         // low — green
}

interface Props {
  overrides?: { evi?: number; lst?: number; wind?: number; elevation?: number };
  onCountyClick?: (county: string, risk: { risk_score: number; label: string }) => void;
}

export function CountyRiskOverlay({ overrides, onCountyClick }: Props) {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const [riskData, setRiskData] = useState<CountyRiskData>({});

  // Fetch risk scores per county
  useEffect(() => {
    const params = new URLSearchParams();
    if (overrides?.evi != null) params.set("evi", String(overrides.evi));
    if (overrides?.lst != null) params.set("lst", String(overrides.lst));
    if (overrides?.wind != null) params.set("wind", String(overrides.wind));
    if (overrides?.elevation != null) params.set("elevation", String(overrides.elevation));

    apiFetch(`/research/risk-by-county?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.counties) setRiskData(data.counties);
      })
      .catch((e) => console.warn("County risk fetch failed:", e));
  }, [overrides?.evi, overrides?.lst, overrides?.wind, overrides?.elevation]);

  // Render overlay when data + map are ready
  useEffect(() => {
    if (!map || Object.keys(riskData).length === 0) return;

    if (overlayRef.current) {
      overlayRef.current.setMap(null);
      overlayRef.current.finalize();
    }

    // Merge risk data into county GeoJSON properties
    const enriched = {
      ...countyGeoJson,
      features: (countyGeoJson as any).features.map((f: any) => {
        const name = f.properties?.name;
        const risk = riskData[name] || { risk_score: 0, label: "Low" };
        return {
          ...f,
          properties: { ...f.properties, risk_score: risk.risk_score, risk_label: risk.label },
        };
      }),
    };

    const overlay = new GoogleMapsOverlay({
      layers: [
        new GeoJsonLayer({
          id: "county-risk-zones",
          data: enriched,
          pickable: true,
          stroked: true,
          filled: true,
          extruded: false,
          lineWidthMinPixels: 1,
          getLineColor: [255, 255, 255, 180],
          getLineWidth: 1,
          getFillColor: (f: any) => getRiskColor(f.properties.risk_score || 0),
          onClick: (info: any) => {
            if (onCountyClick && info.object) {
              const name = info.object.properties?.name;
              const risk = riskData[name];
              if (name && risk) onCountyClick(name, risk);
            }
          },
          updateTriggers: {
            getFillColor: [JSON.stringify(riskData)],
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
  }, [map, riskData, onCountyClick]);

  return null;
}
