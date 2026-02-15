"""Tests for alerts API routes."""

import pytest
import os
os.environ["EMAIL_USE_MOCK"] = "true"
os.environ["RESEND_API_KEY"] = "test"

from backend.app import create_app


@pytest.fixture
def client():
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"})
    return app.test_client()


def test_get_alert_preferences_requires_user_id(client):
    r = client.get("/api/alert-preferences")
    assert r.status_code == 400


def test_put_alert_preferences_requires_user_id(client):
    r = client.put("/api/alert-preferences", json={})
    assert r.status_code == 400


def test_admin_send_test_requires_to(client):
    r = client.post("/api/admin/alerts/send-test", json={})
    assert r.status_code == 400


def test_admin_send_test_success(client):
    r = client.post(
        "/api/admin/alerts/send-test",
        json={"to": "test@example.com"},
        content_type="application/json",
    )
    assert r.status_code == 200
    data = r.get_json()
    assert data.get("ok") is True
    assert "message_id" in data
