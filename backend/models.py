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
    # Pre-resolved zone IDs cached at save time so the alert cron doesn't
    # do point-in-polygon on every tick. Filled lazily on first risk lookup.
    county_fips = db.Column(db.String(5), nullable=True)
    zip_code = db.Column(db.String(10), nullable=True)
    neighborhood_id = db.Column(db.String(64), nullable=True)
    census_tract_id = db.Column(db.String(11), nullable=True)
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
    # Per-channel toggles. Only high_risk is wired up in slice 1; the other two
    # are reserved for slices 2/3 (evacuation + breaking news pipelines).
    breaking_news_enabled = db.Column(db.Boolean, default=False, nullable=False)
    high_risk_enabled = db.Column(db.Boolean, default=True, nullable=False)
    evacuation_enabled = db.Column(db.Boolean, default=True, nullable=False)
    # Wildfires-in-your-county channel (slice 1D). Opt-in (default False)
    # because the firing volume is higher than evac/high-risk on bad fire
    # days — users have to consciously turn this on.
    fire_alerts_enabled = db.Column(db.Boolean, default=False, nullable=False)
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
    # Hash of (tier_bucket, sorted_at_risk_location_ids). The cron skips
    # sending if the most recent row for this user has the same signature —
    # so users only get re-emailed when the situation has actually changed.
    state_signature = db.Column(db.String(64), nullable=True, index=True)
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

    One row per cache_key. Stores both the raw JSON body and a pre-compressed
    Brotli body so cache hits skip both serialization AND compression. Hits
    across redeploys serve in <50ms regardless of upstream latency.
    """
    __tablename__ = 'endpoint_cache'

    cache_key = db.Column(db.String(256), primary_key=True)
    body = db.Column(db.LargeBinary, nullable=False)
    body_br = db.Column(db.LargeBinary, nullable=True)  # Brotli pre-compressed
    etag = db.Column(db.String(64), nullable=False)
    content_type = db.Column(db.String(64), nullable=False, default='application/json')
    computed_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), index=True)


class UserOverride(db.Model):
    """A per-user, per-zone risk override that lives for 24h then expires.

    A researcher adjusts the sliders for a zone; those values are persisted so
    the override survives leaving and returning to the page. Exactly ONE active
    override per (user, scope, zone) — re-saving the same zone upserts the
    values and refreshes the 24h window. After expiry the row is pruned and the
    zone falls back to live data.

    Features mirror the live model signature (predict_from_features /
    /api/predict-custom): evi, air_temp_encoded, wind, humidity, elevation, kbdi.
    risk_score+label are frozen at save time so reads never recompute.
    """
    __tablename__ = 'user_overrides'
    __table_args__ = (
        db.UniqueConstraint('user_id', 'scope', 'zone_id', name='uq_user_override_zone'),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    # Which zone level this override belongs to + the zone it pins to.
    scope = db.Column(db.String(16), nullable=False)   # 'county'|'zip'|'neighborhood'|'tract'
    zone_id = db.Column(db.String(64), nullable=False)
    zone_name = db.Column(db.String(128), nullable=True)
    # The 6 override feature values.
    evi = db.Column(db.Float, nullable=False)
    air_temp_encoded = db.Column(db.Float, nullable=False)
    wind = db.Column(db.Float, nullable=False)
    humidity = db.Column(db.Float, nullable=False)
    elevation = db.Column(db.Float, nullable=False)
    kbdi = db.Column(db.Float, nullable=False)
    # Result frozen at save time.
    risk_score = db.Column(db.Float, nullable=False)
    label = db.Column(db.String(32), nullable=False)
    note = db.Column(db.String(280), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    # 24h from the last save. Expired rows are pruned on the next read/write.
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)

    user = db.relationship('User')


class TrainingSample(db.Model):
    """Durable, append-only store for the continuous-retraining dataset.

    Lives in Postgres (not the ephemeral Render filesystem) so daily-ingested
    samples survive redeploys. OFF the user hot path — only the ingest cron
    writes it and only the retrain job reads it, so it never affects site speed.

    One row = one labeled point: the 6 model features + the fire/no-fire label,
    plus provenance (where it came from, when observed). De-duped on
    (lat, lon, acq_date) so re-runs of the ingest don't double-count.
    """
    __tablename__ = 'training_samples'
    __table_args__ = (
        db.UniqueConstraint('lat', 'lon', 'acq_date', name='uq_training_sample_point'),
    )

    id = db.Column(db.Integer, primary_key=True)
    lat = db.Column(db.Float, nullable=False)
    lon = db.Column(db.Float, nullable=False)
    acq_date = db.Column(db.String(10), nullable=False)  # YYYY-MM-DD of observation
    # Six model features (same order/scale as ml/inference.py + the 2020 base CSV).
    evi = db.Column(db.Float, nullable=False)
    air_temp_encoded = db.Column(db.Float, nullable=False)
    wind = db.Column(db.Float, nullable=False)
    humidity = db.Column(db.Float, nullable=False)
    elevation = db.Column(db.Float, nullable=False)
    kbdi = db.Column(db.Float, nullable=False)
    fire = db.Column(db.Integer, nullable=False)         # 1 = FIRMS detection, 0 = sampled no-fire
    source = db.Column(db.String(32), nullable=False, default='firms_viirs')
    ingested_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), index=True)
