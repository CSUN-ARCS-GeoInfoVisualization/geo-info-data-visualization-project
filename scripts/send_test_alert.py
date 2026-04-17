#!/usr/bin/env python3
"""Send a one-off FireScope alert email as an end-to-end test of the SMTP path.

Usage
-----
Fill in the env vars below (or export them in your shell) and run:

    cd backend && python ../scripts/send_test_alert.py

The script sends a dynamic alert with the given risk score and features to
the `TO` address. Tune `TO`, `RISK_SCORE`, or `FEATURES` to preview other tiers.

Required env vars
-----------------
SMTP_USERNAME   your-gmail@gmail.com
SMTP_PASSWORD   16-char Gmail App Password (NOT your account password)
                → https://myaccount.google.com/apppasswords  (requires 2FA)

Optional env vars
-----------------
TO              recipient (default: ido.the.cohen@gmail.com)
SENDER_EMAIL    defaults to SMTP_USERNAME
SENDER_NAME     default "FireScope Alerts"
SMTP_HOST       default smtp.gmail.com
SMTP_PORT       default 587
RISK_SCORE      default 95  (override to test other tiers, e.g. 55, 72, 95)
AREA_NAME       default "Malibu, CA"
"""

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent / "backend"
sys.path.insert(0, str(BACKEND))

from services.email.provider import SMTPProvider, EmailMessage  # noqa: E402
from services.email.renderer import EmailRenderer, build_alert_subject  # noqa: E402


def require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.stderr.write(
            f"error: env var {name!r} is required.\n"
            f"see the header comment in scripts/send_test_alert.py for setup.\n"
        )
        sys.exit(2)
    return value


def main() -> int:
    smtp_username = require("SMTP_USERNAME")
    smtp_password = require("SMTP_PASSWORD")

    to_addr      = os.getenv("TO", "ido.the.cohen@gmail.com")
    sender_email = os.getenv("SENDER_EMAIL", smtp_username)
    sender_name  = os.getenv("SENDER_NAME", "FireScope Alerts")
    smtp_host    = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port    = int(os.getenv("SMTP_PORT", "587"))

    risk_score  = float(os.getenv("RISK_SCORE", "95"))
    area_name   = os.getenv("AREA_NAME", "Malibu, CA")

    # Dynamic features that will be turned into human-readable bullets by the
    # renderer. Tweak to exercise different contributing-factor messages.
    features = {
        "evi":          0.12,   # very dry vegetation
        "air_temp_c":   41.0,   # ~106°F
        "wind_mph":     45.0,   # extreme-wind tier
        "humidity":      8.0,   # below Red Flag 10% threshold
        "elevation_m":  620.0,
    }

    renderer = EmailRenderer(base_url="https://firescope.netlify.app")
    html, text = renderer.render_immediate_alert(
        area_name=area_name,
        risk_score=risk_score,
        features=features,
    )
    subject = build_alert_subject(area_name, risk_score)

    provider = SMTPProvider(
        host=smtp_host,
        port=smtp_port,
        username=smtp_username,
        password=smtp_password,
        sender_email=sender_email,
        sender_name=sender_name,
    )
    msg = EmailMessage(to=to_addr, subject=subject, html_body=html, text_body=text)

    print(f"→ Sending test alert ({risk_score}%) to {to_addr} via {smtp_host}:{smtp_port}")
    result = provider.send(msg)
    if result.success:
        print(f"  sent ok  (id={result.provider_message_id})")
        print(f"  subject: {subject}")
        print(f"  check Inbox AND Spam on {to_addr}")
        return 0
    print(f"  FAILED: {result.error_message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
