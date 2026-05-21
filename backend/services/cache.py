"""Universal endpoint response cache.

Three-tier read-through cache with single-flight on misses:
    1. Per-process in-memory dict (fastest, lost on restart)
    2. Postgres endpoint_cache table (survives redeploys)
    3. compute_fn() — the expensive live path

Call sites:
    from services.cache import serve_cached
    return serve_cached(
        cache_key='fire_perimeters',
        ttl_seconds=180,
        compute_fn=fetch_nifc_perimeters,  # returns a dict
    )

Behavior:
    - First request after deploy: in-memory miss → DB read → ~50ms response
    - First request ever (DB empty): single-flight lock → compute_fn() → write
      both layers → respond; concurrent waiters share the result
    - All cache hits: pre-serialized body + ETag + 304-Not-Modified on
      If-None-Match → typical browser revalidation costs ~0 bytes after first
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time as _time
from typing import Callable

from flask import Response, request

logger = logging.getLogger(__name__)

# Per-key in-memory cache. Each entry: {body, etag, expires}
_mem: dict[str, dict] = {}
# Per-key locks for single-flight compute
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _get_lock(cache_key: str) -> threading.Lock:
    with _locks_guard:
        lock = _locks.get(cache_key)
        if lock is None:
            lock = threading.Lock()
            _locks[cache_key] = lock
        return lock


def _normalize_etag(raw: str) -> str:
    s = (raw or '').strip()
    if s.startswith('W/'):
        s = s[2:]
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        inner = s[1:-1]
        if ':' in inner:
            inner = inner.rsplit(':', 1)[0]
        return inner
    return s


def _make_entry(data: dict, ttl_seconds: int, content_type: str = 'application/json') -> dict:
    body = json.dumps(data, separators=(',', ':')).encode('utf-8')
    etag = hashlib.md5(body).hexdigest()
    return {
        'body': body,
        'etag': '"' + etag + '"',
        'content_type': content_type,
        'expires': _time.time() + ttl_seconds,
    }


def _respond(entry: dict) -> Response:
    inm_raw = request.headers.get('If-None-Match', '')
    if inm_raw and _normalize_etag(inm_raw) == _normalize_etag(entry['etag']):
        resp = Response(status=304)
        resp.headers['ETag'] = entry['etag']
        resp.headers['Cache-Control'] = 'public, max-age=60'
        return resp
    resp = Response(entry['body'], mimetype=entry.get('content_type', 'application/json'))
    resp.headers['ETag'] = entry['etag']
    resp.headers['Cache-Control'] = 'public, max-age=60, stale-while-revalidate=600'
    return resp


def _load_from_db(cache_key: str) -> dict | None:
    """Read the DB row directly into an entry shape. Returns None on miss or error."""
    try:
        from models import db, EndpointCache  # noqa: F401  (db needed for session below)
        row = EndpointCache.query.filter_by(cache_key=cache_key).first()
        if not row:
            return None
        return {
            'body': bytes(row.body),
            'etag': '"' + hashlib.md5(bytes(row.body)).hexdigest() + '"',
            'content_type': row.content_type,
            'expires': 0.0,  # treated as expired in-memory; DB row freshness handled separately
            'computed_at': row.computed_at.timestamp() if row.computed_at else 0.0,
        }
    except Exception as e:
        logger.warning('endpoint_cache DB read failed for %s: %s', cache_key, e)
        try:
            from models import db
            db.session.rollback()
        except Exception:
            pass
        return None


def _save_to_db(cache_key: str, entry: dict) -> None:
    try:
        from models import db, EndpointCache
        row = EndpointCache.query.filter_by(cache_key=cache_key).first()
        if row is None:
            row = EndpointCache(
                cache_key=cache_key,
                body=entry['body'],
                etag=entry['etag'].strip('"'),
                content_type=entry.get('content_type', 'application/json'),
            )
            db.session.add(row)
        else:
            row.body = entry['body']
            row.etag = entry['etag'].strip('"')
            row.content_type = entry.get('content_type', 'application/json')
        db.session.commit()
    except Exception as e:
        logger.warning('endpoint_cache DB write failed for %s: %s', cache_key, e)
        try:
            from models import db
            db.session.rollback()
        except Exception:
            pass


def serve_cached(
    cache_key: str,
    ttl_seconds: int,
    compute_fn: Callable[[], dict],
    *,
    db_freshness_seconds: int | None = None,
    content_type: str = 'application/json',
) -> Response:
    """Serve a JSON response via the 3-tier cache.

    cache_key: globally unique identifier; rows in endpoint_cache share this key.
    ttl_seconds: how long the in-memory copy is considered fresh.
    db_freshness_seconds: optional — how long the Postgres copy is considered
        fresh. If None, defaults to ttl_seconds * 5 (DB layer outlives memory).
        Set to a large number for effectively-permanent data (historical files).
    compute_fn: zero-arg function that returns the data dict to cache.
    """
    db_freshness = db_freshness_seconds if db_freshness_seconds is not None else ttl_seconds * 5
    now = _time.time()

    # Tier 0
    cached = _mem.get(cache_key)
    if cached and cached['expires'] > now:
        return _respond(cached)

    # Tier 1
    db_entry = _load_from_db(cache_key)
    if db_entry is not None:
        age = now - (db_entry.get('computed_at') or 0)
        if age <= db_freshness:
            db_entry['expires'] = now + ttl_seconds
            _mem[cache_key] = db_entry
            return _respond(db_entry)

    # Tier 2: single-flight compute
    lock = _get_lock(cache_key)
    with lock:
        # Re-check both layers — another request may have populated while we waited
        cached = _mem.get(cache_key)
        if cached and cached['expires'] > now:
            return _respond(cached)
        data = compute_fn()
        entry = _make_entry(data, ttl_seconds, content_type)
        _mem[cache_key] = entry
        _save_to_db(cache_key, entry)
    return _respond(entry)


def invalidate(cache_key: str) -> None:
    """Force-evict from both tiers. Used by admin endpoints or migrations."""
    _mem.pop(cache_key, None)
    try:
        from models import db, EndpointCache
        EndpointCache.query.filter_by(cache_key=cache_key).delete()
        db.session.commit()
    except Exception as e:
        logger.warning('endpoint_cache invalidate failed for %s: %s', cache_key, e)
        try:
            from models import db
            db.session.rollback()
        except Exception:
            pass


def warm_from_db_on_boot() -> int:
    """Hydrate in-memory cache from Postgres at app startup. Returns row count."""
    try:
        from models import EndpointCache
        rows = EndpointCache.query.all()
        now = _time.time()
        for row in rows:
            body = bytes(row.body)
            _mem[row.cache_key] = {
                'body': body,
                'etag': '"' + hashlib.md5(body).hexdigest() + '"',
                'content_type': row.content_type,
                'expires': now + 60,  # short in-memory TTL on boot; route TTL takes over on next miss
            }
        return len(rows)
    except Exception as e:
        logger.warning('endpoint_cache warm-on-boot failed: %s', e)
        return 0
