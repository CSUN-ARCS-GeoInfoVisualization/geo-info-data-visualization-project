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
import time
import random
import logging

import requests
from flask import Blueprint, request, jsonify

from data.features import get_feature
from data.live_weather import get_weather

logger = logging.getLogger(__name__)
ml_ingest_bp = Blueprint("ml_ingest", __name__)


def html_escape(s) -> str:
    if s is None:
        return ""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))

FIRMS_MAP_KEY = os.getenv("FIRMS_MAP_KEY", "")
FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
CA_BBOX = (-124.0, 32.0, -114.0, 42.0)  # lon_min, lat_min, lon_max, lat_max

# Per-run caps: bound endpoint runtime. Each point = several external feature
# fetches (~0.5-1s when cold), and the gunicorn worker timeout is 90s, so we keep
# the point count low AND enforce a hard wall-clock budget below. The dataset
# grows across daily runs, so a modest per-run count is fine.
MAX_FIRE_PER_RUN = 15
MAX_NOFIRE_PER_RUN = 15
TIME_BUDGET_SECONDS = 55  # stop computing well before the 90s worker timeout

# Column order the workflow appends to california_daily.csv (must match the base
# CSV header: the 6 features + label, plus provenance).
ROW_COLS = ["lat", "lon", "acq_date", "evi", "air_temp_encoded", "wind",
            "humidity", "elevation", "kbdi", "fire", "source"]

# Data-quality gate. Physical bounds for each model feature — a computed row that
# falls outside any of these is DROPPED before it can reach the training set, so a
# corrupted or degenerate upstream fetch (e.g. a failed API returning 0/NaN, or an
# out-of-CA point) never poisons the model. Bounds are deliberately wide: real CA
# extremes plus margin.
#   air_temp_encoded = (°C + 273.15) / 0.02 → ~-40°C..60°C maps to 11657..16657
FEATURE_BOUNDS = {
    "evi":              (-0.2, 1.0),
    "air_temp_encoded": (10000.0, 18000.0),
    "wind":             (0.0, 120.0),
    "humidity":         (0.0, 100.0),
    "elevation":        (-100.0, 5000.0),
    "kbdi":             (0.0, 800.0),
}


def _row_quality_issue(row):
    """Return a human-readable reason string if the row fails the data-quality
    gate, or None if the row is clean and safe to append to the training set."""
    import math
    lat, lon = row.get("lat"), row.get("lon")
    lon0, lat0, lon1, lat1 = CA_BBOX
    if lat is None or lon is None or not (lat0 <= lat <= lat1 and lon0 <= lon <= lon1):
        return f"coords {lat},{lon} outside CA bbox"
    for key, (lo, hi) in FEATURE_BOUNDS.items():
        v = row.get(key)
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return f"{key} missing/NaN"
        if not (lo <= v <= hi):
            return f"{key}={v} outside [{lo}, {hi}]"
    return None


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
    dropped = []
    start = time.monotonic()
    truncated = False
    for label, pts in ((1, fire_pts), (0, nofire_pts)):
        for lat, lon, acq_date in pts:
            if time.monotonic() - start > TIME_BUDGET_SECONDS:
                truncated = True
                break
            if not acq_date:
                continue
            try:
                feats = _features_for(lat, lon)
            except Exception as e:
                logger.warning("feature fetch failed @ %.3f,%.3f: %s", lat, lon, e)
                continue
            row = {
                "lat": round(lat, 5), "lon": round(lon, 5), "acq_date": acq_date,
                **feats, "fire": label,
                "source": "firms_viirs" if label else "sampled_nofire",
            }
            # Data-quality gate: only clean rows are returned for appending.
            issue = _row_quality_issue(row)
            if issue:
                logger.warning("ingest row dropped @ %.3f,%.3f: %s", lat, lon, issue)
                dropped.append({"lat": row["lat"], "lon": row["lon"], "reason": issue})
                continue
            rows.append(row)
        if truncated:
            break

    # quality_ok is informational for the caller/alerting: false when nothing
    # clean came through, or when the majority of computed rows failed the gate
    # (a signal that an upstream feed is degraded — the workflow can surface it).
    computed = len(rows) + len(dropped)
    quality_ok = computed > 0 and len(dropped) <= computed * 0.5

    return jsonify({"ok": True, "fires_seen": len(fires), "count": len(rows),
                    "dropped": len(dropped), "dropped_detail": dropped[:20],
                    "quality_ok": quality_ok, "truncated": truncated,
                    "columns": ROW_COLS, "rows": rows}), 200


# Who gets notified when the weekly auto-promote ships a new model.
PROMOTION_EMAIL_TO = os.getenv("MODEL_PROMOTION_EMAIL", "ido.the.cohen@gmail.com")


def _send_promotion_email(details: dict):
    """Email the model owner that the weekly gate promoted a new model. Direct
    Resend SDK call, same pattern as the alert emails."""
    try:
        import resend
    except ImportError:
        return None, "resend SDK missing"
    api_key = os.getenv("RESEND_API_KEY", "")
    sender_email = os.getenv("SENDER_EMAIL", "alerts@firescope.dev")
    sender_name = os.getenv("SENDER_NAME", "FireScope Alerts")
    if not api_key:
        return None, "RESEND_API_KEY not set"
    resend.api_key = api_key

    when = str(details.get("when", ""))
    dataset = str(details.get("dataset", "?"))
    rows = details.get("rows", "?")
    auroc = details.get("auroc")
    brier = details.get("brier")
    reasons = details.get("reasons", "")
    log = str(details.get("log", "")).strip()

    metric_line = ""
    if auroc is not None or brier is not None:
        metric_line = (
            f'<p style="margin:0 0 8px;font-size:14px;">Held-out '
            f'<strong>AUROC {auroc}</strong>, <strong>Brier {brier}</strong>.</p>'
        )
    log_block = (
        f'<pre style="background:#f6f8fa;border:1px solid #e5e7eb;border-radius:6px;'
        f'padding:12px;font-size:12px;white-space:pre-wrap;color:#111827;">{html_escape(log)}</pre>'
        if log else ""
    )
    html = (
        f'<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:640px;">'
        f'<h2 style="margin:0 0 6px;font-size:18px;">FireScope model auto-promoted</h2>'
        f'<p style="margin:0 0 12px;font-size:13px;color:#6b7280;">The weekly gate accepted a new '
        f'candidate and it is now the live wildfire-risk model.</p>'
        f'<p style="margin:0 0 8px;font-size:14px;">Promoted at <strong>{html_escape(when)}</strong> '
        f'on dataset <strong>{html_escape(dataset)}</strong> ({rows} rows).</p>'
        f'{metric_line}'
        f'<p style="margin:0 0 8px;font-size:14px;">Gate: {html_escape(str(reasons))}</p>'
        f'{log_block}'
        f'<p style="margin:14px 0 0;font-size:12px;color:#6b7280;">It passed both the physics '
        f'(monotonicity) check and the AUROC/Brier non-regression check. To roll back, restore the '
        f'previous model from <code>backend/ml/models/archive/</code>.</p>'
        f'</div>'
    )
    text = (
        f"FireScope model auto-promoted at {when}\n"
        f"Dataset: {dataset} ({rows} rows)\n"
        f"AUROC: {auroc}  Brier: {brier}\n"
        f"Gate: {reasons}\n\n{log}\n"
    )
    try:
        resp = resend.Emails.send({
            "from": f"{sender_name} <{sender_email}>",
            "to": [PROMOTION_EMAIL_TO],
            "subject": f"FireScope: AI model auto-promoted ({when[:10] or 'weekly'})",
            "html": html,
            "text": text,
        })
        return resp.get("id"), None
    except Exception as e:
        logger.warning("promotion email failed: %s", e)
        return None, str(e)


@ml_ingest_bp.route("/internal/ml/promotion-email", methods=["POST"])
def promotion_email():
    """Called by the weekly auto-promote workflow ONLY when a promotion happened.
    Emails the model owner the promotion details."""
    expected = os.getenv("INTERNAL_CRON_TOKEN", "")
    if not expected:
        return jsonify({"error": "INTERNAL_CRON_TOKEN not configured"}), 500
    if request.headers.get("X-Internal-Token", "") != expected:
        return jsonify({"error": "invalid X-Internal-Token"}), 401
    details = request.get_json(silent=True) or {}
    msg_id, err = _send_promotion_email(details)
    if err:
        return jsonify({"ok": False, "error": err}), 502
    return jsonify({"ok": True, "id": msg_id, "to": PROMOTION_EMAIL_TO}), 200
