# FireScope

**Live site:** https://firescope.dev (custom domain) · https://firescope.netlify.app
**Latest stable:** [`v3.0-stable`](https://github.com/CSUN-ARCS-GeoInfoVisualization/geo-info-data-visualization-project/releases/tag/v3.0-stable) — **fourth alert channel: wildfires in your county** (per-county bundled CAL FIRE incident alerts every 10 min, change-driven dedup, one-final-"fully contained"-email-then-silence, "View updated perimeters on map" CTA), **universal one-click email unsubscribe** (RFC 8058 native Gmail/Apple button + per-channel footer links + token-authed public endpoint), **breaking-news pipeline cleanup** (NWS title cleaning, per-user CA-county filter, two-pass cross-source dedupe, live CAL FIRE containment enrichment + live summary override so titles and summaries can't show contradictory numbers), **fire-perimeter map auto-retires contained fires** (CAL FIRE pct wins over stale NIFC), high-risk alerts capped at 20 locations with truncation disclosure, history page "No fires recorded" empty state, and Gmail-bulletproof email shell with anti-trim markers. Builds on v2.9's NFDRS 5-tier model + Shelters/Evac rebuild + alerts foundation. See [`docs/SESSION_HANDOFF.md`](docs/SESSION_HANDOFF.md) to pick up where the team left off.

California wildfire risk visualization and prediction platform. Senior research project at California State University, Northridge (2025–2026).

## Overview

FireScope aggregates open-source wildfire data from government agencies, satellite systems, and news providers into a single interactive dashboard for California. It combines:

- **Geospatial ingestion** — CAL FIRE, NIFC WFIGS, NASA FIRMS, NASA MODIS EVI, Open-Meteo, FEMA NSS
- **Machine-learning risk prediction** — calibrated scikit-learn random forest over 6 live features (EVI, air temperature, wind, humidity, elevation, KBDI drought index). Sigmoid-calibrated with spatial-block cross-validation; per-feature SHAP attribution in `backend/ml/RESULTS.md`
- **Map-based visualization** — deck.gl + Google Maps with risk zones, active fire perimeters, historical perimeters (1950–present), evacuation routes, and emergency shelters
- **Alerts and notifications** — three opt-in email channels (high-risk zones for your saved locations, breaking fire news, evacuation orders with nearest open shelters), powered by Resend on `alerts@firescope.dev`, scheduled via three GitHub-Actions cron workflows (every 30/60/10 min). State-driven dedup so users only get re-emailed when the situation actually changes.

## Team

- Ido Cohen
- Alex Hernandez-Abergo
- Ivan Lopez
- Tony Song
- Sannia Jean

## Features

- **Dashboard** — Split view: risk-zone map (county / ZIP / tract / neighborhood) + active-fire perimeter map with 4-tier containment coloring
- **Research page** — Slider-driven per-zone overrides (EVI, temperature, wind, humidity, elevation, **KBDI** 0–800) with live risk recomputation. Air temperature is displayed in Fahrenheit across every zone popup and slider.
- **History page** — 22k+ CAL FIRE perimeters back to 1878, year selector, fire search dropdown, click-to-inspect info card with decoded CAUSE codes, and per-year **CAL FIRE DINS structure damage** (2013→present) overlaid on each year's perimeters with a per-fire damage breakdown (Destroyed / Major / Minor / Affected / No Damage) so users immediately see whether a fire was a 0-structure wildland burn or a catastrophic urban-interface event. Year-aggregate card surfaces totals (e.g., "22,701 destroyed across 35 fires" for 2018)
- **Shelters & Evacuation** — 8,014 California pre-staged emergency shelters (CalOES mirror of the FEMA NSS dataset) with click-to-route both inside the FireScope map (Google DirectionsService polyline) and via "Open in Google Maps" turn-by-turn. Live statewide active **evacuation orders / warnings / advisories / shelter-in-place** zones from the Cal OES `CA_EVACUATIONS_PROD` aggregation (the same source Watch Duty consumes — pulls Genasys PROTECT zones plus county sheriffs). Always-visible centroid pins, "Show on map" zoom-to-fit banner, 60 s auto-refresh.
- **Active Fires** — NIFC year-to-date perimeters with CAL FIRE + WFIGS containment enrichment
- **Alerts page** — Per-user opt-in with master switch + three channel toggles (high-risk zones / breaking news / evacuation). No-saved-location guard for the high-risk toggle. Real backend, no localStorage stub. NWS Red Flag Warnings + GNews wildfire articles flow into the breaking-news channel.
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

Secrets are stored in Netlify and Render environment variables — never in the repo. Required Netlify env vars (already configured): `VITE_API_URL=https://firescope-api.onrender.com/api`, `VITE_GOOGLE_MAPS_API_KEY=…`. Both scoped to all contexts.

Push to `main` → CI auto-syncs `domain-deployment` → Netlify builds + publishes. No manual deploy needed.

## Data Sources

See the in-app **Settings → About** page (`/settings`) for the full list with badges, or browse `backend/routes/` for the ingestion code. Summary:

- **Satellite:** NASA FIRMS (VIIRS SNPP), NASA ORNL DAAC MODIS MOD13Q1 (EVI)
- **Fire agencies:** CAL FIRE Incidents & Historic Fire Perimeters, NIFC WFIGS (perimeters + incident locations), CAL FIRE DINS Damage Inspection Program (POSTFIRE_MASTER_DATA_SHARE — 132,000+ structures statewide, 2013→present)
- **Emergency management:** Cal OES `CA_EVACUATIONS_PROD` (statewide aggregation of Genasys PROTECT zones + county sheriff/EOC feeds), CalOES-mirrored CA Shelter System (8,014 facilities — replaces the gutted FEMA NSS public layer)
- **Weather & news:** NOAA NWS ATOM feed, Open-Meteo, GNews API
- **Mapping:** Google Maps Platform, deck.gl v9
- **Boundaries:** U.S. Census TIGER/Line — 58 counties, 1,769 ZIP codes, 8,041 census tracts, 1,521 neighborhoods

## Machine-Learning Model

Sigmoid-calibrated random forest predicting wildfire risk from 6 live inputs:

1. `evi` — Enhanced Vegetation Index (MODIS MOD13Q1, GEE-sourced with USGS-backed IDW safety net)
2. `air_temp_encoded` — `(°C + 273.15) / 0.02`
3. `wind` — wind speed (m/s)
4. `humidity` — relative humidity (%)
5. `elevation` — meters above sea level (USGS 3DEP, per-tile DB cache, forever-cached)
6. `kbdi` — Keetch-Byram Drought Index (NASA POWER, per-tile DB cache, 24 h TTL)

Output: `risk_score` (0–1) + `label` (Low / Medium / High / Extreme). Trained with spatial-block cross-validation and sigmoid calibration to keep probabilities honest under regional drift; SHAP attribution lives in `backend/ml/RESULTS.md` and the v2.5→v2.6 fingerprint comparison in `backend/ml/CALIBRATION_REPORT.md`. The frontend collapses the four labels into a 3-tier zone palette (green / yellow / red) on the Dashboard, Risk Map, and Research views. Per-zone overrides via `POST /api/predict-custom`.

### Model evolution — what changed in v2.5 → v2.6

| | Previous model (≤ v2.4) | Current model (v2.6 → v2.7) |
|---|---|---|
| **Algorithm** | KNN, then an early uncalibrated Random Forest | Random Forest (300 trees, `class_weight=balanced`), wrapped in `CalibratedClassifierCV` with sigmoid / Platt scaling (`cv=5`) |
| **Features** | 5 inputs (EVI, air temp, wind, humidity, elevation) | 6 inputs — adds **KBDI** (Keetch-Byram Drought Index), a 30-day cumulative soil-moisture-deficit signal that directly captures drought stress the other features miss |
| **EVI / elevation sourcing at inference** | Nearest-neighbor lookup from a baked-in sample table (so every zone in the same neighborhood got the same value) | Real **MODIS EVI via Google Earth Engine** + real **USGS 3DEP elevation**, each backed by per-tile Postgres caches with IDW fall-back when an upstream is cold or slow |
| **No-fire negatives** | Random California points with random 2020 dates — the model could shortcut by learning "summer ⇒ fire" because no-fire dates over-represented winter | **Date-restratified** (`restratify_dates.py`) so the no-fire date distribution matches the fire-date distribution. Kills the seasonal shortcut |
| **Cross-validation** | 10-fold stratified CV only | 10-fold stratified CV **plus spatial-block CV** (~55 km cells via `StratifiedGroupKFold`). Tests on regions never seen during training, so the headline metric isn't inflated by spatial autocorrelation between nearby pixels |
| **Probability calibration** | Raw RF vote counts — a "0.7" had no empirical meaning | Sigmoid (Platt) calibration so `predict_proba` returns probabilities that match observed fire frequencies. The Low / Medium / High / Extreme cut-points correspond to real empirical bins now, not arbitrary thresholds |
| **Interpretability** | None | **SHAP attribution** charts per feature (in `backend/ml/charts/`), plus a v2.5↔v2.6 archetype "fingerprint" comparison and a flagged coastal anomaly in `backend/ml/CALIBRATION_REPORT.md` |
| **Training-set size** | 1,000 California-2020 samples | **1,022 California-2020 samples** (511 FIRMS fire detections + 511 generated no-fire points) — same scale; quality improvements came from method and features, not volume |
| **Headline metrics** | ~88% accuracy on random CV; spatial CV not reported | **91.7% accuracy, ROC-AUC 0.964** on the new CV regime (numbers from `backend/ml/README.md`) |
| **Retraining cadence** | Manual `python -m ml.retrain` | Still manual. Continuous retraining is queued for a future release (would need a GHA workflow that ingests new FIRMS detections, runs EVI/weather/elevation/KBDI enrichment, and commits a new `.pkl`) |

**Plain-language summary.** The v2.6 model is the same size of dataset, but the data, the features, and the evaluation are all stricter. Drought is now an explicit input. The no-fire points no longer leak a seasonal shortcut. The probabilities the model emits are empirically calibrated instead of being raw vote counts. And the cross-validation tests on regions the model has never seen, so the reported accuracy is the honest one, not the inflated one. SHAP charts in `backend/ml/charts/` show which features actually drove each prediction.

## Workflow Guidelines

- Feature branches for new work; keep PRs small and focused.
- Run `npm run build` (frontend) and `pytest` (backend) before opening a PR.
- Update the **About** page in `frontend/src/components/settings-page.tsx` when adding a new data source.
- Never commit API keys, `.env` files, or database dumps.

## License

No license declared yet. Add one before any external release.
