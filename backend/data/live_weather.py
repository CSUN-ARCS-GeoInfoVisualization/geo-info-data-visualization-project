"""
Live weather data fetched from Open-Meteo (https://open-meteo.com/).
Free API — no key required.
"""

import time
import requests

_OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


def get_weather(lat: float, lon: float) -> dict:
    """
    Fetch current wind speed (m/s), air temperature (°C), and relative humidity (%)
    for the given coordinates. Retries up to 3 times on network errors.

    Returns dict with keys: wind_speed, temperature_celsius, humidity
    """
    params = {
        "latitude":        lat,
        "longitude":       lon,
        "current":         "wind_speed_10m,temperature_2m,relative_humidity_2m",
        "wind_speed_unit": "ms",
    }

    for attempt in range(3):
        try:
            response = requests.get(_OPEN_METEO_URL, params=params, timeout=8)
            response.raise_for_status()
            data = response.json()
            return {
                "wind_speed":          float(data["current"]["wind_speed_10m"]),
                "temperature_celsius": float(data["current"]["temperature_2m"]),
                "humidity":            float(data["current"]["relative_humidity_2m"]),
            }
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
