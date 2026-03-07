# Email Delivery Setup Guide (Resend)

This guide walks through configuring the FireWatch email module with [Resend](https://resend.com). *(Maintained by Ido)*

## 1. Create Resend Account

1. Go to [resend.com](https://resend.com) and sign up
2. No credit card required for the free tier (3,000 emails/month, 100/day)
3. Verify your email address

## 2. Domain Verification

To send from your own domain (e.g. `alerts@your-domain.dev`):

1. In Resend dashboard: **Domains** → **Add Domain**
2. Enter your domain (e.g. `your-domain.dev`)
3. Resend will provide DNS records:
   - **SPF**: TXT record for `@` or `yourdomain.dev`
   - **DKIM**: CNAME records (typically 3)
   - **DMARC** (optional): TXT for `_dmarc.yourdomain.dev`

4. Add these records in your DNS provider
5. Wait for verification (usually 5–15 minutes)
6. Status will show as "Verified" when ready

### Using Resend's Test Domain

For development, you can send from `onboarding@resend.dev` without domain verification. Add recipients in **Audience** to receive test emails.

## 3. API Key

1. In Resend: **API Keys** → **Create API Key**
2. Name it (e.g. "FireWatch Production")
3. Copy the key (starts with `re_`) and store it securely
4. Add to `.env`:

```bash
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## 4. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
RESEND_API_KEY=re_xxxx              # Required for sending
SENDER_EMAIL=alerts@your-domain.dev # Must be verified domain
SENDER_NAME=FireWatch Alerts
EMAIL_MAX_RETRIES=3
EMAIL_RETRY_BASE_DELAY=2.0
DAILY_DIGEST_HOUR=8
WEEKLY_DIGEST_DAY=mon
ALERT_DEDUP_WINDOW_HOURS=24
RESEND_WEBHOOK_SECRET=whsec_xxxx    # For delivery callbacks
```

## 5. Webhook (Optional)

To receive delivery status (delivered, bounced, complained):

1. In Resend: **Webhooks** → **Add Webhook**
2. Endpoint URL: `https://your-app.com/api/webhooks/email`
3. Select events: `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`
4. Copy the signing secret to `RESEND_WEBHOOK_SECRET`
5. Implement signature verification in the webhook handler (see Resend docs)

## 6. Test Sending

1. Start the Flask app
2. Send a test email:

```bash
curl -X POST http://localhost:5000/api/admin/alerts/send-test \
  -H "Content-Type: application/json" \
  -d '{"to": "your-email@example.com"}'
```

3. Check your inbox (and spam folder)

## 7. Gmail / Outlook Compatibility

Email templates use:
- Table-based layout for compatibility
- Inline CSS
- Plain-text fallback for deliverability

For Litmus/email testing, use Resend's preview or paste rendered HTML into Litmus.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Domain not verified" | Complete DNS records and wait for propagation |
| Emails in spam | Verify SPF/DKIM/DMARC, avoid spammy content |
| Rate limit | Free tier: 100/day; upgrade or reduce test volume |
| API key invalid | Regenerate key in Resend dashboard |
