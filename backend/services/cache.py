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
import logging
import threading
import time as _time
from typing import Callable

from flask import Response, request

try:
    import orjson as _orjson
    def _dumps(obj) -> bytes:
        return _orjson.dumps(obj)
except ImportError:
    import json
    def _dumps(obj) -> bytes:
        return json.dumps(obj, separators=(',', ':')).encode('utf-8')

try:
    import brotli as _brotli  # type: ignore
    def _brotli_compress(b: bytes) -> bytes:
        return _brotli.compress(b, quality=5)  # quality 5: ~10x faster than 11, negligible size diff for JSON
except ImportError:
    _brotli = None
    def _brotli_compress(b: bytes) -> bytes:
        return b  # no-op fallback; Flask-Compress will still compress on the fly

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


def _make_entry(data, ttl_seconds: int, content_type: str = 'application/json') -> dict:
    body = _dumps(data)
    etag = hashlib.md5(body).hexdigest()
    body_br = _brotli_compress(body) if _brotli is not None else None
    return {
        'body': body,
        'body_br': body_br,
        'etag': '"' + etag + '"',
        'content_type': content_type,
        'expires': _time.time() + ttl_seconds,
    }


def _respond(entry: dict, cache_control: str | None = None) -> Response:
    cc = cache_control or 'public, max-age=60, stale-while-revalidate=600'
    inm_raw = request.headers.get('If-None-Match', '')
    if inm_raw and _normalize_etag(inm_raw) == _normalize_etag(entry['etag']):
        resp = Response(status=304)
        resp.headers['ETag'] = entry['etag']
        resp.headers['Cache-Control'] = cc
        return resp

    # Pre-compressed body fast path: if client accepts br AND we have a cached
    # br body, ship it directly with Content-Encoding: br. Eliminates the per-
    # request Brotli compression cost (was 100-300ms on the 1.4MB DINS payload).
    accept_enc = request.headers.get('Accept-Encoding', '')
    body_br = entry.get('body_br')
    if body_br and 'br' in accept_enc:
        resp = Response(body_br, mimetype=entry.get('content_type', 'application/json'))
        resp.headers['ETag'] = entry['etag']
        resp.headers['Cache-Control'] = cc
        resp.headers['Content-Encoding'] = 'br'
        resp.headers['Vary'] = 'Accept-Encoding'
        return resp

    resp = Response(entry['body'], mimetype=entry.get('content_type', 'application/json'))
    resp.headers['ETag'] = entry['etag']
    resp.headers['Cache-Control'] = cc
    return resp


def _load_from_db(cache_key: str) -> dict | None:
    """Read the DB row directly into an entry shape. Returns None on miss or error."""
    try:
        from models import db, EndpointCache  # noqa: F401
        row = EndpointCache.query.filter_by(cache_key=cache_key).first()
        if not row:
            return None
        body = bytes(row.body)
        body_br = bytes(row.body_br) if getattr(row, 'body_br', None) else None
        return {
            'body': body,
            'body_br': body_br,
            'etag': '"' + hashlib.md5(body).hexdigest() + '"',
            'content_type': row.content_type,
            'expires': 0.0,
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
                body_br=entry.get('body_br'),
                etag=entry['etag'].strip('"'),
                content_type=entry.get('content_type', 'application/json'),
            )
            db.session.add(row)
        else:
            row.body = entry['body']
            row.body_br = entry.get('body_br')
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
    compute_fn: Callable[[], object],
    *,
    db_freshness_seconds: int | None = None,
    content_type: str = 'application/json',
    cache_control: str | None = None,
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
        return _respond(cached, cache_control)

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
            return _respond(cached, cache_control)
        data = compute_fn()
        entry = _make_entry(data, ttl_seconds, content_type)
        _mem[cache_key] = entry
        _save_to_db(cache_key, entry)
    return _respond(entry, cache_control)


def get_cached_data(
    cache_key: str,
    ttl_seconds: int,
    compute_fn: Callable[[], object],
    *,
    db_freshness_seconds: int | None = None,
):
    """Same 3-tier cache as serve_cached, but returns the raw data dict
    instead of a Flask Response. Use from background jobs / cron endpoints
    that need to consume the cached payload internally without doing an
    HTTP self-call (which would deadlock the gunicorn worker)."""
    db_freshness = db_freshness_seconds if db_freshness_seconds is not None else ttl_seconds * 5
    now = _time.time()

    cached = _mem.get(cache_key)
    if cached and cached['expires'] > now and 'data' in cached:
        return cached['data']

    db_entry = _load_from_db(cache_key)
    if db_entry is not None and 'data' in db_entry:
        age = now - (db_entry.get('computed_at') or 0)
        if age <= db_freshness:
            db_entry['expires'] = now + ttl_seconds
            _mem[cache_key] = db_entry
            return db_entry['data']

    lock = _get_lock(cache_key)
    with lock:
        cached = _mem.get(cache_key)
        if cached and cached['expires'] > now and 'data' in cached:
            return cached['data']
        data = compute_fn()
        entry = _make_entry(data, ttl_seconds)
        _mem[cache_key] = entry
        _save_to_db(cache_key, entry)
    return data


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
            body_br = bytes(row.body_br) if getattr(row, 'body_br', None) else None
            _mem[row.cache_key] = {
                'body': body,
                'body_br': body_br,
                'etag': '"' + hashlib.md5(body).hexdigest() + '"',
                'content_type': row.content_type,
                # Long boot TTL — historical/static data lives at the per-route TTL anyway
                # (cache_key-specific TTL applied on next miss), but we want hot start.
                'expires': now + 3600,
            }
        logger.info('endpoint_cache: %d rows warmed into memory at boot', len(rows))
        return len(rows)
    except Exception as e:
        logger.warning('endpoint_cache warm-on-boot failed: %s', e)
        return 0
