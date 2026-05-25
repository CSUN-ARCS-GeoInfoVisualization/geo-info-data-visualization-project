"""Internal cron-triggered alert dispatcher.

Hit by GitHub Actions workflows on a schedule. Auth via the
INTERNAL_CRON_TOKEN env var compared against the X-Internal-Token request
header. Never exposed to end users.

Slice 1A: only /high-risk is wired up. Evacuation and breaking-news endpoints
are stubbed and return 501 so the GHA workflow surface can be designed in one
pass without back-and-forth on the YAML side.
"""

import os
import hashlib
import logging
from datetime import datetime

from flask import Blueprint, request, jsonify

from models import db, User, UserLocation, NotificationPreference, AlertActivity
from routes.predict import _run as predict_at
from data.zone_resolver import resolve_all


_ZONE_LABEL = {"county": "County", "zip": "ZIP", "neighborhood": "Neighborhood", "census_tract": "Census tract"}


def _zones_for_location(loc):
    """Return list of {'kind','zone_name','pct','label'} for the 4 zone types.
    Skips a zone if resolve fails (out of California, etc)."""
    from routes.locations import _label_for
    zones = resolve_all(loc.lat, loc.lon)
    out = []
    for key in ("county", "zip", "neighborhood", "census_tract"):
        z = zones.get(key)
        if not z:
            continue
        try:
            r = predict_at(z["centroid_lat"], z["centroid_lon"])
            pct = float(r["prediction"]["risk_probability"])
        except Exception:
            continue
        out.append({
            "kind": _ZONE_LABEL[key],
            "zone_name": z["name"],
            "pct": pct,
            "label": _label_for(pct),
        })
    return out

logger = logging.getLogger(__name__)

internal_alerts_bp = Blueprint("internal_alerts", __name__)

HIGH_RISK_THRESHOLD = 0.70  # /predict returns risk_probability in 0..1; 0.70 = "High" tier in the 9-tier scale


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
    """Renders one location's all-4-zones table inside the alert email."""
    title = html_escape(loc_payload["name"])
    rows = "".join(
        f"<tr><td style='padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;color:#555'>{html_escape(z['kind'])}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee;font-size:12px'>{html_escape(z['zone_name'])}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee;font-weight:600;font-size:12px'>{html_escape(z['label'])}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-size:12px'>{z['pct']*100:.0f}%</td></tr>"
        for z in loc_payload["zones"]
    )
    return (
        f"<div style='margin-top:14px;border:1px solid #eee;border-radius:8px;overflow:hidden'>"
        f"  <div style='background:#fafafa;padding:10px 12px;font-weight:600;font-size:13px'>{title}</div>"
        f"  <table style='width:100%;border-collapse:collapse'>"
        f"    <thead><tr style='background:#fff'>"
        f"      <th style='padding:6px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase'>Zone</th>"
        f"      <th style='padding:6px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase'>Area</th>"
        f"      <th style='padding:6px 10px;text-align:left;font-size:11px;color:#888;text-transform:uppercase'>Tier</th>"
        f"      <th style='padding:6px 10px;text-align:right;font-size:11px;color:#888;text-transform:uppercase'>Risk</th>"
        f"    </tr></thead>"
        f"    <tbody>{rows}</tbody>"
        f"  </table>"
        f"</div>"
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
      <div style="font-size:13px;letter-spacing:.08em;opacity:.9">FIRESCOPE • HIGH RISK ALERT</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">Elevated wildfire risk near your saved locations</div>
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


@internal_alerts_bp.route("/internal/alerts/evacuation", methods=["POST"])
def run_evacuation_alerts():
    ok, err = _require_internal_token()
    if not ok:
        return jsonify({"error": err}), 401
    return jsonify({"status": "not_implemented", "slice": "1B"}), 501


@internal_alerts_bp.route("/internal/alerts/breaking-news", methods=["POST"])
def run_breaking_news_alerts():
    ok, err = _require_internal_token()
    if not ok:
        return jsonify({"error": err}), 401
    return jsonify({"status": "not_implemented", "slice": "1C"}), 501
