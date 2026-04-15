/**
 * ZIP code risk zone overlay for Google Maps.
 * Loads 1,769 California ZIP code boundaries from backend, predicts risk per zone.
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

function getCentroid(coords: any): [number, number] | null {
  let lat = 0, lon = 0, count = 0;
  const flatten = (c: any) => {
    if (typeof c[0] === "number") { lon += c[0]; lat += c[1]; count++; }
    else c.forEach(flatten);
  };
  flatten(coords);
  return count > 0 ? [lat / count, lon / count] : null;
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
  const [riskData, setRiskData] = useState<Record<string, { risk_score: number; label: string }>>(_cachedRisk);
  const [loading, setLoading] = useState(!_cachedGeo);

  // Load boundary data
  useEffect(() => {
    if (_cachedGeo) return;
    setLoading(true);
    apiFetch("/research/boundaries/zip-codes")
      .then((r) => r.json())
      .then((data) => {
        if (data?.features) { _cachedGeo = data; setGeoData(data); }
      })
      .catch((e) => console.warn("ZIP boundaries load failed:", e))
      .finally(() => setLoading(false));
  }, []);

  // Batch predict risk per ZIP centroid
  useEffect(() => {
    if (!geoData?.features || Object.keys(_cachedRisk).length > 0) {
      if (Object.keys(_cachedRisk).length > 0) setRiskData(_cachedRisk);
      return;
    }
    const centroids: { zip: string; lat: number; lon: number }[] = [];
    for (const f of geoData.features) {
      const zip = f.properties?.zip;
      if (!zip) continue;
      const c = getCentroid(f.geometry?.coordinates);
      if (c) centroids.push({ zip, lat: c[0], lon: c[1] });
    }

    // Batch in chunks of 50
    const CHUNK = 50;
    const results: Record<string, { risk_score: number; label: string }> = {};
    const chunks: typeof centroids[] = [];
    for (let i = 0; i < centroids.length; i += CHUNK) chunks.push(centroids.slice(i, i + CHUNK));

    Promise.all(
      chunks.map((chunk) =>
        apiFetch("/predict/batch", {
          method: "POST",
          body: JSON.stringify({ items: chunk.map((c) => ({ lat: c.lat, lon: c.lon })) }),
        })
          .then((r) => r.json())
          .then((data) => {
            chunk.forEach((c, i) => {
              const pred = data?.results?.[i]?.prediction;
              if (pred) results[c.zip] = { risk_score: pred.risk_probability || 0, label: pred.risk_level || "Low" };
            });
          })
          .catch(() => {})
      )
    ).then(() => { _cachedRisk = results; setRiskData(results); });
  }, [geoData]);

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
      layers: [
        new GeoJsonLayer({
          id: "zip-risk-zones",
          data: enriched,
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 0.5,
          getLineColor: [255, 255, 255, 120],
          getLineWidth: 0.5,
          getFillColor: (f: any) => getRiskColor(f.properties.risk_score || 0),
          onClick: (info: any) => {
            if (onZoneClick && info.object) {
              const zip = info.object.properties?.zip || "";
              const score = info.object.properties?.risk_score || 0;
              const label = info.object.properties?.risk_label || "Low";
              onZoneClick(`ZIP ${zip}`, { risk_score: score, label });
            }
          },
          updateTriggers: { getFillColor: [Object.keys(riskData).length] },
        }),
      ],
    });

    overlay.setMap(map);
    overlayRef.current = overlay;
    return () => { if (overlayRef.current) { overlayRef.current.setMap(null); overlayRef.current.finalize(); overlayRef.current = null; } };
  }, [map, geoData, riskData, onZoneClick]);

  if (loading) return null;
  return null;
}
