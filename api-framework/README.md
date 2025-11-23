# API Framework (Flask)

Flask API skeleton with versioned routes and mock prediction endpoints

## Run (dev) — macOS
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
export FLASK_APP=wsgi.py
flask run
```

## Endpoints
- GET /health
- GET /api/v1/ping
- POST /api/v1/predict
- POST /api/v1/predict/batch
- GET /api/v1/predict/batch/<job_id>

## Quick Test
```bash
curl http://127.0.0.1:5000/health
curl http://127.0.0.1:5000/api/v1/ping
```

## Single Prediction (mock data)
```bash
curl -X POST http://127.0.0.1:5000/api/v1/predict \
  -H "Content-Type: application/json" \
  -d '{"lat":34.25,"lon":-118.5,"date":"2025-06-01"}'
```

## Batch Prediction (mock data)
```bash
curl -X POST http://127.0.0.1:5000/api/v1/predict/batch \
  -H "Content-Type: application/json" \
  -d '{"items":[{"lat":34.25,"lon":-118.5},{"lat":34.1,"lon":-118.3}]}'
```