import time
import logging
import requests as http_requests
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)

shelters_bp = Blueprint('shelters', __name__)

FEMA_NSS_URL = "https://gis.fema.gov/arcgis/rest/services/NSS/FEMA_NSS/FeatureServer/0/query"
FEMA_OPEN_URL = "https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/FeatureServer/0/query"

_cache = {}
CACHE_TTL = 600


@shelters_bp.route('/shelters', methods=['GET'])
def get_shelters():
    state = request.args.get('state', 'CA').upper()

    cached = _cache.get(state)
    if cached and (time.time() - cached[0]) < CACHE_TTL:
        resp = jsonify(cached[1])
        resp.headers['Cache-Control'] = 'public, max-age=600'
        return resp

    params = {
        'where': f"state='{state}'",
        'outFields': '*',
        'f': 'geojson',
        'resultRecordCount': '5000',
    }

    try:
        r = http_requests.get(FEMA_NSS_URL, params=params, timeout=15)
        r.raise_for_status()
        data = r.json()
    except Exception:
        try:
            r = http_requests.get(FEMA_OPEN_URL, params=params, timeout=15)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            logger.error("FEMA shelter fetch failed for state=%s: %s", state, e)
            return jsonify({'error': str(e)}), 502

    _cache[state] = (time.time(), data)
    resp = jsonify(data)
    resp.headers['Cache-Control'] = 'public, max-age=600'
    return resp
