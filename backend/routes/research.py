"""Research data endpoint — FIRMS hotspots and risk predictions for the researcher map."""

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeoutError
from datetime import datetime, timedelta, timezone

import threading

import requests
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt

from ml.inference import predict_from_features, predict_batch_features
from data.sample_locations import SAMPLE_LOCATIONS
from data.live_weather import get_weather
from data.features import get_feature
from models import db, ZoneRiskCache

research_bp = Blueprint('research', __name__)
logger = logging.getLogger(__name__)

_BOUNDARIES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'boundaries')
_VALID_BOUNDARIES = {'zip-codes', 'census-tracts', 'neighborhoods'}

# Risk grid cache (expensive computation)
_grid_cache: dict = {"expires": 0.0, "data": None, "params": None}
_GRID_CACHE_TTL = 900  # 15 minutes

FIRMS_MAP_KEY = os.getenv('FIRMS_MAP_KEY', '')
FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv'


@research_bp.route('/boundaries/<name>', methods=['GET'])
def get_boundaries(name):
    """Serve simplified GeoJSON boundary files (public, no auth).

    Boundary files only change on redeploy, so we send a 24h browser cache.
    Cuts a 1-3MB re-download to a 304/from-cache hit when users navigate
    between pages or toggle overlays.
    """
    if name not in _VALID_BOUNDARIES:
        return jsonify({'error': 'Invalid boundary type'}), 404
    filepath = os.path.join(_BOUNDARIES_DIR, f'{name}.json')
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404
    import json as json_mod
    with open(filepath) as f:
        data = json_mod.load(f)
    resp = jsonify(data)
    resp.headers['Cache-Control'] = 'public, max-age=86400, stale-while-revalidate=604800'
    return resp


def _get_centroid(coords):
    """Calculate centroid from GeoJSON coordinates."""
    lat_sum, lon_sum, count = 0.0, 0.0, 0
    def _flatten(c):
        nonlocal lat_sum, lon_sum, count
        if isinstance(c[0], (int, float)):
            lon_sum += c[0]; lat_sum += c[1]; count += 1
        else:
            for sub in c:
                _flatten(sub)
    _flatten(coords)
    return (lat_sum / count, lon_sum / count) if count > 0 else None


_zone_risk_cache: dict = {}

# Locks so two simultaneous requests don't both kick off the same recompute.
_zone_recompute_locks: dict[str, threading.Lock] = {}
_zone_recompute_locks_guard = threading.Lock()


def _lock_for(cache_key: str) -> threading.Lock:
    with _zone_recompute_locks_guard:
        lock = _zone_recompute_locks.get(cache_key)
        if lock is None:
            lock = threading.Lock()
            _zone_recompute_locks[cache_key] = lock
        return lock


def _load_cache_from_db(cache_key: str) -> dict | None:
    """Read a previously-computed payload out of Postgres. Never raises."""
    try:
        row = ZoneRiskCache.query.get(cache_key)
        if not row:
            return None
        return {
            "data": row.payload,
            "computed_at": row.computed_at.timestamp() if row.computed_at else 0.0,
        }
    except Exception as e:
        logger.warning("zone_risk_cache DB read failed for %s: %s", cache_key, e)
        try:
            db.session.rollback()
        except Exception:
            pass
        return None


def _save_cache_to_db(cache_key: str, payload: dict) -> None:
    """Persist a payload so it survives Render redeploys. Never raises."""
    try:
        row = ZoneRiskCache.query.get(cache_key)
        if row is None:
            row = ZoneRiskCache(cache_key=cache_key, payload=payload)
            db.session.add(row)
        else:
            row.payload = payload
        db.session.commit()
    except Exception as e:
        logger.warning("zone_risk_cache DB write failed for %s: %s", cache_key, e)
        try:
            db.session.rollback()
        except Exception:
            pass


def _spawn_background_refresh(app, cache_key: str, recompute_fn) -> None:
    """Recompute a stale cache entry off the request thread."""
    lock = _lock_for(cache_key)
    if not lock.acquire(blocking=False):
        return  # someone else is already refreshing this key

    def _runner():
        try:
            with app.app_context():
                fresh = recompute_fn()
                if fresh is not None:
                    _zone_risk_cache[cache_key] = {"data": fresh, "expires": time.time() + _GRID_CACHE_TTL}
                    _save_cache_to_db(cache_key, fresh)
        except Exception as e:
            logger.warning("background refresh failed for %s: %s", cache_key, e)
        finally:
            lock.release()

    threading.Thread(target=_runner, name=f"zone-refresh-{cache_key}", daemon=True).start()


def _compute_zone_risk(zone_type: str) -> dict | None:
    """Heavy path: load boundaries, fetch live weather, batch-predict per centroid."""
    filepath = os.path.join(_BOUNDARIES_DIR, f'{zone_type}.json')
    if not os.path.exists(filepath):
        return None

    import json as json_mod
    with open(filepath) as f:
        geo = json_mod.load(f)

    name_key = 'zip' if zone_type == 'zip-codes' else 'name' if zone_type == 'neighborhoods' else 'tract'

    features_list = geo.get('features', [])
    max_samples = 120 if zone_type == 'census-tracts' else 200
    step = max(1, len(features_list) // max_samples)

    # Collect sampled centroids
    sampled = []  # (name, lat, lon)
    for i in range(0, len(features_list), step):
        f = features_list[i]
        name = f.get('properties', {}).get(name_key, str(i))
        coords = f.get('geometry', {}).get('coordinates')
        if not coords:
            continue
        centroid = _get_centroid(coords)
        if not centroid:
            continue
        sampled.append((name, centroid[0], centroid[1]))

    # Fetch live weather for all centroids in parallel.
    # If Open-Meteo rate-limits or stalls, keep whatever returned and fall through
    # to the interpolated path for the rest — never 500 the whole map overlay.
    live_weather: dict[str, dict | None] = {}
    executor = ThreadPoolExecutor(max_workers=_WEATHER_WORKERS)
    try:
        futures = {executor.submit(_fetch_live_weather, lat, lon): name for name, lat, lon in sampled}
        try:
            for future in as_completed(futures, timeout=20):
                try:
                    live_weather[futures[future]] = future.result()
                except Exception:
                    live_weather[futures[future]] = None
        except Exception as e:
            logger.warning("zone weather fetch partial (%s): kept %d/%d", e, len(live_weather), len(futures))
            for fut, name in futures.items():
                if not fut.done():
                    fut.cancel()
    finally:
        executor.shutdown(wait=False)

    # Parallel-fetch EVI / elevation / KBDI for every centroid so a batch of
    # cold cache misses doesn't blow gunicorn's request timeout. Worker
    # threads need Flask app context to use db.session — pass it explicitly.
    static_features: dict[str, dict] = {}
    app_obj = current_app._get_current_object()
    feat_executor = ThreadPoolExecutor(max_workers=_WEATHER_WORKERS)
    try:
        def _load_static(lat_lon):
            lat_, lon_ = lat_lon
            with app_obj.app_context():
                return {
                    "evi":  get_feature(lat_, lon_, "evi"),
                    "elev": get_feature(lat_, lon_, "elevation"),
                    "kbdi": get_feature(lat_, lon_, "kbdi"),
                }
        futures = {feat_executor.submit(_load_static, (lat, lon)): name for name, lat, lon in sampled}
        try:
            for fut in as_completed(futures, timeout=45):
                try:
                    static_features[futures[fut]] = fut.result()
                except Exception:
                    static_features[futures[fut]] = {"evi": 0.0, "elev": 0.0, "kbdi": 200.0}
        except (TimeoutError, FuturesTimeoutError):
            # Whatever finished, ship. Unfinished centroids will use the in-loop
            # IDW fallback below — progressive cache warming over future requests.
            logger.warning("zone feature fetch partial: %d/%d finished within budget",
                           len(static_features), len(futures))
            for fut, name in futures.items():
                if not fut.done():
                    fut.cancel()
    finally:
        feat_executor.shutdown(wait=False)

    sampled_names = []
    sampled_inputs = []  # (evi, air_temp_encoded, wind, humidity, elevation, kbdi) tuples
    sampled_quality = []  # 'live' | 'default' per centroid
    for name, lat, lon in sampled:
        sf_present = name in static_features
        sf = static_features.get(name, {"evi": 0.0, "elev": 0.0, "kbdi": 200.0})
        evi, elev, kbdi = sf["evi"], sf["elev"], sf["kbdi"]
        wx = live_weather.get(name)
        if wx:
            air_temp_encoded = wx["air_temp_encoded"]
            wind             = wx["wind"]
            humidity         = wx["humidity"]
        else:
            air_temp_encoded = get_feature(lat, lon, "air_temp_encoded")
            wind             = get_feature(lat, lon, "wind")
            humidity         = get_feature(lat, lon, "humidity")
        # 'live' means all 3 static + weather came from real sources.
        # 'default' means the parallel feature future didn't finish OR weather fell back.
        sampled_quality.append("live" if (sf_present and wx) else "default")
        sampled_names.append(name)
        sampled_inputs.append((evi, air_temp_encoded, wind, humidity, elev, kbdi))

    # Single batch prediction call (loads model once, predicts all at once via numpy)
    try:
        batch_results = predict_batch_features(sampled_inputs)
    except Exception as e:
        logger.warning("Batch prediction failed: %s", e)
        batch_results = [{"risk_score": 0, "label": "Low"}] * len(sampled_inputs)

    sampled_risk = {
        name: {**risk, "features": {"evi": evi, "air_temp_encoded": air_temp_encoded, "wind": wind, "humidity": humidity, "elevation": elev, "kbdi": kbdi}, "data_quality": q}
        for name, risk, (evi, air_temp_encoded, wind, humidity, elev, kbdi), q in zip(sampled_names, batch_results, sampled_inputs, sampled_quality)
    }

    # Propagate to all zones
    results = {}
    for i, f in enumerate(features_list):
        name = f.get('properties', {}).get(name_key, str(i))
        sampled_idx = (i // step) * step
        sampled_name = features_list[sampled_idx].get('properties', {}).get(name_key, str(sampled_idx)) if sampled_idx < len(features_list) else ""
        results[name] = sampled_risk.get(sampled_name, {"risk_score": 0, "label": "Low"})

    return {"zones": results, "zone_type": zone_type, "total": len(results)}


@research_bp.route('/risk-by-zone/<zone_type>', methods=['GET'])
def risk_by_zone(zone_type):
    """Serve ML risk per zone with three-tier caching: in-memory > Postgres > recompute."""
    if zone_type not in _VALID_BOUNDARIES:
        return jsonify({'error': 'Invalid zone type'}), 404

    now = time.time()
    cache_key = zone_type
    cached = _zone_risk_cache.get(cache_key)
    if cached and cached['expires'] > now:
        return jsonify(cached['data'])

    # In-memory cold (process restart, redeploy) — try Postgres before doing the heavy compute.
    db_cached = _load_cache_from_db(cache_key)
    if db_cached:
        age = now - db_cached['computed_at']
        _zone_risk_cache[cache_key] = {'data': db_cached['data'], 'expires': now + _GRID_CACHE_TTL}
        if age > _GRID_CACHE_TTL:
            # Stale on disk: serve immediately, refresh in background.
            _spawn_background_refresh(current_app._get_current_object(), cache_key, lambda: _compute_zone_risk(zone_type))
        return jsonify(db_cached['data'])

    # No cache anywhere — single-flight compute so concurrent requests for the
    # same zone_type share one computation instead of stampeding.
    lock = _lock_for(cache_key)
    with lock:
        cached = _zone_risk_cache.get(cache_key)
        if cached and cached['expires'] > now:
            return jsonify(cached['data'])
        data = _compute_zone_risk(zone_type)
        if data is None:
            return jsonify({'error': 'Boundary data not found'}), 404
        _zone_risk_cache[cache_key] = {'data': data, 'expires': now + _GRID_CACHE_TTL}
        _save_cache_to_db(cache_key, data)
    return jsonify(data)


def _require_researcher_or_admin():
    role = get_jwt().get('role', '')
    return role in ('Researcher', 'Admin')


@research_bp.route('/fire-data', methods=['GET'])
@jwt_required()
def fire_data():
    if not _require_researcher_or_admin():
        return jsonify({'error': 'Researcher or Admin access required'}), 403

    days = min(int(request.args.get('days', '7')), 30)
    confidence_min = int(request.args.get('confidence_min', '0'))
    frp_min = float(request.args.get('frp_min', '0'))

    features = []

    # Fetch FIRMS VIIRS data for California bounding box
    if FIRMS_MAP_KEY:
        try:
            url = (
                f"{FIRMS_BASE}/{FIRMS_MAP_KEY}/VIIRS_SNPP_NRT"
                f"/-124,32,-114,42/{days}/2025-01-01"
            )
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            lines = r.text.strip().split('\n')
            if len(lines) > 1:
                headers = lines[0].split(',')
                lat_i = headers.index('latitude') if 'latitude' in headers else None
                lon_i = headers.index('longitude') if 'longitude' in headers else None
                conf_i = headers.index('confidence') if 'confidence' in headers else None
                frp_i = headers.index('frp') if 'frp' in headers else None
                date_i = headers.index('acq_date') if 'acq_date' in headers else None

                for line in lines[1:]:
                    cols = line.split(',')
                    if lat_i is None or lon_i is None:
                        continue
                    try:
                        lat = float(cols[lat_i])
                        lon = float(cols[lon_i])
                        conf = cols[conf_i] if conf_i is not None else 'n'
                        frp = float(cols[frp_i]) if frp_i is not None else 0
                        acq_date = cols[date_i] if date_i is not None else ''
                    except (ValueError, IndexError):
                        continue

                    # Map confidence letters to numbers
                    conf_num = {'l': 30, 'n': 50, 'h': 80}.get(conf.lower(), 50)
                    if conf_num < confidence_min or frp < frp_min:
                        continue

                    features.append({
                        'type': 'Feature',
                        'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
                        'properties': {
                            'confidence': conf_num,
                            'frp': frp,
                            'acq_date': acq_date,
                            'layer': 'firms',
                        },
                    })
        except Exception as e:
            logger.warning('FIRMS fetch failed: %s', e)

    return jsonify({
        'type': 'FeatureCollection',
        'features': features,
        'meta': {'days': days, 'confidence_min': confidence_min, 'frp_min': frp_min},
    })


_WEATHER_WORKERS = 16


def _fetch_live_weather(lat: float, lon: float) -> dict | None:
    """Fetch live wind, humidity, and air_temp_encoded from Open-Meteo. Returns None on failure."""
    try:
        w = get_weather(lat, lon)
        return {
            "wind":             w["wind_speed"],
            "humidity":         w["humidity"],
            "air_temp_encoded": (w["temperature_celsius"] + 273.15) / 0.02,
        }
    except Exception:
        return None


# Former _interpolate_feature replaced by data.features.get_feature (imported above).
# The IDW logic now lives in data/features.py as the safety-net fallback.


def _build_risk_grid(evi_ov, air_temp_encoded_ov, wind_ov, humidity_ov, elev_ov, kbdi_ov=None):
    """Generate a grid of risk predictions across California."""
    features = []
    # Grid: lat 32.5-42, lon -124 to -114, step ~0.8 degrees = ~150 points
    lat_start, lat_end, lat_step = 32.5, 42.0, 0.8
    lon_start, lon_end, lon_step = -124.0, -114.0, 0.8

    lat = lat_start
    while lat <= lat_end:
        lon = lon_start
        while lon <= lon_end:
            # Use overrides if provided, otherwise route through get_feature
            evi              = evi_ov if evi_ov is not None else get_feature(lat, lon, "evi")
            air_temp_encoded = air_temp_encoded_ov if air_temp_encoded_ov is not None else get_feature(lat, lon, "air_temp_encoded")
            wind             = wind_ov if wind_ov is not None else get_feature(lat, lon, "wind")
            humidity         = humidity_ov if humidity_ov is not None else get_feature(lat, lon, "humidity")
            elev             = elev_ov if elev_ov is not None else get_feature(lat, lon, "elevation")
            kbdi             = kbdi_ov if kbdi_ov is not None else get_feature(lat, lon, "kbdi")

            try:
                result = predict_from_features(evi, air_temp_encoded, wind, humidity, elev, kbdi)
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "risk_score": result["risk_score"],
                        "label": result["label"],
                        "evi": round(evi, 1),
                        "air_temp_encoded": round(air_temp_encoded, 1),
                        "wind": round(wind, 1),
                        "humidity": round(humidity, 1),
                        "elevation": round(elev, 1),
                        "kbdi": round(kbdi, 1),
                        "layer": "risk_grid",
                    },
                })
            except Exception as e:
                logger.debug("Grid point (%s,%s) failed: %s", lat, lon, e)
            lon += lon_step
        lat += lat_step

    return features


# California county centroids for risk prediction
CA_COUNTY_CENTROIDS = [
    ("Alameda", 37.65, -121.89), ("Alpine", 38.60, -119.82), ("Amador", 38.45, -120.65),
    ("Butte", 39.67, -121.60), ("Calaveras", 38.20, -120.55), ("Colusa", 39.18, -122.24),
    ("Contra Costa", 37.92, -121.95), ("Del Norte", 41.74, -123.90), ("El Dorado", 38.78, -120.52),
    ("Fresno", 36.95, -119.65), ("Glenn", 39.60, -122.39), ("Humboldt", 40.70, -123.87),
    ("Imperial", 33.04, -115.36), ("Inyo", 36.54, -117.99), ("Kern", 35.35, -118.73),
    ("Kings", 36.07, -119.82), ("Lake", 39.10, -122.75), ("Lassen", 40.67, -120.73),
    ("Los Angeles", 34.32, -118.22), ("Madera", 37.22, -119.76), ("Marin", 38.08, -122.72),
    ("Mariposa", 37.58, -119.97), ("Mendocino", 39.44, -123.39), ("Merced", 37.19, -120.72),
    ("Modoc", 41.59, -120.72), ("Mono", 37.94, -118.89), ("Monterey", 36.24, -121.31),
    ("Napa", 38.50, -122.33), ("Nevada", 39.30, -120.77), ("Orange", 33.72, -117.78),
    ("Placer", 39.06, -120.72), ("Plumas", 40.01, -120.84), ("Riverside", 33.74, -115.99),
    ("Sacramento", 38.45, -121.34), ("San Benito", 36.61, -121.08), ("San Bernardino", 34.84, -116.18),
    ("San Diego", 33.03, -116.74), ("San Francisco", 37.78, -122.42), ("San Joaquin", 37.93, -121.27),
    ("San Luis Obispo", 35.38, -120.45), ("San Mateo", 37.43, -122.36), ("Santa Barbara", 34.74, -119.80),
    ("Santa Clara", 37.23, -121.70), ("Santa Cruz", 37.06, -122.01), ("Shasta", 40.76, -122.04),
    ("Sierra", 39.58, -120.52), ("Siskiyou", 41.59, -122.54), ("Solano", 38.27, -121.93),
    ("Sonoma", 38.53, -122.93), ("Stanislaus", 37.56, -121.00), ("Sutter", 39.03, -121.69),
    ("Tehama", 40.13, -122.24), ("Trinity", 40.81, -123.01), ("Tulare", 36.23, -118.78),
    ("Tuolumne", 38.03, -119.97), ("Ventura", 34.36, -119.13), ("Yolo", 38.69, -121.90),
    ("Yuba", 39.29, -121.35),
]

_county_cache: dict = {"expires": 0.0, "data": None, "params": None}


def _compute_county_risk(evi_ov=None, air_temp_encoded_ov=None, wind_ov=None,
                         humidity_ov=None, elev_ov=None, kbdi_ov=None) -> dict:
    """Heavy path for /risk-by-county. Honors per-feature overrides."""
    # Fetch live weather in parallel for all counties (skip if all weather fields are overridden).
    # Same timeout-safe pattern as risk-by-zone: never let a stalled Open-Meteo call 500 the route.
    need_live = air_temp_encoded_ov is None or wind_ov is None or humidity_ov is None
    live_weather: dict[str, dict | None] = {}
    if need_live:
        executor = ThreadPoolExecutor(max_workers=_WEATHER_WORKERS)
        try:
            futures = {executor.submit(_fetch_live_weather, lat, lon): name for name, lat, lon in CA_COUNTY_CENTROIDS}
            try:
                for future in as_completed(futures, timeout=20):
                    try:
                        live_weather[futures[future]] = future.result()
                    except Exception:
                        live_weather[futures[future]] = None
            except Exception as e:
                logger.warning("county weather fetch partial (%s): kept %d/%d", e, len(live_weather), len(futures))
                for fut, name in futures.items():
                    if not fut.done():
                        fut.cancel()
        finally:
            executor.shutdown(wait=False)

    # Parallel-fetch EVI/elevation/KBDI across all 58 county centroids. Worker
    # threads need Flask app context for db.session — pass it explicitly.
    static_features: dict[str, dict] = {}
    need_static = (evi_ov is None) or (elev_ov is None) or (kbdi_ov is None)
    if need_static:
        app_obj = current_app._get_current_object()
        cf_exec = ThreadPoolExecutor(max_workers=_WEATHER_WORKERS)
        try:
            def _load_static(args):
                lat_, lon_ = args
                with app_obj.app_context():
                    return {
                        "evi":  evi_ov  if evi_ov  is not None else get_feature(lat_, lon_, "evi"),
                        "elev": elev_ov if elev_ov is not None else get_feature(lat_, lon_, "elevation"),
                        "kbdi": kbdi_ov if kbdi_ov is not None else get_feature(lat_, lon_, "kbdi"),
                    }
            futures = {cf_exec.submit(_load_static, (lat, lon)): name for name, lat, lon in CA_COUNTY_CENTROIDS}
            try:
                for fut in as_completed(futures, timeout=45):
                    try:
                        static_features[futures[fut]] = fut.result()
                    except Exception:
                        static_features[futures[fut]] = {"evi": 0.0, "elev": 0.0, "kbdi": 200.0}
            except (TimeoutError, FuturesTimeoutError):
                logger.warning("county feature fetch partial: %d/%d finished within budget",
                               len(static_features), len(futures))
                for fut, name in futures.items():
                    if not fut.done():
                        fut.cancel()
        finally:
            cf_exec.shutdown(wait=False)

    names = []
    inputs = []
    quality = []  # 'live' | 'default' per county
    for name, lat, lon in CA_COUNTY_CENTROIDS:
        sf_present = name in static_features
        sf = static_features.get(name, {"evi": evi_ov or 0.0, "elev": elev_ov or 0.0, "kbdi": kbdi_ov if kbdi_ov is not None else 200.0})
        evi, elev, kbdi = sf["evi"], sf["elev"], sf["kbdi"]
        wx   = live_weather.get(name)
        air_temp_encoded = air_temp_encoded_ov if air_temp_encoded_ov is not None else (wx["air_temp_encoded"] if wx else get_feature(lat, lon, "air_temp_encoded"))
        wind             = wind_ov             if wind_ov             is not None else (wx["wind"]             if wx else get_feature(lat, lon, "wind"))
        humidity         = humidity_ov         if humidity_ov         is not None else (wx["humidity"]         if wx else get_feature(lat, lon, "humidity"))
        quality.append("live" if (sf_present and wx) else "default")
        names.append(name)
        inputs.append((evi, air_temp_encoded, wind, humidity, elev, kbdi))
    try:
        batch = predict_batch_features(inputs)
    except Exception:
        batch = [{"risk_score": 0, "label": "Low"}] * len(inputs)
    results = {
        name: {
            **risk,
            "features": {"evi": evi, "air_temp_encoded": air_temp_encoded, "wind": wind, "humidity": humidity, "elevation": elev, "kbdi": kbdi},
            "data_quality": q,
        }
        for name, risk, (evi, air_temp_encoded, wind, humidity, elev, kbdi), q in zip(names, batch, inputs, quality)
    }

    return {"counties": results, "overrides": {"evi": evi_ov, "air_temp_encoded": air_temp_encoded_ov, "wind": wind_ov, "humidity": humidity_ov, "elevation": elev_ov, "kbdi": kbdi_ov}}


@research_bp.route('/risk-by-county', methods=['GET'])
def risk_by_county():
    """Return risk scores per California county — public endpoint, no auth required.

    Three-tier cache (in-memory > Postgres > recompute) only kicks in for the no-overrides
    dashboard case; override requests bypass the persistent cache and recompute every time.
    """
    evi_ov              = request.args.get('evi')
    air_temp_encoded_ov = request.args.get('air_temp_encoded')
    wind_ov             = request.args.get('wind')
    humidity_ov         = request.args.get('humidity')
    elev_ov             = request.args.get('elevation')
    kbdi_ov             = request.args.get('kbdi')

    evi_ov              = float(evi_ov) if evi_ov is not None else None
    air_temp_encoded_ov = float(air_temp_encoded_ov) if air_temp_encoded_ov is not None else None
    wind_ov             = float(wind_ov) if wind_ov is not None else None
    humidity_ov         = float(humidity_ov) if humidity_ov is not None else None
    elev_ov             = float(elev_ov) if elev_ov is not None else None
    kbdi_ov             = float(kbdi_ov) if kbdi_ov is not None else None

    params_key = (evi_ov, air_temp_encoded_ov, wind_ov, humidity_ov, elev_ov, kbdi_ov)
    is_default = params_key == (None, None, None, None, None, None)
    now = time.time()

    if is_default:
        cache_key = 'counties'
        cached = _zone_risk_cache.get(cache_key)
        if cached and cached['expires'] > now:
            return jsonify(cached['data'])
        db_cached = _load_cache_from_db(cache_key)
        if db_cached:
            age = now - db_cached['computed_at']
            _zone_risk_cache[cache_key] = {'data': db_cached['data'], 'expires': now + _GRID_CACHE_TTL}
            if age > _GRID_CACHE_TTL:
                _spawn_background_refresh(current_app._get_current_object(), cache_key, _compute_county_risk)
            return jsonify(db_cached['data'])
        # Single-flight: only ONE concurrent request per worker runs the heavy
        # compute. Others wait for the lock and then re-read the cache that
        # the winning request populated. Prevents the cache-stampede pattern
        # where 6 parallel requests all run the full 80s pipeline.
        lock = _lock_for(cache_key)
        with lock:
            cached = _zone_risk_cache.get(cache_key)
            if cached and cached['expires'] > now:
                return jsonify(cached['data'])
            data = _compute_county_risk()
            _zone_risk_cache[cache_key] = {'data': data, 'expires': now + _GRID_CACHE_TTL}
            _save_cache_to_db(cache_key, data)
        return jsonify(data)

    # Override path — keep the legacy params-keyed in-memory cache, no DB persistence.
    if (_county_cache["data"] is not None
            and _county_cache["expires"] > now
            and _county_cache["params"] == params_key):
        return jsonify(_county_cache["data"])
    data = _compute_county_risk(evi_ov, air_temp_encoded_ov, wind_ov, humidity_ov, elev_ov, kbdi_ov)
    _county_cache["data"] = data
    _county_cache["expires"] = now + _GRID_CACHE_TTL
    _county_cache["params"] = params_key
    return jsonify(data)


@research_bp.route('/risk-grid', methods=['GET'])
@jwt_required()
def risk_grid():
    if not _require_researcher_or_admin():
        return jsonify({'error': 'Researcher or Admin access required'}), 403

    # Optional overrides — None means use interpolated real data
    evi_ov              = request.args.get('evi')
    air_temp_encoded_ov = request.args.get('air_temp_encoded')
    wind_ov             = request.args.get('wind')
    humidity_ov         = request.args.get('humidity')
    elev_ov             = request.args.get('elevation')
    kbdi_ov             = request.args.get('kbdi')

    evi_ov              = float(evi_ov) if evi_ov is not None else None
    air_temp_encoded_ov = float(air_temp_encoded_ov) if air_temp_encoded_ov is not None else None
    wind_ov             = float(wind_ov) if wind_ov is not None else None
    humidity_ov         = float(humidity_ov) if humidity_ov is not None else None
    elev_ov             = float(elev_ov) if elev_ov is not None else None
    kbdi_ov             = float(kbdi_ov) if kbdi_ov is not None else None

    params_key = (evi_ov, air_temp_encoded_ov, wind_ov, humidity_ov, elev_ov, kbdi_ov)

    now = time.time()
    if (_grid_cache["data"] is not None
            and _grid_cache["expires"] > now
            and _grid_cache["params"] == params_key):
        features = _grid_cache["data"]
    else:
        features = _build_risk_grid(evi_ov, air_temp_encoded_ov, wind_ov, humidity_ov, elev_ov, kbdi_ov)
        _grid_cache["data"] = features
        _grid_cache["expires"] = now + _GRID_CACHE_TTL
        _grid_cache["params"] = params_key

    return jsonify({
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "grid_points": len(features),
            "overrides": {
                "evi": evi_ov, "air_temp_encoded": air_temp_encoded_ov,
                "wind": wind_ov, "humidity": humidity_ov, "elevation": elev_ov,
                "kbdi": kbdi_ov,
            },
        },
    })
