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


def _ensure_notification_pref_schema(app):
    """Idempotent column backfill for notification_preferences.

    The ORM model gained contact_email, contact_phone, paused_until,
    blackout_start/end, last_sent_at, and unsubscribed_at after the initial
    table was created in prod. Without a migration step, SELECTs against the
    live table raise UndefinedColumn and every /api/me/notifications call
    returns 500. This ALTER-if-missing runs on boot so Render picks it up
    automatically."""
    required_cols = {
        'contact_email': 'VARCHAR(255)',
        'contact_phone': 'VARCHAR(32)',
        'paused_until': 'TIMESTAMP',
        'blackout_start': 'TIMESTAMP',
        'blackout_end': 'TIMESTAMP',
        'last_sent_at': 'TIMESTAMP',
        'unsubscribed_at': 'TIMESTAMP',
    }
    try:
        from sqlalchemy import inspect, text
        with app.app_context():
            db.create_all()  # no-op if tables exist; creates them on a fresh DB
            insp = inspect(db.engine)
            if 'notification_preferences' not in insp.get_table_names():
                return
            existing = {c['name'] for c in insp.get_columns('notification_preferences')}
            missing = [(c, ddl) for c, ddl in required_cols.items() if c not in existing]
            if not missing:
                return
            with db.engine.begin() as conn:
                for col, ddl in missing:
                    conn.execute(text(
                        f'ALTER TABLE notification_preferences '
                        f'ADD COLUMN IF NOT EXISTS {col} {ddl}'
                    ))
            app.logger.info(
                'notification_preferences: added missing columns %s',
                [c for c, _ in missing],
            )
    except Exception as e:
        app.logger.warning('notification_preferences schema check failed: %s', e)


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

    # Ensure notification_preferences has every column the ORM model expects.
    # Render has no migration step, so new columns added to the model after the
    # initial db.create_all() aren't present in prod and cause 500s on /me/notifications.
    _ensure_notification_pref_schema(app)

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
