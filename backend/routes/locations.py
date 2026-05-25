from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, UserLocation
from data.zone_resolver import resolve_all
from routes.predict import _run as predict_at

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

    Lazily resolves and persists zone IDs onto user_locations so subsequent
    calls skip point-in-polygon work. The risk per zone is the ML prediction
    evaluated at that zone's centroid (which the per-coord _PREDICT_CACHE
    keeps cheap on repeats).
    """
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token'}), 401

    loc = UserLocation.query.filter_by(id=loc_id, user_id=user_id).first()
    if not loc:
        return jsonify({'error': 'Not found'}), 404

    needs_resolve = not (loc.county_fips and loc.zip_code and loc.neighborhood_id and loc.census_tract_id)
    zones = None
    if needs_resolve:
        zones = resolve_all(loc.lat, loc.lon)
        # Cache whatever we resolved (some may be None outside coverage).
        if zones.get('county'):       loc.county_fips    = zones['county']['id'][:5]
        if zones.get('zip'):          loc.zip_code       = zones['zip']['id'][:10]
        if zones.get('neighborhood'): loc.neighborhood_id = zones['neighborhood']['id'][:64]
        if zones.get('census_tract'): loc.census_tract_id = zones['census_tract']['id'][:11]
        db.session.commit()

    def _risk_at(centroid_lat, centroid_lon):
        try:
            r = predict_at(centroid_lat, centroid_lon)
            pct = float(r['prediction']['risk_probability'])
            return {'risk_pct': round(pct * 100, 1), 'label': _label_for(pct)}
        except Exception:
            return None

    # Re-resolve here if we don't have ZoneHit objects in hand — needed to get centroids.
    if zones is None:
        zones = resolve_all(loc.lat, loc.lon)

    out = {'location_id': loc.id, 'name': loc.name, 'lat': loc.lat, 'lon': loc.lon}
    for key in ('county', 'zip', 'neighborhood', 'census_tract'):
        z = zones.get(key)
        if not z:
            out[key] = None
            continue
        risk = _risk_at(z['centroid_lat'], z['centroid_lon'])
        out[key] = {
            'id':   z['id'],
            'name': z['name'],
            'risk_pct': risk['risk_pct'] if risk else None,
            'label':    risk['label']    if risk else None,
        }
    return jsonify(out)
