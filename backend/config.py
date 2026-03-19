import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret')
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'dev-jwt')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(days=7)

    INITIAL_ADMIN_EMAIL = os.getenv('INITIAL_ADMIN_EMAIL')
    INITIAL_ADMIN_PASSWORD = os.getenv('INITIAL_ADMIN_PASSWORD')
