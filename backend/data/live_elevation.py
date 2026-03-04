"""
Live elevation data fetched from Open-Elevation (https://open-elevation.com/).
Free API — no key required.
"""

import requests

_OPEN_ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup"


def get_elevation(lat: float, lon: float) -> float:
    """
    Fetch terrain elevation (meters) for the given coordinates.
    """
    params = {"locations": f"{lat},{lon}"}

    response = requests.get(_OPEN_ELEVATION_URL, params=params, timeout=5)
    response.raise_for_status()

    data = response.json()
    return float(data["results"][0]["elevation"])
