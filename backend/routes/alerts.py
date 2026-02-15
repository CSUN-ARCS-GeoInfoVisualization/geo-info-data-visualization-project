"""Flask blueprint: alert preferences, monitored areas, admin endpoints, webhooks."""

from datetime import datetime
from typing import Optional

from flask import Blueprint, request, jsonify
from sqlalchemy.orm import Session

from backend.services.email.models import (
    UserAlertPreference,
    UserMonitoredArea,
    AlertActivity,
)
from backend.services.email.provider import EmailMessage
from backend.services.email.renderer import EmailRenderer
from backend.services.email.sender import EmailSender

alerts_bp = Blueprint("alerts", __name__, url_prefix="/api")

# Injected by init_email_service
_email_sender: Optional[EmailSender] = None
_session_factory = None


def init_routes(sender: EmailSender, session_factory):
    """Called from init_email_service to inject dependencies."""
    global _email_sender, _session_factory
    _email_sender = sender
    _session_factory = session_factory


def _session() -> Session:
    return _session_factory()


def _require_sender():
    if _email_sender is None:
        raise RuntimeError("Alerts routes not initialized - call init_email_service first")


# --- Alert preferences ---


@alerts_bp.route("/alert-preferences", methods=["GET"])
def get_alert_preferences():
    """GET user alert settings. Requires user_id in query or auth context."""
    user_id = request.args.get("user_id", type=int)
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    session = _session()
    pref = session.query(UserAlertPreference).filter(UserAlertPreference.user_id == user_id).first()
    if not pref:
        return jsonify({"frequency": "instant", "risk_threshold": 70, "is_paused": False})
    return jsonify({
        "frequency": pref.frequency or "instant",
        "risk_threshold": float(pref.risk_threshold or 70),
        "is_paused": pref.is_paused or False,
    })


@alerts_bp.route("/alert-preferences", methods=["PUT"])
def put_alert_preferences():
    """Update user alert settings."""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    session = _session()
    pref = session.query(UserAlertPreference).filter(UserAlertPreference.user_id == user_id).first()
    if not pref:
        pref = UserAlertPreference(user_id=user_id)
        session.add(pref)
    if "frequency" in data:
        pref.frequency = data["frequency"]
    if "risk_threshold" in data:
        pref.risk_threshold = data["risk_threshold"]
    if "is_paused" in data:
        pref.is_paused = data["is_paused"]
    if "email" in data:
        pref.email = data["email"]
    pref.updated_at = datetime.utcnow()
    session.commit()
    return jsonify({"ok": True})


@alerts_bp.route("/alert-preferences/unsubscribe", methods=["POST"])
def unsubscribe():
    """Opt out of alerts."""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    session = _session()
    pref = session.query(UserAlertPreference).filter(UserAlertPreference.user_id == user_id).first()
    if pref:
        pref.is_paused = True
        session.commit()
    return jsonify({"ok": True, "message": "Unsubscribed"})


# --- Monitored areas ---


@alerts_bp.route("/monitored-areas", methods=["GET"])
def get_monitored_areas():
    """List monitored areas for user."""
    user_id = request.args.get("user_id", type=int)
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    session = _session()
    areas = session.query(UserMonitoredArea).filter(UserMonitoredArea.user_id == user_id).all()
    return jsonify([{"id": a.id, "area_name": a.area_name, "area_geojson": a.area_geojson} for a in areas])


@alerts_bp.route("/monitored-areas", methods=["POST"])
def post_monitored_area():
    """Add monitored area."""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    area_name = data.get("area_name")
    if not user_id or not area_name:
        return jsonify({"error": "user_id and area_name required"}), 400
    session = _session()
    area = UserMonitoredArea(user_id=user_id, area_name=area_name, area_geojson=data.get("area_geojson"))
    session.add(area)
    try:
        session.commit()
        session.refresh(area)
        return jsonify({"id": area.id, "area_name": area.area_name}), 201
    except Exception:
        session.rollback()
        return jsonify({"error": "Duplicate or invalid"}), 409


@alerts_bp.route("/monitored-areas/<int:area_id>", methods=["DELETE"])
def delete_monitored_area(area_id):
    """Remove monitored area."""
    session = _session()
    area = session.query(UserMonitoredArea).filter(UserMonitoredArea.id == area_id).first()
    if not area:
        return jsonify({"error": "Not found"}), 404
    session.delete(area)
    session.commit()
    return jsonify({"ok": True})


# --- Alert history ---


@alerts_bp.route("/alert-history", methods=["GET"])
def get_alert_history():
    """Paginated alert history for user."""
    user_id = request.args.get("user_id", type=int)
    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 20, type=int), 100)
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    session = _session()
    q = session.query(AlertActivity).filter(AlertActivity.user_id == user_id).order_by(AlertActivity.created_at.desc())
    total = q.count()
    items = q.offset((page - 1) * per_page).limit(per_page).all()
    return jsonify({
        "items": [
            {
                "id": a.id,
                "alert_type": a.alert_type,
                "risk_score": float(a.risk_score) if a.risk_score else None,
                "delivered_at": a.delivered_at.isoformat() if a.delivered_at else None,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in items
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    })


# --- Admin ---


@alerts_bp.route("/admin/alerts/send-test", methods=["POST"])
def admin_send_test():
    """Send test email to verify Resend setup."""
    _require_sender()
    data = request.get_json() or {}
    to = data.get("to")
    if not to:
        return jsonify({"error": "to address required"}), 400
    renderer = EmailRenderer()
    html, text = renderer.render_immediate_alert(
        area_name="Test Area",
        risk_score=75,
        contributing_factors=["Dry vegetation", "High wind"],
    )
    msg = EmailMessage(to=to, subject="FireWatch Test Email", html_body=html, text_body=text)
    result = _email_sender.provider.send(msg)
    if result.success:
        return jsonify({"ok": True, "message_id": result.provider_message_id})
    return jsonify({"error": result.error_message}), 500


@alerts_bp.route("/admin/alerts/trigger", methods=["POST"])
def admin_trigger_alert():
    """Manually trigger immediate alerts for given risk data."""
    _require_sender()
    data = request.get_json() or {}
    risk_list = data.get("risk_data", [])
    if not risk_list:
        return jsonify({"error": "risk_data required"}), 400
    results = _email_sender.process_risk_alerts(risk_list)
    return jsonify({"sent": sum(1 for r in results if r.success), "total": len(results)})


@alerts_bp.route("/admin/alerts/digest", methods=["POST"])
def admin_trigger_digest():
    """Manually trigger digest send (daily or weekly)."""
    _require_sender()
    data = request.get_json() or {}
    digest_type = data.get("type", "daily")
    if digest_type == "weekly":
        results = _email_sender.send_weekly_digest()
    else:
        results = _email_sender.send_daily_digest()
    return jsonify({"sent": sum(1 for r in results if r.success), "total": len(results)})


# --- Webhook ---


@alerts_bp.route("/webhooks/email", methods=["POST"])
def email_webhook():
    """Resend delivery status webhook."""
    # Verify signature if RESEND_WEBHOOK_SECRET set
    # For now, parse Resend webhook payload
    data = request.get_json() or {}
    event_type = data.get("type")
    email_id = data.get("data", {}).get("email", {}).get("id")
    if not email_id:
        return jsonify({"ok": False}), 400

    _require_sender()
    # Tracker is on sender - we need tracker to be accessible
    tracker = _email_sender.tracker  # type: ignore
    if event_type == "email.delivered":
        tracker.mark_delivered(email_id)
    elif event_type in ("email.delivery_delayed", "email.bounced", "email.complained"):
        tracker.mark_failed(email_id, data.get("data", {}).get("error", {}).get("message", event_type))

    return jsonify({"ok": True})
