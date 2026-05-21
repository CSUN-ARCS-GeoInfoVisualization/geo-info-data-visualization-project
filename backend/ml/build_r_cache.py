"""
Build a per-location mean-annual-precipitation (R) cache for KBDI computation.

Reads the unique (lat, lon) pairs from the training CSV, queries NASA POWER's
precomputed climatology endpoint (MERRA-2 backed, 1991-2020 WMO standard
period, free, no key), and writes a JSON cache file that the dataset
enrichment step and live inference path both consume.

NASA POWER returns the climatological annual mean directly in a single small
response per location, so this is fast (~1 s/location) and not subject to
the kind of payload-driven throttling we see when pulling 30 years of daily
records from a reanalysis archive.

Resume-safe: existing entries in r_cache.json are skipped, so an interrupted
run can be resumed by re-invoking. Crashes mid-run cost at most one location.

Run from backend/:
    python -m ml.build_r_cache
"""

import csv
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import requests


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
# WMO climatological standard period (1991-2020). NASA POWER serves a
# precomputed annual normal for this exact range when start/end are given.
WMO_START_YEAR = 1991
WMO_END_YEAR   = 2020
WMO_YEARS      = WMO_END_YEAR - WMO_START_YEAR + 1

POWER_URL    = "https://power.larc.nasa.gov/api/temporal/climatology/point"
POWER_FILL   = -999.0   # POWER's missing-value sentinel
WORKERS      = 8        # POWER tolerates this comfortably; payload is tiny
CHECKPOINT_EVERY = 25   # persist cache to disk every N successful fetches

_DIR        = os.path.dirname(os.path.abspath(__file__))
_DATA_PATH  = os.path.join(_DIR, "training_data", "california_2020.csv")
_CACHE_PATH = os.path.join(_DIR, "training_data", "r_cache.json")


def _key(lat: float, lon: float) -> str:
    """Cache key. Round to 4 decimal places (~11 m) -- climatological R doesn't
    vary meaningfully below this scale and rounding lets us reuse the same R
    for nearly-coincident points."""
    return f"{round(lat, 4)},{round(lon, 4)}"


def unique_latlons(csv_path: str) -> list[tuple[float, float]]:
    seen: set[tuple[float, float]] = set()
    points: list[tuple[float, float]] = []
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            try:
                lat = round(float(row["lat"]), 4)
                lon = round(float(row["lon"]), 4)
            except (KeyError, ValueError):
                continue
            if (lat, lon) not in seen:
                seen.add((lat, lon))
                points.append((lat, lon))
    return points


def fetch_30yr_precip_inches(lat: float, lon: float) -> float | None:
    """
    Fetch the 1991-2020 climatological annual-mean precipitation for a
    point from NASA POWER and return it in inches per year. Returns None
    on failure or fill-value response.

    POWER returns PRECTOTCORR.ANN as a daily mean in mm/day for the
    requested climatology period, so annual total = ANN * 365.25.
    """
    params = {
        "parameters": "PRECTOTCORR",
        "community":  "AG",
        "latitude":   lat,
        "longitude":  lon,
        "format":     "JSON",
        "start":      str(WMO_START_YEAR),
        "end":        str(WMO_END_YEAR),
    }

    for attempt in range(4):
        try:
            resp = requests.get(POWER_URL, params=params, timeout=30)
            if resp.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            resp.raise_for_status()
            data = resp.json() or {}
            ann = (
                data.get("properties", {})
                    .get("parameter", {})
                    .get("PRECTOTCORR", {})
                    .get("ANN")
            )
            if ann is None or ann == POWER_FILL:
                return None
            mm_per_year = float(ann) * 365.25
            return mm_per_year / 25.4

        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            time.sleep(3 * (attempt + 1))
        except Exception:
            return None
    return None


def load_cache() -> dict[str, float]:
    if not os.path.exists(_CACHE_PATH):
        return {}
    try:
        with open(_CACHE_PATH) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_cache(cache: dict[str, float]) -> None:
    tmp = _CACHE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cache, f, indent=2, sort_keys=True)
    os.replace(tmp, _CACHE_PATH)


def build():
    if not os.path.exists(_DATA_PATH):
        print(f"ERROR: training CSV not found at {_DATA_PATH}", file=sys.stderr)
        sys.exit(1)

    points = unique_latlons(_DATA_PATH)
    cache  = load_cache()
    todo   = [pt for pt in points if _key(*pt) not in cache]

    print(f"Locations in dataset : {len(points):,}")
    print(f"Already in cache     : {len(points) - len(todo):,}")
    print(f"To fetch             : {len(todo):,}")
    print(f"Window               : {WMO_START_YEAR}-{WMO_END_YEAR} ({WMO_YEARS} years)")
    print()

    if not todo:
        print("Nothing to do.")
        return

    started = datetime.now()
    failed  = 0
    completed_since_save = 0

    # Workers fetch in parallel; only the main thread writes to `cache` to keep
    # the JSON write atomic and avoid races.
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {
            executor.submit(fetch_30yr_precip_inches, lat, lon): (lat, lon)
            for lat, lon in todo
        }
        for i, future in enumerate(as_completed(futures), 1):
            lat, lon = futures[future]
            try:
                r = future.result()
            except Exception:
                r = None

            if r is None:
                failed += 1
                print(f"  [{i}/{len(todo)}] ({lat:.4f}, {lon:.4f}) -- FAILED")
                continue

            cache[_key(lat, lon)] = round(r, 3)
            completed_since_save += 1
            print(f"  [{i}/{len(todo)}] ({lat:.4f}, {lon:.4f}) -- R = {r:6.2f} in/yr")

            if completed_since_save >= CHECKPOINT_EVERY:
                save_cache(cache)
                completed_since_save = 0

    save_cache(cache)
    elapsed = (datetime.now() - started).total_seconds()
    print(f"\nDone. {len(todo) - failed} fetched, {failed} failed in {elapsed:.0f}s.")
    print(f"Cache: {_CACHE_PATH}  ({len(cache)} entries total)")


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    build()
