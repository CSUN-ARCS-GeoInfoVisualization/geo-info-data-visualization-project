"""
Build a labeled wildfire training dataset.

Pipeline:
  1. Download MODIS fire detections for California 2020 from NASA FIRMS.
  2. Generate random no-fire points across California far from any fire.
  3. Fetch EVI for all points in one batch via NASA AppEEARS
     (MOD13Q1.061 — 16-day composite, 250 m).
  4. Fetch weather (wind, humidity, temperature) from Open-Meteo historical.
  5. Fetch elevation from Open-Elevation.
  6. Save to ml/training_data/california_2020.csv with per-row checkpointing.

Prerequisites:
  Set environment variables before running:
    EARTHDATA_USERNAME=<your NASA Earthdata username>
    EARTHDATA_PASSWORD=<your NASA Earthdata password>
  Register free at https://urs.earthdata.nasa.gov

Run from backend/:
    python -m ml.build_dataset
"""

import base64
import csv
import io
import math
import os
import random
import sys
import time
from datetime import datetime, timedelta

import numpy as np
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
RANDOM_SEED      = 42
N_FIRE           = 500
N_NOFIRE         = 500
MIN_FIRE_DIST    = 0.5       # degrees (~55 km) minimum separation for no-fire pts
CHECKPOINT_EVERY = 25

CA_LAT_MIN, CA_LAT_MAX = 32.5, 42.0
CA_LON_MIN, CA_LON_MAX = -124.5, -114.0

_DIR    = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(_DIR, "training_data")
OUT_CSV = os.path.join(OUT_DIR, "california_2020.csv")

CSV_COLS = ["lat", "lon", "acq_date", "evi", "lst", "wind", "humidity", "elevation", "fire"]

APPEEARS_URL = "https://appeears.earthdatacloud.nasa.gov/api"

# ---------------------------------------------------------------------------
# FIRMS — fire detection points
# ---------------------------------------------------------------------------
FIRMS_URL = (
    "https://firms.modaps.eosdis.nasa.gov/data/active_fire/"
    "modis-c6.1/csv/MODIS_C6_1_USA_contiguous_and_Hawaii_2020.csv"
)

_FALLBACK_FIRES = [
    (37.10, -119.22, "2020-09-05"),
    (37.50, -121.55, "2020-08-19"),
    (38.84, -122.55, "2020-08-18"),
    (39.82, -122.84, "2020-08-17"),
    (39.78, -121.05, "2020-08-18"),
    (34.24, -117.90, "2020-09-06"),
    (34.02, -117.14, "2020-09-05"),
    (40.60, -122.52, "2020-09-27"),
    (38.62, -122.56, "2020-09-27"),
    (38.48, -122.72, "2020-08-18"),
    (37.82, -122.02, "2020-08-18"),
    (36.98, -119.48, "2020-09-07"),
    (41.05, -123.68, "2020-08-17"),
    (39.25, -120.85, "2020-09-08"),
    (34.42, -118.48, "2020-09-05"),
]


def _in_california(lat: float, lon: float) -> bool:
    return CA_LAT_MIN <= lat <= CA_LAT_MAX and CA_LON_MIN <= lon <= CA_LON_MAX


def _haversine_deg(lat1, lon1, lat2, lon2) -> float:
    return math.sqrt((lat1 - lat2) ** 2 + (lon1 - lon2) ** 2)


def fetch_firms_california() -> list[tuple[float, float, str]]:
    print("Downloading FIRMS 2020 fire detections...")
    try:
        resp = requests.get(FIRMS_URL, timeout=60, stream=True)
        resp.raise_for_status()
        reader = csv.DictReader(io.StringIO(resp.content.decode("utf-8")))
        points = []
        for row in reader:
            try:
                lat  = float(row["latitude"])
                lon  = float(row["longitude"])
                date = row["acq_date"]
                conf = row.get("confidence", "").strip().upper()
                if conf not in ("", "L") and _in_california(lat, lon):
                    points.append((lat, lon, date))
            except (KeyError, ValueError):
                continue
        print(f"  FIRMS: {len(points):,} California detections.")
        return points
    except Exception as e:
        print(f"  FIRMS failed ({e}). Using fallback locations.")
        rng = random.Random(RANDOM_SEED)
        points = []
        for lat, lon, date in _FALLBACK_FIRES:
            for _ in range(35):
                jlat = lat + rng.uniform(-0.4, 0.4)
                jlon = lon + rng.uniform(-0.4, 0.4)
                if _in_california(jlat, jlon):
                    points.append((jlat, jlon, date))
        return points


def _random_2020_date(rng: random.Random) -> str:
    """Return a random date in 2020 as YYYY-MM-DD."""
    start = datetime(2020, 1, 1)
    offset = rng.randint(0, 365)
    return (start + timedelta(days=offset)).strftime("%Y-%m-%d")


def generate_nofire_points(
    fire_points: list[tuple[float, float, str]],
    n: int,
    rng: random.Random,
) -> list[tuple[float, float, str]]:
    """
    Generate n no-fire points at random California locations far from any fire.
    Each point is assigned a random date spread across 2020 to avoid the
    seasonal bias that arises from using a single fixed winter date.

    Locations are generated first (before dates) so the rng sequence for
    lat/lon is identical to previous runs — allowing AppEEARS tasks to be reused.
    """
    fire_latlons = [(lat, lon) for lat, lon, _ in fire_points]
    latlons: list[tuple[float, float]] = []
    attempts = 0

    print(f"Generating {n} no-fire points...")
    while len(latlons) < n and attempts < n * 200:
        attempts += 1
        lat = rng.uniform(CA_LAT_MIN, CA_LAT_MAX)
        lon = rng.uniform(CA_LON_MIN, CA_LON_MAX)
        if not any(_haversine_deg(lat, lon, f, g) < MIN_FIRE_DIST for f, g in fire_latlons):
            latlons.append((lat, lon))

    # Assign random dates after location generation to preserve rng state for lat/lon
    points = [(lat, lon, _random_2020_date(rng)) for lat, lon in latlons]
    print(f"  Generated {len(points)} no-fire points.")
    return points


# ---------------------------------------------------------------------------
# EVI — NASA AppEEARS batch extraction
# ---------------------------------------------------------------------------

def _appeears_login() -> str:
    """Authenticate with NASA Earthdata and return an AppEEARS bearer token."""
    user = os.environ.get("EARTHDATA_USERNAME", "")
    pwd  = os.environ.get("EARTHDATA_PASSWORD", "")
    if not user or not pwd:
        raise RuntimeError(
            "EARTHDATA_USERNAME and EARTHDATA_PASSWORD must be set.\n"
            "Register free at https://urs.earthdata.nasa.gov"
        )
    creds = base64.b64encode(f"{user}:{pwd}".encode()).decode()
    resp  = requests.post(
        f"{APPEEARS_URL}/login",
        headers={"Authorization": f"Basic {creds}"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["token"]


TASK_ID_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".appeears_task_id")


def _get_with_retry(url, headers, timeout=15, retries=5, backoff=30):
    """GET with retry on network errors."""
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=headers, timeout=timeout)
            return resp
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            if attempt == retries - 1:
                raise
            wait = backoff * (attempt + 1)
            print(f"\n  Network error ({e.__class__.__name__}), retrying in {wait}s...", end="", flush=True)
            time.sleep(wait)


def fetch_evi_batch(
    points: list[tuple[float, float, str]],
    resume_task_id: str | None = None,
) -> dict[tuple[float, float], float]:
    """
    Batch-fetch MODIS MOD13Q1 EVI (250 m, 16-day composite) for all points
    via NASA AppEEARS. Submits one task for the full 2020 year, then selects
    the EVI value whose composite date is closest to each point's acquisition date.

    If resume_task_id is given (or a saved .appeears_task_id file exists), skips
    submission and resumes polling that task.

    Returns:
        dict mapping (lat_rounded, lon_rounded) -> EVI raw value
    """
    token   = _appeears_login()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # -- Resume or submit --
    task_id = resume_task_id
    if task_id is None and os.path.exists(TASK_ID_FILE):
        with open(TASK_ID_FILE) as f:
            task_id = f.read().strip()
        print(f"Resuming AppEEARS task {task_id} from saved state...")

    if task_id is None:
        print(f"Submitting AppEEARS batch EVI task for {len(points):,} points...")
        coords = [
            {"id": str(i), "latitude": round(lat, 6), "longitude": round(lon, 6), "category": ""}
            for i, (lat, lon, _) in enumerate(points)
        ]

        task_payload = {
            "task_type": "point",
            "task_name": f"wildfire_evi_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            "params": {
                "dates": [{"startDate": "01-01-2020", "endDate": "12-31-2020"}],
                "layers": [{"product": "MOD13Q1.061", "layer": "_250m_16_days_EVI"}],
                "coordinates": coords,
                "output": {
                    "format": {"type": "csv"},
                    "projection": "geographic",
                },
            },
        }

        resp = requests.post(
            f"{APPEEARS_URL}/task",
            json=task_payload,
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()
        task_id = resp.json()["task_id"]
        print(f"  Task ID: {task_id}")
        # Save so we can resume if the process is interrupted
        with open(TASK_ID_FILE, "w") as f:
            f.write(task_id)

    # Poll until done
    print("  Waiting for AppEEARS to process", end="", flush=True)
    while True:
        time.sleep(20)
        status_resp = _get_with_retry(
            f"{APPEEARS_URL}/task/{task_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        status = status_resp.json().get("status", "unknown")
        print(".", end="", flush=True)
        if status == "done":
            print(" done!")
            break
        elif status in ("error", "deleted"):
            raise RuntimeError(f"AppEEARS task failed: {status}")

    # Clear saved task ID now that it's done
    if os.path.exists(TASK_ID_FILE):
        os.remove(TASK_ID_FILE)

    # Find the CSV in the bundle
    bundle = _get_with_retry(
        f"{APPEEARS_URL}/bundle/{task_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    bundle.raise_for_status()
    files = bundle.json().get("files", [])

    csv_file = next(
        (f for f in files if f["file_name"].endswith(".csv") and "MOD13Q1" in f["file_name"]),
        None,
    )
    if csv_file is None:
        raise RuntimeError(f"No MOD13Q1 CSV found in AppEEARS bundle. Files: {[f['file_name'] for f in files]}")

    # Download
    print("  Downloading EVI CSV...")
    dl = _get_with_retry(
        f"{APPEEARS_URL}/bundle/{task_id}/{csv_file['file_id']}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=120,
    )
    dl.raise_for_status()

    # Parse — find the EVI column
    content = dl.content.decode("utf-8")
    reader  = csv.DictReader(io.StringIO(content))
    evi_col = next((c for c in (reader.fieldnames or []) if "EVI" in c.upper()), None)
    if evi_col is None:
        raise RuntimeError(f"EVI column not found. Got: {reader.fieldnames}")

    # Group by point ID: {id -> [(date_str, evi_value), ...]}
    by_id: dict[str, list[tuple[str, float]]] = {}
    for row in reader:
        pid = row.get("ID") or row.get("id") or ""
        raw = row.get(evi_col, "")
        date_str = row.get("Date", "")
        try:
            val = float(raw)
            if -2000 <= val <= 10000:
                by_id.setdefault(pid, []).append((date_str, val))
        except (ValueError, TypeError):
            continue

    # For each point, pick EVI closest to its acquisition date
    result: dict[tuple[float, float], float] = {}
    for i, (lat, lon, acq_date) in enumerate(points):
        values = by_id.get(str(i), [])
        if not values:
            continue
        target = datetime.strptime(acq_date, "%Y-%m-%d")
        best = min(
            values,
            key=lambda x: abs(
                (datetime.strptime(x[0], "%Y-%m-%d") - target).days
            ) if x[0] else 9999,
        )
        result[(round(lat, 6), round(lon, 6))] = best[1]

    print(f"  EVI resolved for {len(result):,} / {len(points):,} points.")
    return result


# ---------------------------------------------------------------------------
# Weather — Open-Meteo historical (wind + humidity + temperature)
# ---------------------------------------------------------------------------

def fetch_weather_historical(lat: float, lon: float, date_str: str) -> dict | None:
    target = datetime.strptime(date_str, "%Y-%m-%d")
    start  = (target - timedelta(days=3)).strftime("%Y-%m-%d")
    end    = (target + timedelta(days=3)).strftime("%Y-%m-%d")

    params = {
        "latitude":        lat,
        "longitude":       lon,
        "start_date":      start,
        "end_date":        end,
        "daily":           "wind_speed_10m_max,temperature_2m_mean,relative_humidity_2m_mean",
        "wind_speed_unit": "ms",
        "timezone":        "America/Los_Angeles",
    }
    try:
        resp = requests.get(
            "https://archive-api.open-meteo.com/v1/archive",
            params=params,
            timeout=15,
        )
        resp.raise_for_status()
        data  = resp.json().get("daily", {})
        winds = [v for v in data.get("wind_speed_10m_max", [])          if v is not None]
        temps = [v for v in data.get("temperature_2m_mean", [])         if v is not None]
        humid = [v for v in data.get("relative_humidity_2m_mean", [])   if v is not None]
        if not winds or not temps or not humid:
            return None
        return {
            "wind":                float(np.mean(winds)),
            "temperature_celsius": float(np.mean(temps)),
            "humidity":            float(np.mean(humid)),
        }
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Elevation — Open-Elevation
# ---------------------------------------------------------------------------

def fetch_elevation(lat: float, lon: float) -> float | None:
    try:
        resp = requests.get(
            "https://api.open-elevation.com/api/v1/lookup",
            params={"locations": f"{lat},{lon}"},
            timeout=10,
        )
        resp.raise_for_status()
        return float(resp.json()["results"][0]["elevation"])
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Checkpoint helpers
# ---------------------------------------------------------------------------

def load_checkpoint() -> set[tuple[float, float]]:
    done = set()
    if not os.path.exists(OUT_CSV):
        return done
    with open(OUT_CSV, newline="") as f:
        for row in csv.DictReader(f):
            try:
                done.add((float(row["lat"]), float(row["lon"])))
            except (KeyError, ValueError):
                pass
    return done


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build():
    os.makedirs(OUT_DIR, exist_ok=True)
    rng = random.Random(RANDOM_SEED)

    # Collect points
    fire_candidates = fetch_firms_california()
    rng.shuffle(fire_candidates)
    fire_points   = fire_candidates[:N_FIRE]
    nofire_points = generate_nofire_points(fire_candidates, N_NOFIRE, rng)

    all_points = (
        [(lat, lon, date, 1) for lat, lon, date in fire_points] +
        [(lat, lon, date, 0) for lat, lon, date in nofire_points]
    )
    rng.shuffle(all_points)

    # ── Batch EVI via AppEEARS ─────────────────────────────────────────
    evi_lookup = fetch_evi_batch([(lat, lon, date) for lat, lon, date, _ in all_points])

    # ── Resume from checkpoint ─────────────────────────────────────────
    done = load_checkpoint()
    print(f"Checkpoint: {len(done)} rows already complete.")

    file_exists = os.path.exists(OUT_CSV)
    out_file    = open(OUT_CSV, "a", newline="")
    writer      = csv.writer(out_file)
    if not file_exists:
        writer.writerow(CSV_COLS)

    total     = len(all_points)
    completed = len(done)
    skipped   = 0
    failed    = 0

    print(f"\nProcessing {total} points ({completed} already done)...\n")

    for i, (lat, lon, date, label) in enumerate(all_points, 1):
        key = (round(lat, 6), round(lon, 6))

        if key in done:
            skipped += 1
            continue

        prefix = f"[{i}/{total}] ({lat:.4f}, {lon:.4f}) {date} label={label}"

        # EVI from AppEEARS batch result
        evi = evi_lookup.get(key)
        if evi is None:
            print(f"  {prefix} -- EVI missing from batch, skipping")
            failed += 1
            continue

        # Weather
        weather = fetch_weather_historical(lat, lon, date)
        if weather is None:
            print(f"  {prefix} -- weather failed, skipping")
            failed += 1
            continue

        wind     = weather["wind"]
        humidity = weather["humidity"]
        lst      = (weather["temperature_celsius"] + 273.15) / 0.02

        # Elevation
        elevation = fetch_elevation(lat, lon)
        if elevation is None:
            print(f"  {prefix} -- elevation failed, skipping")
            failed += 1
            continue

        writer.writerow([
            round(lat, 6), round(lon, 6), date,
            evi, round(lst, 2), round(wind, 3),
            round(humidity, 1), round(elevation, 2),
            label,
        ])
        completed += 1

        print(
            f"  {prefix} | EVI={evi:.0f} LST={lst:.0f} "
            f"wind={wind:.1f} hum={humidity:.0f}% elev={elevation:.0f}m"
        )

        if completed % CHECKPOINT_EVERY == 0:
            out_file.flush()
            print(f"  -- checkpoint: {completed} rows saved --")

    out_file.flush()
    out_file.close()

    print(f"\nDone. {completed} rows saved, {failed} failed, {skipped} skipped.")
    print(f"Dataset: {OUT_CSV}")


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    build()
