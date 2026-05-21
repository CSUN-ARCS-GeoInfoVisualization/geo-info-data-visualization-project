"""Weekly AppEEARS batch pre-warm for the EVI cache.

Submits a MOD13Q1 point-extraction task across a 0.1° CA grid (~900 points)
and writes results into feature_cache_evi with source='appeears'. Run via
Render cron weekly. Live cache misses still go to GEE; AppEEARS keeps the
hot path served from DB.

Env vars required: EARTHDATA_TOKEN, DATABASE_URL.
Run: `python scripts/warm_evi_cache.py`
"""
from __future__ import annotations

import csv
import datetime as _dt
import io
import logging
import os
import sys
import time
from decimal import Decimal

import requests

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

_APPEEARS_BASE = "https://appeears.earthdatacloud.nasa.gov/api"
_LAT_RANGE = (32.5, 42.0, 0.1)
_LON_RANGE = (-124.0, -114.0, 0.1)


def _token() -> str:
    t = os.environ.get("EARTHDATA_TOKEN")
    if not t:
        raise RuntimeError("EARTHDATA_TOKEN not set")
    return t


def _headers() -> dict:
    return {"Authorization": f"Bearer {_token()}"}


def _ca_grid() -> list[tuple[float, float]]:
    pts = []
    lat = _LAT_RANGE[0]
    while lat <= _LAT_RANGE[1]:
        lon = _LON_RANGE[0]
        while lon <= _LON_RANGE[1]:
            pts.append((round(lat, 2), round(lon, 2)))
            lon += _LON_RANGE[2]
        lat += _LAT_RANGE[2]
    return pts


def submit_task() -> str:
    today = _dt.date.today()
    start = (today - _dt.timedelta(days=32)).strftime("%m-%d-%Y")
    end = today.strftime("%m-%d-%Y")
    coordinates = [
        {"id": f"t{i}", "latitude": lat, "longitude": lon, "category": "tile"}
        for i, (lat, lon) in enumerate(_ca_grid())
    ]
    task = {
        "task_type": "point",
        "task_name": f"firescope-evi-{today.isoformat()}",
        "params": {
            "dates": [{"startDate": start, "endDate": end}],
            "layers": [{"product": "MOD13Q1.061", "layer": "_250m_16_days_EVI"}],
            "coordinates": coordinates,
        },
    }
    r = requests.post(f"{_APPEEARS_BASE}/task", headers=_headers(), json=task, timeout=60)
    r.raise_for_status()
    task_id = r.json()["task_id"]
    logger.info("submitted appeears task %s with %d points", task_id, len(coordinates))
    return task_id


def wait_done(task_id: str, poll_sec: int = 30, timeout_sec: int = 3600 * 4) -> None:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        r = requests.get(f"{_APPEEARS_BASE}/task/{task_id}", headers=_headers(), timeout=30)
        r.raise_for_status()
        status = r.json().get("status")
        logger.info("task %s status=%s", task_id, status)
        if status == "done":
            return
        if status in ("error", "expired"):
            raise RuntimeError(f"AppEEARS task {task_id} ended {status}")
        time.sleep(poll_sec)
    raise TimeoutError(f"AppEEARS task {task_id} did not complete in {timeout_sec}s")


def fetch_results_csv(task_id: str) -> str:
    r = requests.get(f"{_APPEEARS_BASE}/bundle/{task_id}", headers=_headers(), timeout=60)
    r.raise_for_status()
    files = r.json().get("files", [])
    csv_file = next((f for f in files if f["file_name"].endswith(".csv")), None)
    if csv_file is None:
        raise RuntimeError(f"No CSV in task {task_id} bundle")
    file_id = csv_file["file_id"]
    r = requests.get(
        f"{_APPEEARS_BASE}/bundle/{task_id}/{file_id}",
        headers=_headers(), timeout=120, stream=True,
    )
    r.raise_for_status()
    return r.text


def ingest_csv(csv_text: str) -> int:
    from models import db, FeatureCacheEvi

    reader = csv.DictReader(io.StringIO(csv_text))
    seen: dict[tuple, dict] = {}
    for row in reader:
        try:
            lat = float(row["Latitude"])
            lon = float(row["Longitude"])
            evi_raw = float(row["MOD13Q1_061__250m_16_days_EVI"])
            date = _dt.datetime.strptime(row["Date"], "%Y-%m-%d").date()
        except (KeyError, ValueError):
            continue
        tile = (Decimal(f"{round(lat, 2):.4f}"), Decimal(f"{round(lon, 2):.4f}"))
        prev = seen.get(tile)
        if prev is None or date > prev["date"]:
            seen[tile] = {"evi": evi_raw * 0.0001, "date": date}

    written = 0
    for (tlat, tlon), entry in seen.items():
        db.session.merge(FeatureCacheEvi(
            tile_lat=tlat, tile_lon=tlon, evi=entry["evi"],
            source="appeears", composite_date=entry["date"],
        ))
        written += 1
    db.session.commit()
    logger.info("ingested %d tiles into feature_cache_evi", written)
    return written


def main() -> None:
    task_id = submit_task()
    wait_done(task_id)
    csv_text = fetch_results_csv(task_id)
    ingest_csv(csv_text)


if __name__ == "__main__":
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
    from app import create_app
    app = create_app()
    with app.app_context():
        main()
