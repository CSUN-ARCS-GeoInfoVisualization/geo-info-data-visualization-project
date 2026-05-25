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

interface CountyRisk {
  risk_score: number;
  label: string;
  features?: { evi: number; lst: number; wind: number; elevation: number };
}
interface CountyRiskData {
  [county: string]: CountyRisk;
}

import { riskRgba } from "../lib/riskTiers";

// 9-tier palette — shared source of truth in lib/riskTiers.ts
const getRiskColor = riskRgba;

interface Props {
  overrides?: { evi?: number; lst?: number; wind?: number; elevation?: number };
  onCountyClick?: (county: string, risk: CountyRisk) => void;
}

export function CountyRiskOverlay({ overrides, onCountyClick }: Props) {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const riskDataRef = useRef<CountyRiskData>({});
  const onClickRef = useRef(onCountyClick);
  const [riskData, setRiskData] = useState<CountyRiskData>({});

  // Keep refs in sync without triggering effects
  useEffect(() => { onClickRef.current = onCountyClick; }, [onCountyClick]);
  useEffect(() => { riskDataRef.current = riskData; }, [riskData]);

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

  // Create overlay ONCE per map mount — survives subsequent renders
  useEffect(() => {
    if (!map) return;
    const overlay = new GoogleMapsOverlay({ layers: [] });
    overlay.setMap(map);
    overlayRef.current = overlay;
    return () => {
      overlay.setMap(null);
      overlay.finalize();
      overlayRef.current = null;
    };
  }, [map]);

  // Swap layers in-place via setProps when data changes — NO flicker
  useEffect(() => {
    if (!overlayRef.current || Object.keys(riskData).length === 0) return;

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

    overlayRef.current.setProps({
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
          // Use refs so click-handler identity changes never trigger overlay rebuild
          onClick: (info: any) => {
            const cb = onClickRef.current;
            if (cb && info.object) {
              const name = info.object.properties?.name;
              const risk = riskDataRef.current[name];
              if (name && risk) cb(name, risk);
            }
          },
          updateTriggers: {
            getFillColor: [JSON.stringify(riskData)],
          },
        }),
      ],
    });
  }, [riskData]);

  return null;
}
