from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from models import User, Role

me_bp = Blueprint('me', __name__)

@me_bp.route('/me', methods=['GET'])
@jwt_required()
def me():
    user_id = get_jwt_identity()
    claims = get_jwt()
    try:
        user_id_int = int(user_id)
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid token identity'}), 401
    user = User.query.filter_by(id=user_id_int).join(Role).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    return jsonify({
        'id': user.id,
        'email': claims.get('email', user.email),
        'role': claims.get('role', user.role.name)
    })
