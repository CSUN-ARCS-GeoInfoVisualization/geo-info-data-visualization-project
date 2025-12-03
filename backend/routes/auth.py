from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token
from email_validator import validate_email, EmailNotValidError
from models import db, User, Role
from config import Config

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    email = data.get('email')
    password = data.get('password')
    requested_role = data.get('role')

    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400
    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400
    try:
        validate_email(email)
    except EmailNotValidError as e:
        return jsonify({'error': str(e)}), 400

    # Prevent Admin self-registration
    role_name = 'Researcher' if requested_role == 'Researcher' else 'Resident'
    role = Role.query.filter_by(name=role_name).first()
    if not role:
        return jsonify({'error': 'Role not configured'}), 500

    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already registered'}), 409

    user = User(email=email, password_hash=User.hash_password(password), role_id=role.id)
    db.session.add(user)
    db.session.commit()

    return jsonify({'message': 'User registered', 'user': {'id': user.id, 'email': user.email, 'role': role.name}}), 201

@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    email = data.get('email')
    password = data.get('password')
    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400
    user = User.query.filter_by(email=email).join(Role).first()
    if not user or not user.verify_password(password):
        return jsonify({'error': 'Invalid credentials'}), 401
    access_token = create_access_token(identity={'id': user.id, 'email': user.email, 'role': user.role.name})
    return jsonify({'token': access_token})
