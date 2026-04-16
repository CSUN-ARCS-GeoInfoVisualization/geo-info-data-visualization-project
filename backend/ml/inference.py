"""
Wildfire Risk Inference Module

Loads the trained predictive model and runs inference given pre-extracted
feature values. No external API calls or GeoTIFF files are required —
features are passed in directly.

Feature order (must match training): EVI, LST, Wind, Elevation

Feature descriptions:
    EVI       — Enhanced Vegetation Index (raw MODIS pixel value)
    LST       — Land Surface Temperature encoded as (T_celsius + 273.15) / 0.02
    Wind      — Wind speed at 10 m in m/s
    Elevation — Average terrain elevation in meters
"""

import os
import numpy as np
import joblib

_MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
_DEFAULT_MODEL = os.path.join(_MODELS_DIR, "wildfire_model_predictive.pkl")
_DEFAULT_SCALER = os.path.join(_MODELS_DIR, "wildfire_scaler_predictive.pkl")

# Load model and scaler ONCE at module import time
_model = None
_scaler = None


def _ensure_loaded():
    global _model, _scaler
    if _model is None:
        _model = joblib.load(_DEFAULT_MODEL)
        _scaler = joblib.load(_DEFAULT_SCALER)


def risk_label(score: float) -> str:
    """Map a 0–1 probability score to a human-readable risk level."""
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
    lst: float,
    wind: float,
    elevation: float,
    model_path: str = _DEFAULT_MODEL,
    scaler_path: str = _DEFAULT_SCALER,
) -> dict:
    _ensure_loaded()

    features = np.array([[evi, lst, wind, elevation]])
    features_scaled = _scaler.transform(features)
    risk_score = float(_model.predict_proba(features_scaled)[0][1])
    label = risk_label(risk_score)

    return {
        "evi": evi,
        "lst": lst,
        "wind": wind,
        "elevation": elevation,
        "risk_score": risk_score,
        "label": label,
    }


def predict_batch_features(items: list[tuple[float, float, float, float]]) -> list[dict]:
    """Predict risk for multiple locations at once. Much faster than calling predict_from_features in a loop.

    Args:
        items: list of (evi, lst, wind, elevation) tuples
    Returns:
        list of dicts with risk_score and label
    """
    _ensure_loaded()
    if not items:
        return []
    features = np.array(items)
    features_scaled = _scaler.transform(features)
    probas = _model.predict_proba(features_scaled)[:, 1]
    return [
        {"risk_score": float(p), "label": risk_label(float(p))}
        for p in probas
    ]
