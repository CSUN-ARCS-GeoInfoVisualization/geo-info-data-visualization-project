"""Tests for email template renderer."""

import pytest
from backend.services.email.renderer import EmailRenderer


def test_render_immediate_alert():
    r = EmailRenderer(base_url="https://example.com")
    html, text = r.render_immediate_alert(
        area_name="Test Valley",
        risk_score=75,
        contributing_factors=["Dry vegetation", "High wind"],
    )
    assert "Test Valley" in html
    assert "75" in html
    assert "High" in html
    assert "Dry vegetation" in html
    assert "unsubscribe" in html.lower() or "example.com" in html
    assert "Test Valley" in text
    assert "75" in text
    assert "View on Map" in text


def test_render_daily_digest():
    r = EmailRenderer()
    areas = [{"area_name": "Area A", "risk_score": 80}, {"area_name": "Area B", "risk_score": 40}]
    html, text = r.render_daily_digest("2025-02-13", areas)
    assert "2025-02-13" in html
    assert "Area A" in html
    assert "Area B" in html
    assert "Area A" in text


def test_render_weekly_digest():
    r = EmailRenderer()
    areas = [
        {"area_name": "Zone 1", "avg_risk": 65, "trend": "up"},
        {"area_name": "Zone 2", "avg_risk": 30, "trend": "stable"},
    ]
    summary = {"area_count": 2, "max_risk": 65}
    html, text = r.render_weekly_digest("2025-02-07 to 2025-02-13", areas, summary)
    assert "2025-02-07" in html
    assert "Zone 1" in html
    assert "Increasing" in html or "up" in html.lower()
    assert "65" in html
