"""
Wildfire Risk Inference Module

Loads the trained RandomForest model and runs inference given pre-extracted
feature values.

Feature order (must match training): EVI, LST, Wind, Humidity, Elevation
"""

import os
import numpy as np
import joblib

_MODELS_DIR     = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
_DEFAULT_MODEL  = os.path.join(_MODELS_DIR, "wildfire_model_predictive.pkl")
_DEFAULT_SCALER = os.path.join(_MODELS_DIR, "wildfire_scaler_predictive.pkl")


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
    lst: float,
    wind: float,
    humidity: float,
    elevation: float,
    model_path: str = _DEFAULT_MODEL,
    scaler_path: str = _DEFAULT_SCALER,
) -> dict:
    """
    Run wildfire risk inference from pre-extracted feature values.

    Args:
        evi:       Enhanced Vegetation Index (raw MODIS value)
        lst:       Land Surface Temperature encoded: (T_celsius + 273.15) / 0.02
        wind:      Wind speed in m/s
        humidity:  Relative humidity in % (0–100)
        elevation: Terrain elevation in meters

    Returns:
        dict with keys: evi, lst, wind, humidity, elevation, risk_score, label
    """
    scaler = joblib.load(scaler_path)
    model  = joblib.load(model_path)

    features        = np.array([[evi, lst, wind, humidity, elevation]])
    features_scaled = scaler.transform(features)

    risk_score = float(model.predict_proba(features_scaled)[0][1])
    label      = risk_label(risk_score)

    return {
        "evi":       evi,
        "lst":       lst,
        "wind":      wind,
        "humidity":  humidity,
        "elevation": elevation,
        "risk_score": risk_score,
        "label":     label,
    }
