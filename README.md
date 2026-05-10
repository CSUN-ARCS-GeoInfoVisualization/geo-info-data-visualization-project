# FireScope

**Live site:** https://firescope.netlify.app
**Latest stable:** [`v2.2-stable`](https://github.com/CSUN-ARCS-GeoInfoVisualization/geo-info-data-visualization-project/releases/tag/v2.2-stable) — see [`docs/SESSION_HANDOFF.md`](docs/SESSION_HANDOFF.md) to pick up where the team left off.

California wildfire risk visualization and prediction platform. Senior research project at California State University, Northridge (2025–2026).

## Overview

FireScope aggregates open-source wildfire data from government agencies, satellite systems, and news providers into a single interactive dashboard for California. It combines:

- **Geospatial ingestion** — CAL FIRE, NIFC WFIGS, NASA FIRMS, NASA MODIS EVI, Open-Meteo, FEMA NSS
- **Machine-learning risk prediction** — scikit-learn classifier over 5 live features (EVI, air temperature, wind, humidity, elevation)
- **Map-based visualization** — deck.gl + Google Maps with risk zones, active fire perimeters, historical perimeters (1950–present), evacuation routes, and emergency shelters
- **Alerts and notifications** — user-defined risk thresholds with email delivery

## Team

- Ido Cohen
- Alex Hernandez-Abergo
- Ivan Lopez
- Tony Song
- Sannia Jean

## Features

- **Dashboard** — Split view: risk-zone map (county / ZIP / tract / neighborhood) + active-fire perimeter map with 4-tier containment coloring
- **Research page** — Slider-driven per-zone overrides (EVI, temperature, wind, humidity, elevation) with live risk recomputation
- **History page** — 22k+ CAL FIRE perimeters back to 1950, year selector, fire search dropdown, click-to-inspect info card, decoded CAUSE codes
- **Shelters & Evacuation** — 8,014 California pre-staged emergency shelters (CalOES mirror of the FEMA NSS dataset) with click-to-route both inside the FireScope map (Google DirectionsService polyline) and via "Open in Google Maps" turn-by-turn. Live statewide active **evacuation orders / warnings / advisories / shelter-in-place** zones from the Cal OES `CA_EVACUATIONS_PROD` aggregation (the same source Watch Duty consumes — pulls Genasys PROTECT zones plus county sheriffs). Always-visible centroid pins, "Show on map" zoom-to-fit banner, 60 s auto-refresh.
- **Active Fires** — NIFC year-to-date perimeters with CAL FIRE + WFIGS containment enrichment
- **Alerts** — NWS Red Flag Warnings, GNews wildfire articles, user-threshold email notifications
- **Admin** — User management, refresh schedules, model configuration

## Repository Structure

```
frontend/           React + TypeScript + Vite web app (deck.gl, @vis.gl/react-google-maps)
backend/            Flask API
  routes/           Endpoints: auth, predict, history, shelters, notifications, admin
  ml/               scikit-learn risk model + inference
  data/             Sample feature data and live-source adapters
  tests/            pytest suite
migrations/         Alembic database migrations
```

Supporting docs: `software-requirements-specification.md`, `backend/README.md`, `backend/ml/README.md`.

## Getting Started

### Option 1 — Docker (recommended)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

1. Copy `.env.example` to `.env` in the project root and fill in the values:

   ```env
   DB_USER=wildfire_app
   DB_PASSWORD=...
   DB_NAME=wildfire_db
   SECRET_KEY=...
   JWT_SECRET_KEY=...
   INITIAL_ADMIN_EMAIL=admin@example.com
   INITIAL_ADMIN_PASSWORD=...
   VITE_GOOGLE_MAPS_API_KEY=...
   ```

   | Variable | Description |
   |---|---|
   | `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Postgres credentials |
   | `SECRET_KEY` | Flask session secret (long random string) |
   | `JWT_SECRET_KEY` | JWT signing secret (different long random string) |
   | `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` | Seeded admin account |
   | `VITE_GOOGLE_MAPS_API_KEY` | Google Maps JavaScript API key |

   **Never commit `.env`.** It is gitignored. Generate fresh secrets for every environment.

2. Build and start:

   ```bash
   docker-compose up --build
   ```

   - Frontend → http://localhost
   - Backend API → http://localhost:5000/api

Subsequent starts: `docker-compose up`. Stop: `docker-compose down`. Reset data: `docker-compose down -v`.

### Option 2 — Manual setup

Requirements: Node.js 18+, Python 3.10+, PostgreSQL 14+ (or `DATABASE_URL=sqlite:///dev.db`).

**Backend**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env              # fill in SECRET_KEY, JWT_SECRET_KEY, DATABASE_URL, admin creds
flask --app app.py db upgrade
python seed.py
python app.py                     # http://localhost:5000
```

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env              # fill in VITE_GOOGLE_MAPS_API_KEY, VITE_API_URL
npm run dev                       # http://localhost:3000
```

## Email Alerts

Two provider options — pick one, set the matching env vars on Render:

**Option A — Gmail SMTP (easiest, no domain needed).** Works with any personal `@gmail.com`.

1. Turn on **2-Step Verification** on the Gmail account: https://myaccount.google.com/security
2. Create an **App Password** named "FireScope": https://myaccount.google.com/apppasswords
3. Set env vars:
   ```env
   EMAIL_PROVIDER=smtp
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USERNAME=your-gmail@gmail.com
   SMTP_PASSWORD=<16-char app password, no spaces>
   SENDER_EMAIL=your-gmail@gmail.com
   SENDER_NAME=FireScope Alerts
   ```

Gmail's free limit is ~500 recipients/day. Messages may initially land in the recipient's **Spam** folder because `@gmail.com` isn't a verified sending domain — that's an accepted trade-off while developing.

**Option B — Resend (requires a registered domain).** Set:
```env
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
SENDER_EMAIL=alerts@your-verified-domain.com
SENDER_NAME=FireScope Alerts
```

## Deployment

- **Frontend:** Netlify — Site ID `4d02944f-31ae-486b-a273-56dfe3d5016b`, slug `firescope`. Build command: `cd frontend && npm ci && npm run build`, publish dir: `frontend/build`. CI auto-syncs `main → domain-deployment` via `.github/workflows/sync-domain-deployment.yml`.
- **Backend:** Render — `firescope-api` (`srv-d71dltgule4c73cqkbj0`), Python + gunicorn on the `main` branch. Manual redeploy hook: `curl -X POST "https://api.render.com/deploy/srv-d71dltgule4c73cqkbj0?key=IW-X7ztdGiA"`.
- **Database:** Render-managed Postgres (Basic-256MB).

Secrets are stored in Netlify and Render environment variables — never in the repo.

### ⚠ Known deploy gotcha

The Netlify auto-build is **not currently passing the `VITE_API_URL` env var into the Vite build**, so any push to `main` produces a bundle that points the frontend at `http://localhost:5000/api` and breaks every API call in production. Until that is fixed in Netlify Site settings → Environment variables (must be present and scoped to the production context), every deploy needs a manual override:

```bash
cd frontend
VITE_API_URL=https://firescope-api.onrender.com/api \
VITE_GOOGLE_MAPS_API_KEY=<your-key> \
npm run build
cd ..
netlify deploy --site=4d02944f-31ae-486b-a273-56dfe3d5016b \
  --dir=frontend/build --prod --no-build \
  --message="manual deploy: prod env baked in"
```

## Data Sources

See the in-app **Settings → About** page (`/settings`) for the full list with badges, or browse `backend/routes/` for the ingestion code. Summary:

- **Satellite:** NASA FIRMS (VIIRS SNPP), NASA ORNL DAAC MODIS MOD13Q1 (EVI)
- **Fire agencies:** CAL FIRE Incidents & Historic Fire Perimeters, NIFC WFIGS (perimeters + incident locations), CAL FIRE DINS
- **Emergency management:** Cal OES `CA_EVACUATIONS_PROD` (statewide aggregation of Genasys PROTECT zones + county sheriff/EOC feeds), CalOES-mirrored CA Shelter System (8,014 facilities — replaces the gutted FEMA NSS public layer)
- **Weather & news:** NOAA NWS ATOM feed, Open-Meteo, GNews API
- **Mapping:** Google Maps Platform, deck.gl v9
- **Boundaries:** U.S. Census TIGER/Line — 58 counties, 1,769 ZIP codes, 8,041 census tracts, 1,521 neighborhoods

## Machine-Learning Model

scikit-learn classifier predicting wildfire risk from 5 live inputs:

1. `evi` — Enhanced Vegetation Index (MODIS MOD13Q1)
2. `air_temp_encoded` — `(°C + 273.15) / 0.02`
3. `wind` — wind speed (m/s)
4. `humidity` — relative humidity (%)
5. `elevation` — meters above sea level

Output: `risk_score` (0–1) + `label` (Low / Medium / High / Extreme). The frontend collapses these into a 3-tier risk-zone palette (green / yellow / red) on the Dashboard, Risk Map, and Research views. Per-zone overrides via `POST /api/predict-custom`.

## Workflow Guidelines

- Feature branches for new work; keep PRs small and focused.
- Run `npm run build` (frontend) and `pytest` (backend) before opening a PR.
- Update the **About** page in `frontend/src/components/settings-page.tsx` when adding a new data source.
- Never commit API keys, `.env` files, or database dumps.

## License

No license declared yet. Add one before any external release.
