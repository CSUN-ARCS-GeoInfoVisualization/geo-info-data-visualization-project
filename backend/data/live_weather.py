"""
Live weather data fetched from Open-Meteo (https://open-meteo.com/).
Free API — no key required.
"""

import requests

_OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


def get_weather(lat: float, lon: float) -> dict:
    """
    Fetch current wind speed (m/s) and air temperature (°C) for the given
    coordinates in a single API call.

    Returns dict with keys: wind_speed, temperature_celsius
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "wind_speed_10m,temperature_2m",
        "wind_speed_unit": "ms",
    }

    response = requests.get(_OPEN_METEO_URL, params=params, timeout=5)
    response.raise_for_status()

    data = response.json()
    return {
        "wind_speed": float(data["current"]["wind_speed_10m"]),
        "temperature_celsius": float(data["current"]["temperature_2m"]),
    }