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


class SMTPProvider(EmailProvider):
    """Generic SMTP provider — works with Gmail (smtp.gmail.com:587) and any
    SMTP server.  Intended for deployments that don't want to register a
    domain with Resend.

    Gmail setup (no business account required):
      1. Enable 2-Step Verification on the Gmail account.
      2. Generate an App Password at https://myaccount.google.com/apppasswords
         (name it "FireScope").
      3. Set env vars on Render:
           EMAIL_PROVIDER=smtp
           SMTP_HOST=smtp.gmail.com
           SMTP_PORT=587
           SMTP_USERNAME=<your-gmail>@gmail.com
           SMTP_PASSWORD=<16-char app password, no spaces>
           SENDER_EMAIL=<your-gmail>@gmail.com
           SENDER_NAME=FireScope Alerts

    Gmail's free limit is ~500 recipients/day — plenty for this project.
    Emails may initially land in Spam because @gmail.com isn't a verified
    sending domain; that's an accepted trade-off for the demo.
    """

    def __init__(self, host: str, port: int, username: str, password: str,
                 sender_email: str, sender_name: str, use_tls: bool = True):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.sender_email = sender_email
        self.sender_name = sender_name
        self.use_tls = use_tls

    def send(self, message: EmailMessage) -> SendResult:
        import smtplib
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        from email.utils import formataddr, make_msgid

        try:
            mime = MIMEMultipart('alternative')
            mime['Subject'] = message.subject
            mime['From'] = formataddr((self.sender_name, self.sender_email))
            mime['To'] = message.to
            if message.reply_to:
                mime['Reply-To'] = message.reply_to
            msg_id = make_msgid(domain=self.sender_email.split('@')[-1] or 'localhost')
            mime['Message-ID'] = msg_id

            if message.text_body:
                mime.attach(MIMEText(message.text_body, 'plain', 'utf-8'))
            mime.attach(MIMEText(message.html_body, 'html', 'utf-8'))

            with smtplib.SMTP(self.host, self.port, timeout=15) as s:
                s.ehlo()
                if self.use_tls:
                    s.starttls()
                    s.ehlo()
                s.login(self.username, self.password)
                s.sendmail(self.sender_email, [message.to], mime.as_string())

            return SendResult(success=True, provider_message_id=msg_id)
        except Exception as e:
            return SendResult(success=False, error_message=str(e))


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
