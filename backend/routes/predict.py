import math
from flask import Blueprint, request, jsonify
from ml.inference import predict_from_features
from data.sample_locations import SAMPLE_LOCATIONS

predict_bp = Blueprint('predict', __name__)

MODEL_VERSION = "predictive-v1"


def _nearest_location(lat: float, lon: float) -> dict:
    """Return the sample location closest to the given (lat, lon)."""
    def dist(loc):
        return math.sqrt((loc["lat"] - lat) ** 2 + (loc["lon"] - lon) ** 2)

    return min(SAMPLE_LOCATIONS, key=dist)


def _run(lat: float, lon: float) -> dict:
    loc = _nearest_location(lat, lon)
    result = predict_from_features(
        evi=loc["evi"],
        lst=loc["lst"],
        wind=loc["wind"],
        elevation=loc["elevation"],
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
            "lst": result["lst"],
            "wind": result["wind"],
            "elevation": result["elevation"],
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
