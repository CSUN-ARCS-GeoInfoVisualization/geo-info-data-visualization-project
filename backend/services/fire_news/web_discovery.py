"""
Fallback fire-news discovery via Google Programmable Search (Custom Search JSON API).

Does not crawl arbitrary HTML; uses official search API results (title, link, snippet).
Requires GOOGLE_CSE_API_KEY and GOOGLE_CSE_ENGINE_ID (search engine cx) in environment.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import requests

from services.fire_news.aggregator import assign_category, is_fire_related

logger = logging.getLogger(__name__)

GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1"
# Cap on articles kept after merging all queries (fire-filtered, deduped).
FALLBACK_MAX_ITEMS = int(os.getenv("FALLBACK_MAX_ITEMS", "60"))
# 0 = run Custom Search on every get_fallback_articles_cached() call (watch daily query quota).
FALLBACK_CACHE_TTL_SEC = int(os.getenv("FALLBACK_SEARCH_CACHE_TTL_SEC", "0"))
# Up to 10 results per page; Google allows start=1..91 (10 pages = 100 hits per query).
FALLBACK_CSE_MAX_PAGES = int(os.getenv("FALLBACK_CSE_MAX_PAGES", "10"))
_REQUEST_TIMEOUT = 25

_fallback_cache: dict[str, Any] = {"expires": 0.0, "articles": []}

# California-focused queries; CSE can be configured to search entire web or restrict sites.
SEARCH_QUERIES = (
    "California wildfire OR California brush fire OR vegetation fire California",
    '"red flag" OR "fire weather" California site:weather.gov OR site:fire.ca.gov OR site:ca.gov',
    "wildfire evacuation California OR California fire containment OR prescribed burn California",
    "CAL FIRE incident OR forest fire Northern California OR Southern California fire update",
)


def clear_fallback_cache_for_tests() -> None:
    _fallback_cache["expires"] = 0.0
    _fallback_cache["articles"] = []


def _article_id(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]


def _strip_html(text: str | None) -> str:
    if not text:
        return ""
    plain = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", plain).strip()


def _parse_date_from_snippet(snippet: str) -> datetime | None:
    """Best-effort extract a year from snippet for rough ordering."""
    m = re.search(r"\b(20\d{2})\b", snippet or "")
    if m:
        try:
            y = int(m.group(1))
            return datetime(y, 6, 15, tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def _hit_to_article(hit: dict[str, Any], rank: int) -> dict[str, Any] | None:
    title = (hit.get("title") or "").strip()
    url = (hit.get("link") or "").strip()
    snippet = _strip_html(hit.get("snippet") or "")
    if not title or not url or not url.startswith("http"):
        return None
    if not is_fire_related(title, snippet):
        return None

    pub = _parse_date_from_snippet(snippet)
    now = datetime.now(timezone.utc)
    if pub is None:
        # Preserve search ranking: earlier results slightly newer timestamp
        pub = now - timedelta(minutes=rank)

    cat = assign_category(title, snippet, "updates", "web_discovery")
    is_breaking = cat == "breaking" or "red flag" in title.lower()

    return {
        "id": _article_id(url),
        "title": title[:500],
        "summary": snippet[:2000],
        "url": url,
        "published_at": pub.isoformat(),
        "category": cat,
        "source_bucket": "web_discovery",
        "source_label": "Web search result",
        "is_breaking": is_breaking,
        "is_fallback": True,
        "provenance": "search",
    }


def _fetch_google_cse_page(
    query: str,
    api_key: str,
    cx: str,
    *,
    num: int = 10,
    start: int = 1,
) -> list[dict[str, Any]]:
    """One CSE request. ``start`` is 1-based index (1, 11, 21, … up to 91 for 10 pages)."""
    params = {
        "key": api_key,
        "cx": cx,
        "q": query,
        "num": min(num, 10),
        "start": max(1, min(start, 91)),
    }
    r = requests.get(
        GOOGLE_CSE_URL,
        params=params,
        timeout=_REQUEST_TIMEOUT,
        headers={"User-Agent": "FireScopeNews/1.0 (fire news discovery)"},
    )
    r.raise_for_status()
    data = r.json()
    if not isinstance(data, dict):
        return []
    items = data.get("items")
    if not isinstance(items, list):
        return []
    return [x for x in items if isinstance(x, dict)]


def _collect_fallback_raw() -> list[dict[str, Any]]:
    api_key = os.getenv("GOOGLE_CSE_API_KEY", "").strip()
    cx = os.getenv("GOOGLE_CSE_ENGINE_ID", "").strip()
    if not api_key or not cx:
        logger.info("Google CSE not configured (GOOGLE_CSE_API_KEY / GOOGLE_CSE_ENGINE_ID); fallback disabled")
        return []

    seen_urls: set[str] = set()
    out: list[dict[str, Any]] = []
    rank = 0
    max_pages = max(1, min(FALLBACK_CSE_MAX_PAGES, 10))

    for query in SEARCH_QUERIES:
        if len(out) >= FALLBACK_MAX_ITEMS:
            break
        for page in range(max_pages):
            if len(out) >= FALLBACK_MAX_ITEMS:
                break
            start = 1 + page * 10
            try:
                hits = _fetch_google_cse_page(query, api_key, cx, num=10, start=start)
            except Exception as e:
                logger.warning("Google CSE query failed (%s start=%s): %s", query[:40], start, e)
                break
            if not hits:
                break
            for hit in hits:
                if len(out) >= FALLBACK_MAX_ITEMS:
                    break
                url = (hit.get("link") or "").strip()
                key = urlparse(url)._replace(fragment="").geturl()
                if not key or key in seen_urls:
                    continue
                art = _hit_to_article(hit, rank)
                rank += 1
                if art:
                    seen_urls.add(key)
                    out.append(art)

    out.sort(key=lambda x: x.get("published_at", ""), reverse=True)
    return out[:FALLBACK_MAX_ITEMS]


def get_fallback_articles_cached() -> list[dict[str, Any]]:
    """Search-backed articles; no 30-day cutoff. Optional in-process cache (see FALLBACK_SEARCH_CACHE_TTL_SEC)."""
    now_ts = time.time()
    if FALLBACK_CACHE_TTL_SEC > 0 and _fallback_cache["expires"] > now_ts and _fallback_cache["articles"]:
        return _fallback_cache["articles"]
    articles = _collect_fallback_raw()
    if FALLBACK_CACHE_TTL_SEC > 0:
        _fallback_cache["articles"] = articles
        _fallback_cache["expires"] = now_ts + FALLBACK_CACHE_TTL_SEC
    else:
        _fallback_cache["articles"] = []
        _fallback_cache["expires"] = 0.0
    return articles


def normalize_url_key(url: str) -> str:
    return urlparse(url.strip())._replace(fragment="").geturl()
