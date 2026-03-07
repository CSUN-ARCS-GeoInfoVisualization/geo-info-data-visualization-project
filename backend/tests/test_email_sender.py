"""Tests for email sender orchestrator."""

import pytest
from backend.services.email.sender import EmailSender
from backend.services.email.provider import MockProvider
from backend.services.email.renderer import EmailRenderer
from backend.services.email.tracker import DeliveryTracker
from backend.services.email.retry import RetryHandler
from backend.services.email.config import EmailConfig
from backend.services.email.models import UserAlertPreference, UserMonitoredArea
from backend.tests.conftest import User


@pytest.fixture
def sender(mock_provider, session_factory, email_config):
    from backend.services.email.tracker import DeliveryTracker
    from backend.services.email.retry import RetryHandler
    tracker = DeliveryTracker(session_factory, dedup_window_hours=1)
    retry = RetryHandler(max_retries=1, base_delay=0.01)
    renderer = EmailRenderer(base_url="https://test.com")
    return EmailSender(
        provider=mock_provider,
        renderer=renderer,
        tracker=tracker,
        retry=retry,
        config=email_config,
        session_factory=session_factory,
        get_user_email=lambda uid: f"user{uid}@test.com",
    )


def test_send_immediate_alert_no_preference(sender, session_factory):
    s = session_factory()
    u = User(id=1, email="u@x.com")
    s.add(u)
    s.commit()
    s.close()

    result = sender.send_immediate_alert(
        user_id=1,
        area_id=10,
        area_name="Test Area",
        risk_score=80,
        user_email="u@x.com",
    )
    assert not result.success
    assert "not subscribed" in (result.error_message or "").lower()


def test_send_immediate_alert_with_preference(sender, session_factory, mock_provider):
    s = session_factory()
    u = User(id=1, email="u@x.com")
    s.add(u)
    pref = UserAlertPreference(user_id=1, frequency="instant", is_paused=False, risk_threshold=50)
    s.add(pref)
    area = UserMonitoredArea(user_id=1, area_name="Valley")
    s.add(area)
    s.commit()
    s.refresh(area)

    result = sender.send_immediate_alert(
        user_id=1,
        area_id=area.id,
        area_name="Valley",
        risk_score=75,
        user_email="u@x.com",
    )
    assert result.success
    assert len(mock_provider.sent_messages) == 1
    assert mock_provider.sent_messages[0].to == "u@x.com"
    assert "Valley" in mock_provider.sent_messages[0].subject
