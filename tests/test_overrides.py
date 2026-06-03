"""Per-user saved-override CRUD tests (PR-A of the saved-overrides feature).

Covers the new /api/overrides endpoints:
  - save freezes risk_score+label from the live model at save time
  - list + scope filter
  - input validation (scope, zone_id, the 6 required features)
  - JWT required
  - deletes are owner-scoped (a user can't touch another user's override)

The pre-existing model loader (ml.inference.predict_from_features) is stubbed
so the test doesn't depend on the pickled sklearn model — that path is already
exercised in prod via /api/predict-custom. We only assert the route stores
exactly what the model returned (the freeze guarantee).
"""
import sys
import os
import types

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
from models import db, User, Role  # noqa: E402
from routes.overrides import overrides_bp  # noqa: E402


PAYLOAD = {
    "scope": "county", "zone_id": "06037", "zone_name": "Los Angeles",
    "evi": 0.2, "air_temp_encoded": 15000.0, "wind": 5.0,
    "humidity": 20.0, "elevation": 100.0, "kbdi": 400.0, "note": "dry",
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
    return app, {"Authorization": f"Bearer {t1}"}, {"Authorization": f"Bearer {t2}"}


def test_save_freezes_model_score():
    app, h, _ = _make_app()
    c = app.test_client()
    r = c.post("/api/overrides", json=PAYLOAD, headers=h)
    assert r.status_code == 201
    j = r.get_json()
    assert j["risk_score"] == _fake_predict(**{k: PAYLOAD[k] for k in
        ("evi", "air_temp_encoded", "wind", "humidity", "elevation", "kbdi")})["risk_score"]
    assert j["label"] == "High"
    assert j["scope"] == "county" and j["zone_id"] == "06037"


def test_list_and_scope_filter():
    app, h, _ = _make_app()
    c = app.test_client()
    c.post("/api/overrides", json=PAYLOAD, headers=h)
    assert len(c.get("/api/overrides", headers=h).get_json()) == 1
    assert len(c.get("/api/overrides?scope=zip", headers=h).get_json()) == 0
    assert c.get("/api/overrides?scope=bogus", headers=h).status_code == 400


def test_validation():
    app, h, _ = _make_app()
    c = app.test_client()
    assert c.post("/api/overrides", json={**PAYLOAD, "scope": "x"}, headers=h).status_code == 400
    assert c.post("/api/overrides", json={k: v for k, v in PAYLOAD.items() if k != "zone_id"}, headers=h).status_code == 400
    assert c.post("/api/overrides", json={k: v for k, v in PAYLOAD.items() if k != "kbdi"}, headers=h).status_code == 400


def test_jwt_required():
    app, _, _ = _make_app()
    assert app.test_client().get("/api/overrides").status_code == 401


def test_delete_is_owner_scoped():
    app, h, h2 = _make_app()
    c = app.test_client()
    oid = c.post("/api/overrides", json=PAYLOAD, headers=h).get_json()["id"]
    # other user can't delete it
    assert c.delete(f"/api/overrides/{oid}", headers=h2).status_code == 404
    # owner can
    assert c.delete(f"/api/overrides/{oid}", headers=h).status_code == 200
    assert len(c.get("/api/overrides", headers=h).get_json()) == 0
    assert c.delete("/api/overrides/9999", headers=h).status_code == 404


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
    print("ALL PASSED")
