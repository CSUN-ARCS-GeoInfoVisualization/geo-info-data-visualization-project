from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import User, Role

me_bp = Blueprint('me', __name__)

@me_bp.route('/me', methods=['GET'])
@jwt_required()
def me():
    ident = get_jwt_identity()
    user = User.query.filter_by(id=ident['id']).join(Role).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    return jsonify({'id': user.id, 'email': user.email, 'role': user.role.name})
