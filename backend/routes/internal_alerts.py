"""Internal cron-triggered alert dispatcher.

Hit by GitHub Actions workflows on a schedule. Auth via the
INTERNAL_CRON_TOKEN env var compared against the X-Internal-Token request
header. Never exposed to end users.

Slice 1A: only /high-risk is wired up. Evacuation and breaking-news endpoints
are stubbed and return 501 so the GHA workflow surface can be designed in one
pass without back-and-forth on the YAML side.
"""

import os
import logging
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify

from models import db, User, UserLocation, NotificationPreference, AlertActivity
from routes.predict import _run as predict_at

logger = logging.getLogger(__name__)

internal_alerts_bp = Blueprint("internal_alerts", __name__)

HIGH_RISK_THRESHOLD = 0.70  # /predict returns risk_probability in 0..1; 0.70 = "High" tier in the 9-tier scale
DEDUP_WINDOW_HOURS = 24   # don't re-email same user at same tier inside this window


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


def _already_alerted(session, user_id, risk_level):
    """Per-user, per-tier dedup inside the 24h window."""
    cutoff = datetime.utcnow() - timedelta(hours=DEDUP_WINDOW_HOURS)
    q = (
        session.query(AlertActivity)
        .filter(
            AlertActivity.user_id == user_id,
            AlertActivity.risk_level == risk_level,
            AlertActivity.delivery_status == "sent",
            AlertActivity.created_at >= cutoff,
        )
        .first()
    )
    return q is not None


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
    rows_html = "".join(
        f"<tr><td style='padding:8px 12px;border-bottom:1px solid #eee'>{html_escape(loc['name'])}</td>"
        f"<td style='padding:8px 12px;border-bottom:1px solid #eee;font-weight:600'>{loc['label']}</td>"
        f"<td style='padding:8px 12px;border-bottom:1px solid #eee;text-align:right'>{loc['risk']*100:.0f}%</td></tr>"
        for loc in locations_payload
    )
    html = f"""<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f7f7f8;margin:0;padding:24px">
  <div style="max-width:560px;margin:auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #eee">
    <div style="background:#dc2626;color:white;padding:18px 22px">
      <div style="font-size:13px;letter-spacing:.08em;opacity:.9">FIRESCOPE • HIGH RISK ALERT</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">Elevated wildfire risk near your saved locations</div>
    </div>
    <div style="padding:22px">
      <p style="margin:0 0 14px">Hi {html_escape(name)},</p>
      <p style="margin:0 0 16px">One or more of your saved locations is currently at <strong>High</strong> risk or above:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="background:#fafafa">
          <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #eee">Location</th>
          <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #eee">Tier</th>
          <th style="padding:10px 12px;text-align:right;border-bottom:1px solid #eee">Risk</th>
        </tr></thead>
        <tbody>{rows_html}</tbody>
      </table>
      <p style="margin:18px 0 0;font-size:13px;color:#555">
        Open <a href="https://firescope.dev" style="color:#dc2626">firescope.dev</a> to see live conditions and evacuation info.
      </p>
      <p style="margin:14px 0 0;font-size:12px;color:#888">
        You're receiving this because the High Risk channel is on in your alert settings. Manage at firescope.dev → Alerts.
      </p>
    </div>
  </div>
</body></html>"""

    text = f"FireScope — high wildfire risk near your saved locations.\n\n" + "\n".join(
        f"  • {loc['name']}: {loc['label']} ({loc['risk']*100:.0f}%)" for loc in locations_payload
    ) + "\n\nLive map: https://firescope.dev\n"

    try:
        resp = resend.Emails.send({
            "from": f"{sender_name} <{sender_email}>",
            "to": [to_email],
            "subject": f"FireScope: High wildfire risk at {locations_payload[0]['name']}"
                       + (f" + {len(locations_payload)-1} more" if len(locations_payload) > 1 else ""),
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

        # Score every location; collect those at or above the threshold.
        hits = []
        for loc in locations:
            try:
                payload = predict_at(loc.lat, loc.lon)
                pct = float(payload["prediction"]["risk_probability"])
                label = payload["prediction"]["risk_level"]
            except Exception as e:
                logger.warning("predict failed for loc %s: %s", loc.id, e)
                errors += 1
                continue
            if pct >= HIGH_RISK_THRESHOLD:
                hits.append({"name": loc.name, "risk": pct, "label": label})

        if not hits:
            skipped_below += 1
            continue

        # Tier-bucketed dedup: 0..1 probability → 70/80/90/100 buckets.
        max_risk = max(h["risk"] for h in hits)
        bucket = int(max_risk * 100 // 10) * 10  # 70, 80, 90, 100
        if _already_alerted(session, user.id, bucket):
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
