"""Independent second-source weather, used ONLY by the training ingest cron for
cross-source corroboration — never by the live prediction path, so it cannot
affect website latency.

The primary source is Open-Meteo (data/live_weather.py). This module fetches the
same current variables (air temperature °C, relative humidity %, wind speed m/s)
from MET Norway (the Norwegian Meteorological Institute) — a genuinely
independent provider, free and key-less. Comparing the two catches a
plausible-but-wrong value from one provider that range/outlier checks can't see.

Fail-open by design: if the second source errors, we return None and the caller
keeps the row (a flaky CHECK must never throw away otherwise-valid data).
"""
import requests

_METNO_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact"
# MET Norway's terms require an identifying User-Agent.
_HEADERS = {
    "User-Agent": "FireScope/1.0 github.com/CSUN-ARCS-GeoInfoVisualization (ido.the.cohen@gmail.com)"
}


def get_weather_second(lat: float, lon: float):
    """Return {wind_speed, temperature_celsius, humidity} from MET Norway for the
    current hour, or None on any failure (fail-open). Units match get_weather:
    wind m/s, temp °C, humidity %.

    Single attempt with a short timeout ON PURPOSE: this is a best-effort
    corroboration check inside the time-budgeted ingest job, so it must never
    block. A slow/failed second source just means the row skips the check and is
    kept — it must not eat the ingest budget with retries."""
    # MET Norway asks clients to truncate coordinates to <= 4 decimals.
    params = {"lat": round(float(lat), 4), "lon": round(float(lon), 4)}
    try:
        r = requests.get(_METNO_URL, params=params, headers=_HEADERS, timeout=6)
        r.raise_for_status()
        series = r.json()["properties"]["timeseries"]
        if not series:
            return None
        d = series[0]["data"]["instant"]["details"]
        return {
            "wind_speed":          float(d["wind_speed"]),
            "temperature_celsius": float(d["air_temperature"]),
            "humidity":            float(d["relative_humidity"]),
        }
    except Exception:
        return None
