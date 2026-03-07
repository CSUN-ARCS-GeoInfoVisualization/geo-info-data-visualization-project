"""Email provider abstraction - ResendProvider and MockProvider."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class EmailMessage:
    """Outbound email message."""

    to: str
    subject: str
    html_body: str
    text_body: str = ""
    tags: Optional[dict] = None
    reply_to: Optional[str] = None


@dataclass
class SendResult:
    """Result of a send operation."""

    success: bool
    provider_message_id: Optional[str] = None
    error_message: Optional[str] = None


class EmailProvider(ABC):
    """Abstract base class for email providers."""

    @abstractmethod
    def send(self, message: EmailMessage) -> SendResult:
        """Send a single email."""
        pass

    def send_batch(self, messages: List[EmailMessage]) -> List[SendResult]:
        """Send multiple emails. Default: sequential send()."""
        return [self.send(msg) for msg in messages]


class ResendProvider(EmailProvider):
    """Resend.com email provider."""

    def __init__(self, api_key: str, sender_email: str, sender_name: str):
        self.api_key = api_key
        self.sender_email = sender_email
        self.sender_name = sender_name

    def send(self, message: EmailMessage) -> SendResult:
        try:
            import resend

            resend.api_key = self.api_key
            params = {
                "from": f"{self.sender_name} <{self.sender_email}>",
                "to": [message.to],
                "subject": message.subject,
                "html": message.html_body,
            }
            if message.text_body:
                params["text"] = message.text_body
            if message.reply_to:
                params["reply_to"] = message.reply_to
            if message.tags:
                params["tags"] = message.tags

            result = resend.Emails.send(params)
            return SendResult(
                success=True,
                provider_message_id=result.get("id"),
            )
        except Exception as e:
            return SendResult(
                success=False,
                error_message=str(e),
            )


class MockProvider(EmailProvider):
    """In-memory provider for testing - records all messages."""

    def __init__(self):
        self.sent_messages: List[EmailMessage] = []
        self.results: List[SendResult] = []

    def send(self, message: EmailMessage) -> SendResult:
        self.sent_messages.append(message)
        result = SendResult(success=True, provider_message_id=f"mock_{len(self.sent_messages)}")
        self.results.append(result)
        return result

    def reset(self) -> None:
        """Clear recorded messages for test isolation."""
        self.sent_messages.clear()
        self.results.clear()
