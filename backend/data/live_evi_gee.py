"""Live MODIS EVI via Google Earth Engine with DB tile cache.

This serves CURRENT EVI conditions (last 32 days). Separate from data/live_evi.py
which pulls the training-year spring composite for model-consistency lookups.

Authentication uses OAuth user credentials supplied via the
`GEE_OAUTH_CREDENTIALS` env var (JSON body from `earthengine authenticate`).
The credentials are written to the standard EE path on first import so
`ee.Initialize()` finds them.
"""
from __future__ import annotations

import datetime as _dt
import logging
import os
from decimal import Decimal
from pathlib import Path

logger = logging.getLogger(__name__)

_EE_INIT_DONE = False
_EE_PROJECT = os.environ.get("GEE_PROJECT_ID", "ee-idothecohen")
_COMPOSITE_TTL_DAYS = 16  # MOD13Q1 cadence


def _materialize_credentials_file() -> None:
    """Write GEE_OAUTH_CREDENTIALS env var to the path ee.Initialize expects."""
    raw = os.environ.get("GEE_OAUTH_CREDENTIALS")
    if not raw:
        return
    cred_path = Path.home() / ".config" / "earthengine" / "credentials"
    if cred_path.exists() and cred_path.read_text().strip() == raw.strip():
        return
    cred_path.parent.mkdir(parents=True, exist_ok=True)
    cred_path.write_text(raw)
    cred_path.chmod(0o600)


def _ensure_ee_initialized() -> None:
    global _EE_INIT_DONE
    if _EE_INIT_DONE:
        return
    _materialize_credentials_file()
    import ee  # imported lazily so unit tests without GEE deps still load this module
    ee.Initialize(project=_EE_PROJECT)
    _EE_INIT_DONE = True


def _tile(lat: float, lon: float) -> tuple[Decimal, Decimal]:
    return Decimal(f"{round(lat, 2):.4f}"), Decimal(f"{round(lon, 2):.4f}")


def get_evi_live(lat: float, lon: float) -> float:
    """Return current scaled EVI at (lat, lon) from MOD13Q1 (250 m).

    Order: DB tile cache (if composite_date within 16 days) → GEE live →
    cache write-through. EVI is returned scaled (raw * 0.0001) matching the
    training data encoding.
    """
    from models import db, FeatureCacheEvi

    tlat, tlon = _tile(lat, lon)
    today = _dt.date.today()
    cutoff = today - _dt.timedelta(days=_COMPOSITE_TTL_DAYS)

    cached = FeatureCacheEvi.query.filter_by(tile_lat=tlat, tile_lon=tlon).first()
    if cached is not None and cached.composite_date >= cutoff:
        return float(cached.evi)

    _ensure_ee_initialized()
    import ee

    end = today
    start = end - _dt.timedelta(days=32)
    img = (
        ee.ImageCollection("MODIS/061/MOD13Q1")
        .filterDate(start.isoformat(), end.isoformat())
        .select("EVI")
        .sort("system:time_start", False)
        .first()
    )
    point = ee.Geometry.Point([lon, lat])
    info = img.reduceRegion(reducer=ee.Reducer.first(), geometry=point, scale=250).getInfo()
    raw = info.get("EVI") if isinstance(info, dict) else None
    if raw is None:
        raise RuntimeError(f"GEE returned no EVI for {lat},{lon}")
    scaled = float(raw) * 0.0001

    millis = img.get("system:time_start").getInfo()
    composite_date = (
        _dt.datetime.utcfromtimestamp(millis / 1000.0).date()
        if isinstance(millis, (int, float)) else today
    )
    try:
        db.session.merge(FeatureCacheEvi(
            tile_lat=tlat, tile_lon=tlon, evi=scaled,
            source="gee_mod13q1", composite_date=composite_date,
        ))
        db.session.commit()
    except Exception as e:
        logger.warning("EVI cache write failed at %s,%s: %s", lat, lon, e)
        db.session.rollback()
    return scaled
