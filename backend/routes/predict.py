import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Blueprint, request, jsonify
from ml.inference import predict_from_features
from data.sample_locations import SAMPLE_LOCATIONS

from data.live_weather import get_weather
from data.live_elevation import get_elevation
from data.live_evi import get_evi

BATCH_MAX_SIZE   = 500
BATCH_WORKERS    = 8

predict_bp = Blueprint('predict', __name__)

MODEL_VERSION = "predictive-v1"


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres between two lat/lon points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def _nearest_location(lat: float, lon: float) -> dict:
    """Return the sample location with the shortest great-circle distance to (lat, lon)."""
    return min(SAMPLE_LOCATIONS, key=lambda loc: _haversine_km(lat, lon, loc["lat"], loc["lon"]))


def _validate_coords(lat: float, lon: float):
    if not (-90 <= lat <= 90):
        raise ValueError(f"lat {lat} out of range [-90, 90]")
    if not (-180 <= lon <= 180):
        raise ValueError(f"lon {lon} out of range [-180, 180]")


def _run(lat: float, lon: float) -> dict:
    loc = _nearest_location(lat, lon)

    try:
        weather = get_weather(lat, lon)
        wind             = weather["wind_speed"]
        humidity         = weather["humidity"]
        # air_temp_encoded: air temperature as (°C + 273.15) / 0.02 — NOT MODIS LST.
        air_temp_encoded = (weather["temperature_celsius"] + 273.15) / 0.02
        weather_source   = "live"
    except Exception:
        wind             = loc["wind"]
        humidity         = loc["humidity"]
        air_temp_encoded = loc["air_temp_encoded"]
        weather_source   = "fallback"

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
        air_temp_encoded=air_temp_encoded,
        wind=wind,
        humidity=humidity,
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
            "air_temp_encoded": result["air_temp_encoded"],
            "air_temp_encoded_source": weather_source,
            "wind": result["wind"],
            "wind_source": weather_source,
            "humidity": result["humidity"],
            "humidity_source": weather_source,
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

    try:
        _validate_coords(lat, lon)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    return jsonify(_run(lat, lon))


@predict_bp.route('/predict/batch', methods=['POST'])
def predict_batch():
    data = request.get_json() or {}
    items = data.get('items')

    if not isinstance(items, list) or len(items) == 0:
        return jsonify({'error': 'items must be a non-empty list'}), 400

    if len(items) > BATCH_MAX_SIZE:
        return jsonify({'error': f'batch size cannot exceed {BATCH_MAX_SIZE}'}), 400

    # Validate all inputs before running any predictions
    coords = []
    for i, item in enumerate(items):
        lat = item.get('lat')
        lon = item.get('lon')
        if lat is None or lon is None:
            return jsonify({'error': f'items[{i}] missing lat or lon'}), 400
        try:
            lat, lon = float(lat), float(lon)
        except (TypeError, ValueError):
            return jsonify({'error': f'items[{i}] lat and lon must be numbers'}), 400
        try:
            _validate_coords(lat, lon)
        except ValueError as e:
            return jsonify({'error': f'items[{i}]: {e}'}), 400
        coords.append((i, lat, lon))

    # Run predictions in parallel — each location fetches weather/EVI/elevation concurrently
    results = [None] * len(coords)
    with ThreadPoolExecutor(max_workers=BATCH_WORKERS) as executor:
        futures = {executor.submit(_run, lat, lon): i for i, lat, lon in coords}
        for future in as_completed(futures):
            idx = futures[future]
            results[idx] = future.result()

    return jsonify({'results': results})
