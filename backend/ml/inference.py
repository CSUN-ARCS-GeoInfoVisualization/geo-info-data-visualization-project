"""
Wildfire Risk Inference Module

Loads the trained RandomForest model and runs inference given pre-extracted
feature values.

Feature order (must match training): EVI, air_temp_encoded, Wind, Humidity,
Elevation, KBDI.
"""

import os
import numpy as np
import joblib

_MODELS_DIR     = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
_DEFAULT_MODEL  = os.path.join(_MODELS_DIR, "wildfire_model_predictive.pkl")
_DEFAULT_SCALER = os.path.join(_MODELS_DIR, "wildfire_scaler_predictive.pkl")

# Module-level cache: keyed by (model_path, scaler_path) so swapping models works
_cache: dict[tuple[str, str], tuple] = {}


def _load(model_path: str, scaler_path: str) -> tuple:
    key = (model_path, scaler_path)
    if key not in _cache:
        _cache[key] = (joblib.load(model_path), joblib.load(scaler_path))
    return _cache[key]


def risk_label(score: float) -> str:
    """Canonical 9-tier label. Cutoffs mirror the frontend's lib/riskTiers.ts
    and backend/routes/locations.py _TIER_THRESHOLDS so polygon colors,
    legend swatches, badge text, and alert email subjects all agree.

    Was 4-tier (0.25 / 0.50 / 0.75) which made e.g. LA County at risk_score
    0.506 render as 'High' on the map and 'Low' in the side panel — same
    score, different label, because the side panel used the 9-tier scale.
    """
    if score >= 0.95: return "Catastrophic"
    if score >= 0.90: return "Critical"
    if score >= 0.85: return "Extreme"
    if score >= 0.80: return "Severe"
    if score >= 0.75: return "Very High"
    if score >= 0.70: return "High"
    if score >= 0.65: return "Elevated"
    if score >= 0.55: return "Guarded"
    return "Low"


def predict_from_features(
    evi: float,
    air_temp_encoded: float,
    wind: float,
    humidity: float,
    elevation: float,
    kbdi: float,
    model_path: str = _DEFAULT_MODEL,
    scaler_path: str = _DEFAULT_SCALER,
) -> dict:
    model, scaler = _load(model_path, scaler_path)

    features        = np.array([[evi, air_temp_encoded, wind, humidity, elevation, kbdi]])
    features_scaled = scaler.transform(features)

    risk_score = float(model.predict_proba(features_scaled)[0][1])
    label      = risk_label(risk_score)

    return {
        "evi":              evi,
        "air_temp_encoded": air_temp_encoded,
        "wind":             wind,
        "humidity":         humidity,
        "elevation":        elevation,
        "kbdi":             kbdi,
        "risk_score":       risk_score,
        "label":            label,
    }


def predict_batch_features(items: list[tuple[float, float, float, float, float, float]]) -> list[dict]:
    """Predict risk for multiple locations at once. Much faster than calling predict_from_features in a loop.

    Args:
        items: list of (evi, air_temp_encoded, wind, humidity, elevation, kbdi) tuples
    Returns:
        list of dicts with risk_score and label
    """
    if not items:
        return []
    model, scaler = _load(_DEFAULT_MODEL, _DEFAULT_SCALER)
    features = np.array(items)
    features_scaled = scaler.transform(features)
    probas = model.predict_proba(features_scaled)[:, 1]
    return [
        {"risk_score": float(p), "label": risk_label(float(p))}
        for p in probas
    ]
