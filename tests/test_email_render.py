"""Email-rendering regression tests.

A real recipient (Ido) reported the high-risk alert email arriving fully
blank in Gmail on 2026-05-27 (Resend confirmed delivered, .eml Show
Original confirmed the HTML body was present at offsets we expected —
yet Gmail rendered nothing visible).

Two commits-back diff against the last known-working send (Resend ID
57c9c723, sent 16:18:53 UTC) revealed the ONLY two differences from the
broken send (Resend ID 6b87445f, sent 16:49:53 UTC) were:

    1. style='...' (single quotes) -> style="..." (double quotes)
    2. Added `background:#hex` shorthand on each Tier <td>

The `background:` shorthand on <td> is the prime suspect — Gmail's CSS
sanitizer appears to invalidate the cell (and possibly cascade into the
whole table) when it can't resolve the shorthand against its allow-list.

These tests lock in the working render. If you touch
_location_block_html or _send_high_risk_email and any of the
"never-again" guarantees below break, the test fails BEFORE you push to
Render and the user gets another blank inbox.

If you genuinely need to add tier-color tinting, the safe path is:
  - use `background-color:#hex` (explicit, NOT shorthand)
  - test the send in a real Gmail inbox first
  - then update the golden snapshot intentionally
"""

import sys
import os

# Tests live in tests/, backend code lives in backend/ — add backend/ to path
# so we can import the route module directly.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))

from routes.internal_alerts import _location_block_html  # noqa: E402


SAMPLE = {
    "name": "Slice 1A test point — San Bernardino NF",
    "zones": [
        {"kind": "County",       "zone_name": "Riverside",     "label": "Moderate", "pct": 0.38},
        {"kind": "ZIP",          "zone_name": "92223",         "label": "Low",      "pct": 0.17},
        {"kind": "Neighborhood", "zone_name": "Beaumont",      "label": "High",     "pct": 0.46},
        {"kind": "Census tract", "zone_name": "06065044000",   "label": "Moderate", "pct": 0.32},
    ],
}


def test_location_block_uses_single_quoted_style_attrs():
    """Gmail rendered the email blank when we shipped style="..." attrs.
    The proven-working version uses style='...'. Stay on single quotes.
    """
    html = _location_block_html(SAMPLE)
    # Must not contain a single style="..." anywhere — every style attr
    # must be single-quoted.
    assert 'style="' not in html, (
        "Email HTML contains style=\"...\" attributes — Gmail rendered "
        "this as blank on 2026-05-27. Use style='...' (single quotes) "
        "to match the proven-working c3ee3a9 baseline."
    )


def test_location_block_does_not_use_background_shorthand_on_tier_td():
    """The `background:#hex` shorthand on a <td> appears to make Gmail
    drop the cell from layout. If you want tier tinting, use the
    explicit `background-color:` property — and test in a real inbox.
    """
    html = _location_block_html(SAMPLE)
    # The location-block header (<div ... background:#fafafa>) is fine
    # because that's a <div>, not a <td>, and it shipped working for
    # weeks. The regression was inline `background:#hex` on table cells.
    # Verify no <td> ... background:#... pattern exists.
    import re
    bad = re.findall(r"<td[^>]*background:\#[0-9a-fA-F]", html)
    assert not bad, (
        f"<td> contains `background:#hex` shorthand ({len(bad)} occurrences). "
        f"Gmail rendered the email blank when this shipped on 2026-05-27. "
        f"Use background-color:#hex on td if you need cell tinting."
    )


def test_location_block_contains_expected_zones():
    """Sanity: every zone the user saved must appear in the rendered HTML.
    A blank or truncated block is worse than a missing send."""
    html = _location_block_html(SAMPLE)
    for z in SAMPLE["zones"]:
        assert z["zone_name"] in html, f"missing zone_name {z['zone_name']!r}"
        assert z["label"] in html, f"missing tier label {z['label']!r}"
    assert SAMPLE["name"] in html, "missing location title"


def test_location_block_renders_pct_as_integer_percent():
    """Risk column must show '46%' not '0.46' or '46.0%'."""
    html = _location_block_html(SAMPLE)
    assert ">46%<" in html
    assert ">17%<" in html
    assert "0.46" not in html
