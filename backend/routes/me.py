from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, User, Role, RoleRequest
from config import Config

me_bp = Blueprint('me', __name__)


def _get_user():
    uid = get_jwt_identity()
    try:
        uid = int(uid)
    except (TypeError, ValueError):
        return None
    return User.query.filter_by(id=uid).join(Role).first()


@me_bp.route('/me', methods=['GET'])
@jwt_required()
def me():
    user = _get_user()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    return jsonify({
        'id': user.id,
        'email': user.email,
        'role': user.role.name,
        'is_supreme': user.email.lower() in [e.lower() for e in Config.SUPREME_ADMINS],
    })


@me_bp.route('/me/role-request', methods=['GET'])
@jwt_required()
def get_role_request():
    user = _get_user()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    req = RoleRequest.query.filter_by(user_id=user.id, status='pending').first()
    if not req:
        return jsonify(None)
    return jsonify({
        'id': req.id, 'requested_role': req.requested_role,
        'reason': req.reason, 'status': req.status,
        'created_at': req.created_at.isoformat() if req.created_at else None,
    })


@me_bp.route('/me/role-request', methods=['POST'])
@jwt_required()
def create_role_request():
    user = _get_user()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    if user.role.name in ('Researcher', 'Admin'):
        return jsonify({'error': 'You already have elevated access'}), 400
    existing = RoleRequest.query.filter_by(user_id=user.id, status='pending').first()
    if existing:
        return jsonify({'error': 'You already have a pending request'}), 409
    data = request.get_json() or {}
    reason = (data.get('reason') or '').strip()[:500]
    req = RoleRequest(
        user_id=user.id,
        requested_role=data.get('role', 'Researcher'),
        reason=reason,
        status='pending',
    )
    db.session.add(req)
    db.session.commit()
    return jsonify({'message': 'Request submitted', 'id': req.id}), 201
