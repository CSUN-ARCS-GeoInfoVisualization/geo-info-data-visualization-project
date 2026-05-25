import os
from datetime import timedelta
from dotenv import load_dotenv

# Prefer repo-local .env values over inherited shell variables during local dev.
load_dotenv(override=True)

class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret')
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Bigger pool — the default (5 + 10 overflow) starves immediately when a
    # cold cache triggers a zone-risk recompute storm. Each zone recompute
    # opens a DB connection per parallel feature fetch (EVI / elevation /
    # KBDI × hundreds of centroids). Bumping to 20 + 30 overflow lets the
    # recompute fan out without blocking everyday request handlers like
    # /login or /health behind a 30s pool timeout.
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_size': 20,
        'max_overflow': 30,
        'pool_pre_ping': True,
        'pool_recycle': 300,
    }
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'dev-jwt')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(days=7)

    INITIAL_ADMIN_EMAIL = os.getenv('INITIAL_ADMIN_EMAIL')
    INITIAL_ADMIN_PASSWORD = os.getenv('INITIAL_ADMIN_PASSWORD')

    SUPREME_ADMINS = ['ido.the.cohen@gmail.com', 'xunfei.jiang@csun.edu', 'lliu@csun.edu']
