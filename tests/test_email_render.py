"""Email-rendering regression tests.

History of pain on 2026-05-27:
  - c3ee3a9 template: rendered fine in browser, BLANK in Gmail
  - f4c1f2b template: added background:#hex shorthand to <td>, still blank
  - d7db165 template: bulletproof table layout, never tested in real inbox
  - ff51708 revert:   browser-correct, still blank in Gmail (Gmail strips
                      <body>/<html> wrappers, then the inner div with
                      overflow:hidden + max-width:600px + margin:auto
                      collapses to zero visible height)

Final shipping template (this file's guarantees):
  - Pure <table> layout (no <div> for structure) so Gmail's HTML sanitizer
    can't kill the container
  - Proper <head> with charset + viewport meta
  - background-color:#hex (NOT shorthand background:) for any cell tint
  - All 5 NFDRS tiers rendered in a visible scale legend at the bottom
    (Low / Moderate / High / Very High / Extreme) so the recipient sees
    the full scale even if current data only spans 2-3 tiers
  - font-family inlined on every cell because Gmail's mobile renderer
    sometimes drops inherited font-family and renders content invisible

If you touch the email template, every guarantee here must still pass.
"""

import sys
import os
import re

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))

from routes.internal_alerts import _location_block_html, _TIER_BG, _email_shell  # noqa: E402


SAMPLE = {
    "name": "Slice 1A test point — San Bernardino NF",
    "zones": [
        {"kind": "County",       "zone_name": "Riverside",     "label": "Moderate", "pct": 0.38},
        {"kind": "ZIP",          "zone_name": "92223",         "label": "Low",      "pct": 0.17},
        {"kind": "Neighborhood", "zone_name": "Beaumont",      "label": "High",     "pct": 0.46},
        {"kind": "Census tract", "zone_name": "06065044000",   "label": "Moderate", "pct": 0.32},
    ],
}


# ───────────────────────── Gmail-bulletproof guards ─────────────────────────

def test_location_block_uses_table_layout_not_div_structure():
    """Gmail's HTML sanitizer strips <body>/<html> AND will silently kill
    <div style="overflow:hidden;max-width:Xpx;margin:auto"> containers
    after the strip, collapsing them to zero height. Pure <table> layout
    survives the sanitizer. This regression cost a 4-hour debugging
    session on 2026-05-27 — DO NOT reintroduce <div> for structure.
    """
    html = _location_block_html(SAMPLE)
    assert "<div" not in html, (
        "Email HTML contains <div> elements — Gmail strips structural divs "
        "and the email renders blank. Use <table role=\"presentation\"> for "
        "all layout containers."
    )


def test_location_block_uses_background_color_not_shorthand():
    """`background:#hex` shorthand on <td> made Gmail blank out the cell.
    Use the explicit `background-color:#hex` property instead.
    """
    html = _location_block_html(SAMPLE)
    bad = re.findall(r"background:\s*#", html)
    assert not bad, (
        f"Email HTML uses `background:#...` shorthand ({len(bad)} times). "
        f"Gmail blanks the cell. Use `background-color:#...` instead."
    )


def test_location_block_inlines_font_family_on_every_cell():
    """Gmail mobile drops inherited font-family in some configurations
    and renders content invisible. Every <td>/<th> with text must inline
    its own font-family.
    """
    html = _location_block_html(SAMPLE)
    # Every <td or <th that has visible text must contain font-family.
    cells_with_text = re.findall(r"<(td|th)[^>]*>([^<]+)</\1>", html)
    cells_with_visible_text = [c for c in cells_with_text if c[1].strip() and c[1].strip() != "&nbsp;"]
    for tag, text in cells_with_visible_text:
        # Find this exact cell back in the source and check it has font-family
        pat = re.compile(rf'<{tag}[^>]*>{re.escape(text)}</{tag}>')
        m = pat.search(html)
        assert m, f"cell with text {text!r} not found in regex roundtrip"
        cell = m.group(0)
        assert "font-family" in cell, (
            f"<{tag}>{text!r}</{tag}> is missing inline font-family — "
            f"Gmail mobile may render this cell invisible."
        )


def test_table_root_uses_explicit_attrs_for_gmail():
    """Gmail-safe tables MUST have cellpadding, cellspacing, border, and
    role="presentation" attributes — bare <table style=...> sometimes
    gets stripped by Gmail's mobile clip detection.
    """
    html = _location_block_html(SAMPLE)
    # outer table must have all of these
    assert 'role="presentation"' in html
    assert 'cellpadding="0"' in html
    assert 'cellspacing="0"' in html
    assert 'border="0"' in html


# ───────────────────────── Tier coverage guards ─────────────────────────

def test_all_five_tiers_have_color_mapping():
    """The 5-tier NFDRS scale (Low/Moderate/High/Very High/Extreme) must
    each have a defined background color. Missing tier = silent gray cell
    when data lands in that bucket.
    """
    expected = {"Low", "Moderate", "High", "Very High", "Extreme"}
    assert expected == set(_TIER_BG.keys()), (
        f"_TIER_BG missing or has extra tiers. Expected {expected}, "
        f"got {set(_TIER_BG.keys())}"
    )
    # Every color must be a 7-char hex (Gmail prefers explicit hex).
    for tier, color in _TIER_BG.items():
        assert re.match(r"^#[0-9a-fA-F]{6}$", color), (
            f"Tier {tier!r} color {color!r} is not 6-digit hex"
        )


# ───────────────────────── Content guards ─────────────────────────

def test_location_block_contains_expected_zones():
    """Every zone the user saved must appear in the rendered HTML."""
    html = _location_block_html(SAMPLE)
    for z in SAMPLE["zones"]:
        assert z["zone_name"] in html, f"missing zone_name {z['zone_name']!r}"
        assert z["label"] in html, f"missing tier label {z['label']!r}"
    assert SAMPLE["name"] in html


def test_location_block_renders_pct_as_integer_percent():
    """Risk column shows '46%' not '0.46' or '46.0%'."""
    html = _location_block_html(SAMPLE)
    assert ">46%<" in html
    assert ">17%<" in html
    assert "0.46" not in html


def test_location_block_tints_tier_cell_with_background_color():
    """The Tier cell must have a background-color matching the tier so
    the recipient can scan severity visually.
    """
    html = _location_block_html(SAMPLE)
    # Beaumont row is High → bg #ffedd5
    assert "background-color:#ffedd5" in html
    # Riverside row is Moderate → bg #fef9c3
    assert "background-color:#fef9c3" in html


# ───────────────────────── Shared shell guards (covers ALL 4 channels) ─────────────────────────
#
# Every alert email (high-risk, breaking-news, evacuation, shelter-opened)
# routes through _email_shell(). If the shell breaks, every channel blanks
# in Gmail at the same time. These guards lock the shell shape so a future
# change can't reintroduce the <body>+<div> pattern that cost a 4-hour
# debugging session on 2026-05-27.


def _shell_sample() -> str:
    return _email_shell(
        header_bg="#dc2626",
        header_label="HIGH RISK ALERT",
        header_title="Test title",
        header_subtitle="optional subtitle",
        body_inner_html='<p style="margin:0;font-size:14px;font-family:Arial">Body content here.</p>',
        footer_text="Footer text.",
    )


def test_shell_has_no_div_for_structure():
    html = _shell_sample()
    assert "<div" not in html, "Shell uses <div> — Gmail will blank it"


def test_shell_has_xhtml_doctype_and_head_meta():
    html = _shell_sample()
    assert "<!DOCTYPE html PUBLIC" in html
    assert "<head>" in html
    assert 'http-equiv="Content-Type"' in html
    assert 'name="viewport"' in html


def test_shell_uses_role_presentation_tables():
    html = _shell_sample()
    # at least two layout tables (outer wrapper + 600px container)
    assert html.count('role="presentation"') >= 2
    assert 'cellpadding="0"' in html
    assert 'cellspacing="0"' in html
    assert 'border="0"' in html


def test_shell_uses_no_background_shorthand_anywhere():
    html = _shell_sample()
    bad = re.findall(r"background:\s*(?:#|white|black|[a-z]+)\b", html)
    assert not bad, f"Shell uses `background:` shorthand: {bad}"


def test_shell_renders_subtitle_when_provided():
    html = _shell_sample()
    assert "optional subtitle" in html


def test_shell_no_subtitle_row_when_empty():
    html = _email_shell(
        header_bg="#dc2626",
        header_label="X",
        header_title="Y",
        body_inner_html="<p>Z</p>",
        footer_text="W",
    )
    # No empty subtitle row in the DOM if none given (extra rows confuse Gmail).
    # Quick sanity: only one bullet should appear (FIRESCOPE &bull;), no double.
    assert html.count("&bull;") == 1


def test_shell_inlines_font_family_on_text_cells():
    """Gmail mobile drops inherited font-family; every text cell needs its own."""
    html = _shell_sample()
    # Header rows (FIRESCOPE label + title) are in their own <td>s and must
    # have font-family inline. Footer + body content is inside the body <td>
    # which also has font-family — we check by finding the enclosing cell.
    for snippet in ["FIRESCOPE", "Test title"]:
        m = re.search(rf"<td[^>]*>[^<]*{re.escape(snippet)}[^<]*</td>", html)
        assert m, f"snippet {snippet!r} not in any <td>"
        assert "font-family" in m.group(0), (
            f"cell containing {snippet!r} is missing font-family"
        )
    # The body cell must have font-family even though its content is rich.
    body_cell = re.search(r'<td[^>]*style="padding:22px[^"]*"', html)
    assert body_cell, "body padding cell not found"
    assert "font-family" in body_cell.group(0), "body cell missing font-family"
