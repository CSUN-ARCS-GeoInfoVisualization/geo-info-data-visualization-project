"""
Wildfire Risk Inference Module

Loads the trained RandomForest model and runs inference given pre-extracted
feature values.

Feature order (must match training): EVI, air_temp_encoded, Wind, Humidity, Elevation
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
    if score < 0.25:
        return "Low"
    elif score < 0.50:
        return "Medium"
    elif score < 0.75:
        return "High"
    else:
        return "Extreme"


def predict_from_features(
    evi: float,
    air_temp_encoded: float,
    wind: float,
    humidity: float,
    elevation: float,
    model_path: str = _DEFAULT_MODEL,
    scaler_path: str = _DEFAULT_SCALER,
) -> dict:
    model, scaler = _load(model_path, scaler_path)

    features        = np.array([[evi, air_temp_encoded, wind, humidity, elevation]])
    features_scaled = scaler.transform(features)

    risk_score = float(model.predict_proba(features_scaled)[0][1])
    label      = risk_label(risk_score)

    return {
        "evi":              evi,
        "air_temp_encoded": air_temp_encoded,
        "wind":             wind,
        "humidity":         humidity,
        "elevation":        elevation,
        "risk_score":       risk_score,
        "label":            label,
    }


def predict_batch_features(items: list[tuple[float, float, float, float, float]]) -> list[dict]:
    """Predict risk for multiple locations at once. Much faster than calling predict_from_features in a loop.

    Args:
        items: list of (evi, air_temp_encoded, wind, humidity, elevation) tuples
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
