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
        try:
            return check_password_hash(self.password_hash, password)
        except (ValueError, TypeError):
            # Fall back to legacy bcrypt hashes (e.g., "$2b$...") from older builds.
            try:
                from passlib.hash import bcrypt as passlib_bcrypt
                if passlib_bcrypt.verify(password, self.password_hash):
                    # Auto-upgrade to current Werkzeug hash format after successful legacy login.
                    self.password_hash = self.hash_password(password)
                    db.session.add(self)
                    db.session.commit()
                    return True
            except Exception:
                # If fallback verification fails for any reason, treat as invalid credentials.
                pass
            return False


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
    # Per-alert contact info (falls back to user.email if null)
    contact_email = db.Column(db.String(255), nullable=True)
    contact_phone = db.Column(db.String(32), nullable=True)
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


class RoleRequest(db.Model):
    __tablename__ = 'role_requests'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    requested_role = db.Column(db.String(32), nullable=False)
    reason = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(16), nullable=False, default='pending')  # pending/approved/denied
    reviewed_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, server_default=func.now())
    updated_at = db.Column(db.DateTime, server_default=func.now(), onupdate=func.now())

    user = db.relationship('User', foreign_keys=[user_id])
    reviewer = db.relationship('User', foreign_keys=[reviewed_by])


class NewsArticle(db.Model):
    """
    Fire news ingested from allowlisted feeds + optional web discovery.
    Retention: application prunes rows with published_at older than 90 days.
    training_meta holds a JSON snapshot of the source dict for ML / analytics pipelines.
    """
    __tablename__ = 'news_articles'

    id = db.Column(db.Integer, primary_key=True)
    url_hash = db.Column(db.String(64), unique=True, nullable=False, index=True)
    article_id = db.Column(db.String(64), nullable=False, index=True)
    title = db.Column(db.Text, nullable=False)
    summary = db.Column(db.Text, nullable=False)
    url = db.Column(db.Text, nullable=False)
    published_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)
    category = db.Column(db.String(24), nullable=False)
    source_bucket = db.Column(db.String(32), nullable=False, index=True)
    source_label = db.Column(db.String(255), nullable=False)
    is_breaking = db.Column(db.Boolean, default=False, nullable=False)
    is_fallback = db.Column(db.Boolean, default=False, nullable=False, index=True)
    provenance = db.Column(db.String(64), nullable=True)
    training_meta = db.Column(db.JSON, nullable=True)
    first_ingested_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ZoneRiskCache(db.Model):
    """Persistent cache for zone/county risk payloads.

    Survives Render redeploys so cold-start latency on the risk overlays
    drops from 20s+ down to a single DB read (<200ms).
    """
    __tablename__ = 'zone_risk_cache'

    cache_key = db.Column(db.String(64), primary_key=True)  # 'counties', 'zip-codes', 'census-tracts', 'neighborhoods'
    payload = db.Column(db.JSON, nullable=False)
    computed_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class FeatureCacheElevation(db.Model):
    """Per-tile elevation cache. Tile keys are lat/lon rounded to 0.01° (~1.1 km)."""
    __tablename__ = 'feature_cache_elevation'

    tile_lat = db.Column(db.Numeric(7, 4), primary_key=True)
    tile_lon = db.Column(db.Numeric(8, 4), primary_key=True)
    elevation_m = db.Column(db.Float, nullable=False)
    source = db.Column(db.String(32), nullable=False, default='usgs_3dep')
    fetched_at = db.Column(db.DateTime(timezone=True), server_default=func.now())


class FeatureCacheEvi(db.Model):
    """Per-tile MODIS EVI cache. Composite_date refreshed every 16 days."""
    __tablename__ = 'feature_cache_evi'

    tile_lat = db.Column(db.Numeric(7, 4), primary_key=True)
    tile_lon = db.Column(db.Numeric(8, 4), primary_key=True)
    evi = db.Column(db.Float, nullable=False)
    source = db.Column(db.String(32), nullable=False)
    composite_date = db.Column(db.Date, nullable=False, index=True)
    fetched_at = db.Column(db.DateTime(timezone=True), server_default=func.now())


class FeatureCacheKbdi(db.Model):
    """Per-tile Keetch-Byram Drought Index cache. 24h TTL (KBDI changes daily)."""
    __tablename__ = 'feature_cache_kbdi'

    tile_lat = db.Column(db.Numeric(7, 4), primary_key=True)
    tile_lon = db.Column(db.Numeric(8, 4), primary_key=True)
    kbdi = db.Column(db.Float, nullable=False)
    source = db.Column(db.String(32), nullable=False, default='nasa_power')
    fetched_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), index=True)


class EndpointCache(db.Model):
    """Universal DB-backed response cache.

    One row per cache_key (e.g. 'fire_perimeters', 'history_perimeters:2024',
    'evac_zones'). Stores the pre-serialized response body bytes + ETag so
    cache hits across redeploys serve in <50ms regardless of upstream latency.
    """
    __tablename__ = 'endpoint_cache'

    cache_key = db.Column(db.String(128), primary_key=True)
    body = db.Column(db.LargeBinary, nullable=False)
    etag = db.Column(db.String(64), nullable=False)
    content_type = db.Column(db.String(64), nullable=False, default='application/json')
    computed_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), index=True)
