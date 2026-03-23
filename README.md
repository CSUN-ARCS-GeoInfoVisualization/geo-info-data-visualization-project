# geo-info-data-visualization-project
Wildfire  Prediction Senior Research Project conducted at California State University, Northridge

Team Members:

## Overview

This project aims to help residents and researchers understand wildfire risk across California by combining:

- geospatial data ingestion and preprocessing,
- machine learning risk prediction,
- map-based visualization,
- alerts and notifications.

The system is documented in `software-requirements-specification.md` and is currently in active development.

## Team

- Ido Cohen
- Alex Hernandez-Abergo
- Ivan Lopez
- Tony Song
- Sannia Jean

## Repository Structure

Current top-level folders:

- `frontend/` - Web UI (map visualization, user workflows, reusable UI components)
- `backend/` - API routes, ML inference module, and backend service logic
  - `routes/` - API endpoints (auth, predict, notifications, admin)
  - `ml/` - Wildfire risk ML model and inference module
  - `data/` - Hardcoded sample location feature data
  - `tests/` - pytest test suite
- `migrations/` - Alembic database migrations

Supporting docs:

- `software-requirements-specification.md` - Full SRS (features, requirements, constraints)
- `README.md` - Project entry point and contribution guide

## Planned Core Features

- Risk map visualization with date filters and GIS layer toggles
- Prediction API for single and batch wildfire risk requests
- Alerts/notifications based on user-defined risk thresholds
- Data ingestion pipeline for weather, vegetation, elevation, and fire history data
- Admin workflows for refresh schedules and configuration

## Current Status

This repository contains a working frontend (React + TypeScript) and backend (Flask) with a live wildfire risk prediction endpoint powered by a trained ML model.

## Getting Started

### Option 1 — Docker (Recommended)

The easiest way to run the full stack. Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

**1. Create a `.env` file in the project root with the following variables:**

```env
DB_USER=wildfire_app
DB_PASSWORD=your_db_password
DB_NAME=wildfire_db
SECRET_KEY=your_secret_key
JWT_SECRET_KEY=your_jwt_secret_key
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=your_admin_password
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

| Variable | Description |
|---|---|
| `DB_USER` | Postgres username |
| `DB_PASSWORD` | Postgres password |
| `DB_NAME` | Postgres database name |
| `SECRET_KEY` | Flask session secret (any long random string) |
| `JWT_SECRET_KEY` | JWT signing secret (any long random string, different from above) |
| `INITIAL_ADMIN_EMAIL` | Email for the seeded admin account |
| `INITIAL_ADMIN_PASSWORD` | Password for the seeded admin account |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps API key |

**2. Build and start everything:**

```bash
docker-compose up --build
```

Docker will start Postgres, run database migrations, seed the admin account, and start both the backend and frontend automatically.

- Frontend → **http://localhost**
- Backend API → **http://localhost:5000/api**

**Subsequent starts (no code changes):**
```bash
docker-compose up
```

**Stop everything:**
```bash
docker-compose down
```

**Wipe the database and start fresh:**
```bash
docker-compose down -v
docker-compose up --build
```

---

### Option 2 — Manual Setup

Run the frontend and backend separately without Docker.

#### Prerequisites

- Node.js 18+
- Python 3.10+
- PostgreSQL 14+ (or use `DATABASE_URL=sqlite:///dev.db` for local development)

#### Backend

**Linux / macOS**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Fill in SECRET_KEY, JWT_SECRET_KEY, DATABASE_URL, and admin credentials in .env
python -m flask --app app.py db upgrade
python seed.py
python app.py
```

**Windows (PowerShell)**
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Fill in SECRET_KEY, JWT_SECRET_KEY, DATABASE_URL, and admin credentials in .env
flask db upgrade
python seed.py
python app.py
```

API will be available at **http://localhost:5000**

#### Frontend

```bash
cd frontend
npm install
cp .env.example .env
# Fill in VITE_GOOGLE_MAPS_API_KEY and VITE_API_URL in .env
npm run dev
```

App will be available at **http://localhost:3000**

## Workflow Guidelines

- Use feature branches for new work.
- Keep pull requests focused and small.
- Update documentation when requirements or architecture change.
- Keep code aligned with the SRS feature definitions.

## Documentation

- [Backend setup and API reference](backend/README.md)
- [ML model details](backend/ml/README.md)
- [Software Requirements Specification](software-requirements-specification.md)

## Roadmap (MVP Focus)

1. Establish backend API contracts for prediction and map layer data.
2. Build map visualization UI and connect API integration.
3. Implement model inference pipeline and baseline prediction service.
4. Add alerts/notification preferences and delivery flow.
5. Expand test coverage for core user and API paths.

## License

No license has been declared yet.

If this project will be shared publicly, add a license file before release.
