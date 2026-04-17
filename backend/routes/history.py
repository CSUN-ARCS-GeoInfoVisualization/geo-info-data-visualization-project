"""Historical fire data proxies.

Current implementation (option 2 — live proxy):
  GET /api/history/perimeters?year_from=2000&year_to=2024
  GET /api/history/dins?year=2024

Both hit CAL FIRE's public ArcGIS FeatureServers and return GeoJSON ready for
the frontend's history page to render. 1-hour in-memory cache keyed by query.

Planned option 3 — in-house ML training snapshots (future work):
  * Add SQLAlchemy model ActiveFireSnapshot with columns:
      date (UTC timestamp), latitude, longitude,
      evi, ta (MODIS thermal anomalies level), lst, wind, elevation,
      ndvi (vegetation cover), fire (binary outcome), incident_name, irwin_id,
      acres, contained_pct.
  * APScheduler job (hourly): iterate NIFC perimeter centroids, interpolate
    the feature grid values, snapshot one row per active fire.
  * GET /api/history/snapshots endpoint and a training pipeline that pulls
    this table, joins FIRMS hotspot points (positive "fire=1" samples) and
    random non-fire control points (fire=0), and retrains the scikit-learn
    model with the expanded feature set (adds TA and NDVI).
"""
import time
import logging
import requests as http_requests
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)
history_bp = Blueprint('history', __name__)

PERIMETERS_URL = (
    "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/"
    "California_Historic_Fire_Perimeters/FeatureServer/0/query"
)
# CAL FIRE publishes DINS (damage inspection) as separate FeatureServers per
# incident. The consolidated "POSTFIRE_MASTER_DATA" layer lives on a different
# endpoint and changes over time, so we accept a `service` override and default
# to the most recent consolidated layer we have verified.
DINS_DEFAULT_URL = (
    "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/"
    "CALFIRE_Damage_INSpection_DINS_data/FeatureServer/0/query"
)

_cache: dict = {}
CACHE_TTL = 3600  # 1 hour


def _cached_fetch(cache_key: str, url: str, params: dict):
    now = time.time()
    hit = _cache.get(cache_key)
    if hit and (now - hit[0]) < CACHE_TTL:
        return hit[1]
    try:
        r = http_requests.get(url, params=params, timeout=30)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.warning('history upstream fetch failed (%s): %s', cache_key, e)
        data = {'type': 'FeatureCollection', 'features': []}
    _cache[cache_key] = (now, data)
    return data


@history_bp.route('/perimeters/years', methods=['GET'])
def history_perimeter_years():
    """Distinct years present in CAL FIRE's historic perimeter dataset (1878-present).

    Uses outStatistics (min/max) so we only hit ArcGIS once, then fill the range.
    """
    cache_key = "perimeters-years"
    now = time.time()
    hit = _cache.get(cache_key)
    if hit and (now - hit[0]) < 24 * 3600:
        return jsonify(hit[1])
    params = {
        'where': '1=1',
        'outStatistics': (
            '[{"statisticType":"min","onStatisticField":"YEAR_","outStatisticFieldName":"minY"},'
            '{"statisticType":"max","onStatisticField":"YEAR_","outStatisticFieldName":"maxY"}]'
        ),
        'f': 'json',
    }
    try:
        r = http_requests.get(PERIMETERS_URL, params=params, timeout=20)
        r.raise_for_status()
        stats = r.json().get('features', [{}])[0].get('attributes', {})
        min_y = int(stats.get('minY') or 1900)
        max_y = int(stats.get('maxY') or time.gmtime().tm_year)
    except Exception as e:
        logger.warning('history years stat failed: %s', e)
        min_y, max_y = 1950, time.gmtime().tm_year
    years = list(range(max_y, min_y - 1, -1))  # newest first
    payload = {'min': min_y, 'max': max_y, 'years': years}
    _cache[cache_key] = (now, payload)
    return jsonify(payload)


@history_bp.route('/perimeters', methods=['GET'])
def history_perimeters():
    """Return California historic fire perimeters.

    Query params (choose one):
      year (int)                 — single year.
      year_from/year_to (ints)   — inclusive range.
      If neither is given, defaults to the last 5 years so the page loads fast.

      min_acres (int, default 100) — drop sub-100-acre polygons for performance.
                                     Each year has up to several thousand records
                                     below this threshold that slow rendering.
    """
    y = request.args.get('year')
    if y:
        try:
            y = int(y)
            year_from, year_to = y, y
        except Exception:
            year_from, year_to = None, None
    else:
        try:
            year_from = int(request.args.get('year_from') or (time.gmtime().tm_year - 4))
        except Exception:
            year_from = time.gmtime().tm_year - 4
        try:
            year_to = int(request.args.get('year_to') or time.gmtime().tm_year)
        except Exception:
            year_to = time.gmtime().tm_year
    try:
        min_acres = int(request.args.get('min_acres') or 100)
    except Exception:
        min_acres = 100

    where = f"YEAR_ >= {year_from} AND YEAR_ <= {year_to} AND GIS_ACRES >= {min_acres}"
    params = {
        'where': where,
        'outFields': 'OBJECTID,YEAR_,FIRE_NAME,INC_NUM,ALARM_DATE,CONT_DATE,CAUSE,AGENCY,UNIT_ID,GIS_ACRES,COMPLEX_NAME,IRWINID',
        'f': 'geojson',
        'resultRecordCount': 4000,
        'orderByFields': 'GIS_ACRES DESC',
    }
    cache_key = f"perimeters::{year_from}::{year_to}::{min_acres}"
    data = _cached_fetch(cache_key, PERIMETERS_URL, params)
    resp = jsonify(data)
    resp.headers['Cache-Control'] = 'public, max-age=1800'
    return resp


@history_bp.route('/dins', methods=['GET'])
def history_dins():
    """Return CAL FIRE DINS (Damage INSpection) points, optionally filtered by year.

    Query params:
      year (int, optional) — filter by incident year.
      service (str, optional) — override upstream URL (for ad-hoc fire-specific DINS).
    """
    try:
        year = int(request.args.get('year')) if request.args.get('year') else None
    except Exception:
        year = None
    url = request.args.get('service') or DINS_DEFAULT_URL
    where = f"YEAR_ = {year}" if year else "1=1"
    params = {
        'where': where,
        'outFields': '*',
        'f': 'geojson',
        'resultRecordCount': 5000,
    }
    cache_key = f"dins::{url}::{year}"
    data = _cached_fetch(cache_key, url, params)
    resp = jsonify(data)
    resp.headers['Cache-Control'] = 'public, max-age=1800'
    return resp
