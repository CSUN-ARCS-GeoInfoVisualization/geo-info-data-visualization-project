"""Jinja2 template rendering for email HTML and text fallbacks."""

import os
from jinja2 import Environment, FileSystemLoader, select_autoescape
from typing import Any, Dict, List, Optional, Tuple


def _risk_level_from_score(score: float) -> str:
    """Map numeric score to level label."""
    if score >= 80:
        return "High"
    if score >= 50:
        return "Medium"
    if score >= 25:
        return "Low"
    return "Very Low"


def _risk_badge_color(score: float) -> str:
    """Map score to badge background color."""
    if score >= 80:
        return "#dc2626"  # red
    if score >= 50:
        return "#f59e0b"  # amber
    if score >= 25:
        return "#eab308"  # yellow
    return "#16a34a"  # green


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
    ) -> Tuple[str, str]:
        """Render immediate fire risk alert. Returns (html_body, text_body)."""
        ctx = {
            **self._common_context(),
            "area_name": area_name,
            "risk_score": round(risk_score, 1),
            "risk_level": _risk_level_from_score(risk_score),
            "risk_badge_color": _risk_badge_color(risk_score),
            "contributing_factors": contributing_factors or [],
        }
        if map_url:
            ctx["map_url"] = map_url

        template = self.env.get_template("immediate_alert.html")
        html = template.render(**ctx)

        text_lines = [
            f"Fire Risk Alert: {area_name}",
            f"Risk Level: {ctx['risk_level']} ({risk_score}%)",
            "",
        ]
        if contributing_factors:
            text_lines.append("Contributing factors:")
            for f in contributing_factors:
                text_lines.append(f"  - {f}")
            text_lines.append("")
        text_lines.append(f"View on Map: {ctx['map_url']}")
        text_lines.append(f"Unsubscribe: {ctx['unsubscribe_url']}")
        text = "\n".join(text_lines)

        return html, text

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
        text = "\n".join(text_lines)

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
        text = "\n".join(text_lines)

        return html, text
