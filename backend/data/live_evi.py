"""
Live EVI (Enhanced Vegetation Index) from NASA ORNL DAAC MODIS Web Service.
Product: MOD13Q1 (16-day composite, 250m resolution)
Free API — no key required.
"""

import time
import requests
from datetime import datetime, timedelta

_ORNL_DAAC_URL = "https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset"

# MODIS EVI raw integer valid range — values outside this are fill/error values
_EVI_MIN = -2000
_EVI_MAX = 10000


def _modis_date(dt: datetime) -> str:
    """Convert a datetime to MODIS date format: AYYYY + 3-digit day-of-year."""
    return f"A{dt.year}{dt.timetuple().tm_yday:03d}"


def get_evi(lat: float, lon: float) -> float:
    """
    Fetch the spring MODIS EVI value (closest composite to May 1) for the given
    coordinates. Uses the prior May 1st to match the spring fuel-load encoding
    used during model training.

    Returns a scaled float (raw integer * 0.0001), matching the AppEEARS
    training data encoding. E.g., raw 800 → 0.08.

    Retries up to 3 times on network errors before raising.
    """
    now = datetime.utcnow()
    # Target the most recent May 1st (prior year if we haven't reached May yet)
    spring_year = now.year if now.month >= 5 else now.year - 1
    spring_target = datetime(spring_year, 5, 1)

    start_date = spring_target - timedelta(days=24)
    end_date   = spring_target + timedelta(days=24)

    params = {
        "latitude":     lat,
        "longitude":    lon,
        "band":         "250m_16_days_EVI",
        "startDate":    _modis_date(start_date),
        "endDate":      _modis_date(end_date),
        "kmAboveBelow": 0,
        "kmLeftRight":  0,
    }

    for attempt in range(3):
        try:
            response = requests.get(_ORNL_DAAC_URL, params=params, timeout=15)
            response.raise_for_status()
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))

    subsets = response.json().get("subset", [])
    if not subsets:
        raise ValueError("No EVI data returned from MODIS")

    # Pick the composite closest to May 1st
    best_value = None
    best_delta = float("inf")
    for entry in subsets:
        value = entry["data"][0]
        if not (_EVI_MIN <= value <= _EVI_MAX):
            continue
        try:
            entry_date = datetime.strptime(entry["calendar_date"], "%Y-%m-%d")
            delta = abs((entry_date - spring_target).days)
            if delta < best_delta:
                best_delta = delta
                best_value = value
        except (KeyError, ValueError):
            continue

    if best_value is None:
        raise ValueError("No valid EVI value found in MODIS response")

    return float(best_value) * 0.0001
