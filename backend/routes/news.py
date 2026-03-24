import logging
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from services.fire_news.aggregator import get_articles_cached
from services.fire_news.persistence import load_primary_and_fallback, sync_from_feeds
from services.fire_news.web_discovery import get_fallback_articles_cached, normalize_url_key

logger = logging.getLogger(__name__)

news_bp = Blueprint("news", __name__)

# First page size; client may request smaller for “load more” chunks.
DEFAULT_PAGE_SIZE = 15
MAX_PAGE_SIZE = 50


def _parse_pub(iso: str) -> datetime:
    s = iso.replace("Z", "+00:00") if iso.endswith("Z") else iso
    return datetime.fromisoformat(s).astimezone(timezone.utc)


def _category_ok(a: dict, category: str) -> bool:
    if category == "all":
        return True
    return a.get("category") == category


def _merge_fire_news_90d(
    primary: list[dict],
    fallback: list[dict],
    now: datetime,
    day90: datetime,
) -> list[dict]:
    """
    Single timeline: allowlisted feeds + web discovery, deduped by URL,
    published_at within [day90, now], newest first.
    """
    seen: set[str] = set()
    out: list[dict] = []

    for a in primary:
        pub = _parse_pub(a["published_at"])
        if pub > now:
            pub = now
        if pub < day90:
            continue
        k = normalize_url_key(a["url"])
        if k in seen:
            continue
        seen.add(k)
        out.append(a)

    for a in fallback:
        pub = _parse_pub(a["published_at"])
        if pub > now:
            pub = now
        if pub < day90:
            continue
        k = normalize_url_key(a["url"])
        if k in seen:
            continue
        seen.add(k)
        out.append(a)

    out.sort(key=lambda x: x["published_at"], reverse=True)
    return out


@news_bp.route("/news", methods=["GET"])
@jwt_required()
def list_news():
    category = (request.args.get("category") or "all").lower().strip()
    segment = (request.args.get("segment") or "recent").lower().strip()
    if category not in ("all", "breaking", "updates", "safety", "research"):
        return jsonify({"error": "Invalid category"}), 400
    if segment not in ("recent", "older"):
        return jsonify({"error": "Invalid segment"}), 400

    try:
        limit = int(request.args.get("limit") or DEFAULT_PAGE_SIZE)
    except (TypeError, ValueError):
        limit = DEFAULT_PAGE_SIZE
    limit = max(1, min(limit, MAX_PAGE_SIZE))

    try:
        offset = int(request.args.get("offset") or 0)
    except (TypeError, ValueError):
        offset = 0
    offset = max(0, offset)

    primary_live = get_articles_cached()
    fallback_raw = get_fallback_articles_cached()
    try:
        sync_from_feeds(primary_live, fallback_raw)
        primary, fallback = load_primary_and_fallback()
    except Exception:
        logger.exception("news DB sync failed; using live feeds only")
        primary = primary_live
        primary_urls = {normalize_url_key(a["url"]) for a in primary}
        fallback = [a for a in fallback_raw if normalize_url_key(a["url"]) not in primary_urls]

    now = datetime.now(timezone.utc)
    day90 = now - timedelta(days=90)

    merged = _merge_fire_news_90d(primary, fallback, now, day90)
    merged_cat = [a for a in merged if _category_ok(a, category)]

    page = merged_cat[offset : offset + limit]
    has_more = offset + len(page) < len(merged_cat)

    return jsonify({"items": page, "has_more": has_more})
