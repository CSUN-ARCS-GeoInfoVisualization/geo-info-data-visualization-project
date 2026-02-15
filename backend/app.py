"""Flask application entry point for Geo Info Data Visualization."""

import os
from flask import Flask

# Optional: load dotenv if available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


def create_app(config_overrides=None):
    app = Flask(__name__)
    app.config.from_mapping(
        SECRET_KEY=os.getenv("SECRET_KEY", "dev-secret-key"),
        SQLALCHEMY_DATABASE_URI=os.getenv("DATABASE_URL", "sqlite:///firewatch.db"),
        BASE_URL=os.getenv("BASE_URL", "https://app.example.com"),
    )
    if config_overrides:
        app.config.update(config_overrides)

    # Initialize email service (registers blueprint, creates tables when TESTING)
    from backend.services.email import init_email_service
    init_email_service(app)

    return app


app = create_app()
