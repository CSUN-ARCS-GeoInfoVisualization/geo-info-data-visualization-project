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
        # Always re-derive the label from the live pct so the email
        # CANNOT disagree with what the user sees on the map. The cache
        # may hold a stale label string from before the 5-tier NFDRS
        # migration; the frontend re-derives from pct in lib/riskTiers.ts,
        # so we must do the same on the backend to stay in sync.
        out.append({
            "kind": _ZONE_LABEL[key],
            "zone_name": z["name"],
            "pct": pct,
            "label": _label_for(pct),
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


def _anti_gmail_trim_headers() -> dict:
    """Per-send unique X-Entity-Ref-ID + Message-ID-style headers that
    stop Gmail from collapsing repeated FireScope alerts into a single
    'trimmed content' affordance.

    Recipient confirmed on 2026-05-27 that Gmail (web + mobile) was
    hiding the body of repeated similar-subject FireScope alerts behind
    the '...' menu. The cause is Gmail's quoted-text detection treating
    near-identical layouts from the same sender as a duplicate thread.

    X-Entity-Ref-ID is the documented Gmail-specific header for opting
    out of conversation grouping. Pairing it with a unique
    In-Reply-To-style token ensures no two FireScope alerts ever share
    a thread fingerprint.
    """
    import uuid
    ref = uuid.uuid4().hex
    return {
        "X-Entity-Ref-ID": ref,
        # No real In-Reply-To target — using a synthetic ID that won't
        # match any other message in the user's mailbox. Gmail treats
        # this as a thread root, not a reply.
        "X-FireScope-Send-ID": ref,
    }


def _anti_gmail_trim_marker(ref: str | None = None) -> str:
    """A single hidden HTML row carrying a unique token. Invisible to
    the reader (zero font-size, zero opacity, display:none-equivalent
    CSS that still passes Gmail's sanitizer) but counts in Gmail's
    content-similarity hash, breaking the 'trimmed content' collapse."""
    import uuid
    ref = ref or uuid.uuid4().hex
    return (
        '<span style="display:none;font-size:0;line-height:0;'
        'max-height:0;max-width:0;opacity:0;overflow:hidden;'
        'color:transparent;mso-hide:all" aria-hidden="true">'
        f'FireScope-send-uid:{ref}'
        '</span>'
    )


def _encode_polyline(coords: list) -> str:
    """Google polyline encoding algorithm — used by Mapbox Static Images
    API to compress polygon overlays into the URL.

    Input:  [(lat, lon), (lat, lon), ...]
    Output: ASCII-safe string per https://developers.google.com/maps/documentation/utilities/polylinealgorithm

    Inlined instead of `pip install polyline` to keep the email subsystem
    dependency-free.
    """
    result = []
    prev_lat = 0
    prev_lon = 0
    for lat, lon in coords:
        ilat = int(round(lat * 1e5))
        ilon = int(round(lon * 1e5))
        for delta in (ilat - prev_lat, ilon - prev_lon):
            value = delta << 1
            if delta < 0:
                value = ~value
            while value >= 0x20:
                result.append(chr((0x20 | (value & 0x1f)) + 63))
                value >>= 5
            result.append(chr(value + 63))
        prev_lat = ilat
        prev_lon = ilon
    return "".join(result)


# Match the live FireScope dashboard exactly — source of truth is
# frontend/src/components/shelter-evac-legend.tsx + evacuation-routes.tsx
# colorForZoneStatus. Keep these in sync if the dashboard changes.
_EVAC_STATUS_COLORS = {
    # status keyword -> (stroke_hex, fill_hex)  — Mapbox hex without `#`
    "order":     ("7f1d1d", "dc2626"),  # red-900 stroke / red-600 fill
    "warning":   ("d97706", "f97316"),  # amber-600 stroke / orange-500 fill
    "shelter":   ("6b21a8", "9333ea"),  # purple-800 stroke / purple-600 fill (shelter-in-place)
    "advisory":  ("ca8a04", "eab308"),  # yellow-600 stroke / yellow-500 fill
    "default":   ("4b5563", "6b7280"),  # grey-600 stroke / grey-500 fill
}
# Fill opacity 0.35 / stroke opacity 0.9 — matches the live deck.gl alphas
# of 90/255 and 230/255 from evacuation-routes.tsx.colorForZoneStatus.
_EVAC_FILL_OPACITY = 0.35
_EVAC_STROKE_OPACITY = 0.9

# Marker icons mirrored via jsDelivr CDN. Source of truth is the PNGs
# in frontend/public/email-icons/ — we point Mapbox at the jsDelivr
# mirror instead of firescope.dev because Netlify serves static assets
# with `cache-control: max-age=0, must-revalidate` and Mapbox's
# image-fetcher rejects that header and returns "Custom image not found"
# (verified 2026-05-27 against /email-icons/user-location-pin.png).
# jsDelivr serves with `max-age=604800` and works first try, plus it's
# globally CDN-cached and auto-purges on every commit.
_EMAIL_ICON_BASE = (
    "https://cdn.jsdelivr.net/gh/CSUN-ARCS-GeoInfoVisualization/"
    "geo-info-data-visualization-project@main/frontend/public/email-icons"
)
_SHELTER_PIN_URLS = {
    "EVAC": f"{_EMAIL_ICON_BASE}/shelter-pin-EVAC.png",   # 🏃 over blue
    "POST": f"{_EMAIL_ICON_BASE}/shelter-pin-POST.png",   # 🏠 over green
    "BOTH": f"{_EMAIL_ICON_BASE}/shelter-pin-BOTH.png",   # 🏛️ over purple
}
_USER_LOC_PIN_URL = f"{_EMAIL_ICON_BASE}/user-location-pin.png"  # solid blue #2563eb circle


def _evac_status_colors(status: str) -> tuple[str, str]:
    """Pick (stroke_hex, fill_hex) from a CalOES STATUS string. Mirrors
    colorForZoneStatus in evacuation-routes.tsx."""
    s = (status or "").lower()
    for key in ("order", "warning", "shelter", "advisory"):
        if key in s:
            return _EVAC_STATUS_COLORS[key]
    return _EVAC_STATUS_COLORS["default"]


def _static_map_url(center_lat: float, center_lon: float,
                    zone_overlays: list | None = None,
                    shelter_pins: list | None = None,
                    zoom: int | str = 11,
                    width: int = 600, height: int = 300,
                    include_user_pin: bool = True,
                    county_lines: bool = False) -> str:
    """Build a Mapbox Static Images API URL matching the live FireScope
    dashboard pixel-by-pixel (zone colors, shelter emoji icons, blue
    user-location circle).

    zone_overlays: list of dicts {
        "rings": [[(lat, lon), ...], ...],   # polygon rings from _polygon_rings_from_feature
        "status": str,                        # CalOES STATUS string
    } — colors picked per-status to match the live colorForZoneStatus.

    shelter_pins: list of dicts {
        "lat": float, "lon": float,
        "usage_code": "EVAC" | "POST" | "BOTH",   # facility_usage_code
    } — rendered as the matching emoji icon (🏃 / 🏠 / 🏛️) over the same
    blue / green / purple disc the live legend uses. Hosted at
    https://firescope.dev/email-icons/shelter-pin-<CODE>.png.

    The user location is drawn as the same blue solid circle (#2563eb)
    the live Google Maps marker uses on the dashboard.

    Uses MAPBOX_PUBLIC_TOKEN env var (free 50k/mo). Visible placeholder
    when unset so the email still ships.

    URL cap: Mapbox limits to 8192 chars. Rings pre-downsampled by
    _polygon_rings_from_feature, shelter list capped at 3 by the caller —
    well under the cap for typical scenarios.
    """
    token = os.getenv("MAPBOX_PUBLIC_TOKEN", "")
    if not token:
        return (
            f"https://via.placeholder.com/{width}x{height}/eeeeee/666666"
            f"?text=Map+pending+(MAPBOX_PUBLIC_TOKEN+unset)"
        )

    from urllib.parse import quote
    overlays = []

    # County boundary lines (optional, no fill — stroke only). Drawn
    # FIRST so fire polygons + pins layer on top. Uses path-W+color-op
    # with NO trailing +fillcolor — gives Mapbox a stroke-only line.
    # Filtered to counties near (center_lat, center_lon) so all 58 CA
    # counties don't blow the 8KB URL cap when included in a single
    # email. Typical bundle ~8-15 counties for a 2.5° radius.
    if county_lines:
        for ring in _ca_county_outline_rings(near_lat=center_lat, near_lon=center_lon):
            if len(ring) < 3:
                continue
            encoded = _encode_polyline(ring)
            overlays.append(f"path-1+666666-0.55({quote(encoded, safe='')})")

    # Zone polygons next so pins draw on top. Color per STATUS to match
    # the live colorForZoneStatus in evacuation-routes.tsx.
    for zo in (zone_overlays or []):
        rings = zo.get("rings") or []
        stroke_hex, fill_hex = _evac_status_colors(zo.get("status", ""))
        for ring in rings:
            if len(ring) < 3:
                continue
            encoded = _encode_polyline(ring)
            overlays.append(
                f"path-2+{stroke_hex}-{_EVAC_STROKE_OPACITY}+{fill_hex}-{_EVAC_FILL_OPACITY}"
                f"({quote(encoded, safe='')})"
            )

    # Shelter pins — emoji-over-color PNG hosted on Netlify. Falls back
    # to BOTH (purple 🏛️) if usage_code is unknown so an unmapped row
    # still gets a meaningful marker instead of an ugly missing image.
    # Mapbox syntax: url-<URL-encoded-https-URL>(lon,lat)
    for sp in (shelter_pins or []):
        try:
            slat = float(sp["lat"]); slon = float(sp["lon"])
        except (TypeError, ValueError, KeyError):
            continue
        usage = str(sp.get("usage_code", "")).upper() or "BOTH"
        pin_url = _SHELTER_PIN_URLS.get(usage) or _SHELTER_PIN_URLS["BOTH"]
        overlays.append(f"url-{quote(pin_url, safe='')}({slon:.5f},{slat:.5f})")

    # User location LAST so it's on top: blue solid circle PNG matching
    # the live Google Maps marker. Suppressed when include_user_pin=False
    # so callers that auto-frame to just the overlays (e.g. fire-alert
    # bundle spanning multiple counties) can opt out when the user's
    # location is far outside the fire bounding box — keeps the map
    # tightly zoomed on the actual fires instead of spreading to cover
    # both the user and a fire 250km away.
    if include_user_pin:
        overlays.append(
            f"url-{quote(_USER_LOC_PIN_URL, safe='')}({center_lon:.5f},{center_lat:.5f})"
        )

    overlay_str = ",".join(overlays)
    # `auto` lets Mapbox compute the bounding box of every overlay (user
    # pin + every zone polygon + every shelter pin) and frame them ALL
    # into the visible map. Falls back to fixed center+zoom otherwise.
    # Used by the fire-alert email so multi-county bundles can show every
    # matched fire instead of cropping out the far ones.
    if zoom == "auto":
        position = "auto"
    else:
        position = f"{center_lon:.5f},{center_lat:.5f},{zoom}"
    return (
        f"https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/"
        f"{overlay_str}/"
        f"{position}/"
        f"{width}x{height}@2x"
        f"?access_token={token}"
    )


def _polygon_rings_from_feature(feat: dict) -> list:
    """Extract polygon rings from a GeoJSON feature as [(lat, lon), ...] lists.

    Handles both Polygon and MultiPolygon. Returns a list of rings (outer
    rings only — Google Static Maps' &path= doesn't support holes).
    Coordinates are converted from GeoJSON's (lon, lat) order to (lat, lon)
    which is what Static Maps API expects in &path= params.
    """
    geom = (feat or {}).get("geometry") or {}
    gtype = geom.get("type")
    rings = []
    if gtype == "Polygon":
        coords_list = [geom.get("coordinates") or []]
    elif gtype == "MultiPolygon":
        coords_list = geom.get("coordinates") or []
    else:
        return rings
    for poly in coords_list:
        if not poly:
            continue
        outer = poly[0]  # outer ring only, skip holes
        # Downsample very dense rings so the URL stays under Google's 8KB cap.
        # Keep at most ~40 points per ring — plenty for an email-thumb map.
        step = max(1, len(outer) // 40)
        downsampled = outer[::step]
        rings.append([(float(lat), float(lon)) for lon, lat in downsampled])
    return rings


def _email_shell(
    *,
    header_bg: str,
    header_label: str,
    header_title: str,
    header_subtitle: str = "",
    body_inner_html: str,
    footer_text: str,
    link_color: str = "#dc2626",
) -> str:
    """Single Gmail-bulletproof email shell used by every alert channel.

    Why one shell: the high-risk email used to render blank in Gmail
    because the per-channel shells were copy-pasted from the same broken
    <body>+<div> template. Centralizing the wrapper means the next
    Gmail-compat fix lands in one place, not four.

    Bulletproof constraints (also enforced by tests/test_email_render.py):
      - Pure <table role="presentation"> layout — no <div> for structure
      - cellpadding/cellspacing/border explicit attrs on every table
      - Hex colors, no 'white' / 'black' shorthand
      - font-family inlined on every text cell (Gmail mobile drops
        inherited font-family and renders cells invisible)
      - No `background:` CSS shorthand on <td> — use background-color:
    """
    subtitle_row = ""
    if header_subtitle:
        subtitle_row = (
            f'<tr><td align="center" style="background-color:{header_bg};padding:0 22px 14px 22px;'
            f'font-size:13px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">{header_subtitle}</td></tr>'
        )
    # Hidden per-send unique token: breaks Gmail's content-similarity
    # hash so back-to-back FireScope alerts don't get collapsed under
    # the '...' trimmed-content affordance (recipient bug 2026-05-27).
    trim_buster = _anti_gmail_trim_marker()
    return (
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">'
        '<html xmlns="http://www.w3.org/1999/xhtml">'
        '<head>'
        '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />'
        f'<title>{header_title}</title>'
        '</head>'
        '<body style="margin:0;padding:0;background-color:#f7f7f8;font-family:Arial,Helvetica,sans-serif;">'
        f'{trim_buster}'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f7f7f8;">'
        '<tr><td align="center" style="padding:24px 12px;">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" '
        'style="max-width:600px;background-color:#ffffff;border:1px solid #eeeeee;">'
        f'<tr><td align="center" style="background-color:{header_bg};padding:18px 22px 8px 22px;">'
        '<img src="https://firescope.dev/firescope-logo.png" alt="FireScope" width="56" height="56" '
        'style="display:block;margin:0 auto 8px auto;border:0;background-color:#ffffff;padding:4px;" />'
        '</td></tr>'
        f'<tr><td align="center" style="background-color:{header_bg};padding:0 22px 4px 22px;'
        f'font-size:13px;letter-spacing:1px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">'
        f'FIRESCOPE &bull; {header_label}</td></tr>'
        f'<tr><td align="center" style="background-color:{header_bg};padding:0 22px {("12" if header_subtitle else "18")}px 22px;'
        f'font-size:22px;font-weight:bold;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">'
        f'{header_title}</td></tr>'
        f'{subtitle_row}'
        '<tr><td style="padding:22px;font-family:Arial,Helvetica,sans-serif;color:#222222;font-size:14px;">'
        f'{body_inner_html}'
        f'<p style="margin:18px 0 0;font-size:13px;color:#555555;">Open <a href="https://firescope.dev" '
        f'style="color:{link_color};text-decoration:underline;">firescope.dev</a> for the live map.</p>'
        f'<p style="margin:14px 0 0;font-size:12px;color:#888888;">{footer_text}</p>'
        '</td></tr>'
        '</table>'
        '</td></tr>'
        '</table>'
        '</body></html>'
    )


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


_TIER_BG = {
    "Extreme":   "#fee2e2",
    "Very High": "#fecaca",
    "High":      "#ffedd5",
    "Moderate":  "#fef9c3",
    "Low":       "#dcfce7",
}


def _location_block_html(loc_payload: dict) -> str:
    """One location's 4-zone table — Gmail-bulletproof layout.

    Why pure <table>: Gmail's HTML sanitizer strips the wrapping <body>
    AND any <div> styles it considers "structural", which previously
    collapsed our overflow:hidden + max-width:600px container down to
    zero visible height. Tables with explicit width=, cellpadding=,
    cellspacing=, border= attributes survive that sanitizer pass.

    Why `background-color:` (not `background:` shorthand): Gmail's CSS
    parser silently drops shorthand declarations when it can't resolve
    them against its allow-list, which previously knocked out the Tier
    cell entirely.

    See tests/test_email_render.py — those guards are what stop the
    next "improvement" from blanking the inbox.
    """
    title = html_escape(loc_payload["name"])
    rows = []
    for z in loc_payload["zones"]:
        bg = _TIER_BG.get(z["label"], "#f5f5f5")
        rows.append(
            "<tr>"
            f'<td style="padding:6px 10px;border-bottom:1px solid #eeeeee;font-size:12px;color:#555555;font-family:Arial,Helvetica,sans-serif">{html_escape(z["kind"])}</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #eeeeee;font-size:12px;font-family:Arial,Helvetica,sans-serif">{html_escape(z["zone_name"])}</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #eeeeee;font-weight:bold;font-size:12px;background-color:{bg};font-family:Arial,Helvetica,sans-serif">{html_escape(z["label"])}</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #eeeeee;text-align:right;font-size:12px;font-family:Arial,Helvetica,sans-serif">{z["pct"]*100:.0f}%</td>'
            "</tr>"
        )
    rows_html = "".join(rows)
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        'style="border-collapse:collapse;margin-top:14px;border:1px solid #eeeeee;background-color:#ffffff">'
        f'<tr><td style="background-color:#fafafa;padding:10px 12px;font-weight:bold;font-size:13px;'
        f'font-family:Arial,Helvetica,sans-serif;color:#222222">{title}</td></tr>'
        '<tr><td style="padding:0">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        'style="border-collapse:collapse">'
        '<tr style="background-color:#ffffff">'
        '<th align="left" style="padding:6px 10px;font-size:11px;color:#888888;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif">Zone</th>'
        '<th align="left" style="padding:6px 10px;font-size:11px;color:#888888;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif">Area</th>'
        '<th align="left" style="padding:6px 10px;font-size:11px;color:#888888;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif">Tier</th>'
        '<th align="right" style="padding:6px 10px;font-size:11px;color:#888888;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif">Risk</th>'
        '</tr>'
        f'{rows_html}'
        '</table>'
        '</td></tr>'
        '</table>'
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
    # 5-tier NFDRS scale legend — always rendered so the recipient sees the
    # full risk scale even when their current data only spans 2-3 tiers.
    # Swatch is a <td>+background-color (not a <div>) for Gmail compat.
    legend_rows = (
        ("Extreme",   "#fee2e2", "80%+"),
        ("Very High", "#fecaca", "60-80%"),
        ("High",      "#ffedd5", "40-60%"),
        ("Moderate",  "#fef9c3", "20-40%"),
        ("Low",       "#dcfce7", "0-20%"),
    )
    legend_html = "".join(
        f'<tr>'
        f'<td width="14" height="14" style="background-color:{c};border:1px solid #cccccc;font-size:0;line-height:0">&nbsp;</td>'
        f'<td style="padding:4px 8px;font-size:12px;font-family:Arial,Helvetica,sans-serif;color:#222222;font-weight:bold">{l}</td>'
        f'<td style="padding:4px 8px;font-size:12px;font-family:Arial,Helvetica,sans-serif;color:#666666">{r}</td>'
        f'</tr>'
        for l, c, r in legend_rows
    )
    body_inner = (
        f'<p style="margin:0 0 14px;font-size:14px;">Hi {html_escape(name)},</p>'
        '<p style="margin:0 0 8px;font-size:14px;line-height:1.45;">One or more of your saved locations is at '
        '<strong>High</strong> risk or above on the NFDRS 5-tier scale. Below is the current risk by every '
        'zone type &mdash; county, ZIP code, neighborhood, and census tract &mdash; so you can see which '
        'scope is driving the alert.</p>'
        f'{blocks_html}'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        'style="margin-top:18px;border-top:1px solid #eeeeee;">'
        '<tr><td style="padding:14px 0 8px 0;font-size:11px;color:#888888;text-transform:uppercase;'
        'letter-spacing:1px;font-family:Arial,Helvetica,sans-serif;font-weight:bold">NFDRS 5-Tier Risk Scale</td></tr>'
        '<tr><td>'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0">{legend_html}</table>'
        '</td></tr>'
        '</table>'
    )
    html = _email_shell(
        header_bg="#dc2626",
        header_label="HIGH RISK ALERT",
        header_title="Wildfire risk alert for your saved locations",
        body_inner_html=body_inner,
        footer_text="You're receiving this because the High Risk channel is on in your alert settings. "
                    "Manage at firescope.dev &rarr; Alerts.",
    )

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
        # Append the worst tier label + max risk pct to the subject. Two
        # reasons: (a) the recipient sees the severity in the inbox snippet,
        # (b) it makes every subject unique enough that Gmail does NOT
        # thread/collapse repeated alerts and hide their bodies — that
        # collapse is what made the 16:49 send look "blank" in Gmail on
        # 2026-05-27 even though the HTML body was intact.
        worst_pct = max(z["pct"] for z in locations_payload[0]["zones"])
        worst_label = locations_payload[0]["zones"][0]["label"]  # already sorted by location risk
        for z in locations_payload[0]["zones"]:
            if z["pct"] >= worst_pct:
                worst_label = z["label"]
                worst_pct = z["pct"]
        subject = (
            f"FireScope: {worst_label} risk ({worst_pct*100:.0f}%) at {first_name}"
            + (f" + {more} more" if more else "")
        )
        resp = resend.Emails.send({
            "from": f"{sender_name} <{sender_email}>",
            "to": [to_email],
            "subject": subject,
            "html": html,
            "text": text,
            "headers": _anti_gmail_trim_headers(),
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
    # Each article = one table row (header subtitle / title / summary).
    items_html = "".join(
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        'style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #eeeeee;">'
        '<tr><td style="padding:0 0 4px 0;font-size:11px;text-transform:uppercase;color:#888888;'
        'letter-spacing:1px;font-family:Arial,Helvetica,sans-serif;">'
        f'{html_escape(a["source_label"])} &middot; {a["published_at"][:16].replace("T"," ")} UTC</td></tr>'
        '<tr><td style="padding:0 0 6px 0;font-size:15px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;">'
        f'<a href="{html_escape(_our_news_url(a))}" style="color:#dc2626;text-decoration:none">'
        f'{html_escape(a["title"])}</a></td></tr>'
        '<tr><td style="font-size:13px;color:#444444;line-height:1.45;font-family:Arial,Helvetica,sans-serif;">'
        f'{html_escape((a.get("summary") or "")[:280])}{"&hellip;" if len(a.get("summary") or "") > 280 else ""}'
        '</td></tr>'
        '</table>'
        for a in articles
    )
    plural = "story" if len(articles) == 1 else "stories"
    body_inner = (
        f'<p style="margin:0 0 14px;font-size:14px;">Hi {html_escape(name)},</p>'
        f'{items_html}'
    )
    html = _email_shell(
        header_bg="#dc2626",
        header_label="BREAKING FIRE NEWS",
        header_title=f"{len(articles)} new {plural} you should see",
        body_inner_html=body_inner,
        footer_text="You're getting this because the Breaking Fire News channel is on. "
                    "Manage at firescope.dev &rarr; Alerts.",
    )
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
            "headers": _anti_gmail_trim_headers(),
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


def _evac_bundle_signature(sorted_zone_ids: list) -> str:
    """SHA-256 of the sorted zone-id set that triggered this bundled email.
    Same set of zones => same signature => dedup => no duplicate email."""
    joined = "|".join(str(z) for z in sorted_zone_ids)
    return hashlib.sha256(f"evac_bundle:{joined}".encode("utf-8")).hexdigest()[:32]


def _evac_bundle_already_alerted(session, user_id, sig: str) -> bool:
    return session.query(AlertActivity).filter(
        AlertActivity.user_id == user_id,
        AlertActivity.delivery_status == "sent",
        AlertActivity.state_signature == sig,
    ).first() is not None


def _send_multizone_evac_email(
    to_email: str,
    contact_name: str,
    location_name: str,
    location_lat: float,
    location_lon: float,
    county_name: str,
    zone_hits: list,           # [{"props":..., "feature":..., "match":"polygon|county"}]
    nearest_shelters: list,
) -> tuple[str | None, str | None]:
    """Send ONE consolidated evacuation alert listing every zone that
    triggered for this user in the current cron tick, with a static map
    showing the user's location + every zone polygon.

    Replaces the previous per-zone-per-email approach. Bundling is the
    user-requested behavior: 3 zones popping at the same time should
    arrive as 1 email, not 3."""
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

    # Map overlays: per-zone polygons (colored by STATUS so warning vs
    # order matches the live legend) + nearest open shelter pins + user
    # location pin. Same coloring/icons the live dashboard uses.
    zone_overlays = [
        {
            "rings":  _polygon_rings_from_feature(zh.get("feature") or {}),
            "status": str((zh.get("props") or {}).get("STATUS", "")),
        }
        for zh in zone_hits
    ]
    shelter_pins = []
    for s in (nearest_shelters or []):
        if s.get("latitude") is None or s.get("longitude") is None:
            continue
        shelter_pins.append({
            "lat": float(s["latitude"]),
            "lon": float(s["longitude"]),
            # facility_usage_code drives the pin icon (EVAC blue 🏃,
            # POST green 🏠, BOTH purple 🏛️) — same as live dashboard.
            "usage_code": str(s.get("facility_usage_code", "")).upper(),
        })
    map_url = _static_map_url(
        location_lat, location_lon,
        zone_overlays=zone_overlays,
        shelter_pins=shelter_pins,
        zoom=10,
    )

    # Per-zone card: order vs warning, zone name, event, match reason.
    def _zone_card(zh):
        p = zh.get("props") or {}
        is_order = "ORDER" in str(p.get("STATUS", "")).upper()
        banner = "#7f1d1d" if is_order else "#d97706"
        label = "EVACUATION ORDER" if is_order else "EVACUATION WARNING"
        zone_name = p.get("ZONE_NAME") or p.get("ZONE_ID") or "Zone"
        event = p.get("EVENT") or p.get("HEADLINE") or ""
        match_text = ("contains your saved location (polygon match)"
                      if zh.get("match") == "polygon"
                      else f"adjacent zone in {county_name} County")
        return (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
            f'style="margin:0 0 12px 0;border:1px solid #eeeeee;border-left:4px solid {banner};">'
            '<tr><td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;">'
            f'<p style="margin:0;font-size:11px;font-weight:bold;color:{banner};letter-spacing:1px;text-transform:uppercase">{label}</p>'
            f'<p style="margin:4px 0 0;font-size:15px;font-weight:bold;color:#222222">{html_escape(zone_name)}</p>'
            f'<p style="margin:2px 0 0;font-size:13px;color:#555555">{html_escape(event)}</p>'
            f'<p style="margin:6px 0 0;font-size:12px;color:#888888">{html_escape(match_text)}</p>'
            '</td></tr></table>'
        )

    # Order: polygon matches first (most urgent), then county matches; orders before warnings.
    def _zone_sort_key(zh):
        p = zh.get("props") or {}
        polygon_first = 0 if zh.get("match") == "polygon" else 1
        order_first = 0 if "ORDER" in str(p.get("STATUS", "")).upper() else 1
        return (polygon_first, order_first)
    zone_hits = sorted(zone_hits, key=_zone_sort_key)
    zone_cards = "".join(_zone_card(zh) for zh in zone_hits)

    n_orders = sum(1 for zh in zone_hits if "ORDER" in str((zh.get("props") or {}).get("STATUS", "")).upper())
    n_warnings = len(zone_hits) - n_orders
    zone_count_summary = (
        f"{n_orders} order{'s' if n_orders != 1 else ''}, "
        f"{n_warnings} warning{'s' if n_warnings != 1 else ''}"
    )
    has_polygon_match = any(zh.get("match") == "polygon" for zh in zone_hits)

    critical = (
        "LEAVE NOW. Take pets, medications, and important documents. Do not return until evacuation orders are lifted."
        if has_polygon_match else
        "Active evacuation orders in your county. Stay alert — be prepared to evacuate if conditions change."
    )

    # Shelter rows
    shelter_rows = "".join(
        '<tr>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eeeeee;font-family:Arial,Helvetica,sans-serif">{html_escape(s.get("shelter_name",""))}</td>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eeeeee;font-size:12px;color:#666666;font-family:Arial,Helvetica,sans-serif">'
        f'{html_escape(s.get("address_1",""))}, {html_escape(s.get("city",""))}</td>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eeeeee;text-align:right;font-size:12px;font-family:Arial,Helvetica,sans-serif">{s.get("_km",0):.1f} km</td>'
        '</tr>'
        for s in nearest_shelters
    ) or '<tr><td colspan="3" style="padding:10px;color:#888888;font-size:12px;font-family:Arial,Helvetica,sans-serif">No open shelters reported nearby right now &mdash; check CalOES.</td></tr>'

    intro_line = (
        f'<strong>{len(zone_hits)} evacuation zones</strong> active around your saved location '
        f'<strong>{html_escape(location_name)}</strong> ({zone_count_summary}).'
    ) if len(zone_hits) > 1 else (
        f'An <strong>evacuation zone</strong> is active around your saved location '
        f'<strong>{html_escape(location_name)}</strong> ({zone_count_summary}).'
    )

    body_inner = (
        f'<p style="margin:0 0 12px;font-size:14px;">Hi {html_escape(name)},</p>'
        f'<p style="margin:0 0 14px;font-size:15px;line-height:1.45;">{intro_line}</p>'

        # Map → links to live dashboard
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        'style="margin:0 0 14px 0;border:1px solid #eeeeee;">'
        '<tr><td align="center" style="padding:0;line-height:0;">'
        '<a href="https://firescope.dev" style="text-decoration:none;display:block;">'
        f'<img src="{map_url}" alt="Live map: your location + evacuation zones — click to open dashboard" '
        f'width="600" height="300" style="display:block;width:100%;max-width:600px;height:auto;border:0;" />'
        '</a></td></tr>'
        '<tr><td style="padding:6px 12px;font-size:11px;color:#888888;background-color:#fafafa;font-family:Arial,Helvetica,sans-serif">'
        'Red marker = your saved location &middot; red shaded areas = active evacuation zones &middot; '
        '<a href="https://firescope.dev" style="color:#dc2626;text-decoration:underline">tap to open the live dashboard</a>'
        '</td></tr></table>'

        # Critical callout
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        'style="margin:0 0 14px 0;background-color:#fef2f2;border-left:3px solid #dc2626">'
        '<tr><td style="padding:10px 14px;font-size:13px;color:#7f1d1d;font-family:Arial,Helvetica,sans-serif">'
        f'{html_escape(critical)}</td></tr></table>'

        '<p style="margin:8px 0 8px;font-size:13px;font-weight:bold;color:#555555;font-family:Arial,Helvetica,sans-serif">Active evacuation zones</p>'
        f'{zone_cards}'

        '<p style="margin:18px 0 6px;font-size:13px;font-weight:bold;color:#555555;font-family:Arial,Helvetica,sans-serif">Nearest open shelters</p>'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        'style="border-collapse:collapse;border:1px solid #eeeeee;">'
        f'{shelter_rows}'
        '</table>'
    )

    header_label = (f"{len(zone_hits)} EVACUATION ZONES" if len(zone_hits) > 1
                    else ("EVACUATION ORDER" if n_orders else "EVACUATION WARNING"))
    header_bg = "#7f1d1d" if n_orders else "#d97706"

    html = _email_shell(
        header_bg=header_bg,
        header_label=header_label,
        header_title=f"{html_escape(county_name)} County",
        header_subtitle=zone_count_summary,
        body_inner_html=body_inner,
        footer_text="Manage the Evacuation channel at firescope.dev &rarr; Alerts.",
    )

    # Plain-text fallback
    text_lines = [f"{len(zone_hits)} evacuation zone(s) active near {location_name} ({county_name} County).", ""]
    for zh in zone_hits:
        p = zh.get("props") or {}
        is_order = "ORDER" in str(p.get("STATUS", "")).upper()
        text_lines.append(f"  [{('ORDER' if is_order else 'WARNING')}] {p.get('ZONE_NAME','Zone')} — {p.get('EVENT','')}")
    text_lines.append("")
    text_lines.append(critical)
    text_lines.append("")
    text_lines.append("Nearest open shelters:")
    if nearest_shelters:
        for s in nearest_shelters:
            text_lines.append(f"  - {s.get('shelter_name','')} ({s.get('city','')}) — {s.get('_km',0):.1f} km")
    else:
        text_lines.append("  (none reported nearby)")
    text_lines.append("")
    text_lines.append("Live map: https://firescope.dev")
    text = "\n".join(text_lines)

    subject_zone_name = (zone_hits[0].get("props") or {}).get("ZONE_NAME") or "your area"
    if len(zone_hits) > 1:
        subject = f"FireScope: {len(zone_hits)} evacuation zones in {county_name} County ({zone_count_summary})"
    else:
        subject = f"FireScope: {('EVACUATION ORDER' if n_orders else 'EVACUATION WARNING')} — {subject_zone_name}"

    try:
        resp = resend.Emails.send({
            "from": f"{sender_name} <{sender_email}>",
            "to": [to_email],
            "subject": subject,
            "html": html,
            "text": text,
            "headers": _anti_gmail_trim_headers(),
        })
        return resp.get("id"), None
    except Exception as e:
        logger.warning("resend send (multizone evac) failed: %s", e)
        return None, str(e)


# Kept as a thin alias for any external callers — production code uses the
# multizone path directly via run_evacuation_alerts.
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
        f'<tr>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eeeeee;font-family:Arial,Helvetica,sans-serif">{html_escape(s.get("shelter_name",""))}</td>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eeeeee;font-size:12px;color:#666666;font-family:Arial,Helvetica,sans-serif">'
        f'{html_escape(s.get("address_1",""))}, {html_escape(s.get("city",""))}</td>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eeeeee;text-align:right;font-size:12px;font-family:Arial,Helvetica,sans-serif">{s.get("_km",0):.1f} km</td>'
        f'</tr>'
        for s in nearest_shelters
    ) or '<tr><td colspan="3" style="padding:10px;color:#888888;font-size:12px;font-family:Arial,Helvetica,sans-serif">No open shelters reported nearby right now &mdash; check CalOES.</td></tr>'

    banner_color = "#7f1d1d" if is_order else "#d97706"
    banner_label = "EVACUATION ORDER" if is_order else "EVACUATION WARNING"

    # Critical-info callout as a table row (not a div) for Gmail compat.
    critical_row = (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        f'style="margin:0 0 14px 0;background-color:#fef2f2;border-left:3px solid #dc2626">'
        f'<tr><td style="padding:10px 14px;font-size:13px;color:#7f1d1d;font-family:Arial,Helvetica,sans-serif">'
        f'{html_escape(critical)}</td></tr></table>'
    ) if critical else ''
    public_row = (
        f'<p style="margin:0 0 18px 0;font-size:13px;color:#444444;">{html_escape(public)}</p>'
    ) if public else ''

    body_inner = (
        f'<p style="margin:0 0 12px;font-size:14px;">Hi {html_escape(name)},</p>'
        f'<p style="margin:0 0 14px;font-size:15px;">{proximity_line}</p>'
        f'{critical_row}'
        f'{public_row}'
        '<p style="margin:6px 0 6px;font-size:13px;font-weight:bold;color:#555555;">Nearest open shelters</p>'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        'style="border-collapse:collapse;border:1px solid #eeeeee;">'
        f'{shelter_rows}'
        '</table>'
    )
    html = _email_shell(
        header_bg=banner_color,
        header_label=banner_label,
        header_title=f"{html_escape(zone_name)} ({html_escape(county)})",
        header_subtitle=html_escape(event),
        body_inner_html=body_inner,
        footer_text="Manage the Evacuation channel at firescope.dev &rarr; Alerts.",
    )
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
            "headers": _anti_gmail_trim_headers(),
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
        f'<tr>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eeeeee;font-weight:bold;font-family:Arial,Helvetica,sans-serif">{html_escape(s.get("shelter_name",""))}</td>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eeeeee;font-size:12px;color:#666666;font-family:Arial,Helvetica,sans-serif">'
        f'{html_escape(s.get("address_1",""))}, {html_escape(s.get("city",""))} ({html_escape(str(s.get("county_parish","")).title())} County)</td>'
        f'<td style="padding:8px 12px;border-bottom:1px solid #eeeeee;text-align:right;font-size:12px;font-family:Arial,Helvetica,sans-serif">{s.get("evacuation_capacity") or "&mdash;"}</td>'
        f'</tr>'
        for s in shelters
    )
    county_list = ", ".join(sorted({c.title() for _, c in location_county_pairs}))
    n_unique_counties = len(set(c for _, c in location_county_pairs))
    n_unique_locations = len(set(loc for loc, _ in location_county_pairs))
    s_plural = "s" if len(shelters) != 1 else ""
    have_plural = "have" if len(shelters) != 1 else "has"
    contain_plural = "contain" if n_unique_counties > 1 else "contains"
    loc_plural = "s" if n_unique_locations > 1 else ""

    body_inner = (
        f'<p style="margin:0 0 12px;font-size:14px;">Hi {html_escape(name)},</p>'
        f'<p style="margin:0 0 14px;font-size:14px;line-height:1.45;">'
        f'{len(shelters)} shelter{s_plural} {have_plural} been reported open in '
        f'<strong>{html_escape(county_list)}</strong>, which {contain_plural} your saved '
        f'location{loc_plural}.</p>'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        'style="border-collapse:collapse;border:1px solid #eeeeee;font-size:13px;">'
        '<tr style="background-color:#fafafa;">'
        '<th align="left" style="padding:8px 12px;font-size:11px;color:#888888;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif">Shelter</th>'
        '<th align="left" style="padding:8px 12px;font-size:11px;color:#888888;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif">Where</th>'
        '<th align="right" style="padding:8px 12px;font-size:11px;color:#888888;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif">Capacity</th>'
        '</tr>'
        f'{rows}'
        '</table>'
    )
    html = _email_shell(
        header_bg="#16a34a",
        header_label="SHELTER UPDATE",
        header_title=f"{len(shelters)} open shelter{s_plural} near you",
        body_inner_html=body_inner,
        footer_text="You're getting this because the Evacuation channel is on (shelters travel with it). "
                    "Manage at firescope.dev &rarr; Alerts.",
        link_color="#16a34a",
    )
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
            "headers": _anti_gmail_trim_headers(),
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

        # ── Multi-zone bundling ───────────────────────────────────────────
        # Pick the primary location for this user's bundle: prefer a
        # polygon-match location (life-safety), otherwise the first county
        # match. The static map centers on this location.
        polygon_hit = next((h for h in per_zone_hits.values() if h[2] == "polygon"), None)
        primary_loc, _, _ = polygon_hit or list(per_zone_hits.values())[0]

        # Dedup signature is the SORTED set of zone IDs in this bundle. If
        # the user already got an email for this exact zone set, skip.
        bundle_sig = _evac_bundle_signature(sorted(per_zone_hits.keys()))
        if _evac_bundle_already_alerted(session, user.id, bundle_sig):
            skipped_dedup += 1
            continue

        # Three nearest open shelters to the primary location.
        ranked = []
        for s in shelters:
            try:
                d = _haversine_km(primary_loc.lat, primary_loc.lon,
                                  float(s["latitude"]), float(s["longitude"]))
            except (TypeError, ValueError):
                continue
            ranked.append({**s, "_km": d})
        ranked.sort(key=lambda r: r["_km"])
        nearest = ranked[:EVAC_NEAREST_SHELTERS]

        # County name for the email header (most common county across hits).
        from collections import Counter
        county_name = Counter(
            str((feat.get("properties") or {}).get("COUNTY", "")).title()
            for _, feat, _ in per_zone_hits.values()
        ).most_common(1)[0][0] or "your area"

        to_email = (pref.contact_email or user.email or "").strip()
        if not to_email:
            errors += 1
            continue

        zone_hits_payload = [
            {"props": feat.get("properties") or {}, "feature": feat, "match": match_kind}
            for _loc, feat, match_kind in per_zone_hits.values()
        ]
        msg_id, send_err = _send_multizone_evac_email(
            to_email=to_email,
            contact_name=getattr(user, "name", None) or "",
            location_name=primary_loc.name,
            location_lat=primary_loc.lat,
            location_lon=primary_loc.lon,
            county_name=county_name,
            zone_hits=zone_hits_payload,
            nearest_shelters=nearest,
        )
        status = "sent" if msg_id else "failed"
        has_order = any(
            "ORDER" in str((zh.get("props") or {}).get("STATUS", "")).upper()
            for zh in zone_hits_payload
        )
        session.add(AlertActivity(
            user_id=user.id,
            risk_level=99 if has_order else 80,
            delivery_status=status,
            reason=(f"evac_bundle:{len(per_zone_hits)}zones"
                    if msg_id else f"evac_bundle_err:{(send_err or '')[:24]}"),
            state_signature=bundle_sig,
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


# ───────────────────────── WILDFIRES IN YOUR COUNTY (Slice 1D) ─────────────────────────
#
# Cron-driven alerts when an active CAL FIRE incident is in a county that
# contains one of the user's saved locations. Bundles every county-matching
# fire into ONE email per user per tick (like the multi-zone evac). Fires
# again whenever a fire's status / containment-bucket / acres-bucket changes
# (containment crosses 10/20/.../100%, acres grows past the next 100-acre
# bucket, or IsActive flips) — i.e. real "updates" that matter to the user,
# not every tiny acreage tick.
#
# Source: CAL FIRE incidents proxy at /api/calfire/incidents?inactive=false,
# already cached server-side via services.cache.serve_cached. We fetch
# in-process (not via HTTP self-call) to avoid the gunicorn-worker deadlock
# the same way the evac and high-risk channels do.

FIRE_NEAREST_PERIMETERS_ON_MAP = 5   # cap polygon overlays drawn on the map


def _norm_county(name: str) -> str:
    """Normalize a county name: lower, strip 'County', collapse whitespace.
    Lets 'Los Angeles', 'Los Angeles County', and 'LOS ANGELES' all match."""
    s = (name or "").strip().lower()
    if s.endswith(" county"):
        s = s[:-7].strip()
    return " ".join(s.split())


def _fetch_active_fires() -> list:
    """Return the cached list of active CAL FIRE incidents (in-process)."""
    from services.cache import get_cached_data
    try:
        cached = get_cached_data("calfire_incidents:false")
        if cached and isinstance(cached, list):
            return cached
    except Exception as e:
        logger.warning("calfire cache read failed: %s", e)
    # Fallback: live compute. Slower but keeps the cron functional even
    # if the cache hasn't been warmed yet on a fresh deploy.
    try:
        from routes.predict import _compute_calfire
        return _compute_calfire("false") or []
    except Exception as e:
        logger.warning("calfire live compute fallback failed: %s", e)
        return []


def _fetch_nifc_perimeters() -> dict:
    """Return cached NIFC fire-perimeters GeoJSON FeatureCollection so we
    can overlay each fire's real polygon on the static map (instead of
    falling back to an acreage-derived circle).

    Cache key matches the public /api/fire-perimeters endpoint in
    routes/predict.py (`cache_key='fire_perimeters'`). The fire-alert
    cron and the dashboard fire-perimeter overlay both read THIS row —
    same bytes, same polygons, same coordinates the dashboard renders.
    Previously used 'nifc_perimeters' which never existed; every fire
    silently fell back to the synthetic acreage circle, which is what
    the recipient saw in production (commit before 9e2e604).
    """
    from services.cache import get_cached_data
    try:
        cached = get_cached_data("fire_perimeters")
        if cached and isinstance(cached, dict) and "features" in cached:
            return cached
    except Exception as e:
        logger.warning("fire_perimeters cache read failed: %s", e)
    # Fallback: live compute. Keeps the cron functional on a cold deploy.
    try:
        from routes.predict import _compute_nifc_perimeters
        return _compute_nifc_perimeters()
    except Exception as e:
        logger.warning("nifc perimeters live compute fallback failed: %s", e)
        return {"type": "FeatureCollection", "features": []}


_CA_COUNTY_OUTLINE_CACHE: list | None = None


def _ca_county_outline_rings(
    near_lat: float | None = None,
    near_lon: float | None = None,
    radius_deg: float = 2.5,
) -> list:
    """Return downsampled outer rings for CA counties as
    [(centroid_lat, centroid_lon, ring), ...] then filtered to those
    whose centroid is within `radius_deg` of (near_lat, near_lon).
    When near is None, returns ALL — but that overflows Mapbox's 8KB
    URL cap, so callers should pass a center.

    Per-county simplifications used to stay under the URL cap:
      - Outer ring of the FIRST polygon only (drop island sub-polys
        like Catalina off LA County — saves ~30% of total points)
      - Downsample to 8 points per ring (was 12; for 8KB URL safety)
      - Filter by centroid distance so a typical fire-alert email
        only embeds the 8-15 counties actually near the user
    Loaded + cached once per process.
    """
    global _CA_COUNTY_OUTLINE_CACHE
    if _CA_COUNTY_OUTLINE_CACHE is None:
        cache = []
        try:
            import json
            from pathlib import Path
            here = Path(__file__).resolve().parent.parent  # backend/
            path = here / "data" / "boundaries" / "counties.json"
            d = json.load(open(path))
            TARGET_POINTS = 8
            for f in d.get("features", []):
                g = f.get("geometry") or {}
                if g.get("type") == "Polygon":
                    poly = g.get("coordinates") or []
                elif g.get("type") == "MultiPolygon":
                    # Take only the FIRST sub-polygon (mainland for
                    # most counties; the few with islands lose their
                    # island in the outline but the mainland is what
                    # matters for a 600px-wide email map).
                    polys = g.get("coordinates") or []
                    poly = polys[0] if polys else []
                else:
                    continue
                if not poly:
                    continue
                outer = poly[0]
                step = max(1, len(outer) // TARGET_POINTS)
                ds = outer[::step]
                ring = [(float(lat), float(lon)) for lon, lat in ds]
                if len(ring) < 3:
                    continue
                clat = sum(p[0] for p in ring) / len(ring)
                clon = sum(p[1] for p in ring) / len(ring)
                cache.append((clat, clon, ring))
        except Exception as e:
            logger.warning("CA county outline load failed: %s", e)
        _CA_COUNTY_OUTLINE_CACHE = cache

    if near_lat is None or near_lon is None:
        return [r for _, _, r in _CA_COUNTY_OUTLINE_CACHE]
    return [
        r for clat, clon, r in _CA_COUNTY_OUTLINE_CACHE
        if abs(clat - near_lat) <= radius_deg and abs(clon - near_lon) <= radius_deg
    ]


def _fire_match_key(name: str) -> str:
    """Normalized lookup key for matching CAL FIRE incident names to NIFC
    perimeter `poly_IncidentName`.

    CAL FIRE consistently suffixes ' Fire' on incident names
    ('Santa Rosa Island Fire', 'Sandy Fire'), NIFC consistently does
    NOT ('Santa Rosa Island', 'Sandy'). Without stripping the suffix
    NONE of the active CAL FIRE incidents resolved to a NIFC polygon
    in production on 2026-05-27 — the map fell back to the synthetic
    circle for every fire.

    Strip:
      - all non-alphanumerics (case-insensitive)
      - a trailing 'fire' token if present on EITHER side
    Applied symmetrically to both feeds so the names collide.
    """
    from routes.predict import _norm_fire_name
    nm = _norm_fire_name(name)
    if nm.endswith("fire"):
        nm = nm[:-4]
    return nm


def _index_perimeters_by_name(perim_fc: dict) -> dict:
    """{match_key: perimeter_feature} lookup for fast CAL FIRE -> NIFC
    polygon matching. Uses _fire_match_key() symmetrically (see its
    docstring for why the trailing-'fire' suffix has to come off)."""
    idx = {}
    for f in (perim_fc.get("features") or []):
        p = f.get("properties") or {}
        # NIFC uses poly_IncidentName; legacy rows use IncidentName.
        name = p.get("poly_IncidentName") or p.get("IncidentName") or p.get("attr_IncidentName")
        if not name:
            continue
        key = _fire_match_key(name)
        if key and key not in idx:
            idx[key] = f
    return idx


def _matched_perimeter_for(fire: dict, perim_idx: dict):
    """Return the matching NIFC perimeter feature (or None) for a CAL
    FIRE incident, using the suffix-stripped match key."""
    key = _fire_match_key(fire.get("Name", ""))
    return perim_idx.get(key) if key else None


def _fire_bucket(pct, size):
    """Per-fire dedup tuple: (containment_10pct_bucket, acres_100_bucket).
    Buckets so we only re-alert on meaningful change, not every cron tick."""
    try:
        c = int(float(pct or 0) // 10) * 10
    except (TypeError, ValueError):
        c = 0
    try:
        a = int(float(size or 0) // 100) * 100
    except (TypeError, ValueError):
        a = 0
    return c, a


def _fire_per_alert_sig(fire: dict) -> str:
    """Per-fire fingerprint: id + status bucket + containment bucket + acres bucket.
    Two fires with the same fingerprint are 'the same alert state' — no resend."""
    uid = str(fire.get("UniqueId") or fire.get("Name") or "")
    active = bool(fire.get("IsActive", True))
    c_bucket, a_bucket = _fire_bucket(fire.get("PercentContained"), fire.get("AcresBurned"))
    raw = f"fire:{uid}:active={active}:c={c_bucket}:a={a_bucket}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _fire_bundle_sig(fires: list) -> str:
    """Bundle fingerprint = SHA-256 of every fire's per-alert sig sorted.
    If the same exact set of fires in the same state is bundled, dedup."""
    joined = "|".join(sorted(_fire_per_alert_sig(f) for f in fires))
    return hashlib.sha256(f"fire_bundle:{joined}".encode("utf-8")).hexdigest()[:32]


def _fire_bundle_already_alerted(session, user_id, sig: str) -> bool:
    return session.query(AlertActivity).filter(
        AlertActivity.user_id == user_id,
        AlertActivity.delivery_status == "sent",
        AlertActivity.state_signature == sig,
    ).first() is not None


def _fire_closed_marker_sig(fire_id: str) -> str:
    """A separate dedup signature recorded the FIRST time we send a
    bundled email containing a fire at 100% containment. Once present,
    that fire is permanently excluded from future bundles for the same
    user — the recipient gets one final 'fully contained' email then
    silence, even if the upstream feed keeps re-listing the fire."""
    return hashlib.sha256(f"fire_closed:{fire_id}".encode("utf-8")).hexdigest()[:32]


def _fires_already_closed_for_user(session, user_id) -> set:
    """Set of fire UniqueIds we've already sent a 'fully contained'
    closing email about for this user. These are filtered out of every
    future bundle."""
    rows = (
        session.query(AlertActivity.state_signature)
        .filter(
            AlertActivity.user_id == user_id,
            AlertActivity.delivery_status == "sent",
            AlertActivity.reason.like("fire_closed:%"),
        )
        .all()
    )
    return {r[0] for r in rows if r[0]}


def _send_fire_alert_email(
    to_email: str,
    contact_name: str,
    primary_location_name: str,
    primary_lat: float,
    primary_lon: float,
    county_label: str,
    fires: list,
    perim_idx: dict | None = None,
) -> tuple[str | None, str | None]:
    """ONE consolidated email listing every active CAL FIRE incident in a
    county that contains one of the user's saved locations. Map shows
    the user's location pin + a fire-perimeter circle per incident.
    """
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

    # Map overlays: prefer the REAL NIFC perimeter polygon for each fire
    # (matched by normalized name). Fall back to an acreage-derived
    # circle ONLY when no perimeter row exists for that fire (very new
    # incidents and out-of-state fires sometimes miss). Status color is
    # picked per-fire: red for active/uncontained, green for 100%
    # contained — same convention the live dashboard uses.
    perim_idx = perim_idx or {}
    zone_overlays = []
    for f in fires[:FIRE_NEAREST_PERIMETERS_ON_MAP]:
        try:
            pct = float(f.get("PercentContained") or 0)
        except (TypeError, ValueError):
            pct = 0
        # Contained fires use the same green styling as the live
        # post-impact shelter color so the recipient instantly reads
        # "fire is over."
        status_str = "ADVISORY" if pct >= 100 else "ORDER"

        # Try real perimeter first.
        perim_feat = _matched_perimeter_for(f, perim_idx)
        if perim_feat:
            rings = _polygon_rings_from_feature(perim_feat)
            if rings:
                zone_overlays.append({"rings": rings, "status": status_str})
                continue

        # Fallback: synthetic circle from acreage.
        lat = f.get("Latitude"); lon = f.get("Longitude")
        if lat is None or lon is None:
            continue
        acres = float(f.get("AcresBurned") or 0)
        radius_m = max(1000.0, min(20000.0, (acres * 4047.0 / 3.14159) ** 0.5))
        try:
            from routes.predict import _circle_polygon
            ring_lonlat = _circle_polygon(float(lat), float(lon), radius_m, n=32)
            ring = [(p[1], p[0]) for p in ring_lonlat]  # lon,lat -> lat,lon
            zone_overlays.append({"rings": [ring], "status": status_str})
        except Exception:
            continue
    # Compute the bbox of every fire polygon ring so we can decide whether
    # the user's location pin makes sense to include. If the user is INSIDE
    # the fire bounding box, include the pin so the map shows 'these fires
    # are right at your saved spot.' If they're outside (e.g. user saved
    # location is in coastal Santa Barbara but the fire is on Santa Rosa
    # Island 30km offshore), omit the pin so Mapbox auto-frames to just
    # the fires — otherwise the auto-frame zooms way out to cover both
    # and every polygon becomes tiny.
    fire_lats = [p[0] for zo in zone_overlays for ring in zo.get("rings", []) for p in ring]
    fire_lons = [p[1] for zo in zone_overlays for ring in zo.get("rings", []) for p in ring]
    user_inside_frame = bool(fire_lats) and bool(fire_lons) and (
        min(fire_lats) <= primary_lat <= max(fire_lats)
        and min(fire_lons) <= primary_lon <= max(fire_lons)
    )

    map_url = _static_map_url(
        primary_lat, primary_lon,
        zone_overlays=zone_overlays,
        shelter_pins=None,  # no shelter overlay for fire alerts
        zoom="auto",
        include_user_pin=user_inside_frame,
        county_lines=True,   # show all CA county boundaries as a base layer
    )

    # Per-fire card
    def _fire_card(f):
        fname = f.get("Name") or "Unnamed fire"
        county = f.get("County") or "—"
        acres = f.get("AcresBurned")
        pct = f.get("PercentContained")
        updated = (f.get("Updated") or "")[:16].replace("T", " ")
        url = f.get("Url") or "https://firescope.dev"
        active = bool(f.get("IsActive", True))
        banner = "#dc2626" if active and (pct is None or float(pct) < 100) else "#16a34a"
        status_label = "ACTIVE" if active else "INACTIVE"
        if pct is not None:
            try:
                if float(pct) >= 100:
                    status_label = "100% CONTAINED"
            except (TypeError, ValueError):
                pass
        acres_str = f"{int(acres):,} acres" if acres not in (None, 0) else "Size pending"
        pct_str = f"{int(float(pct))}% contained" if pct is not None else "Containment pending"
        return (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
            f'style="margin:0 0 12px 0;border:1px solid #eeeeee;border-left:4px solid {banner};">'
            '<tr><td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;">'
            f'<p style="margin:0;font-size:11px;font-weight:bold;color:{banner};letter-spacing:1px;text-transform:uppercase">{status_label}</p>'
            f'<p style="margin:4px 0 0;font-size:15px;font-weight:bold;color:#222222">'
            f'<a href="{html_escape(url)}" style="color:#222222;text-decoration:none">{html_escape(fname)}</a></p>'
            f'<p style="margin:2px 0 0;font-size:13px;color:#555555">{html_escape(acres_str)} &middot; {html_escape(pct_str)}</p>'
            f'<p style="margin:6px 0 0;font-size:12px;color:#888888">{html_escape(county)} County &middot; updated {html_escape(updated)} UTC</p>'
            '</td></tr></table>'
        )

    # Sort: active first, then by acres descending so the biggest is on top
    fires_sorted = sorted(
        fires,
        key=lambda f: (
            0 if f.get("IsActive", True) else 1,
            -(float(f.get("AcresBurned") or 0)),
        ),
    )
    cards = "".join(_fire_card(f) for f in fires_sorted)

    n = len(fires)
    n_active = sum(1 for f in fires if f.get("IsActive", True))
    # A "fully contained" fire = PercentContained >= 100. We tag the
    # bundle so the email header/subject can lead with the closing
    # message when this is the final alert for that fire.
    def _pct(f):
        try: return float(f.get("PercentContained") or 0)
        except (TypeError, ValueError): return 0
    n_contained = sum(1 for f in fires if _pct(f) >= 100)
    summary_parts = []
    if n_active: summary_parts.append(f"{n_active} active")
    if n_contained: summary_parts.append(f"{n_contained} fully contained")
    if not summary_parts: summary_parts.append(f"{n} fire" + ("s" if n != 1 else ""))
    summary = ", ".join(summary_parts)

    # Special-case copy when EVERY fire in this bundle is fully contained —
    # this is the recipient's final notification before we go silent.
    all_contained = n_contained == n and n > 0
    if all_contained:
        intro_line = (
            f'Good news — '
            f'{"all of " if n > 1 else ""}the wildfire{"s" if n > 1 else ""} we were tracking in '
            f'<strong>{html_escape(county_label)} County</strong> '
            f'{"have" if n > 1 else "has"} reached <strong>100% containment</strong>. '
            f'This is your final update — you will not receive further emails about '
            f'{"these fires" if n > 1 else "this fire"}.'
        )
    elif n > 1:
        intro_line = (
            f'<strong>{n} wildfires</strong> active in '
            f'<strong>{html_escape(county_label)} County</strong>, which contains your saved location '
            f'<strong>{html_escape(primary_location_name)}</strong> ({summary}).'
        )
    else:
        intro_line = (
            f'A wildfire is active in <strong>{html_escape(county_label)} County</strong>, '
            f'which contains your saved location <strong>{html_escape(primary_location_name)}</strong>.'
        )

    body_inner = (
        f'<p style="margin:0 0 12px;font-size:14px;">Hi {html_escape(name)},</p>'
        f'<p style="margin:0 0 14px;font-size:15px;line-height:1.45;">{intro_line}</p>'

        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        'style="margin:0 0 14px 0;border:1px solid #eeeeee;">'
        '<tr><td align="center" style="padding:0;line-height:0;">'
        '<a href="https://firescope.dev" style="text-decoration:none;display:block;">'
        f'<img src="{map_url}" alt="Live map: your location + active fire incidents — click to open dashboard" '
        f'width="600" height="300" style="display:block;width:100%;max-width:600px;height:auto;border:0;" />'
        '</a></td></tr>'
        '<tr><td style="padding:6px 12px;font-size:11px;color:#888888;background-color:#fafafa;font-family:Arial,Helvetica,sans-serif">'
        + (
            'Blue circle = your saved location &middot; red shaded areas = active wildfire perimeters'
            if user_inside_frame else
            'Red shaded areas = active wildfire perimeters in your county (your saved location is outside the map frame)'
        ) +
        ' &middot; <a href="https://firescope.dev" style="color:#dc2626;text-decoration:underline">tap to open the live dashboard</a>'
        '</td></tr></table>'

        '<p style="margin:8px 0 8px;font-size:13px;font-weight:bold;color:#555555;font-family:Arial,Helvetica,sans-serif">Active fires in your county</p>'
        f'{cards}'

        '<p style="margin:18px 0 0;font-size:12px;color:#888888;line-height:1.4;font-family:Arial,Helvetica,sans-serif">'
        "You'll get an update email when containment, status, or size meaningfully changes "
        "(every 10 percent containment, new 100-acre bracket, or status flip)."
        '</p>'
    )

    # Header: green + closing label when every fire is contained,
    # red + count when there are still active fires.
    if all_contained:
        header_bg = "#16a34a"
        header_label = (
            "FIRE FULLY CONTAINED" if n == 1
            else f"ALL {n} FIRES FULLY CONTAINED"
        )
    else:
        header_bg = "#dc2626"
        header_label = f"{n} FIRE{'S' if n != 1 else ''} IN YOUR COUNTY"

    html = _email_shell(
        header_bg=header_bg,
        header_label=header_label,
        header_title=f"{html_escape(county_label)} County",
        header_subtitle=summary,
        body_inner_html=body_inner,
        footer_text="Manage the Wildfires-in-your-county channel at firescope.dev &rarr; Alerts.",
    )

    text_lines = [f"{n} active wildfire(s) in {county_label} County containing your saved location {primary_location_name}.", ""]
    for f in fires_sorted:
        nm = f.get("Name", "Unnamed")
        ac = f.get("AcresBurned"); pc = f.get("PercentContained")
        text_lines.append(f"  - {nm}: {int(ac) if ac else '?'} acres, {int(float(pc)) if pc is not None else '?'}% contained")
    text_lines.append("")
    text_lines.append("Live map: https://firescope.dev")
    text = "\n".join(text_lines)

    primary_fire_name = fires_sorted[0].get("Name", "your area") if fires_sorted else "your area"
    if all_contained:
        subject = (
            f"FireScope: {primary_fire_name} 100% contained — final update"
            if n == 1 else
            f"FireScope: All {n} fires in {county_label} County fully contained — final update"
        )
    elif n > 1:
        subject = f"FireScope: {n} active fires in {county_label} County ({primary_fire_name})"
    else:
        subject = f"FireScope: {primary_fire_name} active in {county_label} County"

    try:
        resp = resend.Emails.send({
            "from": f"{sender_name} <{sender_email}>",
            "to": [to_email],
            "subject": subject,
            "html": html,
            "text": text,
            "headers": _anti_gmail_trim_headers(),
        })
        return resp.get("id"), None
    except Exception as e:
        logger.warning("resend send (fire alert) failed: %s", e)
        return None, str(e)


@internal_alerts_bp.route("/internal/alerts/fires", methods=["POST"])
def run_fire_alerts():
    """Cron-driven wildfires-in-your-county alerts. Bundles every active
    CAL FIRE incident in any county containing a user's saved location
    into one email per user per tick, with change-driven dedup."""
    ok, err = _require_internal_token()
    if not ok:
        return jsonify({"error": err}), 401

    session = db.session
    fires = _fetch_active_fires()
    # Pre-fetch + index NIFC perimeters once per cron tick so every user
    # in the loop reuses the same index instead of paying for it N times.
    perim_idx = _index_perimeters_by_name(_fetch_nifc_perimeters())
    scanned = 0
    sent = 0
    skipped_dedup = 0
    skipped_no_overlap = 0
    skipped_closed = 0
    errors = 0
    sent_ids = []

    if not fires:
        return jsonify({
            "scanned_users": 0,
            "active_fires": 0,
            "sent": 0,
            "skipped_dedup": 0,
            "skipped_no_overlap": 0,
            "skipped_closed": 0,
            "errors": 0,
            "sent_message_ids": [],
        })

    # Index fires by normalized county for O(1) per-user lookup.
    fires_by_county = {}
    for f in fires:
        county = _norm_county(f.get("County", ""))
        if not county:
            continue
        fires_by_county.setdefault(county, []).append(f)

    q = (
        session.query(NotificationPreference, User)
        .join(User, User.id == NotificationPreference.user_id)
        .filter(
            NotificationPreference.opted_in == True,
            NotificationPreference.email_enabled == True,
            NotificationPreference.fire_alerts_enabled == True,
            NotificationPreference.unsubscribed_at.is_(None),
        )
    )
    now = datetime.utcnow()

    for pref, user in q.all():
        scanned += 1
        if pref.paused_until and pref.paused_until > now:
            continue
        locs = session.query(UserLocation).filter(UserLocation.user_id == user.id).all()
        if not locs:
            skipped_no_overlap += 1
            continue

        # Resolve each saved location's county once. Drop duplicates.
        user_counties = {}  # county_norm -> (location, county_display_name)
        for loc in locs:
            try:
                z = resolve_all(loc.lat, loc.lon).get("county")
            except Exception:
                continue
            if not z:
                continue
            cnorm = _norm_county(z.get("name", ""))
            if cnorm and cnorm not in user_counties:
                user_counties[cnorm] = (loc, z["name"])

        # PER-COUNTY BUNDLING. One email per county containing fires —
        # never mix counties in a single email (recipient saw
        # 'Riverside County' subject with a Santa-Barbara fire in the
        # body and asked for the split). Dedup signature is per-county-
        # per-fire-bundle so each county's email fires independently
        # when ITS fire state changes.
        closed_sigs = _fires_already_closed_for_user(session, user.id)
        any_county_had_fires = False
        any_county_sent = False
        any_county_skipped_closed = False

        for cnorm, (loc, display_name) in user_counties.items():
            county_fires = fires_by_county.get(cnorm, [])
            if not county_fires:
                continue
            any_county_had_fires = True

            # Drop fires we've already closed out (one final "fully
            # contained" email then silence).
            county_fires = [
                f for f in county_fires
                if _fire_closed_marker_sig(str(f.get("UniqueId") or f.get("Name") or "")) not in closed_sigs
            ]
            if not county_fires:
                any_county_skipped_closed = True
                continue

            # Per-county bundle signature — include county in the input
            # so the same fire ID in a different county (rare but
            # possible across the state) wouldn't collide.
            bundle_sig = hashlib.sha256(
                f"county:{cnorm}|{_fire_bundle_sig(county_fires)}".encode("utf-8")
            ).hexdigest()[:32]
            if _fire_bundle_already_alerted(session, user.id, bundle_sig):
                skipped_dedup += 1
                continue

            to_email = (pref.contact_email or user.email or "").strip()
            if not to_email:
                errors += 1
                continue

            msg_id, send_err = _send_fire_alert_email(
                to_email=to_email,
                contact_name=getattr(user, "name", None) or "",
                primary_location_name=loc.name,
                primary_lat=loc.lat,
                primary_lon=loc.lon,
                county_label=display_name,
                fires=county_fires,
                perim_idx=perim_idx,
            )
            status = "sent" if msg_id else "failed"
            session.add(AlertActivity(
                user_id=user.id,
                risk_level=90 if any(f.get("IsActive", True) for f in county_fires) else 60,
                delivery_status=status,
                reason=(f"fire_alert:{display_name}:{len(county_fires)}fires"
                        if msg_id else f"fire_alert_err:{(send_err or '')[:24]}"),
                state_signature=bundle_sig,
            ))
            if msg_id:
                sent += 1
                sent_ids.append(msg_id)
                any_county_sent = True
                # Record closing markers for fully-contained fires in
                # this county's bundle.
                for f in county_fires:
                    try:
                        pct = float(f.get("PercentContained") or 0)
                    except (TypeError, ValueError):
                        pct = 0
                    if pct >= 100:
                        fid = str(f.get("UniqueId") or f.get("Name") or "")
                        if fid:
                            session.add(AlertActivity(
                                user_id=user.id,
                                risk_level=10,
                                delivery_status="sent",
                                reason=f"fire_closed:{fid[:24]}",
                                state_signature=_fire_closed_marker_sig(fid),
                            ))
            else:
                errors += 1

        if not any_county_had_fires:
            skipped_no_overlap += 1
        elif not any_county_sent and any_county_skipped_closed:
            # Every matching county had only already-closed fires.
            skipped_closed += 1

    try:
        session.commit()
    except Exception:
        session.rollback()

    return jsonify({
        "scanned_users": scanned,
        "active_fires": len(fires),
        "sent": sent,
        "skipped_dedup": skipped_dedup,
        "skipped_no_overlap": skipped_no_overlap,
        "skipped_closed": skipped_closed,
        "errors": errors,
        "sent_message_ids": sent_ids,
    })
