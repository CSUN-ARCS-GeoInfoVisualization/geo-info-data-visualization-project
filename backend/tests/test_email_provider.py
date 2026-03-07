"""Tests for email provider (MockProvider, ResendProvider contract)."""

import pytest
from backend.services.email.provider import MockProvider, ResendProvider, EmailMessage, SendResult


def test_mock_provider_send(mock_provider):
    msg = EmailMessage(
        to="test@example.com",
        subject="Test",
        html_body="<p>Hello</p>",
        text_body="Hello",
    )
    result = mock_provider.send(msg)
    assert result.success is True
    assert result.provider_message_id is not None
    assert "mock_" in (result.provider_message_id or "")
    assert len(mock_provider.sent_messages) == 1
    assert mock_provider.sent_messages[0].to == "test@example.com"


def test_mock_provider_reset(mock_provider):
    mock_provider.send(EmailMessage(to="a@b.com", subject="X", html_body="Y"))
    mock_provider.reset()
    assert len(mock_provider.sent_messages) == 0
    assert len(mock_provider.results) == 0


def test_mock_provider_batch(mock_provider):
    msgs = [
        EmailMessage(to=f"u{i}@test.com", subject="S", html_body="H") for i in range(3)
    ]
    results = mock_provider.send_batch(msgs)
    assert len(results) == 3
    assert all(r.success for r in results)
