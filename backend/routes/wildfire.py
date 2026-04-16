"""Aggregate current California wildfire incidents from multiple feeds.

Pulls from:
  - CAL FIRE (official state incidents)
  - WFIGS / NIFC Interagency (captures small/new fires often before CAL FIRE lists them)

De-duplicates by name + ~15km proximity, sorts newest first, and exposes a single
shape the frontend can render on the map and list in Active Alerts.
"""
import math
import time
import logging
import requests as http_requests
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)
wildfire_bp = Blueprint('wildfire', __name__)

CALFIRE_URL = "https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List"
WFIGS_URL = (
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/"
    "WFIGS_Incident_Locations_YearToDate/FeatureServer/0/query"
)

_cache: dict = {}
CACHE_TTL = 300  # 5 minutes


def _haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _norm_name(s):
    return "".join(c for c in (s or "").lower() if c.isalnum())


def _fetch_calfire():
    try:
        r = http_requests.get(CALFIRE_URL, params={"inactive": "false"}, timeout=12)
        r.raise_for_status()
        items = r.json() or []
    except Exception as e:
        logger.warning("CAL FIRE fetch failed: %s", e)
        return []
    out = []
    for d in items:
        lat, lon = d.get("Latitude"), d.get("Longitude")
        if not lat or not lon:
            continue
        try:
            pct = int(float(d.get("PercentContained") or 0))
        except Exception:
            pct = 0
        out.append({
            "name": d.get("Name") or "Unknown Fire",
            "lat": float(lat),
            "lon": float(lon),
            "acres": d.get("AcresBurned"),
            "contained": pct,
            "started": d.get("Started") or d.get("StartedDateOnly"),
            "county": d.get("County"),
            "source": "CAL FIRE",
            "source_url": d.get("Url") or "https://www.fire.ca.gov/incidents",
            "active": d.get("IsActive") is not False,
        })
    return out


def _fetch_wfigs():
    params = {
        "where": "POOState='US-CA' AND IncidentTypeCategory='WF'",
        "outFields": (
            "IncidentName,IrwinID,DailyAcres,PercentContained,"
            "FireDiscoveryDateTime,POOCounty,IncidentTypeCategory,IsFireCauseDetermined"
        ),
        "f": "geojson",
        "resultRecordCount": 2000,
    }
    try:
        r = http_requests.get(WFIGS_URL, params=params, timeout=15)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.warning("WFIGS fetch failed: %s", e)
        return []
    out = []
    for f in (data or {}).get("features", []) or []:
        coords = (f.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        props = f.get("properties") or {}
        discovery = props.get("FireDiscoveryDateTime")
        # ArcGIS returns epoch ms
        started_iso = None
        try:
            if discovery is not None:
                started_iso = time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(discovery) / 1000)
                )
        except Exception:
            pass
        try:
            pct = int(float(props.get("PercentContained") or 0))
        except Exception:
            pct = 0
        out.append({
            "name": props.get("IncidentName") or "Unnamed Incident",
            "lat": float(coords[1]),
            "lon": float(coords[0]),
            "acres": props.get("DailyAcres"),
            "contained": pct,
            "started": started_iso,
            "county": props.get("POOCounty"),
            "source": "NIFC / WFIGS",
            "source_url": (
                "https://www.arcgis.com/apps/dashboards/"
                "f81bc11dc4e14f6fb38567c185b02dba"
            ),
            "active": True,
            "irwin_id": props.get("IrwinID"),
        })
    return out


def _started_epoch(item):
    s = item.get("started")
    if not s:
        return 0.0
    try:
        return time.mktime(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S"))
    except Exception:
        try:
            return time.mktime(time.strptime(s[:10], "%Y-%m-%d"))
        except Exception:
            return 0.0


def _merge(all_items):
    """Dedup by normalized name OR position within 15 km. Keep the most recent entry,
    preferring CAL FIRE's official record when close matches are found."""
    buckets: list[dict] = []
    for item in sorted(all_items, key=lambda x: _started_epoch(x), reverse=True):
        nm = _norm_name(item.get("name"))
        matched = None
        for b in buckets:
            if nm and nm == _norm_name(b.get("name")):
                matched = b
                break
            if (
                _haversine_km(item["lat"], item["lon"], b["lat"], b["lon"]) < 15
                and nm
                and _norm_name(b.get("name"))
                and (nm in _norm_name(b.get("name")) or _norm_name(b.get("name")) in nm)
            ):
                matched = b
                break
        if matched:
            # prefer CAL FIRE source label if we find it
            if item.get("source") == "CAL FIRE" and matched.get("source") != "CAL FIRE":
                matched["source"] = "CAL FIRE"
                matched["source_url"] = item.get("source_url")
            # fill in any missing fields
            for k, v in item.items():
                if not matched.get(k) and v:
                    matched[k] = v
        else:
            buckets.append(dict(item))
    return buckets


@wildfire_bp.route('/wildfire/recent', methods=['GET'])
def wildfire_recent():
    """Return all currently active California wildfire incidents from CAL FIRE + WFIGS."""
    now = time.time()
    cached = _cache.get("all")
    if cached and (now - cached[0]) < CACHE_TTL:
        items = cached[1]
    else:
        items = _merge(_fetch_calfire() + _fetch_wfigs())
        _cache["all"] = (now, items)

    # Optional filter: last N hours
    try:
        hours = int(request.args.get("hours") or 0)
    except Exception:
        hours = 0
    if hours > 0:
        cutoff = now - hours * 3600
        items = [i for i in items if _started_epoch(i) >= cutoff]

    # Sort newest first
    items = sorted(items, key=lambda x: _started_epoch(x), reverse=True)
    resp = jsonify({"items": items, "count": len(items), "generated_at": int(now)})
    resp.headers['Cache-Control'] = 'public, max-age=120'
    return resp
