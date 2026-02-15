from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt

notifications_bp = Blueprint('notifications', __name__)

# Mock data, swap for real DB queries when the DB is ready
# Default preference for new users is True (notifications on)
notification_preferences = {}


def get_user_preference(user_id):
    return notification_preferences.get(user_id, True)


@notifications_bp.route('/me/notifications', methods=['GET'])
@jwt_required()
def get_my_notifications():
    user_id = get_jwt_identity()
    enabled = get_user_preference(user_id)
    return jsonify({'user_id': user_id, 'notifications_enabled': enabled})


@notifications_bp.route('/me/notifications', methods=['PUT'])
@jwt_required()
def update_my_notifications():
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    if 'notifications_enabled' not in data:
        return jsonify({'error': 'notifications_enabled is required'}), 400
    notification_preferences[user_id] = bool(data['notifications_enabled'])
    return jsonify({'user_id': user_id, 'notifications_enabled': notification_preferences[user_id]})


@notifications_bp.route('/admin/notifications', methods=['GET'])
@jwt_required()
def admin_get_notifications():
    claims = get_jwt()
    if claims.get('role') != 'Admin':
        return jsonify({'error': 'Admin access required'}), 403
    result = [
        {'user_id': uid, 'notifications_enabled': enabled}
        for uid, enabled in notification_preferences.items()
    ]
    return jsonify(result)


@notifications_bp.route('/admin/notifications/<user_id>', methods=['PUT'])
@jwt_required()
def admin_update_notifications(user_id):
    claims = get_jwt()
    if claims.get('role') != 'Admin':
        return jsonify({'error': 'Admin access required'}), 403
    data = request.get_json() or {}
    if 'notifications_enabled' not in data:
        return jsonify({'error': 'notifications_enabled is required'}), 400
    notification_preferences[user_id] = bool(data['notifications_enabled'])
    return jsonify({'user_id': user_id, 'notifications_enabled': notification_preferences[user_id]})
