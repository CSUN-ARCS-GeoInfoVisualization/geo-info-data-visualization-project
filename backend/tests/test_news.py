import uuid
from datetime import datetime, timedelta, timezone

import pytest

import routes.news as news_routes
from models import NewsArticle, db
from services.fire_news import aggregator as agg_mod
from services.fire_news.persistence import RETENTION_DAYS, load_primary_and_fallback, sync_from_feeds


@pytest.fixture(autouse=True)
def _empty_fallback_search(monkeypatch):
    monkeypatch.setattr(news_routes, "get_fallback_articles_cached", lambda: [])


def _token(client):
    email = f"news_{uuid.uuid4().hex[:10]}@example.com"
    client.post(
        "/api/register",
        json={"email": email, "password": "Password123!"},
    )
    r = client.post(
        "/api/login",
        json={"email": email, "password": "Password123!"},
    )
    return r.get_json()["token"]


def _article(pub_days_ago: float, **kw):
    now = datetime.now(timezone.utc)
    pub = now - timedelta(days=pub_days_ago)
    url = kw.pop("url", None) or f"https://example.com/a/{pub_days_ago}-{uuid.uuid4().hex[:6]}"
    out = {
        "id": f"id-{pub_days_ago!s}",
        "title": kw.pop("title", "Test headline"),
        "summary": kw.pop("summary", "Summary text"),
        "url": url,
        "published_at": pub.isoformat(),
        "category": kw.pop("category", "updates"),
        "source_bucket": kw.pop("source_bucket", "cal_fire"),
        "source_label": kw.pop("source_label", "CAL FIRE"),
        "is_breaking": kw.pop("is_breaking", False),
    }
    out.update(kw)
    out["published_at"] = pub.isoformat()
    return out


def test_news_works_without_jwt(client):
    """News endpoint allows unauthenticated access (jwt optional)."""
    r = client.get("/api/news?segment=recent&category=all")
    assert r.status_code == 200


def test_news_first_page_covers_90d_window(client, monkeypatch):
    """Unified feed: both items in the 90d window appear on the first page (newest first)."""
    articles = [
        _article(2, title="Recent fire", category="updates", url="https://example.com/news/recent-fire"),
        _article(12, title="Older fire", category="updates", url="https://example.com/news/older-fire"),
    ]
    monkeypatch.setattr(news_routes, "get_articles_cached", lambda: articles)
    token = _token(client)
    r = client.get(
        "/api/news?segment=recent&category=all",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    data = r.get_json()
    assert len(data["items"]) == 2
    assert "Recent" in data["items"][0]["title"]
    assert data["has_more"] is False


def test_news_pagination_offset(client, monkeypatch):
    articles = [
        _article(2, title="Recent", url="https://example.com/news/recent"),
        _article(12, title="Older item", url="https://example.com/news/older"),
    ]
    monkeypatch.setattr(news_routes, "get_articles_cached", lambda: articles)
    token = _token(client)
    r = client.get(
        "/api/news?segment=recent&category=all&offset=1&limit=1",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    data = r.get_json()
    assert len(data["items"]) == 1
    assert "Older" in data["items"][0]["title"]
    assert data["has_more"] is False


def test_news_category_filter(client, monkeypatch):
    articles = [
        _article(1, title="Break", category="breaking", url="https://example.com/news/break"),
        _article(1, title="Up", category="updates", url="https://example.com/news/up"),
    ]
    monkeypatch.setattr(news_routes, "get_articles_cached", lambda: articles)
    token = _token(client)
    r = client.get(
        "/api/news?segment=recent&category=breaking",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = r.get_json()
    assert len(data["items"]) == 1
    assert data["items"][0]["category"] == "breaking"


def test_news_single_item_no_has_more(client, monkeypatch):
    articles = [_article(3, title="Only recent", url="https://example.com/news/only-recent")]
    monkeypatch.setattr(news_routes, "get_articles_cached", lambda: articles)
    token = _token(client)
    r = client.get(
        "/api/news?segment=recent&category=all",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.get_json()["has_more"] is False


def test_invalid_category(client):
    token = _token(client)
    r = client.get(
        "/api/news?segment=recent&category=bad",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


def test_normalize_category_rules(monkeypatch):
    assert agg_mod.assign_category("Red Flag Warning here", "", "updates", "nws") == "breaking"
    assert agg_mod.assign_category("Study on wildfire AI", "", "updates", "cal_fire") == "research"


def test_fire_related_filter():
    assert agg_mod.is_fire_related("Brush fire near highway", "Details")
    assert not agg_mod.is_fire_related("Basketball game tonight", "Scores")


def test_has_more_with_fallback_only_small_limit(client, monkeypatch):
    fallback = [
        {
            "id": "w1",
            "title": "California wildfire containment update",
            "summary": "Brush fire wildfire crews",
            "url": "https://example.org/wildfire-news-1",
            "published_at": datetime.now(timezone.utc).isoformat(),
            "category": "updates",
            "source_bucket": "web_discovery",
            "source_label": "Web search result",
            "is_breaking": False,
            "is_fallback": True,
            "provenance": "search",
        },
        {
            "id": "w2",
            "title": "Second wildfire story",
            "summary": "Brush fire crews wildfire",
            "url": "https://example.org/wildfire-news-2",
            "published_at": datetime.now(timezone.utc).isoformat(),
            "category": "updates",
            "source_bucket": "web_discovery",
            "source_label": "Web search result",
            "is_breaking": False,
            "is_fallback": True,
            "provenance": "search",
        },
    ]
    monkeypatch.setattr(news_routes, "get_articles_cached", lambda: [])
    monkeypatch.setattr(news_routes, "get_fallback_articles_cached", lambda: fallback)
    token = _token(client)
    r = client.get(
        "/api/news?segment=recent&category=all&limit=1",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = r.get_json()
    assert len(data["items"]) == 1
    assert data["has_more"] is True


def test_second_page_returns_fallback_when_primary_is_newer(client, monkeypatch):
    primary = [
        _article(2, title="Only in recent window", url="https://example.com/news/recent-only"),
    ]
    fallback = [
        {
            "id": "w1",
            "title": "Older wildfire archive story",
            "summary": "California wildfire historical",
            "url": "https://example.org/archive",
            "published_at": (datetime.now(timezone.utc) - timedelta(days=10)).isoformat(),
            "category": "updates",
            "source_bucket": "web_discovery",
            "source_label": "Web search result",
            "is_breaking": False,
            "is_fallback": True,
            "provenance": "search",
        }
    ]
    monkeypatch.setattr(news_routes, "get_articles_cached", lambda: primary)
    monkeypatch.setattr(news_routes, "get_fallback_articles_cached", lambda: fallback)
    token = _token(client)
    r = client.get(
        "/api/news?segment=recent&category=all&offset=1&limit=1",
        headers={"Authorization": f"Bearer {token}"},
    )
    data = r.get_json()
    assert len(data["items"]) == 1
    assert data["items"][0]["is_fallback"] is True
    assert data["has_more"] is False


def test_news_prunes_db_rows_older_than_retention(app, client, monkeypatch):
    """Rows with published_at before the 90-day cutoff are deleted on sync."""
    monkeypatch.setattr(news_routes, "get_articles_cached", lambda: [])
    monkeypatch.setattr(news_routes, "get_fallback_articles_cached", lambda: [])
    old_pub = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS + 5)
    with app.app_context():
        db.session.add(
            NewsArticle(
                url_hash="a" * 64,
                article_id="stale1",
                title="Stale",
                summary="Old",
                url="https://example.com/stale",
                published_at=old_pub,
                category="updates",
                source_bucket="cal_fire",
                source_label="Test",
                is_breaking=False,
                is_fallback=False,
                training_meta={"x": 1},
            )
        )
        db.session.commit()
        assert NewsArticle.query.count() == 1

    token = _token(client)
    client.get(
        "/api/news?segment=recent&category=all",
        headers={"Authorization": f"Bearer {token}"},
    )
    with app.app_context():
        assert NewsArticle.query.count() == 0


def test_news_training_meta_roundtrip(app, monkeypatch):
    live = [
        _article(
            1,
            title="ML row",
            url="https://example.com/ml-row",
            summary="Summary for training",
        )
    ]
    monkeypatch.setattr(news_routes, "get_articles_cached", lambda: live)
    monkeypatch.setattr(news_routes, "get_fallback_articles_cached", lambda: [])
    with app.app_context():
        sync_from_feeds(live, [])
        primary, _ = load_primary_and_fallback()
        assert len(primary) == 1
        row = NewsArticle.query.one()
        assert row.training_meta is not None
        assert row.training_meta.get("title") == "ML row"


def test_news_skip_persist_if_url_already_exists(app, client, monkeypatch):
    """Existing url_hash: second sync does not overwrite title."""
    stable_url = "https://example.com/news/stable-article"
    first = [_article(1, title="Original headline", url=stable_url)]
    monkeypatch.setattr(news_routes, "get_articles_cached", lambda: first)
    monkeypatch.setattr(news_routes, "get_fallback_articles_cached", lambda: [])
    token = _token(client)
    client.get(
        "/api/news?segment=recent&category=all",
        headers={"Authorization": f"Bearer {token}"},
    )
    with app.app_context():
        assert NewsArticle.query.one().title == "Original headline"

    second = [_article(1, title="Updated headline", url=stable_url)]
    monkeypatch.setattr(news_routes, "get_articles_cached", lambda: second)
    client.get(
        "/api/news?segment=recent&category=all",
        headers={"Authorization": f"Bearer {token}"},
    )
    with app.app_context():
        assert NewsArticle.query.one().title == "Original headline"


def test_news_older_pagination_five_per_page(client, monkeypatch):
    """90d merged list paginates with offset/limit."""
    older_days = [10, 11, 12, 13, 14, 15]
    articles = [
        _article(
            float(d),
            title=f"Older {d}d",
            category="updates",
            url=f"https://example.com/news/older-{d}d",
        )
        for d in older_days
    ]
    monkeypatch.setattr(news_routes, "get_articles_cached", lambda: articles)
    token = _token(client)
    r1 = client.get(
        "/api/news?segment=older&category=all&offset=0&limit=5",
        headers={"Authorization": f"Bearer {token}"},
    )
    d1 = r1.get_json()
    assert len(d1["items"]) == 5
    assert d1["has_more"] is True

    r2 = client.get(
        "/api/news?segment=older&category=all&offset=5&limit=5",
        headers={"Authorization": f"Bearer {token}"},
    )
    d2 = r2.get_json()
    assert len(d2["items"]) == 1
    assert d2["has_more"] is False


def test_best_entry_summary_prefers_rich_content_over_short_summary():
    """RSS/Atom often put the readable body in content[] while summary is a stub."""
    ed = {
        "title": "Wildfire update",
        "summary": "Short teaser.",
        "content": [
            {
                "type": "text/html",
                "value": (
                    "<p>Wildfire crews made progress on the Eagle Fire with 40% containment; "
                    "evacuation orders were lifted for two zones.</p>"
                ),
            }
        ],
    }
    raw = agg_mod._best_entry_summary(ed)
    plain = agg_mod._strip_html(raw).lower()
    assert "containment" in plain
    assert "eagle fire" in plain
    assert len(plain) > len("short teaser.")


def test_best_entry_summary_falls_back_to_description():
    ed = {"summary": "", "description": "Brush fire near Highway 1, crews responding."}
    raw = agg_mod._best_entry_summary(ed)
    assert "brush fire" in agg_mod._strip_html(raw).lower()
