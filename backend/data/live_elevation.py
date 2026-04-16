"""
Live elevation data fetched from Open-Elevation (https://open-elevation.com/).
Free API — no key required.
"""

import time
import requests

_OPEN_ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup"


def get_elevation(lat: float, lon: float) -> float:
    """
    Fetch terrain elevation (meters) for the given coordinates.
    Retries up to 3 times on network errors before raising.
    """
    params = {"locations": f"{lat},{lon}"}

    for attempt in range(3):
        try:
            response = requests.get(_OPEN_ELEVATION_URL, params=params, timeout=8)
            response.raise_for_status()
            return float(response.json()["results"][0]["elevation"])
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
