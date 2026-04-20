import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests as http_requests
from flask import Blueprint, request, jsonify
from ml.inference import predict_from_features
from data.sample_locations import SAMPLE_LOCATIONS

logger = logging.getLogger(__name__)

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
    BATCH_TIMEOUT = 60  # seconds max for the entire batch
    results = [None] * len(coords)
    with ThreadPoolExecutor(max_workers=BATCH_WORKERS) as executor:
        futures = {executor.submit(_run, lat, lon): i for i, lat, lon in coords}
        for future in as_completed(futures, timeout=BATCH_TIMEOUT):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                logger.warning("Batch item %s failed: %s", idx, e)
                results[idx] = {'error': 'prediction failed for this location'}

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


@predict_bp.route('/predict-custom', methods=['POST'])
def predict_custom():
    """Predict risk from raw feature values (no location lookup)."""
    data = request.get_json() or {}
    try:
        evi              = float(data['evi'])
        air_temp_encoded = float(data['air_temp_encoded'])
        wind             = float(data['wind'])
        humidity         = float(data['humidity'])
        elevation        = float(data['elevation'])
    except (KeyError, TypeError, ValueError):
        return jsonify({'error': 'evi, air_temp_encoded, wind, humidity, elevation are required numbers'}), 400
    result = predict_from_features(evi=evi, air_temp_encoded=air_temp_encoded, wind=wind, humidity=humidity, elevation=elevation)
    zone_name = data.get('zone_name')
    resp = {'risk_score': result['risk_score'], 'label': result['label']}
    if zone_name is not None:
        resp['zone_name'] = zone_name
    return jsonify(resp)


def _norm_fire_name(s: str) -> str:
    return ''.join(c for c in (s or '').lower() if c.isalnum())


_containment_cache: dict = {"expires": 0.0, "data": {}}
_CONTAINMENT_TTL = 1800  # 30 min


def _fetch_containment_by_name() -> dict:
    """Build a name->PercentContained lookup from CAL FIRE + WFIGS Incident Locations.

    The perimeter layer often has null PercentContained even when other feeds
    carry a real value, so we enrich the perimeter features with whichever
    number is available.
    """
    import time as _time
    now = _time.time()
    if _containment_cache["expires"] > now and _containment_cache["data"]:
        return _containment_cache["data"]
    lookup: dict = {}

    # CAL FIRE
    try:
        r = http_requests.get(
            'https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List',
            params={'inactive': 'false'},
            timeout=12,
        )
        r.raise_for_status()
        for d in r.json() or []:
            nm = _norm_fire_name(d.get('Name'))
            pct = d.get('PercentContained')
            if nm and pct is not None:
                try:
                    lookup[nm] = float(pct)
                except Exception:
                    pass
    except Exception as e:
        logger.warning('CAL FIRE containment lookup failed: %s', e)

    # WFIGS Incident Locations — points layer carries PercentContained for many small fires
    try:
        r = http_requests.get(
            'https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/'
            'WFIGS_Incident_Locations_YearToDate/FeatureServer/0/query',
            params={
                'where': "POOState='US-CA'",
                'outFields': 'IncidentName,PercentContained',
                'f': 'json',
                'resultRecordCount': 5000,
            },
            timeout=15,
        )
        r.raise_for_status()
        for f in (r.json() or {}).get('features', []) or []:
            a = f.get('attributes') or {}
            nm = _norm_fire_name(a.get('IncidentName'))
            pct = a.get('PercentContained')
            if nm and pct is not None and nm not in lookup:
                try:
                    lookup[nm] = float(pct)
                except Exception:
                    pass
    except Exception as e:
        logger.warning('WFIGS locations containment lookup failed: %s', e)

    if lookup:
        _containment_cache["data"] = lookup
        _containment_cache["expires"] = now + _CONTAINMENT_TTL
    return lookup


@predict_bp.route('/fire-perimeters', methods=['GET'])
def nifc_fire_perimeters():
    """Proxy NIFC WFIGS fire perimeters (California only) and enrich missing
    containment percentages from CAL FIRE + WFIGS Incident Locations so the
    4-tier color coding can actually kick in."""
    try:
        r = http_requests.get(
            'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/'
            'WFIGS_Interagency_Perimeters_YearToDate/FeatureServer/0/query',
            params={
                # California only + drop fully-contained fires at the source
                'where': "attr_POOState='US-CA' AND (attr_PercentContained IS NULL OR attr_PercentContained < 100)",
                'outFields': 'poly_IncidentName,poly_GISAcres,poly_FeatureCategory,attr_PercentContained,attr_FireDiscoveryDateTime',
                'f': 'geojson',
            },
            timeout=20,
            headers={'User-Agent': 'FireScopeProxy/1.0'},
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.warning('NIFC perimeters proxy failed: %s', e)
        return jsonify({'type': 'FeatureCollection', 'features': []}), 200

    try:
        lookup = _fetch_containment_by_name()
        kept = []
        for feat in (data or {}).get('features', []) or []:
            props = feat.get('properties') or {}
            if props.get('attr_PercentContained') is None:
                nm = _norm_fire_name(props.get('poly_IncidentName'))
                if nm in lookup:
                    props['attr_PercentContained'] = lookup[nm]
                    feat['properties'] = props
            # Re-apply the <100 filter after enrichment
            pct = props.get('attr_PercentContained')
            if pct is not None and float(pct) >= 100:
                continue
            kept.append(feat)
        data['features'] = kept
    except Exception as e:
        logger.warning('Containment enrichment failed: %s', e)

    resp = jsonify(data)
    resp.headers['Cache-Control'] = 'public, max-age=300'
    return resp
