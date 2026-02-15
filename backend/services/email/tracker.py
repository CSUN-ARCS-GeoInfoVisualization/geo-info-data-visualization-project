"""Delivery tracking via alert_activity table - dedup, record, status updates."""

from datetime import datetime, timedelta
from typing import Callable, List, Optional

from sqlalchemy.orm import Session

from .models import AlertActivity


class DeliveryTracker:
    """Tracks sent alerts for deduplication and delivery status."""

    def __init__(self, session_factory: Callable[[], Session], dedup_window_hours: int = 24):
        self.session_factory = session_factory
        self.dedup_window_hours = dedup_window_hours

    def is_duplicate(self, user_id: int, event_signature: str) -> bool:
        """Check if we already sent this alert within the dedup window."""
        session = self.session_factory()
        try:
            cutoff = datetime.utcnow() - timedelta(hours=self.dedup_window_hours)
            existing = (
                session.query(AlertActivity)
                .filter(
                    AlertActivity.user_id == user_id,
                    AlertActivity.event_signature == event_signature,
                    AlertActivity.created_at >= cutoff,
                )
                .first()
            )
            return existing is not None
        finally:
            session.close()

    def record_send(
        self,
        user_id: int,
        event_signature: str,
        provider_message_id: str,
        area_id: Optional[int] = None,
        alert_type: str = "immediate",
        risk_score: Optional[float] = None,
    ) -> Optional[AlertActivity]:
        """Record a successful send. Returns the AlertActivity row or None on unique violation."""
        session = self.session_factory()
        try:
            activity = AlertActivity(
                user_id=user_id,
                area_id=area_id,
                event_signature=event_signature,
                alert_type=alert_type,
                risk_score=risk_score,
                provider_message_id=provider_message_id,
                delivered_at=datetime.utcnow(),
            )
            session.add(activity)
            session.commit()
            session.refresh(activity)
            return activity
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def record_failure(
        self,
        user_id: int,
        event_signature: str,
        error_message: str,
        retry_count: int = 0,
        area_id: Optional[int] = None,
        alert_type: str = "immediate",
        risk_score: Optional[float] = None,
    ) -> AlertActivity:
        """Record a failed send attempt."""
        session = self.session_factory()
        try:
            activity = AlertActivity(
                user_id=user_id,
                area_id=area_id,
                event_signature=event_signature,
                alert_type=alert_type,
                risk_score=risk_score,
                error_message=error_message,
                retry_count=retry_count,
            )
            session.add(activity)
            session.commit()
            session.refresh(activity)
            return activity
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def mark_delivered(self, provider_message_id: str) -> bool:
        """Update status when webhook confirms delivery. Returns True if found and updated."""
        session = self.session_factory()
        try:
            activity = (
                session.query(AlertActivity)
                .filter(AlertActivity.provider_message_id == provider_message_id)
                .first()
            )
            if activity:
                activity.delivered_at = datetime.utcnow()
                activity.error_message = None
                session.commit()
                return True
            return False
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def mark_failed(self, provider_message_id: str, error_message: str) -> bool:
        """Update status when webhook reports failure. Returns True if found and updated."""
        session = self.session_factory()
        try:
            activity = (
                session.query(AlertActivity)
                .filter(AlertActivity.provider_message_id == provider_message_id)
                .first()
            )
            if activity:
                activity.error_message = error_message
                activity.retry_count = (activity.retry_count or 0) + 1
                session.commit()
                return True
            return False
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def update_retry(self, activity_id: int, error_message: str, retry_count: int) -> None:
        """Update retry count after a failed retry attempt."""
        session = self.session_factory()
        try:
            activity = session.query(AlertActivity).get(activity_id)
            if activity:
                activity.error_message = error_message
                activity.retry_count = retry_count
                activity.updated_at = datetime.utcnow()
                session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_failed_alerts(self, max_retry_count: int = 3) -> List[AlertActivity]:
        """Query failed alerts eligible for retry (retry_count < max)."""
        session = self.session_factory()
        try:
            return (
                session.query(AlertActivity)
                .filter(
                    AlertActivity.provider_message_id.is_(None),
                    AlertActivity.error_message.isnot(None),
                    AlertActivity.retry_count < max_retry_count,
                )
                .all()
            )
        finally:
            session.close()
