"""Resolve (lat, lon) → zone identity (county, zip, neighborhood, census tract).

Pure-Python point-in-polygon (ray casting) against the GeoJSON files in
``backend/data/boundaries``. Nearest-centroid fallback for counties since we
don't ship county polygons. Each boundary file is loaded once and cached for
the life of the worker; the per-feature centroid is computed lazily.
"""
from __future__ import annotations

import json
import math
import os
from typing import Optional, TypedDict


_BOUNDARIES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "boundaries")


class ZoneHit(TypedDict, total=False):
    id: str          # the zone id (zip code, tract id, neighborhood id, county fips/name)
    name: str        # human label
    centroid_lat: float
    centroid_lon: float


def _point_in_ring(lon: float, lat: float, ring: list) -> bool:
    """Standard ray-casting PIP for a single linear ring in [lon, lat] order."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def _point_in_polygon(lon: float, lat: float, coords: list) -> bool:
    """Polygon = [outer_ring, hole1, hole2, ...]. Inside outer, outside all holes."""
    if not coords:
        return False
    if not _point_in_ring(lon, lat, coords[0]):
        return False
    for hole in coords[1:]:
        if _point_in_ring(lon, lat, hole):
            return False
    return True


def _point_in_multipolygon(lon: float, lat: float, coords: list) -> bool:
    return any(_point_in_polygon(lon, lat, poly) for poly in coords)


def _feature_contains(feature: dict, lon: float, lat: float) -> bool:
    geom = feature.get("geometry") or {}
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon":
        return _point_in_polygon(lon, lat, coords)
    if gtype == "MultiPolygon":
        return _point_in_multipolygon(lon, lat, coords)
    return False


def _centroid_of_ring(ring: list) -> tuple[float, float]:
    """Cheap average of ring coordinates — good enough for ML feature sampling."""
    if not ring:
        return (0.0, 0.0)
    n = len(ring)
    return (sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n)


def _feature_centroid(feature: dict) -> tuple[float, float]:
    geom = feature.get("geometry") or {}
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon" and coords:
        lon, lat = _centroid_of_ring(coords[0])
        return (lat, lon)
    if gtype == "MultiPolygon" and coords:
        # Use the first (largest by convention) polygon's outer ring centroid.
        lon, lat = _centroid_of_ring(coords[0][0])
        return (lat, lon)
    return (0.0, 0.0)


_boundary_cache: dict[str, dict] = {}


def _load(zone_type: str) -> dict:
    """zone_type ∈ {'zip-codes', 'neighborhoods', 'census-tracts'}."""
    if zone_type in _boundary_cache:
        return _boundary_cache[zone_type]
    path = os.path.join(_BOUNDARIES_DIR, f"{zone_type}.json")
    with open(path) as f:
        data = json.load(f)
    _boundary_cache[zone_type] = data
    return data


def _resolve_polygon_zone(lat: float, lon: float, zone_type: str, id_key: str) -> Optional[ZoneHit]:
    """Find the first feature whose polygon contains the point."""
    data = _load(zone_type)
    for feat in data.get("features", []):
        if _feature_contains(feat, lon, lat):
            props = feat.get("properties") or {}
            zid = str(props.get(id_key, ""))
            name = str(props.get("name", zid))
            clat, clon = _feature_centroid(feat)
            return {"id": zid, "name": name, "centroid_lat": clat, "centroid_lon": clon}
    return None


# California county centroids (mirrors backend/routes/research.py CA_COUNTY_CENTROIDS).
# Kept here so the resolver has no cross-package imports.
CA_COUNTY_CENTROIDS = [
    ("Alameda", 37.65, -121.89), ("Alpine", 38.60, -119.82), ("Amador", 38.45, -120.65),
    ("Butte", 39.67, -121.60), ("Calaveras", 38.20, -120.55), ("Colusa", 39.18, -122.24),
    ("Contra Costa", 37.92, -121.95), ("Del Norte", 41.74, -123.90), ("El Dorado", 38.78, -120.52),
    ("Fresno", 36.95, -119.65), ("Glenn", 39.60, -122.39), ("Humboldt", 40.70, -123.87),
    ("Imperial", 33.04, -115.36), ("Inyo", 36.54, -117.99), ("Kern", 35.35, -118.73),
    ("Kings", 36.07, -119.82), ("Lake", 39.10, -122.75), ("Lassen", 40.67, -120.73),
    ("Los Angeles", 34.32, -118.22), ("Madera", 37.22, -119.76), ("Marin", 38.08, -122.72),
    ("Mariposa", 37.58, -119.97), ("Mendocino", 39.44, -123.39), ("Merced", 37.19, -120.72),
    ("Modoc", 41.59, -120.72), ("Mono", 37.94, -118.89), ("Monterey", 36.24, -121.31),
    ("Napa", 38.50, -122.33), ("Nevada", 39.30, -120.77), ("Orange", 33.72, -117.78),
    ("Placer", 39.06, -120.72), ("Plumas", 40.01, -120.84), ("Riverside", 33.74, -115.99),
    ("Sacramento", 38.45, -121.34), ("San Benito", 36.61, -121.08), ("San Bernardino", 34.84, -116.18),
    ("San Diego", 33.03, -116.74), ("San Francisco", 37.78, -122.42), ("San Joaquin", 37.93, -121.27),
    ("San Luis Obispo", 35.38, -120.45), ("San Mateo", 37.43, -122.36), ("Santa Barbara", 34.74, -119.80),
    ("Santa Clara", 37.23, -121.70), ("Santa Cruz", 37.06, -122.01), ("Shasta", 40.76, -122.04),
    ("Sierra", 39.58, -120.52), ("Siskiyou", 41.59, -122.54), ("Solano", 38.27, -121.93),
    ("Sonoma", 38.53, -122.93), ("Stanislaus", 37.56, -121.00), ("Sutter", 39.03, -121.69),
    ("Tehama", 40.13, -122.24), ("Trinity", 40.81, -123.01), ("Tulare", 36.23, -118.78),
    ("Tuolumne", 38.03, -119.97), ("Ventura", 34.36, -119.13), ("Yolo", 38.69, -121.90),
    ("Yuba", 39.29, -121.35),
]


def _nearest_county(lat: float, lon: float) -> ZoneHit:
    best = None
    best_dist = math.inf
    for name, clat, clon in CA_COUNTY_CENTROIDS:
        d = (clat - lat) ** 2 + (clon - lon) ** 2
        if d < best_dist:
            best_dist = d
            best = (name, clat, clon)
    name, clat, clon = best  # type: ignore[misc]
    return {"id": name, "name": name, "centroid_lat": clat, "centroid_lon": clon}


def resolve_all(lat: float, lon: float) -> dict[str, Optional[ZoneHit]]:
    """Return one ZoneHit per zone type (county/zip/neighborhood/census), or None if not found."""
    return {
        "county":       _nearest_county(lat, lon),
        "zip":          _resolve_polygon_zone(lat, lon, "zip-codes",      "zip"),
        "neighborhood": _resolve_polygon_zone(lat, lon, "neighborhoods",  "id"),
        "census_tract": _resolve_polygon_zone(lat, lon, "census-tracts",  "tract"),
    }
