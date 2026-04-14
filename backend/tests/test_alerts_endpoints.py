"""Endpoint tests for alert preferences, monitored areas, and alert history."""
import pytest
from app import create_app
from models import db, Role
from services.email import init_email_service


class AlertsTestConfig:
    TESTING = True
    SECRET_KEY = 'test'
    JWT_SECRET_KEY = 'test_jwt'
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    USE_MOCK_EMAIL_PROVIDER = True


@pytest.fixture(scope='module')
def alerts_app():
    import os
    os.environ['USE_MOCK_PROVIDER'] = 'true'
    app = create_app(AlertsTestConfig)
    with app.app_context():
        db.create_all()
        for name in ['Resident', 'Researcher', 'Admin']:
            if not Role.query.filter_by(name=name).first():
                db.session.add(Role(name=name))
        db.session.commit()
        init_email_service(app)
    return app


@pytest.fixture(scope='module')
def alerts_client(alerts_app):
    return alerts_app.test_client()


@pytest.fixture(autouse=True)
def alerts_app_context(alerts_app):
    with alerts_app.app_context():
        yield


# --- /api/alert-preferences ---

def test_get_alert_preferences_missing_user_id(alerts_client):
    resp = alerts_client.get('/api/alert-preferences')
    assert resp.status_code == 400


def test_get_alert_preferences_defaults_for_new_user(alerts_client):
    resp = alerts_client.get('/api/alert-preferences?user_id=999')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['frequency'] == 'instant'
    assert data['risk_threshold'] == 70
    assert data['is_paused'] is False


def test_put_alert_preferences_missing_user_id(alerts_client):
    resp = alerts_client.put('/api/alert-preferences', json={'frequency': 'daily'})
    assert resp.status_code == 400


def test_put_alert_preferences_creates_and_returns_ok(alerts_client):
    resp = alerts_client.put('/api/alert-preferences', json={
        'user_id': 1,
        'frequency': 'daily',
        'risk_threshold': 60,
        'is_paused': False,
    })
    assert resp.status_code == 200
    assert resp.get_json()['ok'] is True


def test_put_alert_preferences_updates_existing(alerts_client):
    alerts_client.put('/api/alert-preferences', json={'user_id': 2, 'frequency': 'daily'})
    alerts_client.put('/api/alert-preferences', json={'user_id': 2, 'frequency': 'weekly'})

    resp = alerts_client.get('/api/alert-preferences?user_id=2')
    assert resp.get_json()['frequency'] == 'weekly'


def test_put_alert_preferences_is_paused(alerts_client):
    alerts_client.put('/api/alert-preferences', json={'user_id': 3, 'is_paused': True})
    resp = alerts_client.get('/api/alert-preferences?user_id=3')
    assert resp.get_json()['is_paused'] is True


def test_unsubscribe_missing_user_id(alerts_client):
    resp = alerts_client.post('/api/alert-preferences/unsubscribe', json={})
    assert resp.status_code == 400


def test_unsubscribe_sets_is_paused(alerts_client):
    alerts_client.put('/api/alert-preferences', json={'user_id': 4, 'is_paused': False})
    resp = alerts_client.post('/api/alert-preferences/unsubscribe', json={'user_id': 4})
    assert resp.status_code == 200
    assert resp.get_json()['ok'] is True

    resp = alerts_client.get('/api/alert-preferences?user_id=4')
    assert resp.get_json()['is_paused'] is True


def test_unsubscribe_nonexistent_user_still_ok(alerts_client):
    resp = alerts_client.post('/api/alert-preferences/unsubscribe', json={'user_id': 9999})
    assert resp.status_code == 200


# --- /api/monitored-areas ---

def test_get_monitored_areas_missing_user_id(alerts_client):
    resp = alerts_client.get('/api/monitored-areas')
    assert resp.status_code == 400


def test_get_monitored_areas_empty_for_new_user(alerts_client):
    resp = alerts_client.get('/api/monitored-areas?user_id=100')
    assert resp.status_code == 200
    assert resp.get_json() == []


def test_post_monitored_area_missing_area_name(alerts_client):
    resp = alerts_client.post('/api/monitored-areas', json={'user_id': 1})
    assert resp.status_code == 400


def test_post_monitored_area_missing_user_id(alerts_client):
    resp = alerts_client.post('/api/monitored-areas', json={'area_name': 'Test'})
    assert resp.status_code == 400


def test_post_monitored_area_creates_successfully(alerts_client):
    resp = alerts_client.post('/api/monitored-areas', json={
        'user_id': 10,
        'area_name': 'Los Angeles',
    })
    assert resp.status_code == 201
    data = resp.get_json()
    assert data['area_name'] == 'Los Angeles'
    assert 'id' in data


def test_post_monitored_area_with_geojson(alerts_client):
    geojson = '{"type":"Point","coordinates":[-118.25,34.05]}'
    resp = alerts_client.post('/api/monitored-areas', json={
        'user_id': 11,
        'area_name': 'Downtown LA',
        'area_geojson': geojson,
    })
    assert resp.status_code == 201


def test_get_monitored_areas_returns_created(alerts_client):
    alerts_client.post('/api/monitored-areas', json={'user_id': 12, 'area_name': 'Malibu'})
    resp = alerts_client.get('/api/monitored-areas?user_id=12')
    areas = resp.get_json()
    assert len(areas) == 1
    assert areas[0]['area_name'] == 'Malibu'


def test_delete_monitored_area(alerts_client):
    create_resp = alerts_client.post('/api/monitored-areas', json={'user_id': 13, 'area_name': 'Santa Monica'})
    area_id = create_resp.get_json()['id']

    del_resp = alerts_client.delete(f'/api/monitored-areas/{area_id}')
    assert del_resp.status_code == 200
    assert del_resp.get_json()['ok'] is True

    areas = alerts_client.get('/api/monitored-areas?user_id=13').get_json()
    assert len(areas) == 0


def test_delete_monitored_area_not_found(alerts_client):
    resp = alerts_client.delete('/api/monitored-areas/99999')
    assert resp.status_code == 404


# --- /api/alert-history ---

def test_get_alert_history_missing_user_id(alerts_client):
    resp = alerts_client.get('/api/alert-history')
    assert resp.status_code == 400


def test_get_alert_history_empty_for_new_user(alerts_client):
    resp = alerts_client.get('/api/alert-history?user_id=200')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['items'] == []
    assert data['total'] == 0
    assert data['page'] == 1


def test_get_alert_history_pagination_defaults(alerts_client):
    resp = alerts_client.get('/api/alert-history?user_id=201')
    data = resp.get_json()
    assert 'per_page' in data
    assert data['per_page'] == 20


def test_get_alert_history_custom_pagination(alerts_client):
    resp = alerts_client.get('/api/alert-history?user_id=202&page=2&per_page=5')
    data = resp.get_json()
    assert data['page'] == 2
    assert data['per_page'] == 5
