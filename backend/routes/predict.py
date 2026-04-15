import logging
import math
import requests as http_requests
from flask import Blueprint, request, jsonify
from ml.inference import predict_from_features
from data.sample_locations import SAMPLE_LOCATIONS

logger = logging.getLogger(__name__)

from data.live_weather import get_weather
from data.live_elevation import get_elevation
from data.live_evi import get_evi

predict_bp = Blueprint('predict', __name__)

MODEL_VERSION = "predictive-v1"


def _nearest_location(lat: float, lon: float) -> dict:
    """Return the sample location closest to the given (lat, lon)."""
    def dist(loc):
        return math.sqrt((loc["lat"] - lat) ** 2 + (loc["lon"] - lon) ** 2)

    return min(SAMPLE_LOCATIONS, key=dist)


def _run(lat: float, lon: float) -> dict:
    loc = _nearest_location(lat, lon)

    try:
        weather = get_weather(lat, lon)
        wind = weather["wind_speed"]
        lst = (weather["temperature_celsius"] + 273.15) / 0.02
        weather_source = "live"
    except Exception:
        wind = loc["wind"]
        lst = loc["lst"]
        weather_source = "fallback"

    try:
        elevation = get_elevation(lat, lon)
        elevation_source = "live"
    except Exception:
        elevation = loc["elevation"]
        elevation_source = "fallback"

    try:
        evi = get_evi(lat, lon)
        evi_source = "live"
    except Exception:
        evi = loc["evi"]
        evi_source = "fallback"

    result = predict_from_features(
        evi=evi,
        lst=lst,
        wind=wind,
        elevation=elevation,
    )
    return {
        "prediction": {
            "risk_level": result["label"],
            "risk_probability": result["risk_score"],
        },
        "model": {
            "version": MODEL_VERSION,
        },
        "location": {
            "requested_lat": lat,
            "requested_lon": lon,
            "matched_name": loc["name"],
            "matched_lat": loc["lat"],
            "matched_lon": loc["lon"],
        },
        "features": {
            "evi": result["evi"],
            "evi_source": evi_source,
            "lst": result["lst"],
            "lst_source": weather_source,
            "wind": result["wind"],
            "wind_source": weather_source,
            "elevation": result["elevation"],
            "elevation_source": elevation_source,
        },
    }


@predict_bp.route('/predict', methods=['POST'])
def predict_single():
    data = request.get_json() or {}
    lat = data.get('lat')
    lon = data.get('lon')

    if lat is None or lon is None:
        return jsonify({'error': 'lat and lon are required'}), 400

    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return jsonify({'error': 'lat and lon must be numbers'}), 400

    return jsonify(_run(lat, lon))


@predict_bp.route('/predict/batch', methods=['POST'])
def predict_batch():
    data = request.get_json() or {}
    items = data.get('items')

    if not isinstance(items, list) or len(items) == 0:
        return jsonify({'error': 'items must be a non-empty list'}), 400

    results = []
    for i, item in enumerate(items):
        lat = item.get('lat')
        lon = item.get('lon')
        if lat is None or lon is None:
            return jsonify({'error': f'items[{i}] missing lat or lon'}), 400
        try:
            lat, lon = float(lat), float(lon)
        except (TypeError, ValueError):
            return jsonify({'error': f'items[{i}] lat and lon must be numbers'}), 400
        results.append(_run(lat, lon))

    return jsonify({'results': results})


@predict_bp.route('/calfire/incidents', methods=['GET'])
def calfire_incidents():
    """Proxy CAL FIRE incidents API to avoid browser CORS restrictions."""
    inactive = request.args.get('inactive', 'false')
    try:
        r = http_requests.get(
            f'https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List?inactive={inactive}',
            timeout=15,
            headers={'User-Agent': 'FireScopeProxy/1.0'},
        )
        r.raise_for_status()
        return jsonify(r.json())
    except Exception as e:
        logger.warning('CAL FIRE proxy failed: %s', e)
        return jsonify([]), 200
