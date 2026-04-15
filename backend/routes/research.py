"""Research data endpoint — FIRMS hotspots and risk predictions for the researcher map."""

import logging
import os
import time
from datetime import datetime, timedelta, timezone

import requests
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt

from ml.inference import predict_from_features
from data.sample_locations import SAMPLE_LOCATIONS

research_bp = Blueprint('research', __name__)
logger = logging.getLogger(__name__)

# Risk grid cache (expensive computation)
_grid_cache: dict = {"expires": 0.0, "data": None, "params": None}
_GRID_CACHE_TTL = 900  # 15 minutes

FIRMS_MAP_KEY = os.getenv('FIRMS_MAP_KEY', '')
FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv'


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
