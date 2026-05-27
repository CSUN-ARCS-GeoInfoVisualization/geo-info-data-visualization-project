"""Internal cron-triggered alert dispatcher.

Hit by GitHub Actions workflows on a schedule. Auth via the
INTERNAL_CRON_TOKEN env var compared against the X-Internal-Token request
header. Never exposed to end users.

Slice 1A: /high-risk (every 30 min)        — per-user/per-tier dedup
Slice 1C: /breaking-news (every 60 min)    — per-user/per-batch dedup
Slice 1C: /evacuation    (every 10 min)    — per-user/per-zone dedup
"""

import os
import math
import hashlib
import logging
from datetime import datetime, timedelta

import requests
from flask import Blueprint, request, jsonify

from models import db, User, UserLocation, NotificationPreference, AlertActivity, NewsArticle
from data.zone_resolver import _feature_contains
from data.zone_resolver import resolve_all
from routes.research import get_cached_zone_risk


_ZONE_LABEL = {"county": "County", "zip": "ZIP", "neighborhood": "Neighborhood", "census_tract": "Census tract"}


def _zones_for_location(loc):
    """Return list of {'kind','zone_name','pct','label'} for the 4 zone types.

    Reads from the same cached zone-risk data the dashboard map uses — so
    the email's numbers always match what the user sees on firescope.dev
    for the same county/ZIP/neighborhood/tract. Skips a zone if PIP misses
    (point outside California) or the zone is somehow missing from the cache.
    """
    from routes.locations import _label_for
    zones = resolve_all(loc.lat, loc.lon)
    out = []
    for key in ("county", "zip", "neighborhood", "census_tract"):
        z = zones.get(key)
        if not z:
            continue
        cached = get_cached_zone_risk(key, z["id"])
        if not cached or cached.get("risk_score") is None:
            continue
        pct = float(cached["risk_score"])
        out.append({
            "kind": _ZONE_LABEL[key],
            "zone_name": z["name"],
            "pct": pct,
            "label": cached.get("label") or _label_for(pct),
        })
    return out

logger = logging.getLogger(__name__)

internal_alerts_bp = Blueprint("internal_alerts", __name__)

HIGH_RISK_THRESHOLD = 0.40  # 5-tier NFDRS: 0.40 = "High" tier. Fire on any zone reaching High or above per Ido's spec.


def _require_internal_token():
    expected = os.getenv("INTERNAL_CRON_TOKEN", "")
    if not expected:
        return False, "INTERNAL_CRON_TOKEN not configured on server"
    got = request.headers.get("X-Internal-Token", "")
    if got != expected:
        return False, "invalid X-Internal-Token"
    return True, None


def _eligible_prefs(session):
    now = datetime.utcnow()
    q = (
        session.query(NotificationPreference, User)
        .join(User, User.id == NotificationPreference.user_id)
        .filter(
            NotificationPreference.opted_in == True,
            NotificationPreference.email_enabled == True,
            NotificationPreference.high_risk_enabled == True,
            NotificationPreference.unsubscribed_at.is_(None),
        )
    )
    rows = []
    for pref, user in q.all():
        if pref.paused_until and pref.paused_until > now:
            continue
        rows.append((pref, user))
    return rows


def _state_signature(tier_bucket: int, hits: list) -> str:
    """Stable hash of (tier_bucket, sorted_at_risk_location_ids).

    Two cron runs with the same tier max AND the same set of locations
    above threshold collapse to the same hash — we skip the send. A new
    location crossing 70%, an existing one dropping off, or a tier change
    all produce a new hash and re-fire the email.
    """
    loc_ids = sorted(int(h.get("location_id", 0)) for h in hits)
    raw = f"tier={tier_bucket}|locs={','.join(str(i) for i in loc_ids)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _last_alert_signature(session, user_id):
    """Most recent SENT alert for this user, or None if never alerted."""
    row = (
        session.query(AlertActivity.state_signature)
        .filter(
            AlertActivity.user_id == user_id,
            AlertActivity.delivery_status == "sent",
        )
        .order_by(AlertActivity.created_at.desc())
        .first()
    )
    return row[0] if row else None


def _location_block_html(loc_payload: dict) -> str:
    """Renders one location's all-4-zones table inside the alert email.

    HTML attributes use double quotes (not single) because Gmail's content
    sanitizer was stripping the whole table when single-quoted attrs were
    used — recipient reported an empty email body in the wild on 2026-05-27.
    """
    title = html_escape(loc_payload["name"])
    # Tier-keyed background tint so users can see at a glance which zone is
    # most concerning. Matches lib/riskTiers.ts hex values.
    tier_bg = {
        "Extreme":   "#fee2e2",
        "Very High": "#fecaca",
        "High":      "#ffedd5",
        "Moderate":  "#fef9c3",
        "Low":       "#dcfce7",
    }
    row_html = []
    for z in loc_payload["zones"]:
        bg = tier_bg.get(z["label"], "#f5f5f5")
        row_html.append(
            "<tr>"
            f'<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;color:#555">{html_escape(z["kind"])}</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px">{html_escape(z["zone_name"])}</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;font-size:12px;background:{bg}">{html_escape(z["label"])}</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-size:12px">{z["pct"]*100:.0f}%</td>'
            "</tr>"
        )
    rows = "".join(row_html)
    return (
        '<div style="margin-top:14px;border:1px solid #eee;border-radius:8px;overflow:hidden">'
        f'  <div style="background:#fafafa;padding:10px 12px;font-weight:600;font-size:13px">{title}</div>'
        '  <table style="width:100%;border-collapse:collapse">'
        '    <thead><tr style="background:#fff">'
        '      <th style="padding:6px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Zone</th>'
        '      <th style="padding:6px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Area</th>'
        '      <th style="padding:6px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Tier</th>'
        '      <th style="padding:6px 10px;text-align:right;font-size:11px;color:#888;text-transform:uppercase">Risk</th>'
        '    </tr></thead>'
        f'    <tbody>{rows}</tbody>'
        '  </table>'
        '</div>'
    )


def _send_high_risk_email(to_email: str, contact_name: str, locations_payload: list):
    """Direct Resend SDK call. Bypasses the EmailSender/Renderer scaffolding
    in services/email/ because that machinery is wired to a duplicate ORM
    schema that was never integrated. Slice 1B will re-route through the
    proper renderer once those models are unified."""
    try:
        import resend
    except ImportError:
        logger.error("resend SDK not installed")
        return None, "resend SDK missing"

    api_key = os.getenv("RESEND_API_KEY", "")
    sender_email = os.getenv("SENDER_EMAIL", "alerts@firescope.dev")
    sender_name = os.getenv("SENDER_NAME", "FireScope Alerts")
    if not api_key:
        return None, "RESEND_API_KEY not set"
    resend.api_key = api_key

    name = (contact_name or "").strip() or to_email.split("@", 1)[0]
    blocks_html = "".join(_location_block_html(lp) for lp in locations_payload)
    html = f"""<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f7f7f8;margin:0;padding:24px">
  <div style="max-width:600px;margin:auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #eee">
    <div style="background:#dc2626;color:white;padding:18px 22px">
      <div style="text-align:center;margin-bottom:8px"><img src="https://firescope.dev/firescope-logo.png" alt="FireScope" width="56" height="56" style="display:block;margin:0 auto;border:0;background:white;border-radius:10px;padding:4px"></div>
      <div style="font-size:13px;letter-spacing:.08em;opacity:.9;text-align:center">FIRESCOPE • HIGH RISK ALERT</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px;text-align:center">Wildfire risk alert for your saved locations</div>
    </div>
    <div style="padding:22px">
      <p style="margin:0 0 14px">Hi {html_escape(name)},</p>
      <p style="margin:0 0 8px">One or more of your saved locations is at <strong>High</strong> risk or above.
        Below is the current risk by every zone type — county, ZIP code, neighborhood, and census tract — so
        you can see which scope is driving the alert.</p>
      {blocks_html}
      <p style="margin:18px 0 0;font-size:13px;color:#555">
        Open <a href="https://firescope.dev" style="color:#dc2626">firescope.dev</a> for the live map, fire perimeters, and evacuation info.
      </p>
      <p style="margin:14px 0 0;font-size:12px;color:#888">
        You're receiving this because the High Risk channel is on in your alert settings. Manage at firescope.dev → Alerts.
      </p>
    </div>
  </div>
</body></html>"""

    def _txt_block(lp):
        lines = [f"  {lp['name']}:"]
        for z in lp["zones"]:
            lines.append(f"    {z['kind']:<14} {z['zone_name']:<24} {z['label']:<12} {z['pct']*100:.0f}%")
        return "\n".join(lines)

    text = (
        "FireScope — high wildfire risk near your saved locations.\n\n"
        + "\n\n".join(_txt_block(lp) for lp in locations_payload)
        + "\n\nLive map: https://firescope.dev\n"
    )

    try:
        first_name = locations_payload[0]["name"]
        more = len(locations_payload) - 1
        subject = (f"FireScope: High wildfire risk at {first_name}"
                   + (f" + {more} more" if more else ""))
        resp = resend.Emails.send({
            "from": f"{sender_name} <{sender_email}>",
            "to": [to_email],
            "subject": subject,
            "html": html,
            "text": text,
        })
        return resp.get("id"), None
    except Exception as e:
        logger.warning("resend send failed: %s", e)
        return None, str(e)


def html_escape(s: str) -> str:
    if s is None:
        return ""
    return (str(s)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))


@internal_alerts_bp.route("/internal/alerts/high-risk", methods=["POST"])
def run_high_risk_alerts():
    ok, err = _require_internal_token()
    if not ok:
        return jsonify({"error": err}), 401

    session = db.session
    rows = _eligible_prefs(session)
    scanned_users = len(rows)
    sent = 0
    skipped_dedup = 0
    skipped_below = 0
    errors = 0
    sent_ids = []

    for pref, user in rows:
        # Read this user's saved locations.
        locations = (
            session.query(UserLocation)
            .filter(UserLocation.user_id == user.id)
            .all()
        )
        if not locations:
            continue

        # Score every location across all 4 zone types; a location is "at risk"
        # if the MAX of its 4 zones crosses threshold. The email body always
        # lists all 4 zones (county / zip / neighborhood / census tract) per
        # at-risk location so the user sees which scope is driving the alert.
        hits = []
        for loc in locations:
            zones = _zones_for_location(loc)
            if not zones:
                errors += 1
                continue
            max_pct = max(z["pct"] for z in zones)
            if max_pct >= HIGH_RISK_THRESHOLD:
                hits.append({
                    "location_id": loc.id,
                    "name": loc.name,
                    "risk": max_pct,         # used for sort + dedup bucket
                    "zones": zones,
                })

        if not hits:
            skipped_below += 1
            continue

        # Change-driven dedup: signature is (tier max, sorted at-risk location ids).
        # Same signature as last sent => situation unchanged => no email.
        max_risk = max(h["risk"] for h in hits)
        bucket = int(max_risk * 100 // 10) * 10  # 70, 80, 90, 100
        sig = _state_signature(bucket, hits)
        last_sig = _last_alert_signature(session, user.id)
        if last_sig == sig:
            skipped_dedup += 1
            continue

        to_email = (pref.contact_email or user.email or "").strip()
        if not to_email:
            errors += 1
            continue

        msg_id, send_err = _send_high_risk_email(
            to_email=to_email,
            contact_name=getattr(user, "name", None) or "",
            locations_payload=sorted(hits, key=lambda h: -h["risk"]),
        )
        status = "sent" if msg_id else "failed"
        session.add(AlertActivity(
            user_id=user.id,
            risk_level=bucket,
            delivery_status=status,
            reason=("high_risk_cron" if msg_id else f"high_risk_cron_err:{(send_err or '')[:40]}"),
            state_signature=sig,
        ))
        if msg_id:
            sent += 1
            sent_ids.append(msg_id)
            pref.last_sent_at = datetime.utcnow()
        else:
            errors += 1

    try:
        session.commit()
    except Exception:
        session.rollback()

    return jsonify({
        "scanned_users": scanned_users,
        "sent": sent,
        "skipped_dedup": skipped_dedup,
        "skipped_below_threshold": skipped_below,
        "errors": errors,
        "sent_message_ids": sent_ids,
    })


# ───────────────────────── BREAKING NEWS (Slice 1C) ─────────────────────────

NEWS_LOOKBACK_HOURS = 24       # never alert on news older than this
NEWS_MAX_PER_EMAIL = 8         # cap per email body — older items dropped


def _last_news_send_at(session, user_id):
    """Most recent successful news send for this user (None if never)."""
    row = (
        session.query(AlertActivity.created_at)
        .filter(
            AlertActivity.user_id == user_id,
            AlertActivity.delivery_status == "sent",
            AlertActivity.reason.like("breaking_news%"),
        )
        .order_by(AlertActivity.created_at.desc())
        .first()
    )
    return row[0] if row else None


def _send_breaking_news_email(to_email: str, contact_name: str, articles: list) -> tuple[str | None, str | None]:
    try:
        import resend
    except ImportError:
        return None, "resend SDK missing"
    api_key = os.getenv("RESEND_API_KEY", "")
    sender_email = os.getenv("SENDER_EMAIL", "alerts@firescope.dev")
    sender_name = os.getenv("SENDER_NAME", "FireScope Alerts")
    if not api_key:
        return None, "RESEND_API_KEY not set"
    resend.api_key = api_key

    name = (contact_name or "").strip() or to_email.split("@", 1)[0]
    # Link through firescope.dev/?page=news#article-<id> so the user lands on
    # our News page with our summary visible + the original source one click
    # away — not on the raw NWS/GNews JSON page.
    def _our_news_url(a):
        return f"https://firescope.dev/?page=news#article-{a['id']}"
    items_html = "".join(
        '<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #eee">'
        '  <div style="font-size:11px;text-transform:uppercase;color:#888;letter-spacing:.06em">'
        f'    {html_escape(a["source_label"])} · {a["published_at"][:16].replace("T"," ")} UTC'
        '  </div>'
        '  <div style="font-size:15px;font-weight:600;margin:4px 0 6px">'
        f'    <a href="{html_escape(_our_news_url(a))}" style="color:#dc2626;text-decoration:none">{html_escape(a["title"])}</a>'
        '  </div>'
        f'  <div style="font-size:13px;color:#444;line-height:1.45">{html_escape((a.get("summary") or "")[:280])}{"…" if len(a.get("summary") or "") > 280 else ""}</div>'
        '</div>'
        for a in articles
    )
    html = f"""<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f7f7f8;margin:0;padding:24px">
  <div style="max-width:600px;margin:auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #eee">
    <div style="background:#dc2626;color:white;padding:18px 22px">
      <div style="text-align:center;margin-bottom:8px"><img src="https://firescope.dev/firescope-logo.png" alt="FireScope" width="56" height="56" style="display:block;margin:0 auto;border:0;background:white;border-radius:10px;padding:4px"></div>
      <div style="font-size:13px;letter-spacing:.08em;opacity:.9;text-align:center">FIRESCOPE • BREAKING FIRE NEWS</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px;text-align:center">{len(articles)} new {'story' if len(articles) == 1 else 'stories'} you should see</div>
    </div>
    <div style="padding:22px">
      <p style="margin:0 0 14px">Hi {html_escape(name)},</p>
      {items_html}
      <p style="margin:18px 0 0;font-size:13px;color:#555">
        See all fire news on <a href="https://firescope.dev" style="color:#dc2626">firescope.dev</a>.
      </p>
      <p style="margin:14px 0 0;font-size:12px;color:#888">
        You're getting this because the Breaking Fire News channel is on. Manage at firescope.dev → Alerts.
      </p>
    </div>
  </div>
</body></html>"""
    text = (
        f"FireScope — {len(articles)} new breaking fire news {'story' if len(articles) == 1 else 'stories'}.\n\n"
        + "\n\n".join(
            f"  {a['title']}\n    {a['source_label']} · {a['published_at'][:16]}\n    {_our_news_url(a)}"
            for a in articles
        )
        + "\n\nSee all: https://firescope.dev/?page=news\n"
    )
    try:
        resp = resend.Emails.send({
            "from": f"{sender_name} <{sender_email}>",
            "to": [to_email],
            "subject": f"FireScope: {len(articles)} new breaking fire {'story' if len(articles) == 1 else 'stories'}",
            "html": html,
            "text": text,
        })
        return resp.get("id"), None
    except Exception as e:
        logger.warning("resend send (news) failed: %s", e)
        return None, str(e)


@internal_alerts_bp.route("/internal/alerts/breaking-news", methods=["POST"])
def run_breaking_news_alerts():
    ok, err = _require_internal_token()
    if not ok:
        return jsonify({"error": err}), 401

    session = db.session
    now = datetime.utcnow()
    floor = now - timedelta(hours=NEWS_LOOKBACK_HOURS)

    # Eligible users: opted in, email on, breaking-news channel on.
    q = (
        session.query(NotificationPreference, User)
        .join(User, User.id == NotificationPreference.user_id)
        .filter(
            NotificationPreference.opted_in == True,
            NotificationPreference.email_enabled == True,
            NotificationPreference.breaking_news_enabled == True,
            NotificationPreference.unsubscribed_at.is_(None),
        )
    )
    scanned = 0
    sent = 0
    skipped_no_new = 0
    errors = 0
    sent_ids = []

    for pref, user in q.all():
        scanned += 1
        if pref.paused_until and pref.paused_until > now:
            continue

        # Articles published since this user's last news send (or 24h floor).
        cutoff = _last_news_send_at(session, user.id) or floor
        # Drop subsecond/tz mismatch by clamping to floor.
        if cutoff < floor:
            cutoff = floor

        articles_q = (
            session.query(NewsArticle)
            .filter(
                NewsArticle.is_breaking == True,
                NewsArticle.published_at > cutoff,
            )
            .order_by(NewsArticle.published_at.desc())
            .limit(NEWS_MAX_PER_EMAIL)
        )
        articles = articles_q.all()
        if not articles:
            skipped_no_new += 1
            continue

        # Build the payload + a deterministic signature for the batch.
        payload = [{
            "id": a.article_id,
            "title": a.title,
            "summary": a.summary,
            "url": a.url,
            "source_label": a.source_label,
            "published_at": a.published_at.isoformat() if a.published_at else "",
        } for a in articles]
        sig = hashlib.sha256(
            ("news:" + ",".join(sorted(p["id"] for p in payload))).encode("utf-8")
        ).hexdigest()[:32]

        to_email = (pref.contact_email or user.email or "").strip()
        if not to_email:
            errors += 1
            continue
        msg_id, send_err = _send_breaking_news_email(
            to_email=to_email,
            contact_name=getattr(user, "name", None) or "",
            articles=payload,
        )
        status = "sent" if msg_id else "failed"
        session.add(AlertActivity(
            user_id=user.id,
            risk_level=0,
            delivery_status=status,
            reason=("breaking_news" if msg_id else f"breaking_news_err:{(send_err or '')[:30]}"),
            state_signature=sig,
        ))
        if msg_id:
            sent += 1
            sent_ids.append(msg_id)
        else:
            errors += 1

    try:
        session.commit()
    except Exception:
        session.rollback()

    return jsonify({
        "scanned_users": scanned,
        "sent": sent,
        "skipped_no_new_articles": skipped_no_new,
        "errors": errors,
        "sent_message_ids": sent_ids,
    })


# ───────────────────────── EVACUATION (Slice 1C) ─────────────────────────

EVAC_NEAREST_SHELTERS = 3


def _haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def _fetch_active_evac_zones():
    """Direct in-process call to the same cache layer the HTTP endpoint uses.

    Self-calling /api/evacuation-zones over HTTP from within a gunicorn
    worker risks a self-deadlock (worker calls itself, hits its own
    request queue, times out at gunicorn's --timeout=90, dies). Pulling
    via the cache helper avoids the network hop entirely + still shares
    the 60s in-memory and 10min DB cache the public endpoint uses.
    """
    try:
        from services.cache import get_cached_data
        from routes.predict import _compute_evac_zones
        data = get_cached_data(
            cache_key='evac_zones',
            ttl_seconds=60,
            compute_fn=_compute_evac_zones,
            db_freshness_seconds=600,
        )
        return (data or {}).get("features", []) or []
    except Exception as e:
        logger.error("evac fetch failed: %s — alerts will skip this tick", e)
        return []


def _fetch_open_shelters():
    """Direct in-process call to the shelters cache helper. Same rationale
    as _fetch_active_evac_zones — no HTTP self-call from inside a gunicorn
    worker."""
    try:
        from services.cache import get_cached_data
        from routes.shelters import _compute_shelters, CACHE_TTL
        data = get_cached_data(
            cache_key='shelters_ca',
            ttl_seconds=CACHE_TTL,
            compute_fn=_compute_shelters,
            db_freshness_seconds=CACHE_TTL * 2,
        )
        # /api/shelters returns GeoJSON features OR a flat list depending on
        # the cache helper shape; handle both. Normalize to the flat row
        # format internal_alerts expects (lat/lon at top level).
        feats = (data or {}).get("features") if isinstance(data, dict) else None
        if feats is not None:
            rows = []
            for f in feats:
                p = (f.get("properties") or {}).copy()
                c = (f.get("geometry") or {}).get("coordinates") or []
                if len(c) >= 2:
                    p["latitude"], p["longitude"] = c[1], c[0]
                rows.append(p)
        else:
            rows = data if isinstance(data, list) else []
        return [s for s in rows
                if str(s.get("shelter_status_code", "")).upper() == "OPEN"
                and s.get("latitude") is not None and s.get("longitude") is not None]
    except Exception as e:
        logger.error("shelters fetch failed: %s — shelter-opened alerts will skip this tick", e)
        return []


def _evac_already_alerted(session, user_id, zone_id):
    sig = hashlib.sha256(f"evac:{zone_id}".encode("utf-8")).hexdigest()[:32]
    return session.query(AlertActivity).filter(
        AlertActivity.user_id == user_id,
        AlertActivity.delivery_status == "sent",
        AlertActivity.state_signature == sig,
    ).first() is not None, sig


def _send_evacuation_email(to_email, contact_name, location_name, zone_props, nearest_shelters, match_kind: str = "polygon") -> tuple[str | None, str | None]:
    try:
        import resend
    except ImportError:
        return None, "resend SDK missing"
    api_key = os.getenv("RESEND_API_KEY", "")
    sender_email = os.getenv("SENDER_EMAIL", "alerts@firescope.dev")
    sender_name = os.getenv("SENDER_NAME", "FireScope Alerts")
    if not api_key:
        return None, "RESEND_API_KEY not set"
    resend.api_key = api_key

    name = (contact_name or "").strip() or to_email.split("@", 1)[0]
    status = (zone_props.get("STATUS") or "").upper()
    event = zone_props.get("EVENT_TYPE") or "Evacuation"
    zone_name = zone_props.get("ZONE_NAME") or zone_props.get("ZONE_ID") or "Affected zone"
    county = zone_props.get("COUNTY") or ""
    critical = (zone_props.get("CRITICAL_INFO") or "").strip()
    public = (zone_props.get("PUBLIC_INFO") or "").strip()
    is_order = "ORDER" in status
    # County matches are broader awareness, not "you're in the polygon" —
    # word the body accordingly so the user knows the difference.
    in_polygon = match_kind == "polygon"
    proximity_line = (
        f"Your saved location <strong>{html_escape(location_name)}</strong> sits inside an active "
        f"{('evacuation order' if is_order else 'evacuation warning')} for <strong>{html_escape(zone_name)}</strong>."
        if in_polygon else
        f"An active {('evacuation order' if is_order else 'evacuation warning')} has been issued in "
        f"<strong>{html_escape(county)} County</strong>, which contains your saved location "
        f"<strong>{html_escape(location_name)}</strong>. The zone polygon doesn't overlap your saved point — "
        f"this is a heads-up so you know what's happening nearby."
    )

    shelter_rows = "".join(
        f'<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">{html_escape(s.get("shelter_name",""))}</td>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;color:#666">'
        f'{html_escape(s.get("address_1",""))}, {html_escape(s.get("city",""))}</td>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-size:12px">{s.get("_km",0):.1f} km</td></tr>'
        for s in nearest_shelters
    ) or '<tr><td colspan="3" style="padding:10px;color:#888;font-size:12px">No open shelters reported nearby right now — check CalOES.</td></tr>'

    banner_color = "#7f1d1d" if is_order else "#d97706"
    banner_label = "EVACUATION ORDER" if is_order else "EVACUATION WARNING"

    html = f"""<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f7f7f8;margin:0;padding:24px">
  <div style="max-width:600px;margin:auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #eee">
    <div style="background:{banner_color};color:white;padding:18px 22px">
      <div style="text-align:center;margin-bottom:8px"><img src="https://firescope.dev/firescope-logo.png" alt="FireScope" width="56" height="56" style="display:block;margin:0 auto;border:0;background:white;border-radius:10px;padding:4px"></div>
      <div style="font-size:13px;letter-spacing:.08em;opacity:.95;text-align:center">FIRESCOPE • {banner_label}</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px;text-align:center">{html_escape(zone_name)} ({html_escape(county)})</div>
      <div style="font-size:13px;margin-top:4px;opacity:.95">{html_escape(event)}</div>
    </div>
    <div style="padding:22px">
      <p style="margin:0 0 12px">Hi {html_escape(name)},</p>
      <p style="margin:0 0 14px;font-size:15px">{proximity_line}</p>
      {f'<div style="background:#fef2f2;border-left:3px solid #dc2626;padding:10px 14px;margin:0 0 14px;font-size:13px;color:#7f1d1d">{html_escape(critical)}</div>' if critical else ''}
      {f'<div style="font-size:13px;color:#444;margin:0 0 18px">{html_escape(public)}</div>' if public else ''}
      <div style="font-size:13px;font-weight:600;color:#555;margin:6px 0 6px">Nearest open shelters</div>
      <table style="width:100%;border-collapse:collapse">{shelter_rows}</table>
      <p style="margin:18px 0 0;font-size:13px;color:#555">
        See live evacuation map: <a href="https://firescope.dev" style="color:#dc2626">firescope.dev</a>.
      </p>
      <p style="margin:14px 0 0;font-size:12px;color:#888">
        Manage the Evacuation channel at firescope.dev → Alerts.
      </p>
    </div>
  </div>
</body></html>"""
    text = (
        f"{banner_label}\n"
        f"{zone_name} ({county}) — {event}\n"
        f"Your saved location \"{location_name}\" is inside this zone.\n\n"
        + (f"{critical}\n\n" if critical else "")
        + "Nearest open shelters:\n"
        + ("\n".join(f"  - {s.get('shelter_name','')} ({s.get('city','')}) — {s.get('_km',0):.1f} km"
                     for s in nearest_shelters) or "  (none reported nearby)")
        + "\n\nLive map: https://firescope.dev\n"
    )
    try:
        resp = resend.Emails.send({
            "from": f"{sender_name} <{sender_email}>",
            "to": [to_email],
            "subject": f"FireScope: {banner_label} — {zone_name}",
            "html": html,
            "text": text,
        })
        return resp.get("id"), None
    except Exception as e:
        logger.warning("resend send (evac) failed: %s", e)
        return None, str(e)


def _shelter_open_signature(shelter_id) -> str:
    return hashlib.sha256(f"shelter_opened:{shelter_id}".encode("utf-8")).hexdigest()[:32]


def _seen_shelter_ids_for_user(session, user_id) -> set:
    """Every shelter_id we've already alerted this user about."""
    rows = (
        session.query(AlertActivity.state_signature)
        .filter(
            AlertActivity.user_id == user_id,
            AlertActivity.delivery_status == "sent",
            AlertActivity.reason.like("shelter_opened%"),
        )
        .all()
    )
    return {r[0] for r in rows if r[0]}


def _send_shelter_opened_email(to_email, contact_name, location_county_pairs, shelters):
    """One email per cron-tick listing every newly-opened shelter in counties
    that contain the user's saved locations."""
    try:
        import resend
    except ImportError:
        return None, "resend SDK missing"
    api_key = os.getenv("RESEND_API_KEY", "")
    sender_email = os.getenv("SENDER_EMAIL", "alerts@firescope.dev")
    sender_name = os.getenv("SENDER_NAME", "FireScope Alerts")
    if not api_key:
        return None, "RESEND_API_KEY not set"
    resend.api_key = api_key

    name = (contact_name or "").strip() or to_email.split("@", 1)[0]
    rows = "".join(
        f'<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600">{html_escape(s.get("shelter_name",""))}</td>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;color:#666">'
        f'{html_escape(s.get("address_1",""))}, {html_escape(s.get("city",""))} ({html_escape(str(s.get("county_parish","")).title())} County)</td>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-size:12px">{s.get("evacuation_capacity") or "—"}</td></tr>'
        for s in shelters
    )
    county_list = ", ".join(sorted({c.title() for _, c in location_county_pairs}))
    html = f"""<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f7f7f8;margin:0;padding:24px">
  <div style="max-width:600px;margin:auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #eee">
    <div style="background:#16a34a;color:white;padding:18px 22px">
      <div style="text-align:center;margin-bottom:8px"><img src="https://firescope.dev/firescope-logo.png" alt="FireScope" width="56" height="56" style="display:block;margin:0 auto;border:0;background:white;border-radius:10px;padding:4px"></div>
      <div style="font-size:13px;letter-spacing:.08em;opacity:.95;text-align:center">FIRESCOPE • SHELTER UPDATE</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px;text-align:center">{len(shelters)} open shelter{'s' if len(shelters) != 1 else ''} near you</div>
    </div>
    <div style="padding:22px">
      <p style="margin:0 0 12px">Hi {html_escape(name)},</p>
      <p style="margin:0 0 14px;font-size:14px">
        {len(shelters)} shelter{'s' if len(shelters) != 1 else ''} {'have' if len(shelters) != 1 else 'has'} been reported open in <strong>{html_escape(county_list)}</strong>,
        which {'contain' if len(set(c for _, c in location_county_pairs)) > 1 else 'contains'} your saved location{'s' if len(set(loc for loc, _ in location_county_pairs)) > 1 else ''}.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#fafafa">
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Shelter</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase">Where</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#888;text-transform:uppercase">Capacity</th>
        </tr></thead>
        <tbody>{rows}</tbody>
      </table>
      <p style="margin:18px 0 0;font-size:13px;color:#555">
        See the live shelter map at <a href="https://firescope.dev" style="color:#16a34a">firescope.dev</a>.
      </p>
      <p style="margin:14px 0 0;font-size:12px;color:#888">
        You're getting this because the Evacuation channel is on (shelters travel with it). Manage at firescope.dev → Alerts.
      </p>
    </div>
  </div>
</body></html>"""
    text = (
        f"FireScope — {len(shelters)} new open shelter{'s' if len(shelters) != 1 else ''} in {county_list}.\n\n"
        + "\n".join(
            f"  - {s.get('shelter_name','')} ({s.get('city','')}, {str(s.get('county_parish','')).title()})"
            for s in shelters
        )
        + "\n\nSee all: https://firescope.dev\n"
    )
    try:
        resp = resend.Emails.send({
            "from": f"{sender_name} <{sender_email}>",
            "to": [to_email],
            "subject": f"FireScope: {len(shelters)} new open shelter{'s' if len(shelters) != 1 else ''} in {county_list}",
            "html": html,
            "text": text,
        })
        return resp.get("id"), None
    except Exception as e:
        logger.warning("resend send (shelter-opened) failed: %s", e)
        return None, str(e)


@internal_alerts_bp.route("/internal/alerts/evacuation", methods=["POST"])
def run_evacuation_alerts():
    ok, err = _require_internal_token()
    if not ok:
        return jsonify({"error": err}), 401

    session = db.session
    now = datetime.utcnow()

    zones = _fetch_active_evac_zones()
    # We still fetch shelters even when no zones are active — they drive the
    # "newly opened shelter in your county" sub-alert which fires independently
    # of any active evacuation. Shelters cache is 6h on the server so this is
    # cheap on warm hits.
    shelters = _fetch_open_shelters()

    q = (
        session.query(NotificationPreference, User)
        .join(User, User.id == NotificationPreference.user_id)
        .filter(
            NotificationPreference.opted_in == True,
            NotificationPreference.email_enabled == True,
            NotificationPreference.evacuation_enabled == True,
            NotificationPreference.unsubscribed_at.is_(None),
        )
    )
    scanned = 0
    sent = 0
    skipped_dedup = 0
    skipped_no_overlap = 0
    shelter_alerts_sent = 0
    errors = 0
    sent_ids = []

    for pref, user in q.all():
        scanned += 1
        if pref.paused_until and pref.paused_until > now:
            continue
        locs = session.query(UserLocation).filter(UserLocation.user_id == user.id).all()
        if not locs:
            skipped_no_overlap += 1
            continue

        # ---- Sub-alert: newly-opened shelters in the user's saved-location counties.
        # Fires independently of any active evac zone — a shelter opening is
        # itself news-worthy when it's near you (Ido's spec). Per-(user,shelter)
        # dedup via state_signature so each shelter only fires once.
        if shelters:
            user_counties = {  # county_name(lower) -> first matching saved location
                str(zr["county"]["name"]).lower(): loc
                for loc in locs
                for zr in [resolve_all(loc.lat, loc.lon)]
                if zr.get("county")
            }
            already_seen = _seen_shelter_ids_for_user(session, user.id)
            new_shelters = []
            seen_pairs = []  # (location, county_name)
            for s in shelters:
                county = str(s.get("county_parish", "")).lower()
                if county not in user_counties:
                    continue
                sig = _shelter_open_signature(s.get("shelter_id"))
                if sig in already_seen:
                    continue
                new_shelters.append((s, sig))
                seen_pairs.append((user_counties[county], county))
                if len(new_shelters) >= 10:
                    break  # cap the email body; the rest get picked up on the next tick

            if new_shelters:
                to_email = (pref.contact_email or user.email or "").strip()
                if to_email:
                    msg_id, send_err = _send_shelter_opened_email(
                        to_email=to_email,
                        contact_name=getattr(user, "name", None) or "",
                        location_county_pairs=seen_pairs,
                        shelters=[s for s, _ in new_shelters],
                    )
                    status = "sent" if msg_id else "failed"
                    # One AlertActivity row per shelter so dedup is per-shelter.
                    for s, sig in new_shelters:
                        session.add(AlertActivity(
                            user_id=user.id,
                            risk_level=10,
                            delivery_status=status,
                            reason=("shelter_opened" if msg_id else f"shelter_opened_err:{(send_err or '')[:18]}"),
                            state_signature=sig,
                        ))
                    if msg_id:
                        shelter_alerts_sent += 1
                        sent_ids.append(msg_id)

        if not zones:
            # No active evac zones — only the shelter sub-alert could have fired above.
            skipped_no_overlap += 1
            continue

        # Find every (location, zone) match — one alert per zone.
        # Match priority (highest first, both fire alerts):
        #   1. Polygon containment — saved location is literally inside the
        #      evac zone polygon. Life-safety, "your house is in this zone."
        #   2. County match — evac is active in a county that contains one
        #      of the user's saved locations. Broader situational awareness
        #      so you know about evacs in your county even if your specific
        #      address isn't in the polygon. Per Ido's spec.
        per_zone_hits = {}  # zone_id -> (location, zone_feature, match_kind)

        # Pre-resolve the county for each saved location once (PIP cached).
        loc_counties = []  # [(loc, county_name_lower)]
        for loc in locs:
            z = resolve_all(loc.lat, loc.lon).get("county")
            if z:
                loc_counties.append((loc, str(z["name"]).lower()))

        for feat in zones:
            props = (feat.get("properties") or {})
            zid = str(props.get("ZONE_ID") or props.get("ZONE_NAME") or "")
            if not zid:
                continue
            zone_county = str(props.get("COUNTY") or "").lower()

            # Pass 1: polygon containment — strongest match, win the spot.
            polygon_loc = None
            for loc in locs:
                if _feature_contains(feat, loc.lon, loc.lat):
                    polygon_loc = loc
                    break
            if polygon_loc:
                per_zone_hits[zid] = (polygon_loc, feat, "polygon")
                continue

            # Pass 2: county match — fire if any saved location is in this
            # zone's county. Falls back only if no polygon match was found.
            if zone_county:
                for loc, county in loc_counties:
                    if county == zone_county:
                        per_zone_hits[zid] = (loc, feat, "county")
                        break

        if not per_zone_hits:
            skipped_no_overlap += 1
            continue

        for zid, (loc, feat, match_kind) in per_zone_hits.items():
            already, sig = _evac_already_alerted(session, user.id, zid)
            if already:
                skipped_dedup += 1
                continue

            # Three nearest open shelters to the saved location.
            ranked = []
            for s in shelters:
                d = _haversine_km(loc.lat, loc.lon, float(s["latitude"]), float(s["longitude"]))
                ranked.append({**s, "_km": d})
            ranked.sort(key=lambda r: r["_km"])
            nearest = ranked[:EVAC_NEAREST_SHELTERS]

            to_email = (pref.contact_email or user.email or "").strip()
            if not to_email:
                errors += 1
                continue
            msg_id, send_err = _send_evacuation_email(
                to_email=to_email,
                contact_name=getattr(user, "name", None) or "",
                location_name=loc.name,
                zone_props=(feat.get("properties") or {}),
                nearest_shelters=nearest,
                match_kind=match_kind,
            )
            status = "sent" if msg_id else "failed"
            session.add(AlertActivity(
                user_id=user.id,
                risk_level=99 if "ORDER" in str((feat.get("properties") or {}).get("STATUS", "")).upper() else 80,
                delivery_status=status,
                reason=(f"evac_cron:{match_kind}" if msg_id else f"evac_cron_err:{(send_err or '')[:24]}"),
                state_signature=sig,
            ))
            if msg_id:
                sent += 1
                sent_ids.append(msg_id)
            else:
                errors += 1

    try:
        session.commit()
    except Exception:
        session.rollback()

    return jsonify({
        "scanned_users": scanned,
        "active_zones": len(zones),
        "active_shelters": len(shelters),
        "sent": sent,
        "shelter_alerts_sent": shelter_alerts_sent,
        "skipped_dedup": skipped_dedup,
        "skipped_no_overlap": skipped_no_overlap,
        "errors": errors,
        "sent_message_ids": sent_ids,
    })
