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

### 5a. Real PostgreSQL migration flow (recommended for team/dev)

After `.env` is configured with a PostgreSQL `DATABASE_URL`, run migrations and seed:

```bash
python -m flask --app app.py db upgrade
python seed.py
```

Verify migration state:

```bash
python -m flask --app app.py db current
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
| POST | `/api/predict-custom` | — | `{ evi, air_temp_encoded, wind, humidity, elevation }` — used by the Research page slider overrides |

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
  "features": {
    "evi": 0.42,
    "air_temp_encoded": 14196.0,
    "wind": 12.0,
    "humidity": 35.0,
    "elevation": 800.0
  },
  "sources": {
    "weather": "live",
    "elevation": "live",
    "evi": "fallback"
  }
}
```

`risk_level` is one of `Low`, `Medium`, `High`, `Extreme` (thresholds at 0.25 / 0.50 / 0.75). `air_temp_encoded` is air temperature encoded as `(°C + 273.15) / 0.02` — kept as the feature name for backward compatibility with the original MODIS-LST training pipeline.

### Research / map data (mounted under `/api/research`)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/research/boundaries/<name>` | GeoJSON boundaries (county / zip / tract / neighborhood) |
| GET | `/api/research/risk-by-zone/<zone_type>` | Per-zone risk scores for choropleth rendering |
| GET | `/api/research/risk-by-county` | Faster county-level risk overlay (interpolated) |
| GET | `/api/research/risk-grid` | Coarse-grid risk for the active-fire map background |
| GET | `/api/research/fire-data` | NIFC + CAL FIRE active fire perimeters with containment enrichment |

### History, shelters, news

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/history/perimeters/years` | List of years available in the CAL FIRE FRAP dataset |
| GET | `/api/history/perimeters?year=YYYY` | CAL FIRE FRAP historic perimeters (1950–present) |
| GET | `/api/history/dins` | CAL FIRE DINS structure-damage points |
| GET | `/api/shelters` | FEMA National Shelter System points across California |
| GET | `/api/news` | GNews wildfire articles |

### Saved locations

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/me/locations` | JWT | List the current user's saved locations |
| POST | `/api/me/locations` | JWT | Save a new location |
| DELETE | `/api/me/locations/<id>` | JWT | Remove a saved location |

> Alert endpoints under `routes/alerts.py` are not currently wired into `app.py` — alerts run in **UI-only mode** with preferences stored in `localStorage`. Re-enable by registering `alerts_bp` in `app.py` once the server-side flow is brought back online.

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
| POST | `/api/admin/notifications/dispatch/:userId` | Attempt send with eligibility checks and audit logging (`{ risk_level }`) |

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
├── entrypoint.sh           # Docker entrypoint — runs migrations then gunicorn
├── Dockerfile              # Container image for Render deployment
├── requirements.txt        # Python dependencies
├── requirements-dev.txt    # Test/dev-only dependencies
├── pytest.ini              # pytest config
├── SETUP_EMAIL.md          # Step-by-step Gmail SMTP / Resend setup notes
├── routes/
│   ├── auth.py             # /api/register, /api/login
│   ├── me.py               # /api/me
│   ├── admin.py            # /api/admin/*
│   ├── notifications.py    # /api/me/notifications, /api/notifications/*
│   ├── predict.py          # /api/predict, /api/predict/batch, /api/predict-custom
│   ├── research.py         # /api/research/boundaries, /risk-by-zone, /risk-by-county, /risk-grid, /fire-data
│   ├── history.py          # /api/history/perimeters, /api/history/perimeters/years, /api/history/dins
│   ├── shelters.py         # /api/shelters
│   ├── news.py             # /api/news
│   ├── alerts.py           # NOT registered — UI-only mode (kept around for future server-side alerts)
│   └── locations.py        # /api/me/locations  (saved-location CRUD)
├── services/
│   ├── email/              # SMTP + Resend providers and message templates
│   └── fire_news/          # GNews + CAL FIRE incidents adapters
├── ml/
│   ├── inference.py        # predict_from_features() — model loading and scoring
│   ├── build_dataset.py    # Training-data pipeline (FIRMS + AppEEARS + Open-Meteo)
│   ├── retrain.py          # Training + evaluation
│   └── models/
│       ├── wildfire_model_predictive.pkl
│       ├── wildfire_scaler_predictive.pkl
│       └── model_metadata.json
├── data/
│   ├── sample_locations.py # Fallback CA locations with pre-extracted features
│   ├── live_weather.py     # Open-Meteo wind / temperature / humidity adapter
│   ├── live_elevation.py   # Open-Elevation adapter
│   ├── live_evi.py         # NASA AppEEARS EVI adapter (cached spring composite)
│   ├── fire_news_feeds.py  # CAL FIRE Incidents API adapter
│   └── boundaries/         # Cached TIGER/Line GeoJSON for counties / ZIP / tracts / neighborhoods
├── migrations/             # Alembic migrations (Flask-Migrate)
└── tests/                  # pytest suite
```
