# This folder defines a small bunble of routes (blueprint) for version 1

from flask import Blueprint

bp = Blueprint("v1", __name__, url_prefix="/api/v1")

@bp.get("/ping")
def ping():
    return {"message": "pong"}, 200