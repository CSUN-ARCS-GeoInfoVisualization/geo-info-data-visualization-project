from datetime import datetime, timedelta, timezone

from models import db, User, Role, NotificationPreference
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
