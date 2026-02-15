from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import db, User, Role

admin_bp = Blueprint('admin', __name__)


def require_admin():
    identity = get_jwt_identity()
    claims = get_jwt()
    if not identity or claims.get('role') != 'Admin':
        return False
    return True

@admin_bp.before_request
def check_admin():
    if request.endpoint and request.endpoint.startswith('admin.'):
        # endpoints here require admin
        pass

@admin_bp.route('/users', methods=['GET'])
@jwt_required()
def list_users():
    if not require_admin():
        return jsonify({'error': 'Admin access required'}), 403
    users = User.query.join(Role).all()
    result = [{'id': u.id, 'email': u.email, 'role': u.role.name} for u in users]
    return jsonify(result)

@admin_bp.route('/users/<int:user_id>', methods=['GET'])
@jwt_required()
def get_user(user_id):
    if not require_admin():
        return jsonify({'error': 'Admin access required'}), 403
    u = User.query.filter_by(id=user_id).join(Role).first()
    if not u:
        return jsonify({'error': 'User not found'}), 404
    return jsonify({'id': u.id, 'email': u.email, 'role': u.role.name})

@admin_bp.route('/assign-role', methods=['POST'])
@jwt_required()
def assign_role():
    if not require_admin():
        return jsonify({'error': 'Admin access required'}), 403
    data = request.get_json() or {}
    user_id = data.get('userId')
    role_name = data.get('role')
    if not user_id or not role_name:
        return jsonify({'error': 'User ID and role are required'}), 400
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    # safeguard last admin
    if user.role.name == 'Admin' and role_name != 'Admin':
        admin_count = User.query.join(Role).filter(Role.name=='Admin', User.id!=user.id).count()
        if admin_count == 0:
            return jsonify({'error': 'Cannot remove Admin role from the last remaining admin'}), 400
    new_role = Role.query.filter_by(name=role_name).first()
    if not new_role:
        return jsonify({'error': 'Role not found'}), 404
    user.role_id = new_role.id
    db.session.commit()
    return jsonify({'message': 'Role updated.'})
