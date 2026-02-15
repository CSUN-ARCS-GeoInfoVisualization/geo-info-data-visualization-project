"""Pytest fixtures for email module tests."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Import after setting up path - tests run from backend/ or project root
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.services.email.models import (
    Base,
    User,
    UserAlertPreference,
    UserMonitoredArea,
    AlertActivity,
)
from backend.services.email.provider import MockProvider, EmailMessage
from backend.services.email.config import EmailConfig


@pytest.fixture
def engine():
    """In-memory SQLite for tests."""
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    return eng


@pytest.fixture
def session_factory(engine):
    Session = sessionmaker(bind=engine, expire_on_commit=False)
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
