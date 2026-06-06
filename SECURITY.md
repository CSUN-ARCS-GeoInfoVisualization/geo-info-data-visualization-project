# Security

FireScope is a public web application that aggregates open government and satellite data and sends
opt-in email alerts. This document describes the security posture and how to report a vulnerability.

## Reporting a vulnerability

Open a private report via **GitHub Security Advisories** on this repository, or email a maintainer.
Please **do not file public issues** for security problems. Expect an initial response within a few days.

## Data and secrets

- **No secrets in the repository.** API keys, database credentials, JWT/session secrets, and the
  email-provider key live only in the host environment (Render and Netlify environment variables).
  `.env` is gitignored; `.env.example` ships placeholders only. Generate fresh secrets per environment.
- **All ingested data is public.** FireScope reads open feeds (CAL FIRE, NIFC WFIGS, NASA FIRMS,
  NASA MODIS, Cal OES, NOAA NWS, Open-Meteo, U.S. Census). It stores no third-party private data.
- **User data** is limited to account email, hashed password, saved locations, and notification
  preferences. Passwords are hashed; the column is never returned by the API.

## Authentication and authorization

- JWT-based auth (`POST /api/login` / `POST /api/register`), signed with `JWT_SECRET_KEY`.
- Role-gated routes: researcher/admin-only endpoints (e.g. `/api/research/fire-data`,
  `/api/research/risk-grid`, the admin surface) enforce the role server-side, not just in the UI.
- The seeded admin account is created from `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` — change
  these from the defaults before any public deployment.

## Email pipeline

- One-click unsubscribe is RFC 8058-compliant (`List-Unsubscribe` + `List-Unsubscribe-Post`); the
  public unsubscribe endpoint is HMAC-token-authed (`HMAC-SHA256(SECRET_KEY, "unsub:<user>:<channel>")`).
- Alert crons are triggered by GitHub Actions and authenticate to internal endpoints with a token.
- Sending credentials (SMTP app password or Resend API key) are environment-only.

## Input handling

- Public read endpoints are cached and parameterized; the database is accessed through SQLAlchemy.
- Boundary and risk payloads are server-computed; clients cannot inject arbitrary SQL through the
  research/predict surface.

## Dependencies

Keep `backend/requirements.txt` and `frontend/package.json` patched. Report any vulnerable transitive
dependency through the private channel above rather than a public issue.
