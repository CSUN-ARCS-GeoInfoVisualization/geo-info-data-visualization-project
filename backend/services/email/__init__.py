"""Email delivery service - entry point and wiring."""

from .config import EmailConfig
from .provider import EmailProvider, ResendProvider, MockProvider, EmailMessage, SendResult
from .renderer import EmailRenderer
from .tracker import DeliveryTracker
from .retry import RetryHandler
from .sender import EmailSender
from .scheduler import DigestScheduler

# Lazy ref to avoid circular imports
_sender: "EmailSender | None" = None
_scheduler: "DigestScheduler | None" = None


def init_email_service(app):
    """
    Initialize email service: config, provider, renderer, tracker, retry, sender, scheduler.
    Register alerts_bp blueprint.
    """
    global _sender, _scheduler
    from backend.routes.alerts import alerts_bp, init_routes

    config = EmailConfig.from_env()

    if config.use_mock_provider:
        provider = MockProvider()
    else:
        provider = ResendProvider(
            api_key=config.resend_api_key,
            sender_email=config.sender_email,
            sender_name=config.sender_name,
        )

    base_url = getattr(app.config, "BASE_URL", "https://app.example.com")
    renderer = EmailRenderer(base_url=base_url)

    # Session factory - assume app has db.session or similar
    _cache = {}

    def session_factory():
        if hasattr(app, "db") and hasattr(app.db, "session"):
            return app.db.session
        if "maker" not in _cache:
            from sqlalchemy import create_engine
            from sqlalchemy.orm import sessionmaker
            db_url = app.config.get("SQLALCHEMY_DATABASE_URI", "sqlite:///local.db")
            engine = create_engine(db_url)
            if app.config.get("TESTING"):
                from backend.services.email.models import Base
                Base.metadata.create_all(engine)
            _cache["maker"] = sessionmaker(bind=engine)
        return _cache["maker"]()

    tracker = DeliveryTracker(
        session_factory=session_factory,
        dedup_window_hours=config.alert_dedup_window_hours,
    )
    retry = RetryHandler(
        max_retries=config.max_retries,
        base_delay=config.retry_base_delay,
    )

    get_user_email = getattr(app, "get_user_email", None)

    _sender = EmailSender(
        provider=provider,
        renderer=renderer,
        tracker=tracker,
        retry=retry,
        config=config,
        session_factory=session_factory,
        get_user_email=get_user_email,
    )

    def _daily():
        _sender.send_daily_digest()

    def _weekly():
        _sender.send_weekly_digest()

    def _retry():
        for activity in _sender.tracker.get_failed_alerts(config.max_retries):
            # Re-send logic would need stored message context - simplified here
            pass

    _scheduler = DigestScheduler(
        daily_digest_fn=_daily,
        weekly_digest_fn=_weekly,
        retry_failed_fn=_retry,
        daily_hour=config.daily_digest_hour,
        weekly_day=config.weekly_digest_day,
    )
    _scheduler.start()

    init_routes(_sender, session_factory)
    app.register_blueprint(alerts_bp)

    app.extensions["email_sender"] = _sender
    app.extensions["email_scheduler"] = _scheduler

    return _sender


def get_email_sender():
    """Get the configured EmailSender instance."""
    return _sender
