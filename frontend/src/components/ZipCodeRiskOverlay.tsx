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
  if (score >= 0.66) return [220, 38, 38, 150];
  if (score >= 0.33) return [234, 179, 8, 130];
  return [34, 197, 94, 110];
}

interface ZoneRisk {
  risk_score: number;
  label: string;
  features?: { evi: number; lst: number; wind: number; elevation: number };
}
interface Props {
  onZoneClick?: (zip: string, risk: ZoneRisk) => void;
}

let _cachedGeo: any = null;
let _cachedRisk: Record<string, ZoneRisk> = {};

export function ZipCodeRiskOverlay({ onZoneClick }: Props) {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const riskDataRef = useRef<Record<string, ZoneRisk>>(_cachedRisk);
  const onClickRef = useRef(onZoneClick);
  const [geoData, setGeoData] = useState<any>(_cachedGeo);
  const [riskData, setRiskData] = useState(_cachedRisk);

  useEffect(() => { onClickRef.current = onZoneClick; }, [onZoneClick]);
  useEffect(() => { riskDataRef.current = riskData; }, [riskData]);

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

  // Create overlay once per map
  useEffect(() => {
    if (!map) return;
    const overlay = new GoogleMapsOverlay({ layers: [] });
    overlay.setMap(map);
    overlayRef.current = overlay;
    return () => { overlay.setMap(null); overlay.finalize(); overlayRef.current = null; };
  }, [map]);

  // Swap layers in-place when data changes
  useEffect(() => {
    if (!overlayRef.current || !geoData?.features || Object.keys(riskData).length === 0) return;
    const enriched = {
      ...geoData,
      features: geoData.features.map((f: any) => {
        const zip = f.properties?.zip || "";
        const risk = riskData[zip] || { risk_score: 0, label: "Low" };
        return { ...f, properties: { ...f.properties, risk_score: risk.risk_score, risk_label: risk.label } };
      }),
    };
    overlayRef.current.setProps({
      layers: [new GeoJsonLayer({
        id: "zip-risk-zones",
        data: enriched,
        pickable: true, stroked: true, filled: true,
        lineWidthMinPixels: 0.5,
        getLineColor: [255, 255, 255, 120],
        getLineWidth: 0.5,
        getFillColor: (f: any) => getRiskColor(f.properties.risk_score || 0),
        onClick: (info: any) => {
          const cb = onClickRef.current;
          if (cb && info.object) {
            const zip = info.object.properties?.zip || "";
            const r = riskDataRef.current[zip];
            cb(`ZIP ${zip}`, {
              risk_score: r?.risk_score ?? info.object.properties?.risk_score ?? 0,
              label: r?.label ?? info.object.properties?.risk_label ?? "Low",
              features: r?.features,
            });
          }
        },
        updateTriggers: { getFillColor: [Object.keys(riskData).length] },
      })],
    });
  }, [geoData, riskData]);

  return null;
}
