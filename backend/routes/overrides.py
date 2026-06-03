"""Per-user, per-zone risk overrides with a 24h time-to-live.

A signed-in researcher adjusts the sliders for a zone; the values are persisted
server-side so the override survives leaving and returning to the page. Exactly
ONE active override per (user, scope, zone) — re-saving the same zone upserts
and refreshes the 24h window. Expired rows are pruned on the next read/write,
so the zone automatically falls back to live data and the row is freed.

The resulting risk_score+label are computed once (via the live model) and frozen
on the row, so reads never recompute and never drift.

Auth mirrors routes/locations.py: JWT identity -> int user id, owner-scoped.
"""
from datetime import datetime, timedelta, timezone

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, UserOverride
from ml.inference import predict_from_features

overrides_bp = Blueprint('overrides', __name__)

VALID_SCOPES = {'county', 'zip', 'neighborhood', 'tract'}
_FEATURES = ('evi', 'air_temp_encoded', 'wind', 'humidity', 'elevation', 'kbdi')
OVERRIDE_TTL = timedelta(hours=24)
MAX_SAVED_OVERRIDES = 20  # per user; keep in sync with the research-page legend note


def _now():
    return datetime.now(timezone.utc)


def _coerce_user_id():
    raw = get_jwt_identity()
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _prune_expired(user_id):
    """Delete the user's expired overrides so the space frees back up and those
    zones revert to live data. Called on every read/write."""
    deleted = (UserOverride.query
               .filter(UserOverride.user_id == user_id,
                       UserOverride.expires_at <= _now())
               .delete(synchronize_session=False))
    if deleted:
        db.session.commit()
    return deleted


def _serialize(o: UserOverride) -> dict:
    return {
        'id': o.id,
        'scope': o.scope,
        'zone_id': o.zone_id,
        'zone_name': o.zone_name,
        'evi': o.evi,
        'air_temp_encoded': o.air_temp_encoded,
        'wind': o.wind,
        'humidity': o.humidity,
        'elevation': o.elevation,
        'kbdi': o.kbdi,
        'risk_score': o.risk_score,
        'label': o.label,
        'note': o.note,
        'created_at': o.created_at.isoformat() if o.created_at else None,
        'updated_at': o.updated_at.isoformat() if o.updated_at else None,
        'expires_at': o.expires_at.isoformat() if o.expires_at else None,
    }


@overrides_bp.route('/overrides', methods=['GET'])
@jwt_required()
def list_overrides():
    """List the current user's *active* (non-expired) overrides, newest first.

    Optional ?scope=county|zip|neighborhood|tract filter.
    """
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token'}), 401

    _prune_expired(user_id)

    q = UserOverride.query.filter(UserOverride.user_id == user_id,
                                  UserOverride.expires_at > _now())
    scope = request.args.get('scope')
    if scope is not None:
        if scope not in VALID_SCOPES:
            return jsonify({'error': f'scope must be one of {sorted(VALID_SCOPES)}'}), 400
        q = q.filter(UserOverride.scope == scope)
    rows = q.order_by(UserOverride.updated_at.desc()).all()
    return jsonify([_serialize(o) for o in rows])


@overrides_bp.route('/overrides', methods=['POST'])
@jwt_required()
def save_override():
    """Upsert the override for (user, scope, zone): refreshes values + the 24h
    window. risk_score+label are computed from the 6 features at save time."""
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token'}), 401

    data = request.get_json() or {}

    scope = (data.get('scope') or '').strip()
    if scope not in VALID_SCOPES:
        return jsonify({'error': f'scope must be one of {sorted(VALID_SCOPES)}'}), 400

    zone_id = (str(data.get('zone_id')).strip() if data.get('zone_id') is not None else '')
    if not zone_id:
        return jsonify({'error': 'zone_id is required'}), 400

    try:
        features = {k: float(data[k]) for k in _FEATURES}
    except (KeyError, TypeError, ValueError):
        return jsonify({'error': f'these numeric features are required: {", ".join(_FEATURES)}'}), 400

    note = data.get('note')
    if note is not None:
        note = str(note).strip()[:280] or None
    zone_name = (str(data['zone_name']).strip()[:128] if data.get('zone_name') else None)

    _prune_expired(user_id)

    o = (UserOverride.query
         .filter_by(user_id=user_id, scope=scope, zone_id=zone_id)
         .first())
    # 20-zone cap: re-saving an existing zone is always allowed (it upserts);
    # a NEW zone is rejected once the user already has MAX_SAVED_OVERRIDES active.
    if o is None:
        active = (UserOverride.query
                  .filter(UserOverride.user_id == user_id,
                          UserOverride.expires_at > _now())
                  .count())
        if active >= MAX_SAVED_OVERRIDES:
            return jsonify({'error': f'Save limit reached: at most {MAX_SAVED_OVERRIDES} '
                                     f'zones can be saved at once. Reset a zone to free a slot.',
                            'limit': MAX_SAVED_OVERRIDES, 'active': active}), 409

    result = predict_from_features(**features)
    expires_at = _now() + OVERRIDE_TTL

    if o is None:
        o = UserOverride(user_id=user_id, scope=scope, zone_id=zone_id)
        db.session.add(o)
    # Upsert the values + refresh the window.
    o.zone_name = zone_name
    o.note = note
    for k, v in features.items():
        setattr(o, k, v)
    o.risk_score = result['risk_score']
    o.label = result['label']
    o.expires_at = expires_at

    db.session.commit()
    return jsonify(_serialize(o)), 200


@overrides_bp.route('/overrides/<int:override_id>', methods=['DELETE'])
@jwt_required()
def delete_override(override_id):
    """Owner-scoped delete (manual clear before expiry) — resets one zone."""
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token'}), 401

    o = UserOverride.query.filter_by(id=override_id, user_id=user_id).first()
    if not o:
        return jsonify({'error': 'Not found'}), 404

    db.session.delete(o)
    db.session.commit()
    return jsonify({'ok': True})


@overrides_bp.route('/overrides', methods=['DELETE'])
@jwt_required()
def delete_all_overrides():
    """Clear ALL of the user's overrides (reset-all-zones). Optional ?scope=
    limits it to one zone level."""
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token'}), 401

    q = UserOverride.query.filter(UserOverride.user_id == user_id)
    scope = request.args.get('scope')
    if scope is not None:
        if scope not in VALID_SCOPES:
            return jsonify({'error': f'scope must be one of {sorted(VALID_SCOPES)}'}), 400
        q = q.filter(UserOverride.scope == scope)
    deleted = q.delete(synchronize_session=False)
    db.session.commit()
    return jsonify({'ok': True, 'deleted': deleted})
