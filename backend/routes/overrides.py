"""Per-user saved risk-override snapshots.

A signed-in user saves the slider values they tried for a zone; the resulting
risk_score+label are computed once (via the live model) and frozen on the row,
so the history panel and the email digest never recompute and never drift.

Auth mirrors routes/locations.py: JWT identity -> int user id, owner-scoped.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import db, UserOverride
from ml.inference import predict_from_features

overrides_bp = Blueprint('overrides', __name__)

VALID_SCOPES = {'county', 'zip', 'neighborhood', 'tract'}
_FEATURES = ('evi', 'air_temp_encoded', 'wind', 'humidity', 'elevation', 'kbdi')


def _coerce_user_id():
    raw = get_jwt_identity()
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


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
    }


@overrides_bp.route('/overrides', methods=['GET'])
@jwt_required()
def list_overrides():
    """List the current user's saved overrides, newest first.

    Optional ?scope=county|zip|neighborhood|tract filter.
    """
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token'}), 401

    q = UserOverride.query.filter_by(user_id=user_id)
    scope = request.args.get('scope')
    if scope is not None:
        if scope not in VALID_SCOPES:
            return jsonify({'error': f'scope must be one of {sorted(VALID_SCOPES)}'}), 400
        q = q.filter_by(scope=scope)
    rows = q.order_by(UserOverride.created_at.desc()).all()
    return jsonify([_serialize(o) for o in rows])


@overrides_bp.route('/overrides', methods=['POST'])
@jwt_required()
def save_override():
    """Save a snapshot. Computes risk_score+label from the 6 features at save
    time so the stored values never drift from what the user saw."""
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

    result = predict_from_features(**features)

    o = UserOverride(
        user_id=user_id,
        scope=scope,
        zone_id=zone_id,
        zone_name=(str(data['zone_name']).strip()[:128] if data.get('zone_name') else None),
        risk_score=result['risk_score'],
        label=result['label'],
        note=note,
        **features,
    )
    db.session.add(o)
    db.session.commit()
    return jsonify(_serialize(o)), 201


@overrides_bp.route('/overrides/<int:override_id>', methods=['DELETE'])
@jwt_required()
def delete_override(override_id):
    """Owner-scoped delete."""
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token'}), 401

    o = UserOverride.query.filter_by(id=override_id, user_id=user_id).first()
    if not o:
        return jsonify({'error': 'Not found'}), 404

    db.session.delete(o)
    db.session.commit()
    return jsonify({'ok': True})
