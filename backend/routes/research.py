"""Research data endpoint — FIRMS hotspots and risk predictions for the researcher map."""

import logging
import os
import time
from datetime import datetime, timedelta, timezone

import requests
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt

from ml.inference import predict_from_features, predict_batch_features
from data.sample_locations import SAMPLE_LOCATIONS

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
    """Serve simplified GeoJSON boundary files (public, no auth)."""
    if name not in _VALID_BOUNDARIES:
        return jsonify({'error': 'Invalid boundary type'}), 404
    filepath = os.path.join(_BOUNDARIES_DIR, f'{name}.json')
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 404
    import json as json_mod
    with open(filepath) as f:
        data = json_mod.load(f)
    return jsonify(data)


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


@research_bp.route('/risk-by-zone/<zone_type>', methods=['GET'])
def risk_by_zone(zone_type):
    """Compute ML risk per zone — single request replaces 35+ batch calls."""
    if zone_type not in _VALID_BOUNDARIES:
        return jsonify({'error': 'Invalid zone type'}), 404

    now = time.time()
    cache_key = zone_type
    cached = _zone_risk_cache.get(cache_key)
    if cached and cached['expires'] > now:
        return jsonify(cached['data'])

    filepath = os.path.join(_BOUNDARIES_DIR, f'{zone_type}.json')
    if not os.path.exists(filepath):
        return jsonify({'error': 'Boundary data not found'}), 404

    import json as json_mod
    with open(filepath) as f:
        geo = json_mod.load(f)

    # Determine zone name field
    name_key = 'zip' if zone_type == 'zip-codes' else 'name' if zone_type == 'neighborhoods' else 'tract'

    features_list = geo.get('features', [])
    step = max(1, len(features_list) // 500)  # Max ~500 predictions

    # Collect sampled centroids + their feature vectors
    sampled_names = []
    sampled_inputs = []  # (evi, lst, wind, elevation) tuples
    for i in range(0, len(features_list), step):
        f = features_list[i]
        name = f.get('properties', {}).get(name_key, str(i))
        coords = f.get('geometry', {}).get('coordinates')
        if not coords:
            continue
        centroid = _get_centroid(coords)
        if not centroid:
            continue
        lat, lon = centroid
        evi = _interpolate_feature(lat, lon, "evi")
        lst = _interpolate_feature(lat, lon, "lst")
        wind = _interpolate_feature(lat, lon, "wind")
        elev = _interpolate_feature(lat, lon, "elevation")
        sampled_names.append(name)
        sampled_inputs.append((evi, lst, wind, elev))

    # Single batch prediction call (loads model once, predicts all at once via numpy)
    try:
        batch_results = predict_batch_features(sampled_inputs)
    except Exception as e:
        logger.warning("Batch prediction failed: %s", e)
        batch_results = [{"risk_score": 0, "label": "Low"}] * len(sampled_inputs)

    sampled_risk = {
        name: {**risk, "features": {"evi": evi, "lst": lst, "wind": wind, "elevation": elev}}
        for name, risk, (evi, lst, wind, elev) in zip(sampled_names, batch_results, sampled_inputs)
    }

    # Propagate to all zones
    results = {}
    for i, f in enumerate(features_list):
        name = f.get('properties', {}).get(name_key, str(i))
        sampled_idx = (i // step) * step
        sampled_name = features_list[sampled_idx].get('properties', {}).get(name_key, str(sampled_idx)) if sampled_idx < len(features_list) else ""
        results[name] = sampled_risk.get(sampled_name, {"risk_score": 0, "label": "Low"})

    data = {"zones": results, "zone_type": zone_type, "total": len(results)}
    _zone_risk_cache[cache_key] = {'data': data, 'expires': now + _GRID_CACHE_TTL}
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


def _interpolate_feature(lat: float, lon: float, feature_key: str) -> float:
    """Interpolate a feature value from the nearest sample locations (inverse-distance weighted)."""
    total_weight = 0.0
    weighted_sum = 0.0
    for loc in SAMPLE_LOCATIONS:
        dist = ((lat - loc["lat"]) ** 2 + (lon - loc["lon"]) ** 2) ** 0.5
        if dist < 0.001:
            return loc[feature_key]
        w = 1.0 / (dist ** 2)
        weighted_sum += w * loc[feature_key]
        total_weight += w
    return weighted_sum / total_weight if total_weight > 0 else 0


def _build_risk_grid(evi_ov, lst_ov, wind_ov, elev_ov):
    """Generate a grid of risk predictions across California."""
    features = []
    # Grid: lat 32.5-42, lon -124 to -114, step ~0.8 degrees = ~150 points
    lat_start, lat_end, lat_step = 32.5, 42.0, 0.8
    lon_start, lon_end, lon_step = -124.0, -114.0, 0.8

    lat = lat_start
    while lat <= lat_end:
        lon = lon_start
        while lon <= lon_end:
            # Use overrides if provided, otherwise interpolate from sample data
            evi = evi_ov if evi_ov is not None else _interpolate_feature(lat, lon, "evi")
            lst = lst_ov if lst_ov is not None else _interpolate_feature(lat, lon, "lst")
            wind = wind_ov if wind_ov is not None else _interpolate_feature(lat, lon, "wind")
            elev = elev_ov if elev_ov is not None else _interpolate_feature(lat, lon, "elevation")

            try:
                result = predict_from_features(evi, lst, wind, elev)
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "risk_score": result["risk_score"],
                        "label": result["label"],
                        "evi": round(evi, 1),
                        "lst": round(lst, 1),
                        "wind": round(wind, 1),
                        "elevation": round(elev, 1),
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


@research_bp.route('/risk-by-county', methods=['GET'])
def risk_by_county():
    """Return risk scores per California county — public endpoint, no auth required."""
    evi_ov = request.args.get('evi')
    lst_ov = request.args.get('lst')
    wind_ov = request.args.get('wind')
    elev_ov = request.args.get('elevation')

    evi_ov = float(evi_ov) if evi_ov is not None else None
    lst_ov = float(lst_ov) if lst_ov is not None else None
    wind_ov = float(wind_ov) if wind_ov is not None else None
    elev_ov = float(elev_ov) if elev_ov is not None else None

    params_key = (evi_ov, lst_ov, wind_ov, elev_ov)
    now = time.time()
    if (_county_cache["data"] is not None
            and _county_cache["expires"] > now
            and _county_cache["params"] == params_key):
        return jsonify(_county_cache["data"])

    names = []
    inputs = []
    for name, lat, lon in CA_COUNTY_CENTROIDS:
        evi = evi_ov if evi_ov is not None else _interpolate_feature(lat, lon, "evi")
        lst = lst_ov if lst_ov is not None else _interpolate_feature(lat, lon, "lst")
        wind = wind_ov if wind_ov is not None else _interpolate_feature(lat, lon, "wind")
        elev = elev_ov if elev_ov is not None else _interpolate_feature(lat, lon, "elevation")
        names.append(name)
        inputs.append((evi, lst, wind, elev))
    try:
        batch = predict_batch_features(inputs)
    except Exception:
        batch = [{"risk_score": 0, "label": "Low"}] * len(inputs)
    results = {
        name: {
            **risk,
            "features": {"evi": evi, "lst": lst, "wind": wind, "elevation": elev},
        }
        for name, risk, (evi, lst, wind, elev) in zip(names, batch, inputs)
    }

    data = {"counties": results, "overrides": {"evi": evi_ov, "lst": lst_ov, "wind": wind_ov, "elevation": elev_ov}}
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
    evi_ov = request.args.get('evi')
    lst_ov = request.args.get('lst')
    wind_ov = request.args.get('wind')
    elev_ov = request.args.get('elevation')

    evi_ov = float(evi_ov) if evi_ov is not None else None
    lst_ov = float(lst_ov) if lst_ov is not None else None
    wind_ov = float(wind_ov) if wind_ov is not None else None
    elev_ov = float(elev_ov) if elev_ov is not None else None

    params_key = (evi_ov, lst_ov, wind_ov, elev_ov)

    now = time.time()
    if (_grid_cache["data"] is not None
            and _grid_cache["expires"] > now
            and _grid_cache["params"] == params_key):
        features = _grid_cache["data"]
    else:
        features = _build_risk_grid(evi_ov, lst_ov, wind_ov, elev_ov)
        _grid_cache["data"] = features
        _grid_cache["expires"] = now + _GRID_CACHE_TTL
        _grid_cache["params"] = params_key

    return jsonify({
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "grid_points": len(features),
            "overrides": {
                "evi": evi_ov, "lst": lst_ov,
                "wind": wind_ov, "elevation": elev_ov,
            },
        },
    })
