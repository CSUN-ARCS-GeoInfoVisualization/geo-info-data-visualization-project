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
