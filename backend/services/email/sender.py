"""Email orchestrator - immediate alerts, digests, batch processing."""

import hashlib
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional, Any

from sqlalchemy.orm import Session

from .config import EmailConfig
from .models import UserAlertPreference, UserMonitoredArea
from .provider import EmailMessage, EmailProvider, SendResult
from .renderer import EmailRenderer
from .retry import RetryHandler
from .tracker import DeliveryTracker


def _event_signature(area_id: int, risk_score: float, date_str: str) -> str:
    """Create dedup signature: area + risk bucket + date."""
    bucket = "high" if risk_score >= 70 else "med" if risk_score >= 50 else "low"
    raw = f"{area_id}:{bucket}:{date_str}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


class EmailSender:
    """Orchestrates email sending - immediate alerts, digests, retries."""

    def __init__(
        self,
        provider: EmailProvider,
        renderer: EmailRenderer,
        tracker: DeliveryTracker,
        retry: RetryHandler,
        config: EmailConfig,
        session_factory: Callable[[], Session],
        get_user_email: Optional[Callable[[int], str]] = None,
    ):
        self.provider = provider
        self.renderer = renderer
        self.tracker = tracker
        self.retry = retry
        self.config = config
        self.session_factory = session_factory
        self.get_user_email = get_user_email or (lambda uid: f"user-{uid}@example.com")  # override in integration

    def send_immediate_alert(
        self,
        user_id: int,
        area_id: int,
        area_name: str,
        risk_score: float,
        contributing_factors: Optional[List[str]] = None,
        user_email: Optional[str] = None,
        risk_threshold: float = 70,
    ) -> SendResult:
        """
        Send immediate alert if: preferences allow, not paused, score >= threshold, not duplicate.
        """
        session = self.session_factory()
        try:
            pref = (
                session.query(UserAlertPreference)
                .filter(
                    UserAlertPreference.user_id == user_id,
                    UserAlertPreference.is_paused == False,
                )
                .first()
            )
            if not pref or pref.frequency not in ("instant", "immediate"):
                return SendResult(success=False, error_message="User not subscribed to immediate alerts")

            if risk_score < (pref.risk_threshold or risk_threshold):
                return SendResult(success=False, error_message="Risk below threshold")

            email_addr = user_email or (pref.email if pref else None) or self.get_user_email(user_id)
            date_str = datetime.utcnow().strftime("%Y-%m-%d")
            sig = _event_signature(area_id, risk_score, date_str)

            if self.tracker.is_duplicate(user_id, sig):
                return SendResult(success=False, error_message="Duplicate within dedup window")

            html, text = self.renderer.render_immediate_alert(
                area_name=area_name,
                risk_score=risk_score,
                contributing_factors=contributing_factors,
            )
            msg = EmailMessage(
                to=email_addr,
                subject=f"FireWatch Alert: {area_name} - {risk_score:.0f}% Risk",
                html_body=html,
                text_body=text,
            )

            result = self.retry.send_with_retry(lambda m: self.provider.send(m), msg)

            if result.success:
                self.tracker.record_send(
                    user_id=user_id,
                    event_signature=sig,
                    provider_message_id=result.provider_message_id or "",
                    area_id=area_id,
                    alert_type="immediate",
                    risk_score=risk_score,
                )
            else:
                self.tracker.record_failure(
                    user_id=user_id,
                    event_signature=sig,
                    error_message=result.error_message or "Unknown",
                    retry_count=self.config.max_retries,
                    area_id=area_id,
                    alert_type="immediate",
                    risk_score=risk_score,
                )

            return result
        finally:
            session.close()

    def process_risk_alerts(self, risk_data_list: List[Dict[str, Any]]) -> List[SendResult]:
        """
        Batch process: find users monitoring affected areas, send alerts.
        risk_data_list: [{area_id?, area_name, risk_score, contributing_factors?, ...}]
        Matches by area_name to user_monitored_areas.
        """
        results: List[SendResult] = []
        seen = set()

        for item in risk_data_list:
            area_name = item.get("area_name", "Unknown")
            risk_score = float(item.get("risk_score", 0))
            factors = item.get("contributing_factors")

            session = self.session_factory()
            try:
                areas = (
                    session.query(UserMonitoredArea)
                    .filter(UserMonitoredArea.area_name == area_name)
                    .all()
                )
                if not areas and item.get("area_id"):
                    areas = (
                        session.query(UserMonitoredArea)
                        .filter(UserMonitoredArea.id == item["area_id"])
                        .all()
                    )

                for ua in areas:
                    key = (ua.user_id, ua.id)
                    if key in seen:
                        continue
                    seen.add(key)
                    r = self.send_immediate_alert(
                        user_id=ua.user_id,
                        area_id=ua.id,
                        area_name=ua.area_name or area_name,
                        risk_score=risk_score,
                        contributing_factors=factors,
                    )
                    results.append(r)
            finally:
                session.close()

        return results

    def send_daily_digest(self) -> List[SendResult]:
        """Compile data for users on daily digest, render and send."""
        session = self.session_factory()
        results: List[SendResult] = []
        try:
            prefs = (
                session.query(UserAlertPreference)
                .filter(
                    UserAlertPreference.frequency == "daily",
                    UserAlertPreference.is_paused == False,
                )
                .all()
            )
            date_str = datetime.utcnow().strftime("%Y-%m-%d")
            for pref in prefs:
                areas = (
                    session.query(UserMonitoredArea)
                    .filter(UserMonitoredArea.user_id == pref.user_id)
                    .all()
                )
                area_data = [
                    {"area_name": a.area_name, "risk_score": 0, "risk_level": "N/A"}
                    for a in areas
                ]
                # TODO: join with prediction data for actual risk_score
                email_addr = pref.email or self.get_user_email(pref.user_id)
                html, text = self.renderer.render_daily_digest(date_str, area_data)
                msg = EmailMessage(
                    to=email_addr,
                    subject=f"FireWatch Daily Digest - {date_str}",
                    html_body=html,
                    text_body=text,
                )
                r = self.retry.send_with_retry(lambda m: self.provider.send(m), msg)
                results.append(r)
        finally:
            session.close()
        return results

    def send_weekly_digest(self) -> List[SendResult]:
        """Compile data for users on weekly digest, render and send."""
        session = self.session_factory()
        results: List[SendResult] = []
        try:
            prefs = (
                session.query(UserAlertPreference)
                .filter(
                    UserAlertPreference.frequency == "weekly",
                    UserAlertPreference.is_paused == False,
                )
                .all()
            )
            today = datetime.utcnow().date()
            week_start = today - timedelta(days=today.weekday())
            week_end = week_start + timedelta(days=6)
            week_range = f"{week_start} to {week_end}"
            for pref in prefs:
                areas = (
                    session.query(UserMonitoredArea)
                    .filter(UserMonitoredArea.user_id == pref.user_id)
                    .all()
                )
                area_data = [
                    {"area_name": a.area_name, "avg_risk": 0, "trend": "stable"}
                    for a in areas
                ]
                summary = {"area_count": len(areas), "max_risk": 0}
                email_addr = pref.email or self.get_user_email(pref.user_id)
                html, text = self.renderer.render_weekly_digest(
                    week_range, area_data, summary
                )
                msg = EmailMessage(
                    to=email_addr,
                    subject=f"FireWatch Weekly Digest - {week_range}",
                    html_body=html,
                    text_body=text,
                )
                r = self.retry.send_with_retry(lambda m: self.provider.send(m), msg)
                results.append(r)
        finally:
            session.close()
        return results
