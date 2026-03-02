# Backend — Wildfire Prediction API

Flask REST API with JWT auth, PostgreSQL, and ML-powered wildfire risk prediction.

## Prerequisites

| Requirement | Version |
|---|---|
| Python | 3.10+ |
| PostgreSQL | 14+ |

---

## Setup

### 1. Create and activate a virtual environment

**Linux / macOS**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
```

**Windows (PowerShell)**
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```
SECRET_KEY=<random string>
JWT_SECRET_KEY=<different random string>
DATABASE_URL=postgresql+psycopg2://postgres:your_password@localhost:5432/wildfire_db
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=ChangeMe123!
```

> **Tip:** Generate secure keys with `python -c "import secrets; print(secrets.token_hex(32))"`

### 4. Create the database

In PostgreSQL (run once):
```sql
CREATE DATABASE wildfire_db;
```

### 5. Seed the database

This creates all tables and inserts the three roles (Resident, Researcher, Admin) plus the initial admin user:

```bash
python seed.py
```

### 6. Start the server

```bash
python app.py
```

The API will be available at `http://localhost:5000`.

---

## API Reference

### Auth

| Method | Endpoint | Auth | Body |
|---|---|---|---|
| POST | `/api/register` | — | `{ email, password, role? }` |
| POST | `/api/login` | — | `{ email, password }` |
| GET | `/api/me` | JWT | — |

- `role` at registration: `"Resident"` (default) or `"Researcher"`. `"Admin"` is not self-assignable.
- Login returns `{ token }`. Pass it as `Authorization: Bearer <token>` on protected routes.

### Prediction

| Method | Endpoint | Auth | Body |
|---|---|---|---|
| POST | `/api/predict` | — | `{ lat, lon, date? }` |
| POST | `/api/predict/batch` | — | `{ items: [{ lat, lon, date? }, ...] }` |

**Single prediction response:**
```json
{
  "prediction": {
    "risk_level": "Medium",
    "risk_probability": 0.3077
  },
  "model": { "version": "predictive-v1" },
  "location": {
    "requested_lat": 34.25,
    "requested_lon": -118.5,
    "matched_name": "Dry Mountain Chaparral — Peak Season",
    "matched_lat": 34.5,
    "matched_lon": -118.5
  },
  "features": { "evi": 0, "lst": 14196, "wind": 12.0, "elevation": 800.0 }
}
```

### Notifications

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/me/notifications` | JWT | Get current user's notification preferences |
| PUT | `/api/me/notifications` | JWT | Update preferences |
| POST | `/api/notifications/subscribe` | JWT | Opt in to alerts |
| POST | `/api/notifications/unsubscribe` | JWT | Opt out of alerts |

**Preference fields (PUT body):**
```json
{
  "frequency": "instant | daily | weekly",
  "risk_threshold": 0,
  "paused_until": "2026-06-01T00:00:00Z",
  "blackout_start": "2026-01-01T22:00:00Z",
  "blackout_end": "2026-01-02T07:00:00Z"
}
```

### Admin (JWT role=Admin required)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/admin/users` | List all users |
| GET | `/api/admin/users/:id` | Get a single user |
| POST | `/api/admin/assign-role` | `{ userId, role }` — cannot demote last admin |
| GET | `/api/admin/notifications` | List all notification preferences |
| PUT | `/api/admin/notifications/:userId` | Update any user's preferences |

### Health check

```
GET /health  →  { "status": "ok" }
```

---

## Project Structure

```
backend/
├── app.py                  # App factory, blueprint registration
├── config.py               # Config from environment variables
├── models.py               # SQLAlchemy models (User, Role, NotificationPreference)
├── seed.py                 # Creates tables and seeds roles + initial admin
├── requirements.txt        # Python dependencies
├── .env.example            # Environment variable template
├── routes/
│   ├── auth.py             # /api/register, /api/login
│   ├── me.py               # /api/me
│   ├── admin.py            # /api/admin/*
│   ├── notifications.py    # /api/me/notifications, /api/notifications/*
│   └── predict.py          # /api/predict, /api/predict/batch
├── ml/
│   ├── inference.py        # predict_from_features() — model loading and scoring
│   └── models/
│       ├── wildfire_model_predictive.pkl
│       └── wildfire_scaler_predictive.pkl
└── data/
    └── sample_locations.py # Hardcoded CA locations with pre-extracted features
```
