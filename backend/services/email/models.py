"""SQLAlchemy models for alert schema tables (user_alert_preferences, user_monitored_areas, alert_activity)."""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()


class User(Base):
    """Minimal user model - override in fullstack-integration with full User model."""

    __tablename__ = "users"
    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255))


class UserAlertPreference(Base):
    """User alert preferences - frequency, threshold, pause status."""

    __tablename__ = "user_alert_preferences"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    frequency = Column(String(20), default="instant")  # instant, daily, weekly
    risk_threshold = Column(Numeric(5, 2), default=70)  # 0-100
    is_paused = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    email = Column(String(255))  # Override user email if set

    # Relationship (users table assumed to exist from fullstack-integration)
    # user = relationship("User", back_populates="alert_preferences")


class UserMonitoredArea(Base):
    """Areas the user monitors for wildfire risk."""

    __tablename__ = "user_monitored_areas"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    area_name = Column(String(255), nullable=False)
    area_geojson = Column(Text)  # GeoJSON geometry or reference
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "area_name", name="uq_user_area"),)


class AlertActivity(Base):
    """Tracks sent alerts for dedup, delivery status, retries."""

    __tablename__ = "alert_activity"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    area_id = Column(Integer, ForeignKey("user_monitored_areas.id"))
    event_signature = Column(String(64), nullable=False, index=True)  # hash for dedup
    alert_type = Column(String(20), default="immediate")  # immediate, daily_digest, weekly_digest
    risk_score = Column(Numeric(5, 2))
    provider_message_id = Column(String(255))
    error_message = Column(Text)
    retry_count = Column(Integer, default=0)
    delivered_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "event_signature", name="uq_user_event_signature"),
    )
