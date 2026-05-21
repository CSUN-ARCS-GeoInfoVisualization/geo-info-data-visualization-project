"""KBDI lookups with DB tile cache.

Wraps Sania's data/live_kbdi.get_kbdi (NASA POWER 30-day window → Keetch-Byram
integration). KBDI changes daily, so DB entries are considered fresh for 24h.
Tile granularity: 0.01° (~1.1 km).

This is the LARGEST single performance win on the cold-zone-compute path.
Before: 200 centroids × ~10s NASA POWER round-trip = 130-200s wall time.
After:  200 centroids × <5ms DB read = <1s once warm.
"""
from __future__ import annotations

import datetime as _dt
import logging
from decimal import Decimal

logger = logging.getLogger(__name__)

_TTL_HOURS = 24


def _tile(lat: float, lon: float) -> tuple[Decimal, Decimal]:
    return Decimal(f"{round(lat, 2):.4f}"), Decimal(f"{round(lon, 2):.4f}")


def get_kbdi_cached(lat: float, lon: float) -> float:
    """Return KBDI at (lat, lon).

    Order: DB tile cache (if <24h old) → live NASA POWER fetch → cache
    write-through. Raises only if upstream fails and no cache entry exists.
    """
    from models import db, FeatureCacheKbdi

    tlat, tlon = _tile(lat, lon)
    cutoff = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=_TTL_HOURS)

    cached = FeatureCacheKbdi.query.filter_by(tile_lat=tlat, tile_lon=tlon).first()
    if cached is not None and cached.fetched_at and cached.fetched_at > cutoff:
        return float(cached.kbdi)

    # Live fetch (slow — that's why we cache)
    from data.live_kbdi import get_kbdi as _live_get_kbdi
    value = float(_live_get_kbdi(lat, lon))

    try:
        db.session.merge(FeatureCacheKbdi(
            tile_lat=tlat, tile_lon=tlon, kbdi=value, source="nasa_power",
        ))
        db.session.commit()
    except Exception as e:
        logger.warning("KBDI cache write failed at %s,%s: %s", lat, lon, e)
        db.session.rollback()
    return value
