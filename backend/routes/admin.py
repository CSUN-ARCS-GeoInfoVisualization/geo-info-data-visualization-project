from datetime import datetime, timedelta, timezone

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from sqlalchemy import func as sa_func

from config import Config
from models import db, User, Role, RoleRequest

admin_bp = Blueprint('admin', __name__)


def require_admin():
    identity = get_jwt_identity()
    claims = get_jwt()
    if not identity or claims.get('role') != 'Admin':
        return False
    return True


@admin_bp.route('/users', methods=['GET'])
@jwt_required()
def list_users():
    if not require_admin():
        return jsonify({'error': 'Admin access required'}), 403
    users = User.query.join(Role).all()
    supreme = [e.lower() for e in Config.SUPREME_ADMINS]
    result = [{
        'id': u.id, 'email': u.email, 'role': u.role.name,
        'is_supreme': u.email.lower() in supreme,
        'created_at': u.created_at.isoformat() if u.created_at else None,
    } for u in users]
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
    # Protect supreme admins
    if user.email.lower() in [e.lower() for e in Config.SUPREME_ADMINS]:
        return jsonify({'error': 'Cannot modify supreme admin role'}), 403
    # Safeguard last admin
    if user.role.name == 'Admin' and role_name != 'Admin':
        admin_count = User.query.join(Role).filter(Role.name == 'Admin', User.id != user.id).count()
        if admin_count == 0:
            return jsonify({'error': 'Cannot remove Admin role from the last remaining admin'}), 400
    new_role = Role.query.filter_by(name=role_name).first()
    if not new_role:
        return jsonify({'error': 'Role not found'}), 404
    user.role_id = new_role.id
    db.session.commit()
    return jsonify({'message': 'Role updated.'})


@admin_bp.route('/stats', methods=['GET'])
@jwt_required()
def stats():
    if not require_admin():
        return jsonify({'error': 'Admin access required'}), 403
    total = User.query.count()
    role_counts = {}
    for row in db.session.query(Role.name, sa_func.count(User.id)).join(User).group_by(Role.name).all():
        role_counts[row[0]] = row[1]
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    recent = User.query.filter(User.created_at >= week_ago).count()
    return jsonify({
        'total_users': total,
        'role_counts': role_counts,
        'recent_signups_7d': recent,
    })


@admin_bp.route('/role-requests', methods=['GET'])
@jwt_required()
def list_role_requests():
    if not require_admin():
        return jsonify({'error': 'Admin access required'}), 403
    reqs = RoleRequest.query.filter_by(status='pending').order_by(RoleRequest.created_at.desc()).all()
    result = []
    for r in reqs:
        user = User.query.get(r.user_id)
        result.append({
            'id': r.id,
            'user_id': r.user_id,
            'email': user.email if user else 'unknown',
            'requested_role': r.requested_role,
            'reason': r.reason,
            'status': r.status,
            'created_at': r.created_at.isoformat() if r.created_at else None,
        })
    return jsonify(result)


@admin_bp.route('/role-requests/<int:req_id>/approve', methods=['POST'])
@jwt_required()
def approve_role_request(req_id):
    if not require_admin():
        return jsonify({'error': 'Admin access required'}), 403
    rr = RoleRequest.query.get(req_id)
    if not rr or rr.status != 'pending':
        return jsonify({'error': 'Request not found or already processed'}), 404
    new_role = Role.query.filter_by(name=rr.requested_role).first()
    if not new_role:
        return jsonify({'error': 'Role not found'}), 404
    user = User.query.get(rr.user_id)
    if user:
        user.role_id = new_role.id
    admin_id = get_jwt_identity()
    rr.status = 'approved'
    rr.reviewed_by = int(admin_id)
    db.session.commit()
    return jsonify({'message': 'Request approved'})


@admin_bp.route('/role-requests/<int:req_id>/deny', methods=['POST'])
@jwt_required()
def deny_role_request(req_id):
    if not require_admin():
        return jsonify({'error': 'Admin access required'}), 403
    rr = RoleRequest.query.get(req_id)
    if not rr or rr.status != 'pending':
        return jsonify({'error': 'Request not found or already processed'}), 404
    admin_id = get_jwt_identity()
    rr.status = 'denied'
    rr.reviewed_by = int(admin_id)
    db.session.commit()
    return jsonify({'message': 'Request denied'})
