"""Email service configuration loaded from environment variables."""

import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class EmailConfig:
    """Configuration for email delivery, loaded from env vars."""

    # Resend provider
    resend_api_key: str
    sender_email: str
    sender_name: str

    # Retry settings
    max_retries: int
    retry_base_delay: float

    # Digest schedule (Pacific time)
    daily_digest_hour: int
    weekly_digest_day: str  # 'mon', 'tue', etc.

    # Deduplication
    alert_dedup_window_hours: int

    # Webhook (for delivery status callbacks)
    resend_webhook_secret: Optional[str] = None

    # Provider selection
    # 'resend' (default), 'smtp' (gmail / any SMTP), or 'mock'
    email_provider: str = "resend"
    use_mock_provider: bool = False

    # SMTP (gmail/app-password setup)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True

    @classmethod
    def from_env(cls) -> "EmailConfig":
        """Load configuration from environment variables."""
        return cls(
            resend_api_key=os.getenv("RESEND_API_KEY", ""),
            sender_email=os.getenv("SENDER_EMAIL", "alerts@your-domain.dev"),
            sender_name=os.getenv("SENDER_NAME", "FireScope Alerts"),
            max_retries=int(os.getenv("EMAIL_MAX_RETRIES", "3")),
            retry_base_delay=float(os.getenv("EMAIL_RETRY_BASE_DELAY", "2.0")),
            daily_digest_hour=int(os.getenv("DAILY_DIGEST_HOUR", "8")),
            weekly_digest_day=os.getenv("WEEKLY_DIGEST_DAY", "mon").lower(),
            alert_dedup_window_hours=int(os.getenv("ALERT_DEDUP_WINDOW_HOURS", "24")),
            resend_webhook_secret=os.getenv("RESEND_WEBHOOK_SECRET") or None,
            email_provider=os.getenv("EMAIL_PROVIDER", "resend").strip().lower(),
            use_mock_provider=os.getenv("EMAIL_USE_MOCK", "false").lower() == "true",
            smtp_host=os.getenv("SMTP_HOST", ""),
            smtp_port=int(os.getenv("SMTP_PORT", "587")),
            smtp_username=os.getenv("SMTP_USERNAME", ""),
            smtp_password=os.getenv("SMTP_PASSWORD", ""),
            smtp_use_tls=os.getenv("SMTP_USE_TLS", "true").lower() == "true",
        )
