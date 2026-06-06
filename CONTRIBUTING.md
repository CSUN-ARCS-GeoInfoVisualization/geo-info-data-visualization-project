# Contributing

Thanks for your interest in FireScope. This is a CSUN senior research project with a small team;
focused, well-tested changes are easiest to land. By contributing you agree your contributions are
licensed under the project [MIT License](LICENSE).

## Development setup

The fastest path is Docker; manual setup is documented in the [README](README.md#getting-started).

```bash
# Docker (recommended)
cp .env.example .env                 # fill DB creds, SECRET_KEY, JWT_SECRET_KEY, Google Maps key
docker-compose up --build            # frontend → http://localhost · API → http://localhost:5000/api
```

Manual backend:

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env
flask --app app.py db upgrade && python seed.py
python app.py                        # http://localhost:5000
pytest -q                            # should be green before you start
```

Manual frontend:

```bash
cd frontend && npm install && npm run dev    # expects the API on http://localhost:5000/api
```

## Workflow

1. Branch from `main`.
2. Make the change. Keep modules focused (~500 lines) and match the surrounding style.
3. Add or update tests. Backend tests live in `backend/tests/` (`pytest`); they must not require
   live network or real API keys — mock upstreams.
4. Run `pytest -q` for the backend and `npm run build` for the frontend. The build runs a
   **typecheck gate** (`frontend/scripts/typecheck-gate.cjs`) that fails on the undefined-reference
   crash class — fix any failure it reports rather than bypassing it.
5. Browser-verify any UI change. The map surface has click/overlay invariants (see below) that a
   type check can't catch.
6. Open a PR with a clear description of what changed and why.

## Deploy model — read before you push

- **Push to `main`.** CI (`.github/workflows/sync-domain-deployment.yml`) auto-merges `main` into
  `domain-deployment`, which Netlify builds. **Never force-push `domain-deployment`.**
- Backend pushes auto-restart Render (`restart-after-backend-deploy.yml`) because a Render "live"
  deploy does not reliably restart gunicorn. After a backend change, **verify the new behavior is
  actually live** (curl the endpoint) before calling it done.
- Continuous-retrain build plans and any internal planning docs stay **out of this public repo**.

## Architecture invariants (don't break these)

- **One `GoogleMapsOverlay` per map.** Multiple overlays = multiple canvases = blocked clicks.
- **The ML model loads once** at startup via `_ensure_loaded()` — never per-prediction. Its
  signature takes 6 features `[evi, air_temp_encoded, wind, humidity, elevation, kbdi]`.
- **Air temperature** is Fahrenheit in the UI, Kelvin-encoded in the model. Convert at the render
  boundary only.
- **`endpoint_cache`** writes must go through the cache helper, not raw payloads.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design and
[docs/SESSION_HANDOFF.md](docs/SESSION_HANDOFF.md) for the working handoff.

## Scope

FireScope is a California wildfire risk-visualization and alerting platform. New data sources,
risk-model improvements, map features, and accessibility fixes are welcome. Changes that add write
access to third-party systems, or that send user data anywhere beyond the chosen email provider, are
out of scope.
