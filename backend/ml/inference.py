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
    """
    Run wildfire risk inference from pre-extracted feature values.

    Args:
        evi:              Enhanced Vegetation Index (scaled, 0–1 range)
        air_temp_encoded: Air temperature encoded as (T_celsius + 273.15) / 0.02.
                          NOT MODIS Land Surface Temperature — derived from Open-Meteo air temp.
        wind:             Wind speed in m/s
        humidity:         Relative humidity in % (0–100)
        elevation:        Terrain elevation in meters

    Returns:
        dict with keys: evi, air_temp_encoded, wind, humidity, elevation, risk_score, label
    """
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
