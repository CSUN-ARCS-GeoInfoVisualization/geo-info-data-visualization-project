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
    """
    Run wildfire risk inference from pre-extracted feature values.

    Args:
        evi:       Enhanced Vegetation Index (raw MODIS value)
        lst:       Land Surface Temperature encoded value: (T_celsius + 273.15) / 0.02
        wind:      Wind speed in m/s
        elevation: Terrain elevation in meters
        model_path:  Path to the trained .pkl model (optional, uses bundled model)
        scaler_path: Path to the fitted .pkl scaler (optional, uses bundled scaler)

    Returns:
        dict with keys: evi, lst, wind, elevation, risk_score, label
    """
    scaler = joblib.load(scaler_path)
    model = joblib.load(model_path)

    features = np.array([[evi, lst, wind, elevation]])
    features_scaled = scaler.transform(features)

    risk_score = float(model.predict_proba(features_scaled)[0][1])
    label = risk_label(risk_score)

    return {
        "evi": evi,
        "lst": lst,
        "wind": wind,
        "elevation": elevation,
        "risk_score": risk_score,
        "label": label,
    }
