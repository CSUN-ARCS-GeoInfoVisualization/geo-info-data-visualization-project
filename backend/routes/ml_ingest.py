"""Daily training-data ingest for continuous retraining.

POST /api/internal/ml/ingest  (X-Internal-Token, hit by the daily GitHub Action)

Pulls the last N days of FIRMS VIIRS fire detections over California, samples a
matched set of no-fire points, computes the 6 model features for each via the
same live modules production already uses, and RETURNS them as JSON rows.

It does NOT persist anything: feature computation happens here (on Render, where
the live modules + their caches live), but the rows are stored in the GitHub
repo by the calling workflow (CSV append + commit). That keeps the growing
training set in free storage with zero database cost-risk.
"""
import os
import random
import logging

import requests
from flask import Blueprint, request, jsonify

from data.features import get_feature
from data.live_weather import get_weather

logger = logging.getLogger(__name__)
ml_ingest_bp = Blueprint("ml_ingest", __name__)

FIRMS_MAP_KEY = os.getenv("FIRMS_MAP_KEY", "")
FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
CA_BBOX = (-124.0, 32.0, -114.0, 42.0)  # lon_min, lat_min, lon_max, lat_max

# Per-run caps: bound endpoint runtime (each point = a few feature fetches).
MAX_FIRE_PER_RUN = 60
MAX_NOFIRE_PER_RUN = 60

# Column order the workflow appends to california_daily.csv (must match the base
# CSV header: the 6 features + label, plus provenance).
ROW_COLS = ["lat", "lon", "acq_date", "evi", "air_temp_encoded", "wind",
            "humidity", "elevation", "kbdi", "fire", "source"]


def _features_for(lat, lon):
    wx = get_weather(lat, lon) or {}
    return {
        "evi": float(get_feature(lat, lon, "evi")),
        "air_temp_encoded": float(wx.get("air_temp_encoded", get_feature(lat, lon, "air_temp_encoded"))),
        "wind": float(wx.get("wind", 0.0)),
        "humidity": float(wx.get("humidity", 50.0)),
        "elevation": float(get_feature(lat, lon, "elevation")),
        "kbdi": float(get_feature(lat, lon, "kbdi")),
    }


def _far_from_fires(lat, lon, fires, min_deg=0.15):
    return all((lat - flat) ** 2 + (lon - flon) ** 2 >= min_deg ** 2 for flat, flon, _ in fires)


def _fetch_firms(days):
    if not FIRMS_MAP_KEY:
        return []
    lon0, lat0, lon1, lat1 = CA_BBOX
    url = f"{FIRMS_BASE}/{FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/{lon0},{lat0},{lon1},{lat1}/{days}"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    lines = r.text.strip().split("\n")
    if len(lines) < 2:
        return []
    h = lines[0].split(",")
    try:
        li, oi, di = h.index("latitude"), h.index("longitude"), h.index("acq_date")
    except ValueError:
        return []
    out = []
    for line in lines[1:]:
        c = line.split(",")
        try:
            out.append((float(c[li]), float(c[oi]), c[di]))
        except (ValueError, IndexError):
            continue
    return out


@ml_ingest_bp.route("/internal/ml/ingest", methods=["POST"])
def ingest():
    expected = os.getenv("INTERNAL_CRON_TOKEN", "")
    if not expected:
        return jsonify({"error": "INTERNAL_CRON_TOKEN not configured"}), 500
    if request.headers.get("X-Internal-Token", "") != expected:
        return jsonify({"error": "invalid X-Internal-Token"}), 401

    days = int(request.args.get("days", 1))
    try:
        fires = _fetch_firms(days)
    except Exception as e:
        logger.warning("FIRMS fetch failed: %s", e)
        return jsonify({"error": f"FIRMS fetch failed: {e}"}), 502

    rng = random.Random(20260603)
    fire_pts = fires[:MAX_FIRE_PER_RUN]
    lon0, lat0, lon1, lat1 = CA_BBOX
    acq = fires[0][2] if fires else request.args.get("date", "")

    nofire_pts, tries = [], 0
    while len(nofire_pts) < min(MAX_NOFIRE_PER_RUN, max(len(fire_pts), 10)) and tries < 2000:
        tries += 1
        la, lo = rng.uniform(lat0, lat1), rng.uniform(lon0, lon1)
        if _far_from_fires(la, lo, fires):
            nofire_pts.append((la, lo, acq))

    rows = []
    for label, pts in ((1, fire_pts), (0, nofire_pts)):
        for lat, lon, acq_date in pts:
            if not acq_date:
                continue
            try:
                feats = _features_for(lat, lon)
            except Exception as e:
                logger.warning("feature fetch failed @ %.3f,%.3f: %s", lat, lon, e)
                continue
            rows.append({
                "lat": round(lat, 5), "lon": round(lon, 5), "acq_date": acq_date,
                **feats, "fire": label,
                "source": "firms_viirs" if label else "sampled_nofire",
            })

    return jsonify({"ok": True, "fires_seen": len(fires), "count": len(rows),
                    "columns": ROW_COLS, "rows": rows}), 200
