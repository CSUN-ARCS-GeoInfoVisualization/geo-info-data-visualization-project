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
import json
import time
import random
import logging

import requests
from flask import Blueprint, request, jsonify

from data.features import get_feature
from data.live_weather import get_weather
from data.weather_crosscheck import get_weather_second
from ml.geo_checks import on_ca_land, in_any_perimeter

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
# Point-loop budget. Lowered from 55 because each run now also does pre-loop work
# (active-perimeter load + a wider FIRMS avoidance fetch) and a per-point
# cross-source weather call; keeping the loop at 35s leaves comfortable headroom
# under the gunicorn worker timeout. The dataset grows across daily runs, so a
# smaller per-run yield is fine.
TIME_BUDGET_SECONDS = 35

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
        # get_weather returns the key "wind_speed" (not "wind"). The old default
        # of 0.0 silently recorded wind=0 on every row, making the wind feature
        # dead. Read the correct key; fall back to the IDW estimate only if the
        # live fetch had no wind at all.
        "wind": float(wx["wind_speed"]) if "wind_speed" in wx else float(get_feature(lat, lon, "wind")),
        "humidity": float(wx.get("humidity", 50.0)),
        "elevation": float(get_feature(lat, lon, "elevation")),
        "kbdi": float(get_feature(lat, lon, "kbdi")),
    }


_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"


def _weather_for_date(lat, lon, date_str):
    """Daily-archive weather for a specific past date (±3-day mean), matching the
    base training set's feature definition (wind_speed_10m_max, temp/humidity
    daily mean). Returns {wind, air_temp_encoded, humidity} or None if the archive
    has no data yet (recent dates lag a few days). Used by the backtest so recent
    fires are scored with weather AT fire time, not current weather."""
    import datetime as _dt
    try:
        t = _dt.datetime.strptime(date_str, "%Y-%m-%d")
    except (ValueError, TypeError):
        return None
    start = (t - _dt.timedelta(days=3)).strftime("%Y-%m-%d")
    end = (t + _dt.timedelta(days=3)).strftime("%Y-%m-%d")
    try:
        r = requests.get(_ARCHIVE_URL, params={
            "latitude": lat, "longitude": lon, "start_date": start, "end_date": end,
            "daily": "wind_speed_10m_max,temperature_2m_mean,relative_humidity_2m_mean",
            "wind_speed_unit": "ms", "timezone": "America/Los_Angeles",
        }, timeout=15)
        r.raise_for_status()
        d = r.json().get("daily", {})
        winds = [v for v in d.get("wind_speed_10m_max", []) if v is not None]
        temps = [v for v in d.get("temperature_2m_mean", []) if v is not None]
        hums = [v for v in d.get("relative_humidity_2m_mean", []) if v is not None]
        if not winds or not temps or not hums:
            return None
        import statistics
        return {
            "wind": float(statistics.mean(winds)),
            "air_temp_encoded": (float(statistics.mean(temps)) + 273.15) / 0.02,
            "humidity": float(statistics.mean(hums)),
        }
    except Exception:
        return None


def _features_for_date(lat, lon, date_str):
    """Like _features_for but with weather AT the given date (archive). Falls back
    to current weather if the archive has no data for that date yet."""
    wx = _weather_for_date(lat, lon, date_str)
    if wx is None:
        return _features_for(lat, lon)
    return {
        "evi": float(get_feature(lat, lon, "evi")),
        "air_temp_encoded": wx["air_temp_encoded"],
        "wind": wx["wind"],
        "humidity": wx["humidity"],
        "elevation": float(get_feature(lat, lon, "elevation")),
        "kbdi": float(get_feature(lat, lon, "kbdi")),
    }


# Layer 2c — cross-source corroboration (INGEST ONLY; never the website path).
# Compares the primary weather (Open-Meteo) against an independent second source
# (MET Norway) per point and drops the row if they grossly disagree, catching a
# plausible-but-wrong value that range/outlier checks can't see. Tolerances are
# deliberately wide: two legitimate providers routinely differ (e.g. coastal
# humidity by ~25 pts), so we only flag clearly-anomalous gaps, not normal model
# disagreement. Fail-open: if the second source is unavailable the row is kept.
CROSSCHECK_ENABLED = os.getenv("INGEST_CROSSCHECK", "1") != "0"
XCHECK_TEMP_TOL = 12.0       # °C
XCHECK_HUMIDITY_TOL = 40.0   # percentage points
XCHECK_WIND_TOL = 15.0       # m/s


def _weather_mismatch(row, second):
    """Return a reason string if the primary and second weather sources grossly
    disagree for this point, else None."""
    primary_temp_c = row["air_temp_encoded"] * 0.02 - 273.15
    checks = (
        ("temperature", primary_temp_c, second.get("temperature_celsius"), XCHECK_TEMP_TOL),
        ("humidity", row.get("humidity"), second.get("humidity"), XCHECK_HUMIDITY_TOL),
        ("wind", row.get("wind"), second.get("wind_speed"), XCHECK_WIND_TOL),
    )
    for name, a, b, tol in checks:
        if a is None or b is None:
            continue
        if abs(a - b) > tol:
            return f"{name} disagree: primary={a:.1f} second={b:.1f} (>{tol})"
    return None


def _far_from_fires(lat, lon, fires, min_deg=0.15):
    return all((lat - flat) ** 2 + (lon - flon) ** 2 >= min_deg ** 2 for flat, flon, _ in fires)


# Label-quality gate (Layer 2a): drop low-confidence FIRMS detections. VIIRS
# reports confidence as 'l'/'n'/'h' (low/nominal/high); low-confidence pixels are
# the usual false positives (industrial heat, flares, sun glint), so labelling
# them fire=1 is label noise. We keep nominal + high only.
_LOW_CONFIDENCE = {"l", "low"}


def _is_low_confidence(val: str) -> bool:
    v = (val or "").strip().lower()
    if v in _LOW_CONFIDENCE:
        return True
    # MODIS-style numeric confidence (0-100): treat <30 as low.
    try:
        return float(v) < 30.0
    except (ValueError, TypeError):
        return False


def _fetch_firms(days):
    """Returns (kept_detections, n_low_confidence_dropped). kept = list of
    (lat, lon, acq_date) for nominal/high-confidence fire pixels only."""
    if not FIRMS_MAP_KEY:
        return [], 0
    lon0, lat0, lon1, lat1 = CA_BBOX
    url = f"{FIRMS_BASE}/{FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/{lon0},{lat0},{lon1},{lat1}/{days}"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    lines = r.text.strip().split("\n")
    if len(lines) < 2:
        return [], 0
    h = lines[0].split(",")
    try:
        li, oi, di = h.index("latitude"), h.index("longitude"), h.index("acq_date")
    except ValueError:
        return [], 0
    ci = h.index("confidence") if "confidence" in h else -1
    out, low = [], 0
    for line in lines[1:]:
        c = line.split(",")
        try:
            if ci >= 0 and _is_low_confidence(c[ci]):
                low += 1
                continue
            out.append((float(c[li]), float(c[oi]), c[di]))
        except (ValueError, IndexError):
            continue
    return out, low


def _load_active_perimeters():
    """Active NIFC fire perimeters for the no-fire label check. Prefer the cached
    copy (already warmed by the website / daily prewarm); fall back to the live
    compute. Fail-open to an empty set so a fetch problem never blocks ingest."""
    try:
        from services.cache import _load_from_db
        entry = _load_from_db("fire_perimeters")
        if entry and entry.get("data"):
            data = entry["data"]
            return json.loads(data) if isinstance(data, str) else data
    except Exception as e:
        logger.warning("perimeter cache read failed: %s", e)
    try:
        from routes.predict import _compute_nifc_perimeters
        return _compute_nifc_perimeters()
    except Exception as e:
        logger.warning("perimeter live compute failed: %s", e)
        return {"features": []}


@ml_ingest_bp.route("/internal/ml/ingest", methods=["POST"])
def ingest():
    expected = os.getenv("INTERNAL_CRON_TOKEN", "")
    if not expected:
        return jsonify({"error": "INTERNAL_CRON_TOKEN not configured"}), 500
    if request.headers.get("X-Internal-Token", "") != expected:
        return jsonify({"error": "invalid X-Internal-Token"}), 401

    days = int(request.args.get("days", 1))
    try:
        fires, firms_lowconf = _fetch_firms(days)
    except Exception as e:
        logger.warning("FIRMS fetch failed: %s", e)
        return jsonify({"error": f"FIRMS fetch failed: {e}"}), 502

    rng = random.Random(20260603)
    fire_pts = fires[:MAX_FIRE_PER_RUN]
    lon0, lat0, lon1, lat1 = CA_BBOX
    acq = fires[0][2] if fires else request.args.get("date", "")

    # No-fire label verification (Layer 2 #1): a sampled "no-fire" point must be
    # genuinely fire-free. We reject it if it is (a) near any fire in a WIDER
    # window than today's (so a fire from 2-3 days ago, or one FIRMS caught
    # adjacent, still excludes it), or (b) inside an active NIFC fire perimeter.
    # Plus a CA-land mask (#2) so no-fire points are never ocean / out-of-state.
    avoid_fires, _ = (_fetch_firms(max(days, 3)) if FIRMS_MAP_KEY else ([], 0))
    if not avoid_fires:
        avoid_fires = fires
    perimeters = _load_active_perimeters()

    nofire_pts, tries = [], 0
    nofire_target = min(MAX_NOFIRE_PER_RUN, max(len(fire_pts), 10))
    while len(nofire_pts) < nofire_target and tries < 8000:
        tries += 1
        la, lo = rng.uniform(lat0, lat1), rng.uniform(lon0, lon1)
        if not on_ca_land(la, lo):
            continue
        if not _far_from_fires(la, lo, avoid_fires):
            continue
        if in_any_perimeter(la, lo, perimeters):
            continue
        nofire_pts.append((la, lo, acq))

    crosscheck = CROSSCHECK_ENABLED and request.args.get("crosscheck", "1") != "0"
    rows = []
    dropped = []
    cross_dropped = []
    cross_checked = 0
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
            # Layer 2c: cross-source corroboration. Fail-open — a missing second
            # source never discards the row; only a gross disagreement does.
            if crosscheck:
                second = get_weather_second(lat, lon)
                if second:
                    cross_checked += 1
                    mm = _weather_mismatch(row, second)
                    if mm:
                        logger.warning("ingest row cross-source mismatch @ %.3f,%.3f: %s", lat, lon, mm)
                        cross_dropped.append({"lat": row["lat"], "lon": row["lon"], "reason": mm})
                        continue
            rows.append(row)
        if truncated:
            break

    # quality_ok is informational for the caller/alerting: false when nothing
    # clean came through, or when the majority of computed rows failed the gate
    # (a signal that an upstream feed is degraded — the workflow can surface it).
    computed = len(rows) + len(dropped)
    quality_ok = computed > 0 and len(dropped) <= computed * 0.5

    return jsonify({"ok": True, "fires_seen": len(fires),
                    "firms_lowconf_dropped": firms_lowconf, "count": len(rows),
                    "dropped": len(dropped), "dropped_detail": dropped[:20],
                    "cross_source_checked": cross_checked,
                    "cross_source_dropped": len(cross_dropped),
                    "cross_source_detail": cross_dropped[:20],
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


def _send_data_health_email(report: dict):
    """Email a Layer-2 data-health alert. Distinguishes a feed-corruption signal
    (high outlier rate — urgent) from distribution drift (usually seasonal —
    informational, the weekly retrain adapts to it)."""
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

    o_rate = report.get("outlier_rate", 0.0)
    o_thresh = report.get("outlier_rate_threshold", 0.10)
    drifted = report.get("drifted_features", [])
    drift = report.get("drift", {})

    dead = report.get("dead_features", [])
    parts = []
    if dead:
        parts.append(
            f'<p style="margin:0 0 10px;font-size:14px;color:#b91c1c;"><strong>&#9888; Dead / constant feature(s): '
            f'{html_escape(", ".join(dead))}.</strong> One or more features are flatlined in the recent window '
            f'(a single value dominates) &mdash; usually a broken upstream field. These rows are excluded from '
            f'training by the sanity check, but the feed should be fixed.</p>'
        )
    if o_rate > o_thresh:
        parts.append(
            f'<p style="margin:0 0 10px;font-size:14px;color:#b91c1c;"><strong>&#9888; Feed quality issue.</strong> '
            f'{o_rate*100:.1f}% of recent rows are statistical outliers vs the training distribution '
            f'(threshold {o_thresh*100:.0f}%). This usually means an upstream feed is returning '
            f'plausible-but-wrong values &mdash; worth investigating before the next promotion.</p>'
        )
    if drifted:
        rows_html = "".join(
            f'<tr><td style="padding:3px 10px;font-size:13px;font-family:Arial">{html_escape(f)}</td>'
            f'<td style="padding:3px 10px;font-size:13px;font-family:Arial">PSI {drift[f]["psi"]}</td></tr>'
            for f in drifted
        )
        parts.append(
            f'<p style="margin:0 0 6px;font-size:14px;color:#92400e;"><strong>&#8505; Distribution drift.</strong> '
            f'These features have shifted vs earlier ingest (PSI &gt; {report.get("psi_threshold", 0.25)}):</p>'
            f'<table role="presentation" style="border-collapse:collapse;margin:0 0 10px;">{rows_html}</table>'
            f'<p style="margin:0 0 10px;font-size:13px;color:#6b7280;">Drift is often just seasonal change. '
            f'The weekly gated retrain adapts to it automatically; only dig in if a single feature spikes '
            f'unexpectedly or alongside the feed-quality warning above.</p>'
        )
    # A few random recent rows to eyeball (#4).
    sample = report.get("sample", []) or []
    sample_html = ""
    if sample:
        cols = ["acq_date", "fire", "source", "evi", "wind", "humidity", "elevation", "kbdi"]
        head = "".join(f'<th style="padding:3px 8px;text-align:left;font-size:11px;color:#6b7280;">{c}</th>' for c in cols)
        body = ""
        for r in sample:
            body += "<tr>" + "".join(
                f'<td style="padding:3px 8px;font-size:11px;border-top:1px solid #eee;">{html_escape(r.get(c, ""))}</td>'
                for c in cols) + "</tr>"
        sample_html = (
            '<p style="margin:14px 0 4px;font-size:13px;color:#374151;"><strong>Random sample of recent rows</strong> '
            '(eyeball check):</p>'
            f'<table role="presentation" style="border-collapse:collapse;width:100%;"><tr>{head}</tr>{body}</table>'
        )
    html = (
        f'<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:680px;">'
        f'<h2 style="margin:0 0 6px;font-size:18px;">FireScope training-data health</h2>'
        f'<p style="margin:0 0 12px;font-size:13px;color:#6b7280;">Layer-2 statistical check on the '
        f'rolling ingest ({report.get("recent_rows","?")} recent rows vs '
        f'{report.get("earlier_rows","?")} earlier; outliers vs '
        f'{report.get("base_rows",0)+report.get("daily_rows",0)} training rows).</p>'
        f'{"".join(parts)}'
        f'{sample_html}'
        f'<pre style="background:#f6f8fa;border:1px solid #e5e7eb;border-radius:6px;padding:12px;'
        f'font-size:11px;white-space:pre-wrap;margin-top:12px;">{html_escape(json.dumps(report, indent=2))}</pre>'
        f'</div>'
    )
    try:
        flags = []
        if dead:
            flags.append(f"dead:{'/'.join(dead)}")
        if o_rate > o_thresh:
            flags.append("feed-quality")
        if drifted:
            flags.append(f"drift:{'/'.join(drifted)}")
        subject = "FireScope data health: " + (", ".join(flags) if flags else "ok")
        resp = resend.Emails.send({
            "from": f"{sender_name} <{sender_email}>",
            "to": [PROMOTION_EMAIL_TO],
            "subject": subject[:120],
            "html": html,
            "text": json.dumps(report, indent=2),
        })
        return resp.get("id"), None
    except Exception as e:
        logger.warning("data-health email failed: %s", e)
        return None, str(e)


@ml_ingest_bp.route("/internal/ml/data-health", methods=["POST"])
def data_health():
    """Layer-2 data-quality monitor: outlier rate + distribution drift over the
    rolling ingest. Emails the owner when unhealthy (unless ?notify=0). Returns
    the full report so the caller (weekly workflow) can log it."""
    expected = os.getenv("INTERNAL_CRON_TOKEN", "")
    if not expected:
        return jsonify({"error": "INTERNAL_CRON_TOKEN not configured"}), 500
    if request.headers.get("X-Internal-Token", "") != expected:
        return jsonify({"error": "invalid X-Internal-Token"}), 401

    try:
        from ml.data_quality import health_report
    except Exception as e:
        return jsonify({"error": f"data_quality import failed: {e}"}), 500

    report = health_report()
    notify = request.args.get("notify", "1") != "0"
    # digest=1 forces a weekly summary email even when healthy (so you always get
    # the row sample to eyeball); otherwise we only email when something's wrong.
    digest = request.args.get("digest", "0") == "1"
    emailed, email_err = False, None
    if notify and (digest or not report.get("healthy", True)):
        _id, email_err = _send_data_health_email(report)
        emailed = _id is not None
    return jsonify({"ok": True, "emailed": emailed, "email_error": email_err,
                    "report": report}), 200


def _send_alert_email(subject: str, message: str):
    """Generic ops alert to the model owner (feed outages, low backtest recall,
    feature mismatches). Same Resend path as the other notifications."""
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
    html = (
        f'<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:640px;">'
        f'<h2 style="font-size:17px;margin:0 0 8px;">{html_escape(subject)}</h2>'
        f'<pre style="background:#f6f8fa;border:1px solid #e5e7eb;border-radius:6px;padding:12px;'
        f'font-size:12px;white-space:pre-wrap;">{html_escape(message)}</pre></div>'
    )
    try:
        resp = resend.Emails.send({
            "from": f"{sender_name} <{sender_email}>",
            "to": [PROMOTION_EMAIL_TO],
            "subject": ("FireScope: " + subject)[:120],
            "html": html, "text": message,
        })
        return resp.get("id"), None
    except Exception as e:
        logger.warning("alert email failed: %s", e)
        return None, str(e)


@ml_ingest_bp.route("/internal/ml/alert", methods=["POST"])
def alert():
    """Generic ops alert (#3 feed-outage etc.). Body: {subject, message}."""
    expected = os.getenv("INTERNAL_CRON_TOKEN", "")
    if not expected:
        return jsonify({"error": "INTERNAL_CRON_TOKEN not configured"}), 500
    if request.headers.get("X-Internal-Token", "") != expected:
        return jsonify({"error": "invalid X-Internal-Token"}), 401
    body = request.get_json(silent=True) or {}
    mid, err = _send_alert_email(str(body.get("subject", "alert")), str(body.get("message", "")))
    if err:
        return jsonify({"ok": False, "error": err}), 502
    return jsonify({"ok": True, "id": mid}), 200


# Backtest (#5): of recent REAL fires, what fraction did the live model rate
# High+ beforehand? A recall sanity check on the model that's actually serving.
BACKTEST_RECALL_THRESHOLD = 0.5
BACKTEST_BUDGET_SECONDS = 45


@ml_ingest_bp.route("/internal/ml/backtest", methods=["POST"])
def backtest():
    expected = os.getenv("INTERNAL_CRON_TOKEN", "")
    if not expected:
        return jsonify({"error": "INTERNAL_CRON_TOKEN not configured"}), 500
    if request.headers.get("X-Internal-Token", "") != expected:
        return jsonify({"error": "invalid X-Internal-Token"}), 401

    days = int(request.args.get("days", 3))
    try:
        fires, _ = _fetch_firms(days)
    except Exception as e:
        return jsonify({"error": f"FIRMS fetch failed: {e}"}), 502
    try:
        from ml.inference import predict_from_features
    except Exception as e:
        return jsonify({"error": f"inference import failed: {e}"}), 500

    start = time.monotonic()
    scores = []
    for lat, lon, acq in fires[:30]:
        if time.monotonic() - start > BACKTEST_BUDGET_SECONDS:
            break
        try:
            # Score with weather AT the fire's date (archive), not current weather,
            # so the recall metric reflects conditions the fire actually burned in.
            f = _features_for_date(lat, lon, acq)
            r = predict_from_features(f["evi"], f["air_temp_encoded"], f["wind"],
                                      f["humidity"], f["elevation"], f["kbdi"])
            scores.append(float(r["risk_score"]))
        except Exception:
            continue

    n = len(scores)
    if n == 0:
        return jsonify({"ok": True, "report": {"n": 0, "note": "no recent fires to score"}}), 200
    recall_high = sum(1 for s in scores if s >= 0.40) / n
    report = {
        "n": n,
        "recall_at_high": round(recall_high, 3),
        "recall_at_moderate": round(sum(1 for s in scores if s >= 0.20) / n, 3),
        "avg_risk_on_real_fires": round(sum(scores) / n, 3),
        "recall_threshold": BACKTEST_RECALL_THRESHOLD,
    }
    healthy = recall_high >= BACKTEST_RECALL_THRESHOLD
    emailed = False
    if request.args.get("notify", "1") != "0" and not healthy:
        msg = (json.dumps(report, indent=2) +
               f"\n\nThe live model rated only {recall_high*100:.0f}% of {n} recent real fires as "
               f"High+ risk beforehand (threshold {BACKTEST_RECALL_THRESHOLD*100:.0f}%). "
               f"This suggests the model is under-calling real fire conditions — worth investigating "
               f"the features or training data.")
        _id, _ = _send_alert_email("model backtest: low recall on recent fires", msg)
        emailed = _id is not None
    return jsonify({"ok": True, "healthy": healthy, "emailed": emailed, "report": report}), 200


# Feature audit (#6): cross-validate CACHED elevation against an independent DEM
# (Open-Meteo elevation API). Elevation is static, so a large disagreement means
# a corrupt cached tile or a bad source. EVI/KBDI have no easy second provider,
# so they are NOT cross-validated here (honest scope).
_OPEN_METEO_ELEV = "https://api.open-meteo.com/v1/elevation"
FEATURE_AUDIT_ELEV_TOL = 120.0  # meters; DEMs agree well within this for terrain


def _elevation_second(lat, lon):
    try:
        r = requests.get(_OPEN_METEO_ELEV, params={"latitude": lat, "longitude": lon}, timeout=6)
        r.raise_for_status()
        return float(r.json()["elevation"][0])
    except Exception:
        return None


@ml_ingest_bp.route("/internal/ml/feature-audit", methods=["POST"])
def feature_audit():
    expected = os.getenv("INTERNAL_CRON_TOKEN", "")
    if not expected:
        return jsonify({"error": "INTERNAL_CRON_TOKEN not configured"}), 500
    if request.headers.get("X-Internal-Token", "") != expected:
        return jsonify({"error": "invalid X-Internal-Token"}), 401

    rng = random.Random(20260619)
    lon0, lat0, lon1, lat1 = CA_BBOX
    checked, mismatches = [], []
    tries = 0
    start = time.monotonic()
    while len(checked) < 8 and tries < 4000 and time.monotonic() - start < 40:
        tries += 1
        la, lo = rng.uniform(lat0, lat1), rng.uniform(lon0, lon1)
        if not on_ca_land(la, lo):
            continue
        try:
            cached = float(get_feature(la, lo, "elevation"))
        except Exception:
            continue
        second = _elevation_second(la, lo)
        if second is None:
            continue
        rec = {"lat": round(la, 4), "lon": round(lo, 4),
               "cached": round(cached, 1), "independent": round(second, 1),
               "diff": round(abs(cached - second), 1)}
        checked.append(rec)
        if abs(cached - second) > FEATURE_AUDIT_ELEV_TOL:
            mismatches.append(rec)

    report = {"checked": len(checked), "mismatches": len(mismatches),
              "tolerance_m": FEATURE_AUDIT_ELEV_TOL, "detail": mismatches,
              "note": "elevation cross-validated vs Open-Meteo DEM; EVI/KBDI not cross-validated"}
    emailed = False
    if request.args.get("notify", "1") != "0" and mismatches:
        _id, _ = _send_alert_email("feature audit: cached elevation mismatch", json.dumps(report, indent=2))
        emailed = _id is not None
    return jsonify({"ok": True, "healthy": not mismatches, "emailed": emailed, "report": report}), 200
