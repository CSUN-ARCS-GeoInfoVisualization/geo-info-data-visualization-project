"""Geometry checks for the training ingest (used ONLY by the ingest cron).

Reuses the pure-Python point-in-polygon from data.zone_resolver so we don't ship
a second implementation. Two uses:

  * on_ca_land(lat, lon)        — is the point inside a California county polygon?
                                  Used to keep no-fire samples on CA land (no
                                  ocean / out-of-state points).
  * in_any_perimeter(lat, lon)  — is the point inside an active NIFC fire
                                  perimeter? Used to reject "no-fire" samples
                                  that are actually inside a burning area.
"""
from __future__ import annotations

import os
import json
from functools import lru_cache

from data.zone_resolver import _feature_contains, _BOUNDARIES_DIR


@lru_cache(maxsize=1)
def _county_features():
    path = os.path.join(_BOUNDARIES_DIR, "counties.json")
    try:
        with open(path) as f:
            return json.load(f).get("features", [])
    except Exception:
        return []


def on_ca_land(lat: float, lon: float) -> bool:
    """True if the point falls inside any California county polygon. Fail-open
    (returns True) if the county boundaries can't be loaded, so a data problem
    never silently empties the no-fire sample."""
    feats = _county_features()
    if not feats:
        return True
    return any(_feature_contains(ft, lon, lat) for ft in feats)


def in_any_perimeter(lat: float, lon: float, perimeters: dict) -> bool:
    """True if the point is inside any active fire perimeter polygon."""
    if not isinstance(perimeters, dict):
        return False
    feats = perimeters.get("features") or []
    return any(_feature_contains(ft, lon, lat) for ft in feats)
