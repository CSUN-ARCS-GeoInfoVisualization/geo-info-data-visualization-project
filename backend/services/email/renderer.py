"""Jinja2 template rendering for email HTML and text fallbacks."""

import os
from jinja2 import Environment, FileSystemLoader, select_autoescape
from typing import Any, Dict, List, Optional, Tuple


def _risk_level_from_score(score: float) -> str:
    """Map numeric score (0-100) to NFDRS 5-tier label. Matches
    backend/ml/inference.risk_label and frontend lib/riskTiers.ts.
    """
    if score >= 80: return "Extreme"
    if score >= 60: return "Very High"
    if score >= 40: return "High"
    if score >= 20: return "Moderate"
    return "Low"


def _risk_badge_color(score: float) -> str:
    if score >= 80: return "#7f1d1d"
    if score >= 60: return "#dc2626"
    if score >= 40: return "#f97316"
    if score >= 20: return "#facc15"
    return "#22c55e"


# Tier-specific urgency copy — keyed by floor score, resolved top-down.
_TIER_TEMPLATES = [
    (80, {
        "urgency":  "EXTREME — IMMEDIATE ACTION MAY BE REQUIRED",
        "headline": "Extreme fire risk — evacuate if ordered",
        "body": (
            "Conditions in your area are at the highest tier of the National Fire Danger Rating System. "
            "If local authorities issue an evacuation order, LEAVE IMMEDIATELY. "
            "Do not wait for further confirmation."
        ),
        "cta": "Check the live map now",
    }),
    (60, {
        "urgency":  "VERY HIGH RISK — PREPARE TO LEAVE",
        "headline": "Very High fire risk in your area",
        "body": (
            "Multiple fire-weather drivers are converging. Pack a go-bag, keep your phone charged, "
            "fuel vehicles facing outward, and monitor official evacuation channels."
        ),
        "cta": "View current perimeters",
    }),
    (40, {
        "urgency":  "HIGH RISK ALERT",
        "headline": "High fire risk — stay alert",
        "body": (
            "Fire-weather conditions are elevated. Avoid outdoor equipment that can throw sparks "
            "(mowers, grinders, welders) and check that your emergency kit is complete."
        ),
        "cta": "See what changed",
    }),
    (20, {
        "urgency":  "MODERATE RISK",
        "headline": "Moderate fire risk in your area",
        "body": (
            "Conditions are above baseline but not yet critical. Clear debris from around your home "
            "and review your family's evacuation plan."
        ),
        "cta": "View details",
    }),
    (0, {
        "urgency":  "LOW RISK — INFORMATIONAL",
        "headline": "Fire risk update",
        "body": "Conditions in your area are currently low.",
        "cta": "Open FireScope",
    }),
]


_SIGNOFF_TEXT = (
    "\n\n"
    "Stay safe,\n"
    "The FireScope Team\n"
    "https://firescope.netlify.app"
)


def _tier_copy(score: float) -> dict:
    for floor, copy in _TIER_TEMPLATES:
        if score >= floor:
            return copy
    return _TIER_TEMPLATES[-1][1]


def _factors_from_features(features: dict) -> list:
    """Auto-generate human-readable contributing-factor bullets from model features.

    Accepts any subset of {evi, air_temp_c, wind_mph, humidity, elevation_m}.
    Silently skips keys that are None / missing so digests and single alerts
    can share one code path."""
    bullets = []
    if not features:
        return bullets

    wind = features.get("wind_mph")
    if wind is not None:
        if wind >= 40: bullets.append(f"Extreme wind: {wind:.0f} mph (trees may fall, embers travel miles)")
        elif wind >= 25: bullets.append(f"Strong wind: {wind:.0f} mph (fires spread rapidly)")
        elif wind >= 15: bullets.append(f"Breezy: {wind:.0f} mph wind")

    humidity = features.get("humidity")
    if humidity is not None:
        if humidity <= 10: bullets.append(f"Critically low humidity: {humidity:.0f}% (Red Flag threshold)")
        elif humidity <= 20: bullets.append(f"Very low humidity: {humidity:.0f}%")
        elif humidity <= 30: bullets.append(f"Low humidity: {humidity:.0f}%")

    temp = features.get("air_temp_c")
    if temp is not None:
        f = temp * 9 / 5 + 32
        if f >= 100: bullets.append(f"Extreme heat: {f:.0f}°F ({temp:.0f}°C)")
        elif f >= 90: bullets.append(f"High temperature: {f:.0f}°F ({temp:.0f}°C)")

    evi = features.get("evi")
    if evi is not None:
        if evi <= 0.15: bullets.append(f"Vegetation extremely dry (EVI {evi:.2f}) — heavy dead fuel load")
        elif evi <= 0.25: bullets.append(f"Vegetation drier than normal (EVI {evi:.2f})")

    elevation = features.get("elevation_m")
    if elevation is not None and elevation >= 1500:
        bullets.append(f"Mountainous terrain ({elevation:.0f} m) — fire can climb ridge lines quickly")

    return bullets


class EmailRenderer:
    """Renders email templates to HTML and plain text."""

    def __init__(self, base_url: str = "https://app.example.com", unsubscribe_path: str = "/unsubscribe"):
        self.base_url = base_url.rstrip("/")
        self.unsubscribe_path = unsubscribe_path
        template_dir = os.path.join(os.path.dirname(__file__), "templates")
        self.env = Environment(
            loader=FileSystemLoader(template_dir),
            autoescape=select_autoescape(["html", "xml"]),
        )
        self.env.globals["unsubscribe_url"] = f"{self.base_url}{self.unsubscribe_path}"
        self.env.globals["map_url"] = f"{self.base_url}/map"

    def _common_context(self) -> Dict[str, Any]:
        return {
            "unsubscribe_url": f"{self.base_url}{self.unsubscribe_path}",
            "map_url": f"{self.base_url}/map",
        }

    def render_immediate_alert(
        self,
        area_name: str,
        risk_score: float,
        contributing_factors: Optional[List[str]] = None,
        map_url: Optional[str] = None,
        features: Optional[Dict[str, Any]] = None,
    ) -> Tuple[str, str]:
        """Render immediate fire risk alert. Returns (html_body, text_body).

        If `features` is provided (any subset of evi, air_temp_c, wind_mph,
        humidity, elevation_m), contributing-factor bullets are auto-generated
        and merged with any explicit `contributing_factors`. Headline, urgency
        tag, and CTA copy are selected dynamically from the score tier so the
        same function produces a 55% informational note or a 95% evacuation
        warning without caller branching."""
        tier = _tier_copy(risk_score)
        auto_factors = _factors_from_features(features or {})
        all_factors = list(contributing_factors or []) + auto_factors

        ctx = {
            **self._common_context(),
            "area_name": area_name,
            "risk_score": round(risk_score, 1),
            "risk_level": _risk_level_from_score(risk_score),
            "risk_badge_color": _risk_badge_color(risk_score),
            "contributing_factors": all_factors,
            "urgency": tier["urgency"],
            "headline": tier["headline"],
            "body_copy": tier["body"],
            "cta_label": tier["cta"],
        }
        if map_url:
            ctx["map_url"] = map_url

        template = self.env.get_template("immediate_alert.html")
        html = template.render(**ctx)

        text_lines = [
            f"[{ctx['urgency']}]  FireScope — {area_name}",
            "",
            ctx["headline"],
            f"Risk level: {ctx['risk_level']} ({round(risk_score, 1)}%)",
            "",
            ctx["body_copy"],
            "",
        ]
        if all_factors:
            text_lines.append("Why this alert:")
            for f in all_factors:
                text_lines.append(f"  - {f}")
            text_lines.append("")
        text_lines.append(f"{ctx['cta_label']}: {ctx['map_url']}")
        text_lines.append(f"Unsubscribe: {ctx['unsubscribe_url']}")
        text = "\n".join(text_lines) + _SIGNOFF_TEXT

        return html, text


def build_alert_subject(area_name: str, risk_score: float) -> str:
    """Subject line that matches the tiered body copy."""
    level = _risk_level_from_score(risk_score)
    prefix = "⚠ FireScope Alert"
    if risk_score >= 90: prefix = "🚨 FireScope CRITICAL"
    elif risk_score >= 80: prefix = "⚠ FireScope SEVERE"
    elif risk_score >= 70: prefix = "⚠ FireScope HIGH"
    return f"{prefix}: {area_name} — {level} risk ({round(risk_score)}%)"

    def render_daily_digest(
        self,
        date_str: str,
        areas: List[Dict[str, Any]],
        map_url: Optional[str] = None,
    ) -> Tuple[str, str]:
        """Render daily digest. areas: [{area_name, risk_score, risk_level, badge_color, highlight_bg}]."""
        for item in areas:
            if "risk_level" not in item:
                item["risk_level"] = _risk_level_from_score(float(item.get("risk_score", 0)))
            if "badge_color" not in item:
                item["badge_color"] = _risk_badge_color(float(item.get("risk_score", 0)))
            if "highlight_bg" not in item:
                item["highlight_bg"] = "#fffef0" if float(item.get("risk_score", 0)) >= 70 else "transparent"

        ctx = {
            **self._common_context(),
            "date_str": date_str,
            "areas": areas,
        }
        if map_url:
            ctx["map_url"] = map_url

        template = self.env.get_template("daily_digest.html")
        html = template.render(**ctx)

        text_lines = [f"Daily Risk Summary - {date_str}", ""]
        for item in areas:
            text_lines.append(f"{item['area_name']}: {item.get('risk_score', 0)}% ({item.get('risk_level', '')})")
        text_lines.append("")
        text_lines.append(f"View Full Map: {ctx['map_url']}")
        text = "\n".join(text_lines) + _SIGNOFF_TEXT

        return html, text

    def render_weekly_digest(
        self,
        week_range: str,
        areas: List[Dict[str, Any]],
        summary_stats: Optional[Dict[str, Any]] = None,
        map_url: Optional[str] = None,
    ) -> Tuple[str, str]:
        """Render weekly digest. areas: [{area_name, avg_risk, trend}], trend in up/down/stable."""
        ctx = {
            **self._common_context(),
            "week_range": week_range,
            "areas": areas,
            "summary_stats": summary_stats or {},
        }
        if map_url:
            ctx["map_url"] = map_url

        template = self.env.get_template("weekly_digest.html")
        html = template.render(**ctx)

        text_lines = [f"Weekly Risk Summary - {week_range}", ""]
        if summary_stats:
            text_lines.append(f"Areas monitored: {summary_stats.get('area_count', 0)}")
            text_lines.append(f"Highest risk: {summary_stats.get('max_risk', 0)}%")
            text_lines.append("")
        for item in areas:
            trend = item.get("trend", "stable")
            text_lines.append(f"{item['area_name']}: {item.get('avg_risk', 0)}% (trend: {trend})")
        text_lines.append("")
        text_lines.append(f"View Full Map: {ctx['map_url']}")
        text = "\n".join(text_lines) + _SIGNOFF_TEXT

        return html, text
