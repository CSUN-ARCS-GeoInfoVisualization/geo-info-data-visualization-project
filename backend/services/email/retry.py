"""Exponential backoff retry logic for email sending."""

import random
import time
from typing import Callable, Optional, TypeVar

from .provider import EmailMessage, SendResult

T = TypeVar("T")


def _delay(attempt: int, base: float, max_delay: float = 60.0) -> float:
    """Compute delay with exponential backoff + jitter: min(base * 2^attempt, max) + jitter."""
    delay = min(base * (2 ** attempt), max_delay)
    jitter = random.uniform(0, delay * 0.2)
    return delay + jitter


class RetryHandler:
    """Handles retries with exponential backoff."""

    def __init__(self, max_retries: int = 3, base_delay: float = 2.0, max_delay: float = 60.0):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay

    def send_with_retry(
        self,
        send_fn: Callable[[EmailMessage], SendResult],
        message: EmailMessage,
    ) -> SendResult:
        """Attempt to send with retries. Returns last result."""
        last_result: Optional[SendResult] = None
        for attempt in range(self.max_retries + 1):
            result = send_fn(message)
            last_result = result
            if result.success:
                return result
            if attempt < self.max_retries:
                time.sleep(_delay(attempt, self.base_delay, self.max_delay))
        return last_result or SendResult(success=False, error_message="No attempts made")
