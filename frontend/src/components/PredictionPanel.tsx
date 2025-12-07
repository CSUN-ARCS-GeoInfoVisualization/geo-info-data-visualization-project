import React, { useState } from "react";
import { predictSingle } from "../services/PredictionService.js";


export default function PredictionPanel() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function handlePredict() {
    setLoading(true);
    const data = await predictSingle(34.25, -118.5, "2025-06-01");
    setResult(data);
    setLoading(false);
  }

  return (
    <div style={{ padding: "1rem", background: "#f6f6f6", borderRadius: "8px" }}>
      <button
        onClick={handlePredict}
        style={{
          padding: "8px 12px",
          background: "black",
          color: "white",
          borderRadius: "6px",
        }}
      >
        Run Prediction
      </button>

      {loading && <p>Loading...</p>}

      {result && (
        <div className="mt-4 p-4 bg-gray-100 rounded">
          <h3 className="font-bold text-lg">Prediction Result</h3>
          <p>Risk Level: <strong>{result.prediction.risk_level}</strong></p>
          <p>Probability: {Math.round(result.prediction.risk_probability * 100)}%</p>
          <p>Model Version: {result.model.version}</p>
        </div>
      )}

    </div>
  );
}
