import os
from dotenv import load_dotenv

# Prefer repo-local .env values over inherited shell variables during local dev.
load_dotenv(override=True)

class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret')
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'dev-jwt')

    INITIAL_ADMIN_EMAIL = os.getenv('INITIAL_ADMIN_EMAIL')
    INITIAL_ADMIN_PASSWORD = os.getenv('INITIAL_ADMIN_PASSWORD')
