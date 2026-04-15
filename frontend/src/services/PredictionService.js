import { getApiBaseUrl } from "../config/apiBase";

export async function predictSingle(lat, lon, date) {
  const API_URL = getApiBaseUrl();
  if (!API_URL) {
    throw new Error("VITE_API_URL is not configured");
  }
  const response = await fetch(`${API_URL}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon, date }),
  });

  if (!response.ok) {
    throw new Error(`Prediction request failed (${response.status})`);
  }

  return await response.json();
}

export async function predictBatch(items) {
  const API_URL = getApiBaseUrl();
  if (!API_URL) {
    throw new Error("VITE_API_URL is not configured");
  }
  const response = await fetch(`${API_URL}/predict/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    throw new Error(`Batch request failed (${response.status})`);
  }

  return await response.json();
}
