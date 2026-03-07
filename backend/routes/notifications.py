from datetime import datetime, timedelta, timezone

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt

from models import db, User, NotificationPreference, AlertActivity


notifications_bp = Blueprint('notifications', __name__)

FREQUENCY_OPTIONS = {'instant', 'daily', 'weekly'}
RISK_MIN = 0
RISK_MAX = 100


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _parse_datetime(value, field_name):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f'{field_name} must be an ISO-8601 string or null')
    text = value.strip()
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _format_datetime(value):
    if value is None:
        return None
    return value.isoformat() + 'Z'


def _coerce_user_id():
    raw = get_jwt_identity()
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _get_or_create_preference(user_id):
    pref = NotificationPreference.query.filter_by(user_id=user_id).first()
    if pref:
        return pref
    pref = NotificationPreference(user_id=user_id)
    db.session.add(pref)
    db.session.commit()
    return pref


def _serialize_preference(pref):
    return {
        'user_id': pref.user_id,
        'opted_in': pref.opted_in,
        'email_enabled': pref.email_enabled,
        'sms_enabled': pref.sms_enabled,
        'frequency': pref.frequency,
        'risk_threshold': pref.risk_threshold,
        'paused_until': _format_datetime(pref.paused_until),
        'blackout_start': _format_datetime(pref.blackout_start),
        'blackout_end': _format_datetime(pref.blackout_end),
        'last_sent_at': _format_datetime(pref.last_sent_at),
        'unsubscribed_at': _format_datetime(pref.unsubscribed_at),
    }


def evaluate_alert_eligibility(pref, risk_level, now=None):
    check_time = now or _now()
    if not pref.opted_in:
        return False, 'unsubscribed'
    if pref.paused_until and check_time < pref.paused_until:
        return False, 'paused'
    if pref.blackout_start and pref.blackout_end:
        if pref.blackout_start <= check_time <= pref.blackout_end:
            return False, 'blackout'
    if risk_level < pref.risk_threshold:
        return False, 'below_risk_threshold'
    if pref.frequency == 'instant':
        return True, 'eligible'
    if not pref.last_sent_at:
        return True, 'eligible'
    delta = check_time - pref.last_sent_at
    if pref.frequency == 'daily':
        if delta >= timedelta(days=1):
            return True, 'eligible'
        return False, 'frequency_not_elapsed'
    if pref.frequency == 'weekly':
        if delta >= timedelta(days=7):
            return True, 'eligible'
        return False, 'frequency_not_elapsed'
    return False, 'invalid_frequency'


def should_send_alert(pref, risk_level, now=None):
    eligible, _ = evaluate_alert_eligibility(pref, risk_level, now=now)
    return eligible


def _apply_preference_updates(pref, data):
    if 'email_enabled' in data:
        if not isinstance(data['email_enabled'], bool):
            return {'error': 'email_enabled must be a boolean'}, 400
        pref.email_enabled = data['email_enabled']
    
    if 'sms_enabled' in data:
        if not isinstance(data['sms_enabled'], bool):
            return {'error': 'sms_enabled must be a boolean'}, 400
        pref.sms_enabled = data['sms_enabled']
    if 'frequency' in data:
        frequency = data['frequency']
        if frequency not in FREQUENCY_OPTIONS:
            return {'error': 'frequency must be instant, daily, or weekly'}, 400
        pref.frequency = frequency

    if 'risk_threshold' in data:
        threshold = data['risk_threshold']
        if not isinstance(threshold, int):
            return {'error': 'risk_threshold must be an integer'}, 400
        if threshold < RISK_MIN or threshold > RISK_MAX:
            return {'error': f'risk_threshold must be between {RISK_MIN} and {RISK_MAX}'}, 400
        pref.risk_threshold = threshold

    if 'paused_until' in data:
        try:
            pref.paused_until = _parse_datetime(data['paused_until'], 'paused_until')
        except ValueError as exc:
            return {'error': str(exc)}, 400

    if 'blackout_start' in data:
        try:
            pref.blackout_start = _parse_datetime(data['blackout_start'], 'blackout_start')
        except ValueError as exc:
            return {'error': str(exc)}, 400

    if 'blackout_end' in data:
        try:
            pref.blackout_end = _parse_datetime(data['blackout_end'], 'blackout_end')
        except ValueError as exc:
            return {'error': str(exc)}, 400

    if pref.blackout_start and pref.blackout_end and pref.blackout_start > pref.blackout_end:
        return {'error': 'blackout_start must be before blackout_end'}, 400

    return None, None


@notifications_bp.route('/me/notifications', methods=['GET'])
@jwt_required()
def get_my_notifications():
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token identity'}), 401
    pref = _get_or_create_preference(user_id)
    return jsonify(_serialize_preference(pref))


@notifications_bp.route('/me/notifications', methods=['PUT'])
@jwt_required()
def update_my_notifications():
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token identity'}), 401
    pref = _get_or_create_preference(user_id)
    data = request.get_json() or {}
    error, status = _apply_preference_updates(pref, data)
    if error:
        return jsonify(error), status
    db.session.commit()
    return jsonify(_serialize_preference(pref))


@notifications_bp.route('/notifications/preferences', methods=['PUT'])
@jwt_required()
def update_notification_preferences():
    return update_my_notifications()


@notifications_bp.route('/notifications/subscribe', methods=['POST'])
@jwt_required()
def subscribe_notifications():
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token identity'}), 401
    pref = _get_or_create_preference(user_id)
    pref.opted_in = True
    pref.unsubscribed_at = None
    db.session.commit()
    return jsonify(_serialize_preference(pref))


@notifications_bp.route('/notifications/unsubscribe', methods=['POST'])
@jwt_required()
def unsubscribe_notifications():
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token identity'}), 401
    pref = _get_or_create_preference(user_id)
    pref.opted_in = False
    pref.unsubscribed_at = _now()
    db.session.commit()
    return jsonify(_serialize_preference(pref))


@notifications_bp.route('/admin/notifications', methods=['GET'])
@jwt_required()
def admin_get_notifications():
    claims = get_jwt()
    if claims.get('role') != 'Admin':
        return jsonify({'error': 'Admin access required'}), 403
    result = [_serialize_preference(pref) for pref in NotificationPreference.query.all()]
    return jsonify(result)


@notifications_bp.route('/admin/notifications/<int:user_id>', methods=['PUT'])
@jwt_required()
def admin_update_notifications(user_id):
    claims = get_jwt()
    if claims.get('role') != 'Admin':
        return jsonify({'error': 'Admin access required'}), 403
    pref = _get_or_create_preference(user_id)
    data = request.get_json() or {}
    if 'opted_in' in data:
        pref.opted_in = bool(data['opted_in'])
        pref.unsubscribed_at = None if pref.opted_in else _now()
    error, status = _apply_preference_updates(pref, data)
    if error:
        return jsonify(error), status
    db.session.commit()
    return jsonify(_serialize_preference(pref))


@notifications_bp.route('/admin/notifications/dispatch/<int:user_id>', methods=['POST'])
@jwt_required()
def admin_dispatch_notification(user_id):
    claims = get_jwt()
    if claims.get('role') != 'Admin':
        return jsonify({'error': 'Admin access required'}), 403

    target_user = db.session.get(User, user_id)
    if not target_user:
        return jsonify({'error': 'User not found'}), 404

    data = request.get_json() or {}
    risk_level = data.get('risk_level')
    if not isinstance(risk_level, int):
        return jsonify({'error': 'risk_level must be an integer'}), 400
    if risk_level < RISK_MIN or risk_level > RISK_MAX:
        return jsonify({'error': f'risk_level must be between {RISK_MIN} and {RISK_MAX}'}), 400

    pref = _get_or_create_preference(user_id)
    eligible, reason = evaluate_alert_eligibility(pref, risk_level, now=_now())

    requester_id = _coerce_user_id()
    if eligible:
        pref.last_sent_at = _now()

    activity = AlertActivity(
        user_id=user_id,
        risk_level=risk_level,
        delivery_status='sent' if eligible else 'skipped',
        reason=reason,
        triggered_by_user_id=requester_id,
    )
    db.session.add(activity)
    db.session.commit()

    return jsonify({
        'user_id': user_id,
        'delivery_status': activity.delivery_status,
        'reason': activity.reason,
        'activity_id': activity.id,
        'preference': _serialize_preference(pref),
    })
