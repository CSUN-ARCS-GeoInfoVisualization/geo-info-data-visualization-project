"""Tests for retry logic."""

import pytest
from backend.services.email.retry import RetryHandler
from backend.services.email.provider import EmailMessage, SendResult


def test_send_succeeds_first_try():
    attempts = []
    def send_fn(msg):
        attempts.append(1)
        return SendResult(success=True, provider_message_id="ok")
    handler = RetryHandler(max_retries=2, base_delay=0.01)
    msg = EmailMessage(to="a@b.com", subject="S", html_body="H")
    result = handler.send_with_retry(send_fn, msg)
    assert result.success
    assert len(attempts) == 1


def test_send_retries_on_failure():
    attempts = []
    def send_fn(msg):
        attempts.append(1)
        if len(attempts) < 2:
            return SendResult(success=False, error_message="Temp fail")
        return SendResult(success=True, provider_message_id="ok")
    handler = RetryHandler(max_retries=3, base_delay=0.01)
    msg = EmailMessage(to="a@b.com", subject="S", html_body="H")
    result = handler.send_with_retry(send_fn, msg)
    assert result.success
    assert len(attempts) == 2


def test_send_exhausts_retries():
    attempts = []
    def send_fn(msg):
        attempts.append(1)
        return SendResult(success=False, error_message="Always fail")
    handler = RetryHandler(max_retries=2, base_delay=0.01)
    msg = EmailMessage(to="a@b.com", subject="S", html_body="H")
    result = handler.send_with_retry(send_fn, msg)
    assert not result.success
    assert len(attempts) == 3  # 1 initial + 2 retries
