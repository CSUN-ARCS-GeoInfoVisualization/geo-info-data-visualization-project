def test_me_requires_auth(client):
    resp = client.get('/api/me')
    assert resp.status_code == 401

def test_me_success(client):
    # Register and login to get token
    client.post('/api/register', json={'email': 'me@example.com', 'password': 'Password123!'})
    login = client.post('/api/login', json={'email': 'me@example.com', 'password': 'Password123!'})
    token = login.get_json()['token']
    resp = client.get('/api/me', headers={'Authorization': f'Bearer {token}'})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['email'] == 'me@example.com'
