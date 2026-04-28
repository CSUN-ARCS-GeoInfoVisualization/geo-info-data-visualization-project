"""
Live Keetch-Byram Drought Index for the inference path.

Fetches the past ~30 days of daily max temperature and precipitation from
NASA POWER's daily endpoint (the same source used to enrich the training
set), looks up the location's mean annual rainfall (R) from the on-disk
cache populated by `ml/build_r_cache.py`, and runs the KBDI iteration.
R cache misses are computed on the fly and written back so the cache
warms naturally as new locations are queried.

Using POWER for both training enrichment and live inference avoids a
training/inference data-source mismatch -- POWER (MERRA-2) and ERA5
report measurably different daily precip and T_max in CA's complex
terrain, and KBDI's 30-day cumulative integral compounds those differences.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import requests

from ml.kbdi import kbdi_final, c_to_f, mm_to_in
from ml.build_r_cache import fetch_30yr_precip_inches, _key as r_key


_R_CACHE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "ml", "training_data", "r_cache.json",
)

_POWER_DAILY_URL  = "https://power.larc.nasa.gov/api/temporal/daily/point"
_POWER_FILL       = -999.0
_POWER_LAG_DAYS   = 3      # POWER daily data is reliably available with ~2-3 day lag
_KBDI_SPINUP_DAYS = 30
_R_FALLBACK_IN    = 18.0   # CA-wide median; only used if R fetch fails entirely

_r_cache_lock = threading.Lock()
_r_cache_mem: dict[str, float] | None = None


# ---------------------------------------------------------------------------
# R cache (on-disk + in-memory, lazy-loaded, write-through on miss)
# ---------------------------------------------------------------------------

def _load_r_cache() -> dict[str, float]:
    """Lazy-load the on-disk R cache into memory. Thread-safe via double-check."""
    global _r_cache_mem
    if _r_cache_mem is not None:
        return _r_cache_mem
    with _r_cache_lock:
        if _r_cache_mem is None:
            try:
                with open(_R_CACHE_PATH) as f:
                    _r_cache_mem = json.load(f)
            except (OSError, json.JSONDecodeError):
                _r_cache_mem = {}
    return _r_cache_mem


def _persist_r_cache() -> None:
    """Atomic write of the in-memory cache to disk. Caller holds _r_cache_lock."""
    cache = _r_cache_mem if _r_cache_mem is not None else {}
    tmp = _R_CACHE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cache, f, indent=2, sort_keys=True)
    os.replace(tmp, _R_CACHE_PATH)


def _r_for(lat: float, lon: float) -> float:
    """Look up R for a location; compute and cache on miss."""
    cache = _load_r_cache()
    key   = r_key(lat, lon)
    r     = cache.get(key)
    if r is not None:
        return r

    r = fetch_30yr_precip_inches(lat, lon)
    if r is None:
        return _R_FALLBACK_IN

    with _r_cache_lock:
        cache[key] = round(r, 3)
        try:
            _persist_r_cache()
        except OSError:
            pass  # in-memory write still succeeded; disk persistence will retry later
    return r


# ---------------------------------------------------------------------------
# 30-day weather window
# ---------------------------------------------------------------------------

def _fetch_30day_weather(lat: float, lon: float) -> list[tuple[float, float]]:
    """
    Fetch the past _KBDI_SPINUP_DAYS days of daily max temperature and
    precipitation from NASA POWER. Returns a chronological list of
    (T_max_F, precip_inches).

    The window ends `_POWER_LAG_DAYS` before today because POWER's daily
    endpoint backfills with a 2-3 day delay. KBDI is a 30-day cumulative
    index, so a few-day shift on the trailing edge is immaterial.
    """
    end   = datetime.now(timezone.utc).date() - timedelta(days=_POWER_LAG_DAYS)
    start = end - timedelta(days=_KBDI_SPINUP_DAYS - 1)

    params = {
        "parameters": "T2M_MAX,PRECTOTCORR",
        "community":  "AG",
        "latitude":   lat,
        "longitude":  lon,
        "start":      start.strftime("%Y%m%d"),
        "end":        end.strftime("%Y%m%d"),
        "format":     "JSON",
    }

    last_err: Exception | None = None
    for attempt in range(3):
        try:
            resp = requests.get(_POWER_DAILY_URL, params=params, timeout=20)
            if resp.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            resp.raise_for_status()
            payload = resp.json() or {}
            param   = payload.get("properties", {}).get("parameter", {})
            tmax_d  = param.get("T2M_MAX")     or {}
            prec_d  = param.get("PRECTOTCORR") or {}
            if not tmax_d or not prec_d:
                raise ValueError("incomplete POWER payload")

            series: list[tuple[float, float]] = []
            for ymd in sorted(tmax_d.keys()):
                t_c = tmax_d.get(ymd)
                p_mm = prec_d.get(ymd)
                if t_c is None or p_mm is None:
                    continue
                if t_c == _POWER_FILL or p_mm == _POWER_FILL:
                    continue
                series.append((c_to_f(float(t_c)), mm_to_in(float(p_mm))))

            if len(series) < _KBDI_SPINUP_DAYS // 2:
                raise ValueError(f"too few valid days returned ({len(series)})")
            return series

        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            last_err = e
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
        except Exception as e:
            last_err = e
            if attempt < 2:
                time.sleep(2 * (attempt + 1))

    raise RuntimeError(f"NASA POWER 30-day fetch failed: {last_err}")


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------

def get_kbdi(lat: float, lon: float) -> float:
    """
    Return the current Keetch-Byram Drought Index (0-800) for the given
    coordinates. Raises on network/data failure -- caller is expected to
    fall back to a sample-location value, matching the pattern used by
    get_weather / get_elevation / get_evi.
    """
    series = _fetch_30day_weather(lat, lon)
    r      = _r_for(lat, lon)
    return float(kbdi_final(series, r_annual_in=r, initial_kbdi=100.0))
