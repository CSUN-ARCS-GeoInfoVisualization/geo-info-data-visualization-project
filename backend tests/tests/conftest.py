import os
import pytest
from app import create_app
from models import db, Role, User

class TestConfig:
    TESTING = True
    SECRET_KEY = 'test'
    JWT_SECRET_KEY = 'test_jwt'
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    SQLALCHEMY_TRACK_MODIFICATIONS = False

@pytest.fixture()
def app():
    app = create_app(TestConfig)
    with app.app_context():
        db.create_all()
        # seed roles
        for name in ['Resident', 'Researcher', 'Admin']:
            if not Role.query.filter_by(name=name).first():
                db.session.add(Role(name=name))
        db.session.commit()
    yield app

@pytest.fixture()
def client(app):
    return app.test_client()

@pytest.fixture()
def db_session(app):
    with app.app_context():
        yield db.session
        db.session.rollback()
