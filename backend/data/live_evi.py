"""
Live EVI (Enhanced Vegetation Index) from NASA ORNL DAAC MODIS Web Service.
Product: MOD13Q1 (16-day composite, 250m resolution)
Free API — no key required.
"""

import requests
from datetime import datetime, timedelta

_ORNL_DAAC_URL = "https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset"

# MODIS EVI valid range — values outside this are fill/error values
_EVI_MIN = -2000
_EVI_MAX = 10000


def _modis_date(dt: datetime) -> str:
    """Convert a datetime to MODIS date format: AYYYY + 3-digit day-of-year."""
    return f"A{dt.year}{dt.timetuple().tm_yday:03d}"


def get_evi(lat: float, lon: float) -> float:
    """
    Fetch the most recent MODIS EVI raw pixel value for the given coordinates.

    Returns the raw integer value matching the model's training encoding
    (scale factor 0.0001, so 800 = EVI of 0.08).

    Looks back 60 days to account for MODIS processing delay and cloud cover gaps.
    """
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=60)

    params = {
        "latitude": lat,
        "longitude": lon,
        "band": "250m_16_days_EVI",
        "startDate": _modis_date(start_date),
        "endDate": _modis_date(end_date),
        "kmAboveBelow": 0,
        "kmLeftRight": 0,
    }

    response = requests.get(_ORNL_DAAC_URL, params=params, timeout=15)
    response.raise_for_status()

    subsets = response.json().get("subset", [])
    if not subsets:
        raise ValueError("No EVI data returned from MODIS")

    # Walk from most recent to oldest, return the first valid value
    for entry in reversed(subsets):
        value = entry["data"][0]
        if _EVI_MIN <= value <= _EVI_MAX:
            return float(value)

    raise ValueError("No valid EVI value found in MODIS response")
