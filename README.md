# Geo Info Data Visualization Project

Wildfire prediction and geospatial visualization senior research project at California State University, Northridge.

## Team

- Ido Cohen
- Alex Hernandez-Abergo
- Ivan Lopez
- Tony Song
- Sannia Jean

---

## Getting Started

The project has two parts that run separately — a **frontend** (React) and a **backend** (Flask). Both need to be running for the full app to work.

### Prerequisites

- Node.js 18+
- Python 3.10+
- PostgreSQL 14+ (or SQLite for local development)

---

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
# Fill in VITE_GOOGLE_MAPS_API_KEY and VITE_API_URL in .env
npm run dev
```

App will be available at **http://localhost:3000**

---

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

---

## Project Structure

```
├── frontend/        # React + TypeScript web app (Vite)
├── backend/         # Flask REST API
│   ├── routes/      # API endpoints (auth, predict, notifications, admin)
│   ├── ml/          # Wildfire risk ML model and inference module
│   ├── data/        # Hardcoded sample location feature data
│   └── tests/       # pytest test suite
└── software-requirements-specification.md
```

---

## Docs

- [Backend setup and API reference](backend/README.md)
- [ML model details](backend/ml/README.md)
- [Software Requirements Specification](software-requirements-specification.md)
