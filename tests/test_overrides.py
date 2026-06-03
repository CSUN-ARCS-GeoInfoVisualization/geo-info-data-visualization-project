"""Per-user, per-zone 24h-TTL override tests.

Covers the /api/overrides endpoints:
  - save upserts one row per (user, scope, zone) and freezes risk_score+label
  - save sets expires_at ~24h ahead; re-saving refreshes the window
  - list returns only non-expired rows and prunes expired ones (space frees up)
  - input validation (scope, zone_id, the 6 required features)
  - JWT required
  - deletes are owner-scoped

ml.inference.predict_from_features is stubbed so the test doesn't load the
pickled sklearn model (that path is exercised in prod via /api/predict-custom).
We assert the route stores exactly what the model returned (the freeze).
"""
import sys
import os
import types
from datetime import datetime, timedelta, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))

# Stub ml.inference before importing the blueprint that imports it.
_ml = types.ModuleType("ml")
_ml_inf = types.ModuleType("ml.inference")


def _fake_predict(evi, air_temp_encoded, wind, humidity, elevation, kbdi):
    return {"risk_score": round(0.001 * kbdi + 0.01 * wind, 4), "label": "High"}


_ml_inf.predict_from_features = _fake_predict
sys.modules["ml"] = _ml
sys.modules["ml.inference"] = _ml_inf

from flask import Flask  # noqa: E402
from flask_jwt_extended import JWTManager, create_access_token  # noqa: E402
from models import db, User, Role, UserOverride  # noqa: E402
from routes.overrides import overrides_bp  # noqa: E402


PAYLOAD = {
    "scope": "county", "zone_id": "Los Angeles", "zone_name": "Los Angeles",
    "evi": 0.2, "air_temp_encoded": 15000.0, "wind": 5.0,
    "humidity": 50.0, "elevation": 100.0, "kbdi": 400.0,
}


def _make_app():
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["JWT_SECRET_KEY"] = "test-secret-key-at-least-32-bytes-long!!"
    db.init_app(app)
    JWTManager(app)
    app.register_blueprint(overrides_bp, url_prefix="/api")
    with app.app_context():
        db.create_all()
        db.session.add(Role(name="user"))
        db.session.commit()
        u1 = User(email="a@a.com", password_hash=User.hash_password("x"), role_id=1)
        u2 = User(email="b@b.com", password_hash=User.hash_password("x"), role_id=1)
        db.session.add_all([u1, u2])
        db.session.commit()
        t1 = create_access_token(identity=str(u1.id))
        t2 = create_access_token(identity=str(u2.id))
        uid1 = u1.id
    return app, {"Authorization": f"Bearer {t1}"}, {"Authorization": f"Bearer {t2}"}, uid1


def test_save_freezes_model_score_and_returns_200():
    app, h, _, _ = _make_app()
    c = app.test_client()
    r = c.post("/api/overrides", json=PAYLOAD, headers=h)
    assert r.status_code == 200
    j = r.get_json()
    expected = _fake_predict(**{k: PAYLOAD[k] for k in
        ("evi", "air_temp_encoded", "wind", "humidity", "elevation", "kbdi")})["risk_score"]
    assert j["risk_score"] == expected
    assert j["label"] == "High"
    assert j["scope"] == "county" and j["zone_id"] == "Los Angeles"


def test_save_sets_24h_ttl():
    app, h, _, _ = _make_app()
    c = app.test_client()
    j = c.post("/api/overrides", json=PAYLOAD, headers=h).get_json()
    exp = datetime.fromisoformat(j["expires_at"])
    if exp.tzinfo is None:  # SQLite drops tz; Postgres keeps it
        exp = exp.replace(tzinfo=timezone.utc)
    delta = exp - datetime.now(timezone.utc)
    # ~24h ahead (allow a couple minutes of slack)
    assert timedelta(hours=23, minutes=58) < delta <= timedelta(hours=24, minutes=1)


def test_save_is_upsert_per_zone():
    app, h, _, uid = _make_app()
    c = app.test_client()
    first = c.post("/api/overrides", json=PAYLOAD, headers=h).get_json()
    # re-save same zone with a different kbdi -> same row, new value + new window
    second = c.post("/api/overrides", json={**PAYLOAD, "kbdi": 800.0}, headers=h).get_json()
    assert first["id"] == second["id"], "upsert must reuse the same row"
    assert second["kbdi"] == 800.0
    assert len(c.get("/api/overrides", headers=h).get_json()) == 1
    # a DIFFERENT zone makes a second row
    c.post("/api/overrides", json={**PAYLOAD, "zone_id": "Kern", "zone_name": "Kern"}, headers=h)
    assert len(c.get("/api/overrides", headers=h).get_json()) == 2


def test_expired_rows_pruned_and_hidden():
    app, h, _, uid = _make_app()
    c = app.test_client()
    c.post("/api/overrides", json=PAYLOAD, headers=h)
    # force-expire the row
    with app.app_context():
        o = UserOverride.query.filter_by(user_id=uid).first()
        o.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.session.commit()
    assert c.get("/api/overrides", headers=h).get_json() == []
    with app.app_context():
        assert UserOverride.query.filter_by(user_id=uid).count() == 0, "expired row must be deleted"


def test_list_and_scope_filter():
    app, h, _, _ = _make_app()
    c = app.test_client()
    c.post("/api/overrides", json=PAYLOAD, headers=h)
    assert len(c.get("/api/overrides", headers=h).get_json()) == 1
    assert len(c.get("/api/overrides?scope=zip", headers=h).get_json()) == 0
    assert c.get("/api/overrides?scope=bogus", headers=h).status_code == 400


def test_validation():
    app, h, _, _ = _make_app()
    c = app.test_client()
    assert c.post("/api/overrides", json={**PAYLOAD, "scope": "x"}, headers=h).status_code == 400
    assert c.post("/api/overrides", json={k: v for k, v in PAYLOAD.items() if k != "zone_id"}, headers=h).status_code == 400
    assert c.post("/api/overrides", json={k: v for k, v in PAYLOAD.items() if k != "kbdi"}, headers=h).status_code == 400


def test_jwt_required():
    app, _, _, _ = _make_app()
    assert app.test_client().get("/api/overrides").status_code == 401


def test_delete_is_owner_scoped():
    app, h, h2, _ = _make_app()
    c = app.test_client()
    oid = c.post("/api/overrides", json=PAYLOAD, headers=h).get_json()["id"]
    assert c.delete(f"/api/overrides/{oid}", headers=h2).status_code == 404
    assert c.delete(f"/api/overrides/{oid}", headers=h).status_code == 200
    assert len(c.get("/api/overrides", headers=h).get_json()) == 0
    assert c.delete("/api/overrides/9999", headers=h).status_code == 404


def test_delete_all_resets_every_zone():
    app, h, h2, _ = _make_app()
    c = app.test_client()
    c.post("/api/overrides", json=PAYLOAD, headers=h)
    c.post("/api/overrides", json={**PAYLOAD, "zone_id": "Kern", "zone_name": "Kern"}, headers=h)
    c.post("/api/overrides", json={**PAYLOAD, "scope": "zip", "zone_id": "90001"}, headers=h)
    # another user's override must survive
    c.post("/api/overrides", json=PAYLOAD, headers=h2)
    # scope-limited reset-all clears only county rows
    r = c.delete("/api/overrides?scope=county", headers=h)
    assert r.status_code == 200 and r.get_json()["deleted"] == 2
    rows = c.get("/api/overrides", headers=h).get_json()
    assert len(rows) == 1 and rows[0]["scope"] == "zip"
    # full reset-all clears the rest
    assert c.delete("/api/overrides", headers=h).get_json()["deleted"] == 1
    assert len(c.get("/api/overrides", headers=h).get_json()) == 0
    # other user untouched
    assert len(c.get("/api/overrides", headers=h2).get_json()) == 1
    assert c.delete("/api/overrides?scope=bogus", headers=h).status_code == 400


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
    print("ALL PASSED")
