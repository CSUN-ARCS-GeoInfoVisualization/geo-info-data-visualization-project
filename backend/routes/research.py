"""Research data endpoint — FIRMS hotspots and risk predictions for the researcher map."""

import logging
import os
from datetime import datetime, timedelta, timezone

import requests
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt

research_bp = Blueprint('research', __name__)
logger = logging.getLogger(__name__)

FIRMS_MAP_KEY = os.getenv('FIRMS_MAP_KEY', '')
FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv'


def _require_researcher_or_admin():
    role = get_jwt().get('role', '')
    return role in ('Researcher', 'Admin')


@research_bp.route('/fire-data', methods=['GET'])
@jwt_required()
def fire_data():
    if not _require_researcher_or_admin():
        return jsonify({'error': 'Researcher or Admin access required'}), 403

    days = min(int(request.args.get('days', '7')), 30)
    confidence_min = int(request.args.get('confidence_min', '0'))
    frp_min = float(request.args.get('frp_min', '0'))

    features = []

    # Fetch FIRMS VIIRS data for California bounding box
    if FIRMS_MAP_KEY:
        try:
            url = (
                f"{FIRMS_BASE}/{FIRMS_MAP_KEY}/VIIRS_SNPP_NRT"
                f"/-124,32,-114,42/{days}/2025-01-01"
            )
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            lines = r.text.strip().split('\n')
            if len(lines) > 1:
                headers = lines[0].split(',')
                lat_i = headers.index('latitude') if 'latitude' in headers else None
                lon_i = headers.index('longitude') if 'longitude' in headers else None
                conf_i = headers.index('confidence') if 'confidence' in headers else None
                frp_i = headers.index('frp') if 'frp' in headers else None
                date_i = headers.index('acq_date') if 'acq_date' in headers else None

                for line in lines[1:]:
                    cols = line.split(',')
                    if lat_i is None or lon_i is None:
                        continue
                    try:
                        lat = float(cols[lat_i])
                        lon = float(cols[lon_i])
                        conf = cols[conf_i] if conf_i is not None else 'n'
                        frp = float(cols[frp_i]) if frp_i is not None else 0
                        acq_date = cols[date_i] if date_i is not None else ''
                    except (ValueError, IndexError):
                        continue

                    # Map confidence letters to numbers
                    conf_num = {'l': 30, 'n': 50, 'h': 80}.get(conf.lower(), 50)
                    if conf_num < confidence_min or frp < frp_min:
                        continue

                    features.append({
                        'type': 'Feature',
                        'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
                        'properties': {
                            'confidence': conf_num,
                            'frp': frp,
                            'acq_date': acq_date,
                            'layer': 'firms',
                        },
                    })
        except Exception as e:
            logger.warning('FIRMS fetch failed: %s', e)

    return jsonify({
        'type': 'FeatureCollection',
        'features': features,
        'meta': {'days': days, 'confidence_min': confidence_min, 'frp_min': frp_min},
    })
