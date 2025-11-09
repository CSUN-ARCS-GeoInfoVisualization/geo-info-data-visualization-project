# API Framework (Flask)

Flask API skeleton with versioned routes.

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

## Quick Test
```bash
curl http://127.0.0.1:5000/health
curl http://127.0.0.1:5000/api/v1/ping
```
