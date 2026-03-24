"""
Aggregate California fire-related items from allowlisted official feeds.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlparse

import feedparser
import requests

from data.fire_news_feeds import (
    CAL_FIRE_INCIDENTS_JSON,
    NWS_CA_ALERTS_ATOM,
    RSS_FEED_SOURCES,
)

logger = logging.getLogger(__name__)

# 0 = refetch allowlisted feeds on every get_articles_cached() call (no in-process cache).
# Set e.g. 900 to cache for 15 minutes and reduce load on upstream APIs.
CACHE_TTL_SEC = int(os.getenv("FIRE_NEWS_CACHE_TTL_SEC", "0"))
_REQUEST_TIMEOUT = 25

_cache: dict[str, Any] = {"expires": 0.0, "articles": []}

TAG_RE = re.compile(r"<[^>]+>")

# Keywords for fire relevance (title + summary + optional event text)
FIRE_TERMS = (
    "wildfire",
    "brush fire",
    "forest fire",
    "vegetation fire",
    "fire weather",
    "red flag",
    "firefighter",
    "cal fire",
    "calfire",
    "evacuation",
    "evacuate",
    "containment",
    " acres",
    "acre ",
    "burned",
    "burn scar",
    "prescribed burn",
    "smoke",
    "ember",
    "defensible space",
    "structure fire",
    "rescue fire",
    "responding to a fire",
    "fire department",
    "fire station",
    "fire season",
    "fire danger",
    "extreme fire",
)

# Non–fire NWS products to exclude when no fire context
NWS_EXCLUDE_IF_NO_FIRE = (
    "heat advisory",
    "frost advisory",
    "freeze warning",
    "small craft",
    "marine",
    "rip current",
    "beach hazards",
    "dense fog",
)


def clear_cache_for_tests() -> None:
    _cache["expires"] = 0.0
    _cache["articles"] = []


def _strip_html(text: str | None) -> str:
    if not text:
        return ""
    plain = TAG_RE.sub(" ", text)
    return re.sub(r"\s+", " ", plain).strip()


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, time.struct_time):
        return datetime(*value[:6], tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            # ISO 8601
            if value.endswith("Z"):
                value = value[:-1] + "+00:00"
            return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError:
            pass
        try:
            return parsedate_to_datetime(value).astimezone(timezone.utc)
        except (TypeError, ValueError):
            return None
    return None


def _article_id(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]


def _blob(*parts: str) -> str:
    return " ".join(p for p in parts if p).lower()


def is_fire_related(title: str, summary: str, extra: str = "") -> bool:
    b = _blob(title, summary, extra)
    if not any(t in b for t in FIRE_TERMS):
        return False
    return True


def nws_entry_is_fire_related(entry: dict[str, Any]) -> bool:
    title = entry.get("title", "") or ""
    summary = entry.get("summary", "") or ""
    b = _blob(title, summary)
    if "red flag" in b or "fire weather" in b or "wildfire" in b:
        return True
    if is_fire_related(title, summary):
        return True
    for ex in NWS_EXCLUDE_IF_NO_FIRE:
        if ex in b and "fire" not in b:
            return False
    return False


def assign_category(
    title: str,
    summary: str,
    default: str,
    source_bucket: str,
) -> str:
    t = _blob(title, summary)
    if any(
        k in t
        for k in (
            "study ",
            " studies",
            "research ",
            "researchers",
            "university",
            "journal",
            "peer-reviewed",
            "satellite",
            "algorithm",
        )
    ):
        return "research"
    if any(
        k in t
        for k in (
            "safety tip",
            "defensible space",
            "preparedness",
            "protect your home",
            "smoke alarm",
            "escape plan",
            "how to prepare",
        )
    ):
        return "safety"
    if any(
        k in t
        for k in (
            "red flag warning",
            "red flag",
            "fire weather watch",
            "evacuation order",
            "evacuation warning",
            "mandatory evacuation",
            "new fire",
            "new wildfire",
            "breaking",
        )
    ):
        return "breaking"
    if any(
        k in t
        for k in (
            "contained",
            "containment",
            "acre",
            "update",
            "crews",
            "forward progress",
            "cause under investigation",
        )
    ):
        return "updates"
    if default in ("breaking", "updates", "safety", "research"):
        return default
    return "updates"


def _normalize_article(
    *,
    title: str,
    summary: str,
    url: str,
    published_at: datetime | None,
    source_bucket: str,
    source_label: str,
    default_category: str,
) -> dict[str, Any] | None:
    if not url or not title:
        return None
    now = datetime.now(timezone.utc)
    if published_at is None:
        published_at = now
    if published_at > now + timedelta(days=1):
        published_at = now
    cat = assign_category(title, summary, default_category, source_bucket)
    is_breaking = cat == "breaking" or "red flag" in title.lower()
    return {
        "id": _article_id(url),
        "title": title.strip(),
        "summary": _strip_html(summary)[:2000],
        "url": url.strip(),
        "published_at": published_at.isoformat(),
        "category": cat,
        "source_bucket": source_bucket,
        "source_label": source_label,
        "is_breaking": is_breaking,
    }


def _fetch_json(url: str) -> Any:
    r = requests.get(url, timeout=_REQUEST_TIMEOUT, headers={"User-Agent": "FireScopeNews/1.0"})
    r.raise_for_status()
    return r.json()


def _fetch_cal_fire_incidents() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        data = _fetch_json(CAL_FIRE_INCIDENTS_JSON)
    except Exception as e:
        logger.warning("CAL FIRE incidents fetch failed: %s", e)
        return out
    if not isinstance(data, list):
        return out
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=90)
    for inc in data:
        if not isinstance(inc, dict):
            continue
        name = inc.get("Name") or "Incident"
        county = inc.get("County") or ""
        acres = inc.get("AcresBurned")
        pct = inc.get("PercentContained")
        url = inc.get("Url") or ""
        if not url:
            continue
        updated = _parse_dt(inc.get("Updated")) or _parse_dt(inc.get("Started"))
        if updated and updated < cutoff:
            continue
        summary = f"{county} — {acres or 'Unknown'} acres"
        if pct is not None:
            summary += f", {pct}% contained"
        title = f"{name} ({county} County)" if county else name
        art = _normalize_article(
            title=title,
            summary=summary,
            url=url,
            published_at=updated,
            source_bucket="cal_fire",
            source_label="CAL FIRE",
            default_category="updates",
        )
        if art:
            # Incident-specific category tweak
            st = inc.get("Started")
            st_dt = _parse_dt(st) if st else None
            if st_dt and (now - st_dt) < timedelta(hours=48) and (pct is None or pct < 30):
                art["category"] = "breaking"
                art["is_breaking"] = True
            out.append(art)
    return out


def _fetch_nws_atom() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        r = requests.get(
            NWS_CA_ALERTS_ATOM,
            timeout=_REQUEST_TIMEOUT,
            headers={"User-Agent": "(FireScopeNews/1.0, contact@localhost)"},
        )
        r.raise_for_status()
        parsed = feedparser.parse(r.content)
    except Exception as e:
        logger.warning("NWS atom fetch failed: %s", e)
        return out
    for entry in parsed.entries:
        ed = entry if isinstance(entry, dict) else dict(entry)
        if not nws_entry_is_fire_related(ed):
            continue
        title = ed.get("title", "") or ""
        summary = ed.get("summary", "") or ed.get("description", "") or ""
        link = ed.get("link")
        if not link:
            links = ed.get("links")
            if isinstance(links, list):
                for L in links:
                    if isinstance(L, dict) and L.get("rel") == "alternate" and L.get("href"):
                        link = L["href"]
                        break
        if not link:
            continue
        # Prefer informational HTML page if id is API urn
        if "api.weather.gov/alerts/" in link and link.endswith(".cap"):
            link = ed.get("id", link)
        published = _parse_dt(ed.get("published") or ed.get("updated"))
        art = _normalize_article(
            title=title,
            summary=summary,
            url=link,
            published_at=published,
            source_bucket="nws",
            source_label="National Weather Service",
            default_category="breaking",
        )
        if art:
            out.append(art)
    return out


def _fetch_rss_feed(
    feed_url: str,
    source_bucket: str,
    source_label: str,
    default_category: str,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        r = requests.get(
            feed_url,
            timeout=_REQUEST_TIMEOUT,
            headers={"User-Agent": "FireScopeNews/1.0"},
        )
        r.raise_for_status()
        parsed = feedparser.parse(r.content)
    except Exception as e:
        logger.warning("RSS fetch failed %s: %s", feed_url, e)
        return out
    for entry in parsed.entries:
        ed = entry if isinstance(entry, dict) else dict(entry)
        title = ed.get("title", "") or ""
        summary = ed.get("summary", "") or ed.get("description", "") or ""
        link = ed.get("link")
        if not link:
            continue
        if not is_fire_related(title, _strip_html(summary)):
            continue
        published = _parse_dt(ed.get("published") or ed.get("updated"))
        art = _normalize_article(
            title=title,
            summary=summary,
            url=link,
            published_at=published,
            source_bucket=source_bucket,
            source_label=source_label,
            default_category=default_category,
        )
        if art:
            out.append(art)
    return out


def _dedupe_by_url(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for a in articles:
        u = a["url"]
        key = urlparse(u)._replace(fragment="").geturl()
        if key not in seen:
            seen[key] = a
        else:
            # keep newer
            t1 = seen[key].get("published_at", "")
            t2 = a.get("published_at", "")
            if t2 > t1:
                seen[key] = a
    return list(seen.values())


def _collect_all_raw() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    items.extend(_fetch_cal_fire_incidents())
    items.extend(_fetch_nws_atom())
    for src in RSS_FEED_SOURCES:
        items.extend(
            _fetch_rss_feed(
                src["feed_url"],
                src["source_bucket"],
                src["source_label"],
                src["default_category"],
            )
        )
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=90)
    filtered = []
    for a in items:
        pub = _parse_dt(a.get("published_at"))
        if pub is None or pub < cutoff:
            continue
        filtered.append(a)
    return _dedupe_by_url(filtered)


def get_articles_cached() -> list[dict[str, Any]]:
    now_ts = time.time()
    if CACHE_TTL_SEC > 0 and _cache["expires"] > now_ts and _cache["articles"]:
        return _cache["articles"]
    articles = _collect_all_raw()
    articles.sort(key=lambda x: x.get("published_at", ""), reverse=True)
    if CACHE_TTL_SEC > 0:
        _cache["articles"] = articles
        _cache["expires"] = now_ts + CACHE_TTL_SEC
    else:
        _cache["articles"] = []
        _cache["expires"] = 0.0
    return articles
