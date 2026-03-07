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

The project has two parts that run separately — a **frontend** (React) and a **backend** (Flask). Both need to be running for the full app to work.

### Prerequisites

- Node.js 18+
- Python 3.10+
- PostgreSQL 14+ (or SQLite for local development)

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
# Fill in VITE_GOOGLE_MAPS_API_KEY and VITE_API_URL in .env
npm run dev
```

App will be available at **http://localhost:3000**

### Backend

**Linux / macOS**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Fill in SECRET_KEY, JWT_SECRET_KEY, and DATABASE_URL in .env
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
# Fill in SECRET_KEY, JWT_SECRET_KEY, and DATABASE_URL in .env
python seed.py
python app.py
```

API will be available at **http://localhost:5000**

> For local development without PostgreSQL, set `DATABASE_URL=sqlite:///dev.db` in `.env`

### Running the App

After completing setup, use these commands each time you want to start the app. Open two separate terminals:

**Terminal 1 — Start the backend:**

Linux / macOS:
```bash
cd backend
source .venv/bin/activate
python app.py
```

Windows (PowerShell):
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python app.py
```

**Terminal 2 — Start the frontend:**
```bash
cd frontend
npm run dev
```

Then open **http://localhost:3000** in your browser.

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
