"""Unified feature-lookup router.

`get_feature(lat, lon, key)` returns a single feature value using a layered
fallback chain so the model never starves:

    1. DB tile cache (where applicable: elevation, EVI)
    2. Live source per feature:
         elevation → USGS 3DEP → Open-Elevation     (data/live_elevation.py)
         evi       → GEE MODIS MOD13Q1              (data/live_evi_gee.py)
         wind, humidity, air_temp_encoded → Open-Meteo (data/live_weather.py)
         kbdi      → live KBDI fetcher              (data/live_kbdi.py — Sania's branch)
    3. IDW interpolation across SAMPLE_LOCATIONS    (the prior default, now last resort)

Callers should use get_feature instead of touching the underlying modules
directly so the fallback chain stays consistent.
"""
from __future__ import annotations

import logging

from data.sample_locations import SAMPLE_LOCATIONS

logger = logging.getLogger(__name__)

VALID_KEYS = {"evi", "elevation", "wind", "humidity", "air_temp_encoded", "kbdi"}


def _idw(lat: float, lon: float, key: str) -> float:
    """Inverse-distance-weighted interpolation across SAMPLE_LOCATIONS — safety net."""
    if not SAMPLE_LOCATIONS or key not in SAMPLE_LOCATIONS[0]:
        return 0.0
    total_w = 0.0
    weighted = 0.0
    for loc in SAMPLE_LOCATIONS:
        d = ((lat - loc["lat"]) ** 2 + (lon - loc["lon"]) ** 2) ** 0.5
        if d < 0.001:
            return float(loc[key])
        w = 1.0 / (d ** 2)
        weighted += w * loc[key]
        total_w += w
    return weighted / total_w if total_w else 0.0


def get_feature(lat: float, lon: float, key: str) -> float:
    """Return a feature value at (lat, lon). Never raises; falls back to IDW."""
    if key not in VALID_KEYS:
        raise ValueError(f"unknown feature key: {key}")

    try:
        if key == "elevation":
            from data.live_elevation import get_elevation
            return float(get_elevation(lat, lon))

        if key == "evi":
            from data.live_evi_gee import get_evi_live
            return float(get_evi_live(lat, lon))

        if key in ("wind", "humidity", "air_temp_encoded"):
            from data.live_weather import get_weather
            w = get_weather(lat, lon)
            if key == "wind":
                return float(w["wind_speed"])
            if key == "humidity":
                return float(w["humidity"])
            return (float(w["temperature_celsius"]) + 273.15) / 0.02

        if key == "kbdi":
            try:
                from data.live_kbdi_cached import get_kbdi_cached
                return float(get_kbdi_cached(lat, lon))
            except ImportError:
                logger.debug("live_kbdi_cached not available — falling back to IDW for kbdi")
                return _idw(lat, lon, "kbdi")
    except Exception as e:
        logger.warning("live %s lookup failed at %s,%s: %s — falling back to IDW", key, lat, lon, e)

    return _idw(lat, lon, key)
