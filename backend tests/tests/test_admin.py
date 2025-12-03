from models import db, User, Role

def create_user(email, password, role_name):
    role = Role.query.filter_by(name=role_name).first()
    u = User(email=email, password_hash=User.hash_password(password), role_id=role.id)
    db.session.add(u)
    db.session.commit()
    return u


def login_token(client, email, password):
    resp = client.post('/api/login', json={'email': email, 'password': password})
    return resp.get_json().get('token')


def test_admin_requires_admin_role(client):
    # Create resident and login
    client.post('/api/register', json={'email': 'res@example.com', 'password': 'Password123!'})
    token = login_token(client, 'res@example.com', 'Password123!')
    res = client.get('/api/admin/users', headers={'Authorization': f'Bearer {token}'})
    assert res.status_code == 403


def test_admin_can_list_and_assign(client):
    # Create admin and user
    admin = create_user('admin@example.com', 'Password123!', 'Admin')
    user = create_user('user@example.com', 'Password123!', 'Resident')
    token = login_token(client, 'admin@example.com', 'Password123!')

    # List users
    res = client.get('/api/admin/users', headers={'Authorization': f'Bearer {token}'})
    assert res.status_code == 200

    # Assign role
    res = client.post('/api/admin/assign-role', json={'userId': user.id, 'role': 'Researcher'}, headers={'Authorization': f'Bearer {token}'})
    assert res.status_code == 200


def test_last_admin_safeguard(client):
    # Only one admin exists
    create_user('onlyadmin@example.com', 'Password123!', 'Admin')
    token = login_token(client, 'onlyadmin@example.com', 'Password123!')
    # Attempt to demote self
    me_res = client.get('/api/me', headers={'Authorization': f'Bearer {token}'})
    uid = me_res.get_json()['id']
    res = client.post('/api/admin/assign-role', json={'userId': uid, 'role': 'Resident'}, headers={'Authorization': f'Bearer {token}'})
    assert res.status_code == 400
    assert 'last remaining admin' in res.get_json().get('error','')
