/**
 * ZIP code risk zone overlay for Google Maps.
 * Loads boundaries + bulk risk from dedicated backend endpoint.
 */
import { useEffect, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { GeoJsonLayer } from "@deck.gl/layers";
import { apiFetch } from "../services/api";

function getRiskColor(score: number): [number, number, number, number] {
  if (score >= 0.75) return [139, 0, 0, 140];
  if (score >= 0.50) return [220, 38, 38, 120];
  if (score >= 0.25) return [234, 179, 8, 100];
  return [34, 197, 94, 70];
}

interface Props {
  onZoneClick?: (zip: string, risk: { risk_score: number; label: string }) => void;
}

let _cachedGeo: any = null;
let _cachedRisk: Record<string, { risk_score: number; label: string }> = {};

export function ZipCodeRiskOverlay({ onZoneClick }: Props) {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const [geoData, setGeoData] = useState<any>(_cachedGeo);
  const [riskData, setRiskData] = useState(_cachedRisk);

  // Load boundaries + risk in parallel
  useEffect(() => {
    if (_cachedGeo && Object.keys(_cachedRisk).length > 0) {
      setGeoData(_cachedGeo);
      setRiskData(_cachedRisk);
      return;
    }
    Promise.all([
      _cachedGeo ? Promise.resolve(_cachedGeo) : apiFetch("/research/boundaries/zip-codes").then((r) => r.json()),
      Object.keys(_cachedRisk).length > 0 ? Promise.resolve({ zones: _cachedRisk }) : apiFetch("/research/risk-by-zone/zip-codes").then((r) => r.json()),
    ])
      .then(([geo, risk]) => {
        if (geo?.features) { _cachedGeo = geo; setGeoData(geo); }
        if (risk?.zones) { _cachedRisk = risk.zones; setRiskData(risk.zones); }
      })
      .catch((e) => console.warn("ZIP overlay load failed:", e));
  }, []);

  // Render overlay
  useEffect(() => {
    if (!map || !geoData?.features || Object.keys(riskData).length === 0) return;
    if (overlayRef.current) { overlayRef.current.setMap(null); overlayRef.current.finalize(); }

    const enriched = {
      ...geoData,
      features: geoData.features.map((f: any) => {
        const zip = f.properties?.zip || "";
        const risk = riskData[zip] || { risk_score: 0, label: "Low" };
        return { ...f, properties: { ...f.properties, risk_score: risk.risk_score, risk_label: risk.label } };
      }),
    };

    const overlay = new GoogleMapsOverlay({
      layers: [new GeoJsonLayer({
        id: "zip-risk-zones",
        data: enriched,
        pickable: true, stroked: true, filled: true,
        lineWidthMinPixels: 0.5,
        getLineColor: [255, 255, 255, 120],
        getLineWidth: 0.5,
        getFillColor: (f: any) => getRiskColor(f.properties.risk_score || 0),
        onClick: (info: any) => {
          if (onZoneClick && info.object) {
            onZoneClick(`ZIP ${info.object.properties?.zip || ""}`, {
              risk_score: info.object.properties?.risk_score || 0,
              label: info.object.properties?.risk_label || "Low",
            });
          }
        },
        updateTriggers: { getFillColor: [Object.keys(riskData).length] },
      })],
    });
    overlay.setMap(map);
    overlayRef.current = overlay;
    return () => { if (overlayRef.current) { overlayRef.current.setMap(null); overlayRef.current.finalize(); overlayRef.current = null; } };
  }, [map, geoData, riskData, onZoneClick]);

  return null;
}
