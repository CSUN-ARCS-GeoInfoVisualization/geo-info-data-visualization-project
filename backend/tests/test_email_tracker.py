"""Tests for delivery tracker."""

import pytest
from datetime import datetime, timedelta
from backend.services.email.tracker import DeliveryTracker
from backend.services.email.models import AlertActivity
from backend.tests.conftest import User


def test_is_duplicate_false(session_factory):
    # Seed a user
    s = session_factory()
    u = User(id=1, email="u@x.com")
    s.add(u)
    s.commit()
    s.close()

    tracker = DeliveryTracker(session_factory, dedup_window_hours=24)
    assert tracker.is_duplicate(1, "sig123") is False


def test_record_send_and_is_duplicate(session_factory):
    s = session_factory()
    u = User(id=1, email="u@x.com")
    s.add(u)
    s.commit()
    s.close()

    tracker = DeliveryTracker(session_factory, dedup_window_hours=24)
    tracker.record_send(user_id=1, event_signature="sig456", provider_message_id="msg_1")
    assert tracker.is_duplicate(1, "sig456") is True
    assert tracker.is_duplicate(1, "sig789") is False


def test_record_failure(session_factory):
    s = session_factory()
    u = User(id=1, email="u@x.com")
    s.add(u)
    s.commit()
    s.close()

    tracker = DeliveryTracker(session_factory)
    activity = tracker.record_failure(
        user_id=1,
        event_signature="sig_fail",
        error_message="SMTP error",
        retry_count=1,
    )
    assert activity.id is not None
    assert activity.error_message == "SMTP error"
