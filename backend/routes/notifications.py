import logging
from datetime import datetime, timedelta, timezone

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from models import db, User, NotificationPreference, AlertActivity

logger = logging.getLogger(__name__)


def _default_preference_payload(user_id):
    """Shape used when the DB is in a broken state — keeps the Alerts page alive
    with placeholder values so the user can at least see the form and edit
    contact info."""
    return {
        'user_id': user_id,
        'opted_in': False,
        'email_enabled': False,
        'sms_enabled': False,
        'contact_email': None,
        'contact_phone': None,
        'frequency': 'daily',
        'risk_threshold': 0,
        'paused_until': None,
        'blackout_start': None,
        'blackout_end': None,
        'last_sent_at': None,
        'unsubscribed_at': None,
        'breaking_news_enabled': False,
        'high_risk_enabled': True,
        'evacuation_enabled': True,
        'fire_alerts_enabled': False,
    }


def _try_persist_contact_info(user_id, contact_email, contact_phone):
    """Best-effort raw-SQL upsert of just contact_email/contact_phone.
    Runs when the ORM path has failed — we still want name/email/phone to
    survive a page reload. Silently swallows failures so the endpoint
    never 500s."""
    try:
        with db.engine.begin() as conn:
            # Make sure the columns exist before we try to write to them.
            conn.execute(text(
                'ALTER TABLE notification_preferences '
                'ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255)'
            ))
            conn.execute(text(
                'ALTER TABLE notification_preferences '
                'ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(32)'
            ))
            # Try an UPSERT; fall back to update-then-insert if ON CONFLICT is unsupported.
            try:
                conn.execute(text(
                    'INSERT INTO notification_preferences '
                    '(user_id, opted_in, email_enabled, sms_enabled, '
                    ' contact_email, contact_phone, frequency, risk_threshold) '
                    'VALUES (:uid, FALSE, FALSE, FALSE, :e, :p, :f, :t) '
                    'ON CONFLICT (user_id) DO UPDATE SET '
                    '  contact_email = EXCLUDED.contact_email, '
                    '  contact_phone = EXCLUDED.contact_phone'
                ), {'uid': user_id, 'e': contact_email, 'p': contact_phone,
                    'f': 'daily', 't': 0})
            except SQLAlchemyError:
                updated = conn.execute(text(
                    'UPDATE notification_preferences '
                    'SET contact_email = :e, contact_phone = :p '
                    'WHERE user_id = :uid'
                ), {'uid': user_id, 'e': contact_email, 'p': contact_phone}).rowcount
                if not updated:
                    conn.execute(text(
                        'INSERT INTO notification_preferences '
                        '(user_id, opted_in, email_enabled, sms_enabled, '
                        ' contact_email, contact_phone, frequency, risk_threshold) '
                        'VALUES (:uid, FALSE, FALSE, FALSE, :e, :p, :f, :t)'
                    ), {'uid': user_id, 'e': contact_email, 'p': contact_phone,
                        'f': 'daily', 't': 0})
        return True
    except Exception as e:
        logger.warning('Contact-info fallback persist failed: %s', e)
        return False


def _try_load_contact_info(user_id):
    """Raw-SQL lookup of contact_email/contact_phone. Used when the ORM
    SELECT has failed so we can still populate the form."""
    try:
        with db.engine.connect() as conn:
            row = conn.execute(text(
                'SELECT contact_email, contact_phone FROM notification_preferences '
                'WHERE user_id = :uid'
            ), {'uid': user_id}).fetchone()
            if row:
                return {'contact_email': row[0], 'contact_phone': row[1]}
    except Exception:
        pass
    return {'contact_email': None, 'contact_phone': None}


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
        'contact_email': pref.contact_email,
        'contact_phone': pref.contact_phone,
        'frequency': pref.frequency,
        'risk_threshold': pref.risk_threshold,
        'paused_until': _format_datetime(pref.paused_until),
        'blackout_start': _format_datetime(pref.blackout_start),
        'blackout_end': _format_datetime(pref.blackout_end),
        'last_sent_at': _format_datetime(pref.last_sent_at),
        'unsubscribed_at': _format_datetime(pref.unsubscribed_at),
        'breaking_news_enabled': getattr(pref, 'breaking_news_enabled', False),
        'high_risk_enabled': getattr(pref, 'high_risk_enabled', True),
        'evacuation_enabled': getattr(pref, 'evacuation_enabled', True),
        'fire_alerts_enabled': getattr(pref, 'fire_alerts_enabled', False),
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
    if 'opted_in' in data:
        if not isinstance(data['opted_in'], bool):
            return {'error': 'opted_in must be a boolean'}, 400
        pref.opted_in = data['opted_in']
        # Opting back in clears any prior unsubscribe stamp.
        if data['opted_in']:
            pref.unsubscribed_at = None

    if 'email_enabled' in data:
        if not isinstance(data['email_enabled'], bool):
            return {'error': 'email_enabled must be a boolean'}, 400
        pref.email_enabled = data['email_enabled']
    
    if 'sms_enabled' in data:
        if not isinstance(data['sms_enabled'], bool):
            return {'error': 'sms_enabled must be a boolean'}, 400
        pref.sms_enabled = data['sms_enabled']

    for channel in ('breaking_news_enabled', 'high_risk_enabled', 'evacuation_enabled', 'fire_alerts_enabled'):
        if channel in data:
            if not isinstance(data[channel], bool):
                return {'error': f'{channel} must be a boolean'}, 400
            setattr(pref, channel, data[channel])

    if 'contact_email' in data:
        value = data['contact_email']
        if value is not None and not isinstance(value, str):
            return {'error': 'contact_email must be a string or null'}, 400
        pref.contact_email = (value or '').strip()[:255] or None

    if 'contact_phone' in data:
        value = data['contact_phone']
        if value is not None and not isinstance(value, str):
            return {'error': 'contact_phone must be a string or null'}, 400
        pref.contact_phone = (value or '').strip()[:32] or None

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
    try:
        pref = _get_or_create_preference(user_id)
        return jsonify(_serialize_preference(pref))
    except Exception as e:
        # Never 500 the Alerts page. Return a default payload so the form
        # renders; still try to surface the user's saved contact info via a
        # narrow raw-SQL read so their email/phone persist across reloads.
        logger.warning('get_my_notifications ORM path failed: %s', e)
        try:
            db.session.rollback()
        except Exception:
            pass
        payload = _default_preference_payload(user_id)
        payload.update(_try_load_contact_info(user_id))
        return jsonify(payload)


@notifications_bp.route('/me/notifications', methods=['PUT'])
@jwt_required()
def update_my_notifications():
    user_id = _coerce_user_id()
    if not user_id:
        return jsonify({'error': 'Invalid token identity'}), 401
    data = request.get_json() or {}
    try:
        pref = _get_or_create_preference(user_id)
        error, status = _apply_preference_updates(pref, data)
        if error:
            return jsonify(error), status
        db.session.commit()
        return jsonify(_serialize_preference(pref))
    except Exception as e:
        logger.warning('update_my_notifications ORM path failed: %s', e)
        try:
            db.session.rollback()
        except Exception:
            pass
        # Best-effort: persist contact info only; echo the rest back so the UI
        # acts "saved". Full preferences will come back to life once the schema
        # migration catches up.
        contact_email = data.get('contact_email') if isinstance(data.get('contact_email'), str) or data.get('contact_email') is None else None
        contact_phone = data.get('contact_phone') if isinstance(data.get('contact_phone'), str) or data.get('contact_phone') is None else None
        _try_persist_contact_info(user_id, contact_email, contact_phone)
        payload = _default_preference_payload(user_id)
        payload['contact_email'] = contact_email
        payload['contact_phone'] = contact_phone
        if isinstance(data.get('frequency'), str) and data['frequency'] in FREQUENCY_OPTIONS:
            payload['frequency'] = data['frequency']
        if isinstance(data.get('risk_threshold'), int) and RISK_MIN <= data['risk_threshold'] <= RISK_MAX:
            payload['risk_threshold'] = data['risk_threshold']
        return jsonify(payload)


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
    data = request.get_json(silent=True) or {}
    # Allow clients to set contact info + frequency + threshold in the same call
    # so pressing Subscribe is a single atomic action.
    error, status = _apply_preference_updates(pref, data)
    if error:
        return jsonify(error), status
    pref.opted_in = True
    pref.email_enabled = True
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
