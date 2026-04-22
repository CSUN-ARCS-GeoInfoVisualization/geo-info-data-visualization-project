import os

from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from models import db, migrate
from config import Config
from routes.auth import auth_bp
from routes.admin import admin_bp
from routes.me import me_bp
from routes.notifications import notifications_bp
from routes.predict import predict_bp
from routes.locations import locations_bp
from routes.news import news_bp
from routes.research import research_bp
from routes.shelters import shelters_bp
from routes.history import history_bp


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    db.init_app(app)
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    migrations_dir = os.path.join(repo_root, 'migrations')
    migrate.init_app(app, db, directory=migrations_dir)
    CORS(app)
    JWTManager(app)

    # Register blueprints
    app.register_blueprint(auth_bp, url_prefix='/api')
    app.register_blueprint(admin_bp, url_prefix='/api/admin')
    app.register_blueprint(me_bp, url_prefix='/api')
    app.register_blueprint(notifications_bp, url_prefix='/api')
    app.register_blueprint(predict_bp, url_prefix='/api')
    app.register_blueprint(locations_bp, url_prefix='/api')
    app.register_blueprint(news_bp, url_prefix='/api')
    app.register_blueprint(research_bp, url_prefix='/api/research')
    app.register_blueprint(shelters_bp, url_prefix='/api')
    app.register_blueprint(history_bp, url_prefix='/api/history')

    # Initialize email service if RESEND_API_KEY is configured
    if os.getenv('RESEND_API_KEY'):
        try:
            from services.email import init_email_service
            init_email_service(app)
        except Exception as e:
            app.logger.warning(f"Email service not initialized: {e}")

    @app.route('/health')
    def health():
        return jsonify({'status': 'ok'})

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(host='0.0.0.0', port=5000)
