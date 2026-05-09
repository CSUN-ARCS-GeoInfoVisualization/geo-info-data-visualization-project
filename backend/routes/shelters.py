import time
import logging
from concurrent.futures import ThreadPoolExecutor
import requests as http_requests
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)

shelters_bp = Blueprint('shelters', __name__)

# CalOES-published mirror of the legacy FEMA NSS California subset.
# FEMA's own NSS endpoint was reduced to currently-open shelters only
# (~10 features, none in CA), so we point at the full pre-staged inventory.
CA_SHELTERS_URL = (
    "https://services2.arcgis.com/iq8zYa0SRsvIFFKz/arcgis/rest/services/"
    "CA_Shelter_system/FeatureServer/0/query"
)
PAGE_SIZE = 2000

# 10-char ArcGIS column → original FEMA NSS field name the frontend expects.
FIELD_MAP = {
    'STATE': 'state',
    'SHELTER_ST': 'shelter_status_code',
    'SHELTER_NA': 'shelter_name',
    'ADDRESS_1': 'address_1',
    'CITY': 'city',
    'ZIP': 'zip',
    'COUNTY_PAR': 'county_parish',
    'EVACUATION': 'evacuation_capacity',
    'POST_IMPAC': 'post_impact_capacity',
    'WHEELCHAIR': 'wheelchair_accessible',
    'GENERATOR_': 'generator_onsite',
    'FACILITY_U': 'facility_usage_code',
    'FACILITY_T': 'facility_type',
    'SHELTER_ID': 'shelter_id',
    'LATITUDE': 'latitude',
    'LONGITUDE': 'longitude',
}

_cache = {}
CACHE_TTL = 60 * 60 * 6  # 6h — upstream is a slow-moving inventory snapshot


def _fetch_page(offset: int) -> list:
    params = {
        'where': '1=1',
        'outFields': ','.join(FIELD_MAP.keys()),
        'f': 'geojson',
        'outSR': '4326',
        'resultRecordCount': PAGE_SIZE,
        'resultOffset': offset,
    }
    r = http_requests.get(CA_SHELTERS_URL, params=params, timeout=20,
                          headers={'User-Agent': 'FireScopeProxy/1.0'})
    r.raise_for_status()
    return (r.json() or {}).get('features', []) or []


def _remap(feat: dict) -> dict:
    raw = feat.get('properties') or {}
    props = {}
    for src, dst in FIELD_MAP.items():
        v = raw.get(src)
        if v is not None:
            props[dst] = v
    feat['properties'] = props
    return feat


@shelters_bp.route('/shelters', methods=['GET'])
def get_shelters():
    state = request.args.get('state', 'CA').upper()
    cached = _cache.get(state)
    if cached and (time.time() - cached[0]) < CACHE_TTL:
        resp = jsonify(cached[1])
        resp.headers['Cache-Control'] = 'public, max-age=3600'
        return resp

    if state != 'CA':
        # Layer is California-only; return empty for other states rather than 500.
        empty = {'type': 'FeatureCollection', 'features': []}
        return jsonify(empty)

    try:
        # Pull pages in parallel. ~8,014 features → 5 pages of 2,000.
        offsets = list(range(0, 12000, PAGE_SIZE))
        with ThreadPoolExecutor(max_workers=5) as pool:
            pages = list(pool.map(_fetch_page, offsets))
    except Exception as e:
        logger.error("CA_Shelter_system fetch failed: %s", e)
        return jsonify({'error': str(e)}), 502

    features = []
    for page in pages:
        for feat in page:
            features.append(_remap(feat))

    data = {'type': 'FeatureCollection', 'features': features}
    _cache[state] = (time.time(), data)
    logger.info("Loaded %d CA shelters from CalOES mirror", len(features))
    resp = jsonify(data)
    resp.headers['Cache-Control'] = 'public, max-age=3600'
    return resp
