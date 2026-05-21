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
# CAL FIRE DINS (Damage Inspection Program) — statewide consolidated layer.
# The previous CALFIRE_Damage_INSpection_DINS_data layer was retired; the
# authoritative endpoint is now POSTFIRE_MASTER_DATA_SHARE on services1
# (132k+ structures, 2013→present, INCIDENTSTARTDATE for year filtering).
DINS_DEFAULT_URL = (
    "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/"
    "POSTFIRE_MASTER_DATA_SHARE/FeatureServer/0/query"
)
DINS_PAGE_SIZE = 2000  # ArcGIS hosted-FS hard cap

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
    cache_key = f"history_perimeters:{year_from}:{year_to}:{min_acres}"

    def _compute():
        try:
            r = http_requests.get(PERIMETERS_URL, params=params, timeout=30)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            logger.warning('history perimeters fetch failed (%s): %s', cache_key, e)
            return {'type': 'FeatureCollection', 'features': []}
        # Coord truncation to 5 decimals (~1.1m precision) — drops payload ~30% on
        # 12MB-class GeoJSONs without any visible loss at state-zoom display.
        def _trunc(coords):
            if isinstance(coords, (list, tuple)):
                if coords and isinstance(coords[0], (int, float)):
                    return [round(c, 5) if isinstance(c, float) else c for c in coords]
                return [_trunc(c) for c in coords]
            return coords
        for f in data.get('features', []) or []:
            geom = f.get('geometry') or {}
            if 'coordinates' in geom:
                geom['coordinates'] = _trunc(geom['coordinates'])
        return data

    from services.cache import serve_cached
    # Historical perimeters are immutable; tell browsers to keep them forever.
    return serve_cached(
        cache_key=cache_key,
        ttl_seconds=1800,
        compute_fn=_compute,
        db_freshness_seconds=30 * 86400,
        cache_control='public, max-age=86400, stale-while-revalidate=604800, immutable',
    )


@history_bp.route('/dins', methods=['GET'])
def history_dins():
    """Return CAL FIRE DINS (Damage INSpection) points filtered by incident year.

    Query params:
      year (int, REQUIRED) — incident year (2013 onward; CAL FIRE DINS coverage starts 2013).
      service (str, optional) — override upstream URL (for ad-hoc fire-specific DINS).

    Pages through ArcGIS's 2,000-row hard cap so big years (2018, 2020, 2025)
    return the full set in one response. Cached 1 h per year.
    """
    try:
        year = int(request.args.get('year')) if request.args.get('year') else None
    except Exception:
        year = None
    url = request.args.get('service') or DINS_DEFAULT_URL

    if year is None:
        # Don't pull the full 132k statewide set in one shot — force a year filter.
        return jsonify({'type': 'FeatureCollection', 'features': [],
                        'error': 'year query param is required'}), 400

    cache_key = f"history_dins:{url}:{year}"

    def _compute():
        # INCIDENTSTARTDATE is a date field; bracket it to the calendar year.
        where = (
            f"INCIDENTSTARTDATE >= DATE '{year}-01-01' AND "
            f"INCIDENTSTARTDATE < DATE '{year + 1}-01-01'"
        )
        base_params = {
            'where': where,
            'outFields': 'OBJECTID,DAMAGE,INCIDENTNAME,INCIDENTNUM,INCIDENTSTARTDATE,'
                         'CITY,COUNTY,STREETNUMBER,STREETNAME,STREETTYPE,'
                         'LATITUDE,LONGITUDE,STRUCTURETYPE,STRUCTURECATEGORY,YEARBUILT',
            'outSR': '4326',
            'f': 'geojson',
            'resultRecordCount': DINS_PAGE_SIZE,
        }
        features = []
        offset = 0
        try:
            for _ in range(20):
                params = {**base_params, 'resultOffset': offset}
                r = http_requests.get(url, params=params, timeout=30,
                                      headers={'User-Agent': 'FireScopeProxy/1.0'})
                r.raise_for_status()
                page = r.json() or {}
                page_feats = page.get('features') or []
                features.extend(page_feats)
                if len(page_feats) < DINS_PAGE_SIZE:
                    break
                offset += DINS_PAGE_SIZE
        except Exception as e:
            logger.warning('DINS proxy failed (year=%s): %s', year, e)
            return {'type': 'FeatureCollection', 'features': []}
        logger.info('DINS year=%s loaded %d structures', year, len(features))
        return {'type': 'FeatureCollection', 'features': features}

    from services.cache import serve_cached
    return serve_cached(
        cache_key=cache_key,
        ttl_seconds=3600,
        compute_fn=_compute,
        db_freshness_seconds=30 * 86400,
        cache_control='public, max-age=86400, stale-while-revalidate=604800, immutable',
    )


@history_bp.route('/admin/backfill-years', methods=['POST'])
def backfill_history_years():
    """One-time-then-forever backfill of historical perimeters + DINS into endpoint_cache.

    Iterates years in [from_year, to_year] inclusive. For each year, computes
    and caches both perimeters and DINS (if applicable — DINS starts 2013).
    Skips years already cached unless force=true. Chunkable so each call fits
    under gunicorn's 90s worker budget — pass small ranges from the cron.

    Query params:
      from_year (int, default 1950)
      to_year   (int, default current year)
      type      ('perimeters' | 'dins' | 'both', default 'both')
      force     ('true' to recompute even if cache row exists)

    Returns: {wrote, skipped, failed, total, elapsed_s, years_done}
    """
    import time as _time
    from sqlalchemy import select
    from models import db, EndpointCache

    now_y = _time.gmtime().tm_year
    try:
        y_from = int(request.args.get('from_year') or 1950)
        y_to   = int(request.args.get('to_year')   or now_y)
    except Exception:
        return jsonify({'error': 'from_year and to_year must be integers'}), 400
    kind  = (request.args.get('type') or 'both').lower()
    force = (request.args.get('force') or 'false').lower() == 'true'
    if y_from > y_to:
        return jsonify({'error': 'from_year must be <= to_year'}), 400

    start = _time.time()
    wrote = 0
    skipped = 0
    failed = 0
    years_done: list[int] = []

    def _cache_has(key: str) -> bool:
        try:
            return db.session.execute(
                select(EndpointCache.cache_key).where(EndpointCache.cache_key == key)
            ).first() is not None
        except Exception:
            return False

    with current_app.test_request_context():
        for year in range(y_from, y_to + 1):
            # Each iteration calls existing route handlers which use serve_cached.
            # We piggyback on serve_cached's write-through so endpoint_cache fills naturally.
            try:
                if kind in ('both', 'perimeters'):
                    key = f"history_perimeters:{year}:{year}:100"
                    if force or not _cache_has(key):
                        with current_app.test_request_context(
                            path=f"/api/history/perimeters?year={year}",
                            method='GET',
                        ):
                            resp = history_perimeters()
                            if resp.status_code == 200:
                                wrote += 1
                            else:
                                failed += 1
                    else:
                        skipped += 1
                if kind in ('both', 'dins') and year >= 2013:
                    key = f"history_dins:{DINS_DEFAULT_URL}:{year}"
                    if force or not _cache_has(key):
                        with current_app.test_request_context(
                            path=f"/api/history/dins?year={year}",
                            method='GET',
                        ):
                            resp = history_dins()
                            # history_dins returns tuple on bad year — skip
                            if hasattr(resp, 'status_code') and resp.status_code == 200:
                                wrote += 1
                            else:
                                failed += 1
                    else:
                        skipped += 1
                years_done.append(year)
            except Exception as e:
                logger.warning("backfill year %s failed: %s", year, e)
                failed += 1
            # Soft cap: stop if approaching gunicorn budget
            if _time.time() - start > 75:
                break

    elapsed = round(_time.time() - start, 1)
    logger.info("backfill: wrote=%d skipped=%d failed=%d done=%s elapsed=%ss",
                wrote, skipped, failed, years_done, elapsed)
    return jsonify({
        'wrote': wrote,
        'skipped': skipped,
        'failed': failed,
        'years_done': years_done,
        'last_year_processed': years_done[-1] if years_done else None,
        'requested_range': [y_from, y_to],
        'elapsed_s': elapsed,
    })
