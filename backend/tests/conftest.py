import os
import sys
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
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


@pytest.fixture(autouse=True)
def app_context(app):
    with app.app_context():
        yield

@pytest.fixture()
def client(app):
    return app.test_client()

@pytest.fixture()
def db_session(app):
    with app.app_context():
        yield db.session
        db.session.rollback()


# --- Email service fixtures ---

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from services.email.models import (
        Base as EmailBase,
        UserAlertPreference,
        UserMonitoredArea,
        AlertActivity as EmailAlertActivity,
    )
    from services.email.provider import MockProvider, EmailMessage
    from services.email.config import EmailConfig

    @pytest.fixture
    def email_engine():
        eng = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        EmailBase.metadata.create_all(eng)
        return eng

    @pytest.fixture
    def session_factory(email_engine):
        Session = sessionmaker(bind=email_engine, expire_on_commit=False)
        return Session

    @pytest.fixture
    def mock_provider():
        p = MockProvider()
        yield p
        p.reset()

    @pytest.fixture
    def email_config():
        return EmailConfig(
            resend_api_key="test_key",
            sender_email="test@test.com",
            sender_name="Test",
            max_retries=2,
            retry_base_delay=0.01,
            daily_digest_hour=8,
            weekly_digest_day="mon",
            alert_dedup_window_hours=24,
            use_mock_provider=True,
        )

except ImportError:
    pass
