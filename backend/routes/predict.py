import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests as http_requests
from flask import Blueprint, request, jsonify
from ml.inference import predict_from_features
from data.sample_locations import SAMPLE_LOCATIONS

logger = logging.getLogger(__name__)

from data.live_weather import get_weather
from data.live_elevation import get_elevation
from data.live_evi import get_evi

BATCH_MAX_SIZE   = 500
BATCH_WORKERS    = 8

predict_bp = Blueprint('predict', __name__)

MODEL_VERSION = "predictive-v1"


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres between two lat/lon points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def _nearest_location(lat: float, lon: float) -> dict:
    """Return the sample location with the shortest great-circle distance to (lat, lon)."""
    return min(SAMPLE_LOCATIONS, key=lambda loc: _haversine_km(lat, lon, loc["lat"], loc["lon"]))


def _validate_coords(lat: float, lon: float):
    if not (-90 <= lat <= 90):
        raise ValueError(f"lat {lat} out of range [-90, 90]")
    if not (-180 <= lon <= 180):
        raise ValueError(f"lon {lon} out of range [-180, 180]")


# Per-coordinate prediction cache. Keyed on rounded lat/lon (~110m granularity)
# so a researcher's saved location and an idle dashboard polling identical
# coords share the same expensive 3× live-fetch + ML call. 5-min TTL keeps
# weather fresh enough for risk decisions.
_PREDICT_CACHE: dict = {}
_PREDICT_TTL = 300


def _run(lat: float, lon: float) -> dict:
    cache_key = (round(lat, 3), round(lon, 3))
    now = time.time()
    cached = _PREDICT_CACHE.get(cache_key)
    if cached and cached["expires"] > now:
        return cached["data"]

    loc = _nearest_location(lat, lon)

    # Fire weather + elevation + EVI in PARALLEL instead of sequential.
    # Was: 3 sequential HTTP calls = ~1.5-4s. Now: bounded by the slowest = ~1s.
    with ThreadPoolExecutor(max_workers=3) as ex:
        f_weather = ex.submit(get_weather, lat, lon)
        f_elev    = ex.submit(get_elevation, lat, lon)
        f_evi     = ex.submit(get_evi, lat, lon)

        try:
            weather          = f_weather.result(timeout=8)
            wind             = weather["wind_speed"]
            humidity         = weather["humidity"]
            # air_temp_encoded: air temperature as (°C + 273.15) / 0.02 — NOT MODIS LST.
            air_temp_encoded = (weather["temperature_celsius"] + 273.15) / 0.02
            weather_source   = "live"
        except Exception:
            wind             = loc["wind"]
            humidity         = loc["humidity"]
            air_temp_encoded = loc["air_temp_encoded"]
            weather_source   = "fallback"

        try:
            elevation = f_elev.result(timeout=8)
            elevation_source = "live"
        except Exception:
            elevation = loc["elevation"]
            elevation_source = "fallback"

        try:
            evi = f_evi.result(timeout=8)
            evi_source = "live"
        except Exception:
            evi = loc["evi"]
            evi_source = "fallback"

    result = predict_from_features(
        evi=evi,
        air_temp_encoded=air_temp_encoded,
        wind=wind,
        humidity=humidity,
        elevation=elevation,
    )
    payload = {
        "prediction": {
            "risk_level": result["label"],
            "risk_probability": result["risk_score"],
        },
        "model": {
            "version": MODEL_VERSION,
        },
        "location": {
            "requested_lat": lat,
            "requested_lon": lon,
            "matched_name": loc["name"],
            "matched_lat": loc["lat"],
            "matched_lon": loc["lon"],
        },
        "features": {
            "evi": result["evi"],
            "evi_source": evi_source,
            "air_temp_encoded": result["air_temp_encoded"],
            "air_temp_encoded_source": weather_source,
            "wind": result["wind"],
            "wind_source": weather_source,
            "humidity": result["humidity"],
            "humidity_source": weather_source,
            "elevation": result["elevation"],
            "elevation_source": elevation_source,
        },
    }
    _PREDICT_CACHE[cache_key] = {"data": payload, "expires": now + _PREDICT_TTL}
    return payload


@predict_bp.route('/predict', methods=['POST'])
def predict_single():
    data = request.get_json() or {}
    lat = data.get('lat')
    lon = data.get('lon')

    if lat is None or lon is None:
        return jsonify({'error': 'lat and lon are required'}), 400

    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return jsonify({'error': 'lat and lon must be numbers'}), 400

    try:
        _validate_coords(lat, lon)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    return jsonify(_run(lat, lon))


@predict_bp.route('/predict/batch', methods=['POST'])
def predict_batch():
    data = request.get_json() or {}
    items = data.get('items')

    if not isinstance(items, list) or len(items) == 0:
        return jsonify({'error': 'items must be a non-empty list'}), 400

    if len(items) > BATCH_MAX_SIZE:
        return jsonify({'error': f'batch size cannot exceed {BATCH_MAX_SIZE}'}), 400

    # Validate all inputs before running any predictions
    coords = []
    for i, item in enumerate(items):
        lat = item.get('lat')
        lon = item.get('lon')
        if lat is None or lon is None:
            return jsonify({'error': f'items[{i}] missing lat or lon'}), 400
        try:
            lat, lon = float(lat), float(lon)
        except (TypeError, ValueError):
            return jsonify({'error': f'items[{i}] lat and lon must be numbers'}), 400
        try:
            _validate_coords(lat, lon)
        except ValueError as e:
            return jsonify({'error': f'items[{i}]: {e}'}), 400
        coords.append((i, lat, lon))

    # Run predictions in parallel — each location fetches weather/EVI/elevation concurrently
    BATCH_TIMEOUT = 60  # seconds max for the entire batch
    results = [None] * len(coords)
    with ThreadPoolExecutor(max_workers=BATCH_WORKERS) as executor:
        futures = {executor.submit(_run, lat, lon): i for i, lat, lon in coords}
        for future in as_completed(futures, timeout=BATCH_TIMEOUT):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                logger.warning("Batch item %s failed: %s", idx, e)
                results[idx] = {'error': 'prediction failed for this location'}

    return jsonify({'results': results})


@predict_bp.route('/calfire/incidents', methods=['GET'])
def calfire_incidents():
    """Proxy CAL FIRE incidents API to avoid browser CORS restrictions."""
    inactive = request.args.get('inactive', 'false')
    try:
        r = http_requests.get(
            f'https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List?inactive={inactive}',
            timeout=15,
            headers={'User-Agent': 'FireScopeProxy/1.0'},
        )
        r.raise_for_status()
        return jsonify(r.json())
    except Exception as e:
        logger.warning('CAL FIRE proxy failed: %s', e)
        return jsonify([]), 200


@predict_bp.route('/predict-custom', methods=['POST'])
def predict_custom():
    """Predict risk from raw feature values (no location lookup)."""
    data = request.get_json() or {}
    try:
        evi              = float(data['evi'])
        air_temp_encoded = float(data['air_temp_encoded'])
        wind             = float(data['wind'])
        humidity         = float(data['humidity'])
        elevation        = float(data['elevation'])
    except (KeyError, TypeError, ValueError):
        return jsonify({'error': 'evi, air_temp_encoded, wind, humidity, elevation are required numbers'}), 400
    result = predict_from_features(evi=evi, air_temp_encoded=air_temp_encoded, wind=wind, humidity=humidity, elevation=elevation)
    zone_name = data.get('zone_name')
    resp = {'risk_score': result['risk_score'], 'label': result['label']}
    if zone_name is not None:
        resp['zone_name'] = zone_name
    return jsonify(resp)


def _norm_fire_name(s: str) -> str:
    return ''.join(c for c in (s or '').lower() if c.isalnum())


def _circle_polygon(lat: float, lon: float, radius_m: float, n: int = 36) -> list:
    """Return a GeoJSON-style polygon ring (list of [lon, lat]) approximating a
    circle of `radius_m` centered at (lat, lon). Equirectangular offsets — fine
    for the few-km scale of fire incidents."""
    lat_per_m = 1.0 / 110574.0
    lon_per_m = 1.0 / (111320.0 * max(math.cos(math.radians(lat)), 1e-6))
    ring = []
    for i in range(n):
        theta = 2 * math.pi * i / n
        dlat = radius_m * math.sin(theta) * lat_per_m
        dlon = radius_m * math.cos(theta) * lon_per_m
        ring.append([lon + dlon, lat + dlat])
    ring.append(ring[0])
    return ring


def _acres_to_radius_m(acres) -> float:
    """Convert acres to the radius of an equal-area circle, in meters.
    Floors to 400 m so tiny/new incidents remain visible."""
    try:
        a = float(acres)
    except (TypeError, ValueError):
        a = 0.0
    sq_m = max(a, 0.0) * 4046.86
    r = math.sqrt(sq_m / math.pi) if sq_m > 0 else 0.0
    return max(r, 400.0)


def _fetch_news_incident_features(existing_names: set) -> list:
    """Fetch CAL FIRE active incidents with lat/lon and synthesize circle-polygon
    features for any incident not already represented by a WFIGS perimeter.

    These are the fires users see discussed in alerts/news but which may not yet
    have a WFIGS perimeter polygon (new, small, or not ingested yet). Returned
    features match the WFIGS property schema so existing styling and tooltips
    work unchanged."""
    features = []
    try:
        r = http_requests.get(
            'https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List',
            params={'inactive': 'false'},
            timeout=12,
            headers={'User-Agent': 'FireScopeProxy/1.0'},
        )
        r.raise_for_status()
        incidents = r.json() or []
    except Exception as e:
        logger.warning('CAL FIRE incidents fetch (news layer) failed: %s', e)
        return features

    for inc in incidents:
        if not isinstance(inc, dict):
            continue
        name = inc.get('Name')
        nm = _norm_fire_name(name)
        if not nm or nm in existing_names:
            continue
        try:
            lat = float(inc.get('Latitude'))
            lon = float(inc.get('Longitude'))
        except (TypeError, ValueError):
            continue
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            continue
        # California bounding box sanity check (loose)
        if not (32.0 <= lat <= 42.5 and -125.0 <= lon <= -113.5):
            continue

        acres = inc.get('AcresBurned')
        radius_m = _acres_to_radius_m(acres)
        ring = _circle_polygon(lat, lon, radius_m)

        pct_raw = inc.get('PercentContained')
        try:
            pct = float(pct_raw) if pct_raw is not None else None
        except (TypeError, ValueError):
            pct = None
        if pct is not None and pct >= 100:
            continue

        try:
            acres_val = float(acres) if acres is not None else None
        except (TypeError, ValueError):
            acres_val = None

        features.append({
            'type': 'Feature',
            'geometry': {'type': 'Polygon', 'coordinates': [ring]},
            'properties': {
                'poly_IncidentName': name,
                'poly_GISAcres': acres_val,
                'poly_FeatureCategory': 'CAL FIRE Incident (news)',
                'attr_PercentContained': pct,
                'attr_FireDiscoveryDateTime': inc.get('Started'),
                'incident_url': inc.get('Url'),
                'news_source': 'cal_fire',
            },
        })
        existing_names.add(nm)
    return features


def _fetch_containment_by_name() -> dict:
    """Build a name->PercentContained lookup from CAL FIRE + WFIGS Incident Locations.

    The perimeter layer often has null PercentContained even when other feeds
    carry a real value, so we enrich the perimeter features with whichever
    number is available.
    """
    lookup: dict = {}

    # CAL FIRE
    try:
        r = http_requests.get(
            'https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List',
            params={'inactive': 'false'},
            timeout=12,
        )
        r.raise_for_status()
        for d in r.json() or []:
            nm = _norm_fire_name(d.get('Name'))
            pct = d.get('PercentContained')
            if nm and pct is not None:
                try:
                    lookup[nm] = float(pct)
                except Exception:
                    pass
    except Exception as e:
        logger.warning('CAL FIRE containment lookup failed: %s', e)

    # WFIGS Incident Locations — points layer carries PercentContained for many small fires
    try:
        r = http_requests.get(
            'https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/'
            'WFIGS_Incident_Locations_YearToDate/FeatureServer/0/query',
            params={
                'where': "POOState='US-CA'",
                'outFields': 'IncidentName,PercentContained',
                'f': 'json',
                'resultRecordCount': 5000,
            },
            timeout=15,
        )
        r.raise_for_status()
        for f in (r.json() or {}).get('features', []) or []:
            a = f.get('attributes') or {}
            nm = _norm_fire_name(a.get('IncidentName'))
            pct = a.get('PercentContained')
            if nm and pct is not None and nm not in lookup:
                try:
                    lookup[nm] = float(pct)
                except Exception:
                    pass
    except Exception as e:
        logger.warning('WFIGS locations containment lookup failed: %s', e)

    return lookup


_PERIMETER_CACHE: dict = {"data": None, "expires": 0.0}
_PERIMETER_TTL = 180  # NIFC perimeters refresh ~hourly upstream; 3 min keeps maps near-live


@predict_bp.route('/fire-perimeters', methods=['GET'])
def nifc_fire_perimeters():
    """Proxy NIFC WFIGS fire perimeters (California only) and enrich missing
    containment percentages from CAL FIRE + WFIGS Incident Locations so the
    4-tier color coding can actually kick in."""
    import time as _time
    now = _time.time()
    if _PERIMETER_CACHE["data"] is not None and _PERIMETER_CACHE["expires"] > now:
        resp = jsonify(_PERIMETER_CACHE["data"])
        resp.headers['Cache-Control'] = 'public, max-age=180, stale-while-revalidate=600'
        return resp
    try:
        r = http_requests.get(
            'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/'
            'WFIGS_Interagency_Perimeters_YearToDate/FeatureServer/0/query',
            params={
                # California only + drop fully-contained fires at the source
                'where': "attr_POOState='US-CA' AND (attr_PercentContained IS NULL OR attr_PercentContained < 100)",
                'outFields': 'poly_IncidentName,poly_GISAcres,poly_FeatureCategory,attr_PercentContained,attr_FireDiscoveryDateTime',
                'f': 'geojson',
            },
            timeout=20,
            headers={'User-Agent': 'FireScopeProxy/1.0'},
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.warning('NIFC perimeters proxy failed: %s', e)
        return jsonify({'type': 'FeatureCollection', 'features': []}), 200

    try:
        lookup = _fetch_containment_by_name()
        kept = []
        existing_names: set = set()
        for feat in (data or {}).get('features', []) or []:
            props = feat.get('properties') or {}
            if props.get('attr_PercentContained') is None:
                nm = _norm_fire_name(props.get('poly_IncidentName'))
                if nm in lookup:
                    props['attr_PercentContained'] = lookup[nm]
                    feat['properties'] = props
            # Re-apply the <100 filter after enrichment
            pct = props.get('attr_PercentContained')
            if pct is not None and float(pct) >= 100:
                continue
            kept.append(feat)
            nm = _norm_fire_name(props.get('poly_IncidentName'))
            if nm:
                existing_names.add(nm)
        data['features'] = kept
    except Exception as e:
        logger.warning('Containment enrichment failed: %s', e)
        existing_names = set()

    # Merge in CAL FIRE incidents from the alerts/news feed that aren't already
    # represented as WFIGS perimeters. These surface as circle polygons so every
    # map consuming /fire-perimeters (dashboard, risk map, evac routes, research)
    # shows the same incidents users read about in the news tab.
    try:
        news_feats = _fetch_news_incident_features(existing_names)
        if news_feats:
            data.setdefault('features', []).extend(news_feats)
            logger.info('fire-perimeters: appended %d news-sourced incident circles', len(news_feats))
    except Exception as e:
        logger.warning('News-incident merge failed: %s', e)

    _PERIMETER_CACHE["data"] = data
    _PERIMETER_CACHE["expires"] = now + _PERIMETER_TTL
    resp = jsonify(data)
    resp.headers['Cache-Control'] = 'public, max-age=180, stale-while-revalidate=600'
    return resp


_EVAC_ZONE_CACHE: dict = {"data": None, "expires": 0.0}
_EVAC_ZONE_TTL = 60  # Cal OES pipeline refreshes ~10 min upstream; 60s keeps UI fresh


@predict_bp.route('/evacuation-zones', methods=['GET'])
def evacuation_zones():
    """Statewide California active evacuation zones from the Cal OES /
    Genasys-aggregated CA_EVACUATIONS_PROD feature service.

    Same source Watch Duty consumes. Layer is filtered upstream to ACTIVE
    zones only — cleared zones drop out (no 'All Clear' status appears).
    """
    import time as _time
    now = _time.time()
    if _EVAC_ZONE_CACHE["data"] is not None and _EVAC_ZONE_CACHE["expires"] > now:
        resp = jsonify(_EVAC_ZONE_CACHE["data"])
        resp.headers['Cache-Control'] = 'public, max-age=60, stale-while-revalidate=300'
        return resp

    try:
        r = http_requests.get(
            'https://services3.arcgis.com/uknczv4rpevve42E/arcgis/rest/services/'
            'CA_EVACUATIONS_PROD/FeatureServer/0/query',
            params={
                'where': "1=1",
                'outFields': 'COUNTY,ZONE_NAME,ZONE_ID,STATUS,EVENT_TYPE,'
                             'CRITICAL_INFO,PUBLIC_INFO,STATEWIDE_LAST_UPDATED',
                'outSR': '4326',
                'f': 'geojson',
            },
            timeout=15,
            headers={'User-Agent': 'FireScopeProxy/1.0'},
        )
        r.raise_for_status()
        data = r.json() or {'type': 'FeatureCollection', 'features': []}
    except Exception as e:
        logger.warning('Cal OES evacuation zones proxy failed: %s', e)
        return jsonify({'type': 'FeatureCollection', 'features': []}), 200

    _EVAC_ZONE_CACHE["data"] = data
    _EVAC_ZONE_CACHE["expires"] = now + _EVAC_ZONE_TTL
    resp = jsonify(data)
    resp.headers['Cache-Control'] = 'public, max-age=60, stale-while-revalidate=300'
    return resp
