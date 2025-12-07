# Build the main Flask app and plugs in blueprints

from flask import Flask
from flask_cors import CORS
from .config import get_config
from .api.v1.routes import bp as v1_bp

def create_app(config_name=None):
    app =Flask(__name__)
    # Load settings (Dev/Prod) from config.py using FLASK_ENV
    app.config.from_object(get_config(config_name))

    # Attach the v1 routes under /api/v1 (version 1)
    app.register_blueprint(v1_bp)

    #enable CORS for frontend
    CORS(app, resources={r"/api/*": {"origins": "*"}})

# simple check to see if the server is alive
    @app.get("/health")
    def health():
        return {"status": "ok"}, 200
    
    return app