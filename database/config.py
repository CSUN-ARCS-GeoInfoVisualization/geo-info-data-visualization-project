"""Database configuration for wildfire prediction system.
Follows the pattern from api-framework and ml-data-sources branches.
"""

import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Database connection settings
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_NAME = os.getenv('DB_NAME', 'wildfire_prediction')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD', '')

# Connection string for psycopg2
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# SQLAlchemy connection string (if using ORM)
SQLALCHEMY_DATABASE_URI = DATABASE_URL

# PostGIS settings
POSTGIS_VERSION = '3.0'
SRID = 4326  # WGS84 coordinate system

# Schema settings
SCHEMA_DIR = os.path.join(os.path.dirname(__file__), 'schema')

# Migration settings
MIGRATION_TABLE = 'schema_migrations'

# Data directories (matching ml-data-sources branch pattern)
DATA_DIR = os.getenv('DATA_DIR', os.path.join(os.path.dirname(__file__), '..', 'data'))
FIRMS_DATA_DIR = os.path.join(DATA_DIR, 'firms')
NOAA_DATA_DIR = os.path.join(DATA_DIR, 'noaa')
USGS_DATA_DIR = os.path.join(DATA_DIR, 'usgs')

# Create directories if they don't exist
for directory in [DATA_DIR, FIRMS_DATA_DIR, NOAA_DATA_DIR, USGS_DATA_DIR]:
    os.makedirs(directory, exist_ok=True)

# Year range for partitions
PARTITION_START_YEAR = 2013
PARTITION_END_YEAR = 2025

# Logging
LOG_QUERIES = os.getenv('LOG_QUERIES', 'False').lower() == 'true'
