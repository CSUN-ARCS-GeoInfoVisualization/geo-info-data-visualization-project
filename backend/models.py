from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from sqlalchemy import func
from werkzeug.security import generate_password_hash, check_password_hash


db = SQLAlchemy()
migrate = Migrate()

class Role(db.Model):
    __tablename__ = 'roles'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(32), unique=True, nullable=False)

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role_id = db.Column(db.Integer, db.ForeignKey('roles.id'), nullable=False)
    created_at = db.Column(db.DateTime, server_default=func.now())
    updated_at = db.Column(db.DateTime, server_default=func.now(), onupdate=func.now())

    role = db.relationship('Role')

    @staticmethod
    def hash_password(password: str) -> str:
        return generate_password_hash(password)

    def verify_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)


class UserLocation(db.Model):
    __tablename__ = 'user_locations'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    address = db.Column(db.String(255), nullable=True)
    lat = db.Column(db.Float, nullable=False)
    lon = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime, server_default=func.now())

    user = db.relationship('User')


class NotificationPreference(db.Model):
    __tablename__ = 'notification_preferences'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), unique=True, nullable=False)
    opted_in = db.Column(db.Boolean, default=False, nullable=False)
    email_enabled = db.Column(db.Boolean, default=False, nullable=False)
    sms_enabled = db.Column(db.Boolean, default=False, nullable=False)
    frequency = db.Column(db.String(16), default='daily', nullable=False)
    risk_threshold = db.Column(db.Integer, default=0, nullable=False)
    paused_until = db.Column(db.DateTime, nullable=True)
    blackout_start = db.Column(db.DateTime, nullable=True)
    blackout_end = db.Column(db.DateTime, nullable=True)
    last_sent_at = db.Column(db.DateTime, nullable=True)
    unsubscribed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, server_default=func.now())
    updated_at = db.Column(db.DateTime, server_default=func.now(), onupdate=func.now())

    user = db.relationship('User')


class AlertActivity(db.Model):
    __tablename__ = 'alert_activity'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    risk_level = db.Column(db.Integer, nullable=False)
    delivery_status = db.Column(db.String(16), nullable=False)
    reason = db.Column(db.String(64), nullable=True)
    triggered_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, server_default=func.now(), nullable=False, index=True)

    user = db.relationship('User', foreign_keys=[user_id])
    triggered_by_user = db.relationship('User', foreign_keys=[triggered_by_user_id])
