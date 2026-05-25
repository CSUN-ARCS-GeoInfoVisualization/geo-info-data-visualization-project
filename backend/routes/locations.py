from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, UserLocation
from data.zone_resolver import resolve_all
from routes.research import get_cached_zone_risk

locations_bp = Blueprint('locations', __name__)

CA_LAT_MIN, CA_LAT_MAX = 32.5, 42.0
CA_LON_MIN, CA_LON_MAX = -124.5, -114.1

# 9-tier scale used across the app — keep aligned with notification-settings.tsx.
_TIER_THRESHOLDS = [
    (0.95, "Catastrophic"), (0.90, "Critical"), (0.85, "Extreme"),
    (0.80, "Severe"),       (0.75, "Very High"), (0.70, "High"),
    (0.65, "Elevated"),     (0.55, "Guarded"),  (0.0,  "Low"),
]


def _label_for(pct_0_to_1: float) -> str:
    for cutoff, label in _TIER_THRESHOLDS:
        if pct_0_to_1 >= cutoff:
            return label
    return "Low"


def _coerce_user_id():
    raw = get_jwt_identity()
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _serialize(loc: UserLocation) -> dict:
    return {
        'id': loc.id,
        'name': loc.name,
        'address': loc.address,
        'lat': loc.lat,
        'lon': loc.lon,
        'created_at': loc.created_at.isoformat() + 'Z' if loc.created_at else None,
    }


@locations_bp.route('/me/locations', methods=['GET'])
@jwt_required()
def get_locations():
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token'}), 401
    locs = UserLocation.query.filter_by(user_id=user_id).order_by(UserLocation.created_at).all()
    return jsonify([_serialize(l) for l in locs])


@locations_bp.route('/me/locations', methods=['POST'])
@jwt_required()
def add_location():
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token'}), 401

    data = request.get_json() or {}
    name = data.get('name', '').strip()
    lat = data.get('lat')
    lon = data.get('lon')
    address = data.get('address', '').strip() or None

    if not name:
        return jsonify({'error': 'name is required'}), 400
    if lat is None or lon is None:
        return jsonify({'error': 'lat and lon are required'}), 400

    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return jsonify({'error': 'lat and lon must be numbers'}), 400

    if not (CA_LAT_MIN <= lat <= CA_LAT_MAX and CA_LON_MIN <= lon <= CA_LON_MAX):
        return jsonify({'error': 'Location must be within California'}), 400

    loc = UserLocation(user_id=user_id, name=name, address=address, lat=lat, lon=lon)
    db.session.add(loc)
    db.session.commit()
    return jsonify(_serialize(loc)), 201


@locations_bp.route('/me/locations/<int:loc_id>', methods=['DELETE'])
@jwt_required()
def delete_location(loc_id):
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token'}), 401

    loc = UserLocation.query.filter_by(id=loc_id, user_id=user_id).first()
    if not loc:
        return jsonify({'error': 'Not found'}), 404

    db.session.delete(loc)
    db.session.commit()
    return jsonify({'ok': True})


@locations_bp.route('/me/locations/<int:loc_id>/risk-by-all-zones', methods=['GET'])
@jwt_required()
def risk_by_all_zones(loc_id):
    """Return county/zip/neighborhood/census_tract risk for one saved location.

    Numbers come from the SAME three-tier cache (in-memory → Postgres → fresh
    compute) that powers the dashboard map's /risk-by-county and
    /risk-by-zone/<type> endpoints — so the side-panel value is guaranteed
    to match what the user sees on the map for the same zone. Lookup is
    O(1) per zone after the (~80ms) point-in-polygon resolve.
    """
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token'}), 401

    loc = UserLocation.query.filter_by(id=loc_id, user_id=user_id).first()
    if not loc:
        return jsonify({'error': 'Not found'}), 404

    zones = resolve_all(loc.lat, loc.lon)

    out = {'location_id': loc.id, 'name': loc.name, 'lat': loc.lat, 'lon': loc.lon}
    for key in ('county', 'zip', 'neighborhood', 'census_tract'):
        z = zones.get(key)
        if not z:
            out[key] = None
            continue
        cached = get_cached_zone_risk(key, z['id'])
        if not cached or cached.get('risk_score') is None:
            out[key] = {'id': z['id'], 'name': z['name'], 'risk_pct': None, 'label': None}
            continue
        pct = float(cached['risk_score'])
        out[key] = {
            'id':       z['id'],
            'name':     z['name'],
            'risk_pct': round(pct * 100, 1),
            'label':    cached.get('label') or _label_for(pct),
        }
    return jsonify(out)
