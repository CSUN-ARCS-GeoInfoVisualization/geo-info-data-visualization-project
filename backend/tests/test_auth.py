from flask_jwt_extended import decode_token
from models import db, User, Role

def test_register_validation(client):
    resp = client.post('/api/register', json={'email': 'bad', 'password': 'short'})
    assert resp.status_code == 400

def test_register_and_login(client, db_session):
    # Register
    resp = client.post('/api/register', json={'email': 'new@example.com', 'password': 'Password123!'})
    assert resp.status_code == 201
    # Login
    resp = client.post('/api/login', json={'email': 'new@example.com', 'password': 'Password123!'})
    assert resp.status_code == 200
    token = resp.get_json().get('token')
    assert token

def test_login_invalid(client):
    resp = client.post('/api/login', json={'email': 'nouser@example.com', 'password': 'x'})
    assert resp.status_code == 401


def test_login_token_contains_claims(client, app):
    client.post('/api/register', json={'email': 'claims@example.com', 'password': 'Password123!'})
    resp = client.post('/api/login', json={'email': 'claims@example.com', 'password': 'Password123!'})
    token = resp.get_json().get('token')
    assert token

    with app.app_context():
        decoded = decode_token(token)
        user = User.query.filter_by(email='claims@example.com').first()

    assert decoded['sub'] == str(user.id)
    assert decoded['email'] == 'claims@example.com'
    assert decoded['role'] == 'Resident'
