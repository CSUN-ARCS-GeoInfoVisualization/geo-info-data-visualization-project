"""
Configuration for API keys and data paths.
This file loads secrets from .env if present.
DO NOT COMMIT THIS FILE (it's in .gitignore).
"""

import os


# --- API Keys ---
USGS_API_KEY = os.getenv("USGS_API_KEY", "")
NOAA_API_KEY = os.getenv("NOAA_API_KEY", "zwDDmcJeSfFqRdBjvlrPmcbDBqTIrwaH")
NASA_FIRMS_API_KEY = os.getenv("NASA_FIRMS_API_KEY", "0c8375d2c37f6ccbd3a29cf7322c461d")

# --- API Endpoints ---
USGS_API_URL = "https://earthexplorer.usgs.gov/inventory/json/v/1.4.1/"
NOAA_API_URL = "https://www.ncei.noaa.gov/cdo-web/api/v2/"
NASA_FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/api/"

# --- Data directories (relative to repo root) ---
BASE_DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "data"))
USGS_DATA_DIR = os.path.join(BASE_DATA_DIR, "usgs")
NOAA_DATA_DIR = os.path.join(BASE_DATA_DIR, "noaa")
FIRMS_DATA_DIR = os.path.join(BASE_DATA_DIR, "firms")

# Ensure directories exist at import time
for _d in (BASE_DATA_DIR, USGS_DATA_DIR, NOAA_DATA_DIR, FIRMS_DATA_DIR):
    os.makedirs(_d, exist_ok=True)

# --- California bounding box (W,S,E,N order for FIRMS area API) ---
# Using precise CA bounds in WGS84
CA_BBOX_W = -124.482003
CA_BBOX_S =   32.529508
CA_BBOX_E = -114.131211
CA_BBOX_N =   42.009503
CA_BBOX_STR = f"{CA_BBOX_W},{CA_BBOX_S},{CA_BBOX_E},{CA_BBOX_N}"
