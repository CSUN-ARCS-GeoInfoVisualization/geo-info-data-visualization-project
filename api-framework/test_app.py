# test_app.py

import pytest
from app import create_app


@pytest.fixture
def client():
    app = create_app("development")
    app.config["TESTING"] = True

    with app.test_client() as client:
        yield client


# Test for health

def test_health_ok_get(client):
    """
    Test Case 1 (health):
    Verify successful health check for valid GET request.
    """
    resp = client.get("/health")

    assert resp.status_code == 200
    assert resp.get_json() == {"status": "ok"}


def test_health_method_not_allowed(client):
    """
    Test Case 2 (health):
    Verify that unsupported HTTP method is rejected.
    """
    resp = client.post("/health")

    assert resp.status_code == 405  



# Test for ping

def test_ping_ok_get(client):
    """
    Test Case 1 (ping):
    Verify successful ping for valid GET request.
    """
    resp = client.get("/api/v1/ping")

    assert resp.status_code == 200
    assert resp.get_json() == {"message": "pong"}


def test_ping_not_found_without_prefix(client):
    """
    Test Case 2 (ping):
    Verify that ping endpoint is not found without the /api/v1 prefix.
    """
    resp = client.get("/ping")

    assert resp.status_code == 404 

