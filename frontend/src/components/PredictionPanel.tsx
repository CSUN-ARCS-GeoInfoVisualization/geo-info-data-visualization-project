import React, { useState } from "react";
import { predictSingle } from "../services/PredictionService.js";

const LOCATIONS = [
  { name: "High Sierra — Mountain Ridge",       lat: 37.5200, lon: -119.2700 },
  { name: "Coastal San Francisco",              lat: 37.7749, lon: -122.4194 },
  { name: "Sacramento Valley",                  lat: 38.5816, lon: -121.4944 },
  { name: "Los Angeles Foothills",              lat: 34.1900, lon: -118.1300 },
  { name: "San Diego Backcountry",              lat: 32.9000, lon: -116.7000 },
  { name: "NorCal Fire Zone — Trinity County",  lat: 41.1875, lon: -123.4208 },
  { name: "Altadena — Bobcat Fire Origin",      lat: 34.2375, lon: -118.0958 },
  { name: "Dry Mountain Chaparral — Peak Season", lat: 34.5000, lon: -118.5000 },
  { name: "Ventura — Thomas Fire Area (High Risk)", lat: 34.3500, lon: -119.2000 },
];

const RISK_COLORS: Record<string, string> = {
  Low:     "#16a34a",
  Medium:  "#ca8a04",
  High:    "#dc2626",
  Extreme: "#7c3aed",
};

export default function PredictionPanel() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = LOCATIONS[selectedIndex];

  async function handlePredict() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await predictSingle(selected.lat, selected.lon, null);
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? "Prediction failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: "1rem", background: "#f6f6f6", borderRadius: "8px", maxWidth: "420px" }}>
      <h3 style={{ fontWeight: "bold", marginBottom: "0.75rem" }}>Wildfire Risk Prediction</h3>

      {/* Location selector */}
      <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem", color: "#555" }}>
        Select location
      </label>
      <select
        value={selectedIndex}
        onChange={e => { setSelectedIndex(Number(e.target.value)); setResult(null); }}
        style={{
          width: "100%",
          padding: "6px 8px",
          borderRadius: "6px",
          border: "1px solid #ccc",
          marginBottom: "0.5rem",
          fontSize: "0.9rem",
        }}
      >
        {LOCATIONS.map((loc, i) => (
          <option key={i} value={i}>{loc.name}</option>
        ))}
      </select>

      {/* Coordinates display */}
      <p style={{ fontSize: "0.8rem", color: "#666", marginBottom: "0.75rem" }}>
        lat {selected.lat}, lon {selected.lon}
      </p>

      <button
        onClick={handlePredict}
        disabled={loading}
        style={{
          padding: "8px 16px",
          background: loading ? "#555" : "black",
          color: "white",
          borderRadius: "6px",
          cursor: loading ? "not-allowed" : "pointer",
          fontSize: "0.9rem",
        }}
      >
        {loading ? "Running…" : "Run Prediction"}
      </button>

      {error && (
        <p style={{ marginTop: "0.75rem", color: "#dc2626", fontSize: "0.85rem" }}>{error}</p>
      )}

      {result && (
        <div style={{ marginTop: "1rem", padding: "0.75rem", background: "white", borderRadius: "6px", border: "1px solid #ddd" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <span style={{
              background: RISK_COLORS[result.prediction.risk_level] ?? "#333",
              color: "white",
              padding: "2px 10px",
              borderRadius: "999px",
              fontWeight: "bold",
              fontSize: "0.85rem",
            }}>
              {result.prediction.risk_level}
            </span>
            <span style={{ fontWeight: "bold", fontSize: "1rem" }}>
              {Math.round(result.prediction.risk_probability * 100)}% risk
            </span>
          </div>

          <p style={{ fontSize: "0.8rem", color: "#555", marginBottom: "0.2rem" }}>
            Matched: {result.location.matched_name}
          </p>
          <p style={{ fontSize: "0.75rem", color: "#888" }}>
            Model: {result.model.version}
          </p>
        </div>
      )}
    </div>
  );
}
