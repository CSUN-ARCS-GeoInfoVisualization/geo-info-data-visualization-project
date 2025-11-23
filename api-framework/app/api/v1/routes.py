# API v1 routes: ping + mock prediction endpoints

from flask import Blueprint, request
import logging
import uuid
import datetime
import math

bp = Blueprint("v1", __name__, url_prefix="/api/v1")

logger = logging.getLogger(__name__)

# small in-memory stores for demo only
PREDICTION_LOG = []
BATCH_JOBS = {}


@bp.get("/ping")
def ping():
    return {"message": "pong"}, 200


def _mock_risk_score(lat: float, lon: float, date_str: str):
    """
    Make a fake wildfire risk score based on lat/lon/date.
    This is only for mock data, not a real model.
    """
    try:
        d = datetime.date.fromisoformat(date_str)
        day_of_year = d.timetuple().tm_yday
    except Exception:
        day_of_year = 180  # default "summer-ish" day

    # simple formula so it feels location + season based
    base = (abs(lat) + abs(lon)) % 90 / 90.0
    seasonal = (math.sin(day_of_year / 365.0 * 2 * math.pi) + 1) / 2
    prob = 0.2 + 0.6 * (0.5 * base + 0.5 * seasonal)
    prob = max(0.01, min(prob, 0.99))

    half_width = 0.12
    low = max(0.0, prob - half_width)
    high = min(1.0, prob + half_width)

    if prob < 0.3:
        level = "low"
    elif prob < 0.6:
        level = "medium"
    else:
        level = "high"

    return prob, (low, high), level


def _log_request(payload, kind: str):
    entry = {
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "kind": kind,
        "payload": payload,
    }
    PREDICTION_LOG.append(entry)
    logger.info("Prediction %s: %s", kind, entry)


@bp.post("/predict")
def predict_single():
    """
    Single-area prediction with mock data.
    """
    data = request.get_json(silent=True) or {}

    missing = [f for f in ("lat", "lon") if f not in data]
    if missing:
        return {"error": f"Missing required field(s): {', '.join(missing)}"}, 400

    try:
        lat = float(data["lat"])
        lon = float(data["lon"])
    except (TypeError, ValueError):
        return {"error": "lat and lon must be numbers"}, 400

    date_str = data.get("date") or datetime.date.today().isoformat()

    prob, (low, high), level = _mock_risk_score(lat, lon, date_str)

    result = {
        "region": {"lat": lat, "lon": lon},
        "date": date_str,
        "prediction": {
            "risk_probability": round(prob, 3),
            "confidence_interval": [round(low, 3), round(high, 3)],
            "risk_level": level,
        },
        "model": {
            "version": "mock-v1",
            "top_factors": ["temperature", "wind_speed", "vegetation_dryness"],
        },
    }

    _log_request(data, kind="single")

    return result, 200


@bp.post("/predict/batch")
def predict_batch():
    """
    Batch prediction with mock data.
    """
    data = request.get_json(silent=True) or {}
    items = data.get("items")

    if not isinstance(items, list) or not items:
        return {"error": "items must be a non-empty list"}, 400

    results = []
    for idx, item in enumerate(items):
        try:
            lat = float(item["lat"])
            lon = float(item["lon"])
        except (KeyError, TypeError, ValueError):
            return {"error": f"Invalid or missing lat/lon for item {idx}"}, 400

        date_str = item.get("date") or datetime.date.today().isoformat()
        prob, (low, high), level = _mock_risk_score(lat, lon, date_str)

        results.append(
            {
                "region": {"lat": lat, "lon": lon},
                "date": date_str,
                "prediction": {
                    "risk_probability": round(prob, 3),
                    "confidence_interval": [round(low, 3), round(high, 3)],
                    "risk_level": level,
                },
                "model": {
                    "version": "mock-v1",
                    "top_factors": [
                        "temperature",
                        "wind_speed",
                        "vegetation_dryness",
                    ],
                },
            }
        )

    job_id = str(uuid.uuid4())

    job = {
        "job_id": job_id,
        "status": "completed",  # mock: done right away
        "results": results,
        "download_url": f"/api/v1/predict/batch/{job_id}",
    }

    BATCH_JOBS[job_id] = job
    _log_request(data, kind="batch")

    return job, 200


@bp.get("/predict/batch/<job_id>")
def get_batch_job(job_id):
    job = BATCH_JOBS.get(job_id)
    if not job:
        return {"error": "job not found"}, 404
    return job, 200