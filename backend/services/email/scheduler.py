"""APScheduler for daily/weekly digests and retry failed alerts."""

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from typing import Callable, Optional


def _cron_for_daily(hour: int) -> dict:
    """Build cron trigger for daily at given hour (Pacific). APScheduler uses server time."""
    return {"hour": hour, "minute": 0}


def _cron_for_weekly(day: str) -> dict:
    """day: mon, tue, wed, thu, fri, sat, sun -> weekday number."""
    days = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
    return {"day_of_week": days.get(day.lower(), 0), "hour": 8, "minute": 0}


class DigestScheduler:
    """Runs digest and retry jobs in-process."""

    def __init__(
        self,
        daily_digest_fn: Callable[[], None],
        weekly_digest_fn: Callable[[], None],
        retry_failed_fn: Callable[[], None],
        daily_hour: int = 8,
        weekly_day: str = "mon",
    ):
        self.scheduler = BackgroundScheduler()
        self.scheduler.add_job(
            daily_digest_fn,
            CronTrigger(**{"hour": daily_hour, "minute": 0}),
            id="daily_digest",
        )
        days = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
        self.scheduler.add_job(
            weekly_digest_fn,
            CronTrigger(day_of_week=days.get(weekly_day.lower(), 0), hour=8, minute=0),
            id="weekly_digest",
        )
        self.scheduler.add_job(
            retry_failed_fn,
            CronTrigger(minute="*/15"),  # every 15 minutes
            id="retry_failed",
        )

    def start(self) -> None:
        self.scheduler.start()

    def shutdown(self, wait: bool = True) -> None:
        self.scheduler.shutdown(wait=wait)
