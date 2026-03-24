"""
Persist aggregated news to the database for up to 90 days (by published_at) for API serving and ML/export.

Rows older than the retention window are deleted on each sync. Existing ``url_hash`` rows are left unchanged
(no overwrite) so training snapshots stay stable. Live feeds are still fetched each request; the API merges DB
+ fresh data for the response timeline.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from models import NewsArticle, db
from services.fire_news.web_discovery import normalize_url_key

logger = logging.getLogger(__name__)

RETENTION_DAYS = 90


def _url_hash(url: str) -> str:
    return hashlib.sha256(normalize_url_key(url).encode("utf-8")).hexdigest()


def _parse_pub(iso: str) -> datetime:
    s = iso.replace("Z", "+00:00") if iso.endswith("Z") else iso
    return datetime.fromisoformat(s).astimezone(timezone.utc)


def _article_to_training_meta(a: dict[str, Any]) -> dict[str, Any]:
    """Full snapshot for downstream ML / analytics (JSON-serializable)."""
    out: dict[str, Any] = {}
    for k, v in a.items():
        if isinstance(v, datetime):
            out[k] = v.astimezone(timezone.utc).isoformat()
        else:
            try:
                json.dumps(v)
                out[k] = v
            except (TypeError, ValueError):
                out[k] = str(v)
    return out


def _row_to_api_dict(row: NewsArticle) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": row.article_id,
        "title": row.title,
        "summary": row.summary,
        "url": row.url,
        "published_at": row.published_at.astimezone(timezone.utc).isoformat(),
        "category": row.category,
        "source_bucket": row.source_bucket,
        "source_label": row.source_label,
        "is_breaking": row.is_breaking,
        "is_fallback": row.is_fallback,
    }
    if row.provenance:
        d["provenance"] = row.provenance
    return d


def prune_expired() -> int:
    """Delete articles whose published_at is before the retention cutoff. Returns rows deleted."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    q = NewsArticle.query.filter(NewsArticle.published_at < cutoff)
    n = q.delete(synchronize_session=False)
    return n


def upsert_from_live(primary: list[dict[str, Any]], fallback: list[dict[str, Any]]) -> None:
    """
    Merge live primary + deduped fallback into news_articles.
    Primary rows win url_hash; fallback skips URLs already present in primary.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    primary_hashes = {_url_hash(a["url"]) for a in primary}
    for a in primary:
        _upsert_one(a, is_fallback=False, cutoff=cutoff)
    for a in fallback:
        if _url_hash(a["url"]) in primary_hashes:
            continue
        _upsert_one(a, is_fallback=True, cutoff=cutoff)


def _upsert_one(a: dict[str, Any], *, is_fallback: bool, cutoff: datetime) -> None:
    pub = _parse_pub(a["published_at"])
    if pub > datetime.now(timezone.utc):
        pub = datetime.now(timezone.utc)
    if pub < cutoff:
        return

    uh = _url_hash(a["url"])
    row = NewsArticle.query.filter_by(url_hash=uh).first()
    if row is not None:
        # Already stored — skip writes (keeps first_ingested_at / stable training snapshot).
        return

    training = _article_to_training_meta(a)
    row = NewsArticle(
        url_hash=uh,
        article_id=(str(a.get("id") or uh))[:64],
        title=a.get("title") or "",
        summary=a.get("summary") or "",
        url=a.get("url") or "",
        published_at=pub,
        category=a.get("category") or "updates",
        source_bucket=a.get("source_bucket") or "emergency",
        source_label=a.get("source_label") or "",
        is_breaking=bool(a.get("is_breaking")),
        is_fallback=is_fallback,
        provenance=a.get("provenance"),
        training_meta=training,
    )
    db.session.add(row)


def sync_from_feeds(primary: list[dict[str, Any]], fallback_raw: list[dict[str, Any]]) -> None:
    """
    Prune >90d by published_at, then upsert live primary and fallback (fallback deduped against primary URLs).
    """
    primary_keys = {normalize_url_key(a["url"]) for a in primary}
    fallback = [a for a in fallback_raw if normalize_url_key(a["url"]) not in primary_keys]

    try:
        deleted = prune_expired()
        if deleted:
            logger.debug("Pruned %s news_articles older than %s days", deleted, RETENTION_DAYS)
        upsert_from_live(primary, fallback)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise


def load_primary_and_fallback() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """All stored articles in the retention window, split like live feed + fallback for the news route."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    rows = (
        NewsArticle.query.filter(NewsArticle.published_at >= cutoff)
        .order_by(NewsArticle.published_at.desc())
        .all()
    )
    primary: list[dict[str, Any]] = []
    fallback: list[dict[str, Any]] = []
    for r in rows:
        d = _row_to_api_dict(r)
        if r.is_fallback:
            fallback.append(d)
        else:
            primary.append(d)
    return primary, fallback
