from datetime import datetime, timedelta, timezone

from models import db, User, Role, NotificationPreference, AlertActivity
from routes.notifications import should_send_alert


def create_user(email, password, role_name='Resident'):
    role = Role.query.filter_by(name=role_name).first()
    user = User(email=email, password_hash=User.hash_password(password), role_id=role.id)
    db.session.add(user)
    db.session.commit()
    return user


def login_token(client, email, password):
    resp = client.post('/api/login', json={'email': email, 'password': password})
    return resp.get_json().get('token')


def test_default_opt_in_false(client):
    client.post('/api/register', json={'email': 'notify@example.com', 'password': 'Password123!'})
    token = login_token(client, 'notify@example.com', 'Password123!')

    resp = client.get('/api/me/notifications', headers={'Authorization': f'Bearer {token}'})
    data = resp.get_json()

    assert resp.status_code == 200
    assert data['opted_in'] is False


def test_subscribe_unsubscribe_flow(client):
    create_user('sub@example.com', 'Password123!')
    token = login_token(client, 'sub@example.com', 'Password123!')

    resp = client.post('/api/notifications/subscribe', headers={'Authorization': f'Bearer {token}'})
    data = resp.get_json()
    assert resp.status_code == 200
    assert data['opted_in'] is True
    assert data['unsubscribed_at'] is None

    resp = client.post('/api/notifications/unsubscribe', headers={'Authorization': f'Bearer {token}'})
    data = resp.get_json()
    assert resp.status_code == 200
    assert data['opted_in'] is False
    assert data['unsubscribed_at'] is not None


def test_update_preferences(client):
    create_user('prefs@example.com', 'Password123!')
    token = login_token(client, 'prefs@example.com', 'Password123!')

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    payload = {
        'frequency': 'weekly',
        'risk_threshold': 55,
        'paused_until': (now + timedelta(hours=6)).isoformat() + 'Z',
        'blackout_start': (now + timedelta(days=1)).isoformat() + 'Z',
        'blackout_end': (now + timedelta(days=2)).isoformat() + 'Z',
    }

    resp = client.put('/api/notifications/preferences', json=payload, headers={'Authorization': f'Bearer {token}'})
    data = resp.get_json()

    assert resp.status_code == 200
    assert data['frequency'] == 'weekly'
    assert data['risk_threshold'] == 55
    assert data['paused_until'] is not None
    assert data['blackout_start'] is not None
    assert data['blackout_end'] is not None


def test_update_preferences_validation(client):
    create_user('invalid@example.com', 'Password123!')
    token = login_token(client, 'invalid@example.com', 'Password123!')

    resp = client.put(
        '/api/notifications/preferences',
        json={'frequency': 'monthly'},
        headers={'Authorization': f'Bearer {token}'}
    )
    assert resp.status_code == 400

    resp = client.put(
        '/api/notifications/preferences',
        json={'risk_threshold': 101},
        headers={'Authorization': f'Bearer {token}'}
    )
    assert resp.status_code == 400


def test_should_send_alert_frequency_and_threshold():
    user = create_user('alerts@example.com', 'Password123!')
    pref = NotificationPreference(
        user_id=user.id,
        opted_in=True,
        frequency='daily',
        risk_threshold=40,
        last_sent_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=23)
    )
    db.session.add(pref)
    db.session.commit()

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    assert should_send_alert(pref, risk_level=50, now=now) is False
    assert should_send_alert(pref, risk_level=30, now=now) is False

    pref.last_sent_at = now - timedelta(hours=25)
    db.session.commit()

    assert should_send_alert(pref, risk_level=50, now=now) is True

def test_default_channel_preferences(client):
    client.post('/api/register', json={'email': 'channels@example.com', 'password': 'Password123!'})
    token = login_token(client, 'channels@example.com', 'Password123!')

    resp = client.get('/api/me/notifications', headers={'Authorization': f'Bearer {token}'})
    data = resp.get_json()

    assert resp.status_code == 200
    assert data['email_enabled'] is False
    assert data['sms_enabled'] is False

def test_update_channel_preferences(client):
    create_user('chan2@example.com', 'Password123!')
    token = login_token(client, 'chan2@example.com', 'Password123!')

    resp = client.put('/api/notifications/preferences', json={'email_enabled': True, 'sms_enabled': True}, headers={'Authorization': f'Bearer {token}'})
    data = resp.get_json()
    assert resp.status_code == 200
    assert data['email_enabled'] is True
    assert data['sms_enabled'] is True

    resp = client.put('/api/notifications/preferences', json={'email_enabled': 'yes'}, headers={'Authorization': f'Bearer {token}'})
    assert resp.status_code == 400


def test_admin_dispatch_notification_sent_creates_activity(client):
    admin = create_user('notify-admin@example.com', 'Password123!', 'Admin')
    user = create_user('dispatch-target@example.com', 'Password123!')

    pref = NotificationPreference(user_id=user.id, opted_in=True, frequency='instant', risk_threshold=20)
    db.session.add(pref)
    db.session.commit()

    token = login_token(client, 'notify-admin@example.com', 'Password123!')
    resp = client.post(
        f'/api/admin/notifications/dispatch/{user.id}',
        json={'risk_level': 70},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert resp.status_code == 200
    data = resp.get_json()
    assert data['delivery_status'] == 'sent'
    assert data['reason'] == 'eligible'
    assert data['preference']['last_sent_at'] is not None

    activity = AlertActivity.query.filter_by(user_id=user.id).order_by(AlertActivity.id.desc()).first()
    assert activity is not None
    assert activity.delivery_status == 'sent'
    assert activity.reason == 'eligible'
    assert activity.triggered_by_user_id == admin.id


def test_admin_dispatch_notification_skipped_records_reason(client):
    create_user('skip-admin@example.com', 'Password123!', 'Admin')
    user = create_user('skip-target@example.com', 'Password123!')

    pref = NotificationPreference(user_id=user.id, opted_in=False, frequency='instant', risk_threshold=0)
    db.session.add(pref)
    db.session.commit()

    token = login_token(client, 'skip-admin@example.com', 'Password123!')
    resp = client.post(
        f'/api/admin/notifications/dispatch/{user.id}',
        json={'risk_level': 90},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert resp.status_code == 200
    data = resp.get_json()
    assert data['delivery_status'] == 'skipped'
    assert data['reason'] == 'unsubscribed'
    assert data['preference']['last_sent_at'] is None

    activity = AlertActivity.query.filter_by(user_id=user.id).order_by(AlertActivity.id.desc()).first()
    assert activity is not None
    assert activity.delivery_status == 'skipped'
    assert activity.reason == 'unsubscribed'


def test_admin_dispatch_notification_requires_admin(client):
    create_user('resident@example.com', 'Password123!')
    target = create_user('target@example.com', 'Password123!')
    token = login_token(client, 'resident@example.com', 'Password123!')

    resp = client.post(
        f'/api/admin/notifications/dispatch/{target.id}',
        json={'risk_level': 60},
        headers={'Authorization': f'Bearer {token}'},
    )

    assert resp.status_code == 403
