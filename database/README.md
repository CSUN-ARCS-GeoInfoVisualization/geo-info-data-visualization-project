# Wildfire Prediction Database

Core database implementation with PostGIS spatial tables for the wildfire prediction system.

## Overview

This module provides:
- **PostgreSQL + PostGIS** database schema
- **Spatial tables** for geographic wildfire data
- **Partitioned tables** by year for performance
- **Python utilities** for database operations
- **Step-by-step migration** system

## Database Schema

### Core Dataset (per point, per date)
- Date
- Latitude, Longitude (PostGIS GEOGRAPHY)
- EVI (Enhanced Vegetation Index)
- TA (Thermal Anomalies level)
- LST (Land Surface Temperature)
- Wind (wind speed)
- Elevation (meters above sea level)
- Fire (binary fire occurrence)
- NDVI (Normalized Difference Vegetation Index)
- Vegetation cover (EPA ecosystems)
- Seasonal timelines

### Key Tables
1. **wildfire_observations** - Main partitioned table with spatial data
2. **seasons** - Seasonal lookup table
3. **vegetation_types** - EPA ecosystem classifications
4. **Spatial indexes** - GIST indexes for fast geographic queries

## Prerequisites

1. **PostgreSQL 12+** with **PostGIS 3.0+** installed
2. **Python 3.8+**
3. Database created: `wildfire_prediction`

### Install PostgreSQL + PostGIS

**Windows:**
```bash
# Download from https://www.postgresql.org/download/windows/
# Enable PostGIS during installation or install separately
```

**macOS:**
```bash
brew install postgresql postgis
```

**Linux:**
```bash
sudo apt-get install postgresql postgis
```

## Setup Instructions

### Step 1: Install Python Dependencies

```bash
cd database
pip install -r requirements.txt
```

### Step 2: Configure Database Connection

Copy the example environment file and edit with your credentials:

```bash
cp ../.env.example ../.env
```

Edit `.env`:
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=wildfire_prediction
DB_USER=postgres
DB_PASSWORD=your_password
```

### Step 3: Create Database

First, create the database in PostgreSQL:

```bash
# Using psql
psql -U postgres
CREATE DATABASE wildfire_prediction;
\q
```

Or use pgAdmin GUI to create the database.

### Step 4: Run Migrations

Run all migration steps:

```bash
cd migrations
python run_migration.py
```

Run specific steps:

```bash
# Run only steps 1-2
python run_migration.py --start 1 --end 2

# Run from step 3 onwards
python run_migration.py --start 3
```

### Step 5: Verify Installation

```python
from connection import test_connection

if test_connection():
    print("Database ready!")
```

## Directory Structure

```
database/
config.py                    # Database configuration
connection.py                # Connection management
spatial_utils.py            # PostGIS helper functions
requirements.txt            # Python dependencies
README.md                   # This file
schema/                     # SQL schema files
    step_01_create_database.sql
    step_02_lookup_tables.sql
    step_03_main_observations.sql
    step_04_spatial_indexes.sql
        migrations/                 # Python migration scripts
            __init__.py
        run_migration.py        # Migration runner
    .env.example                # Environment configuration template
```

## Usage Examples

### Insert Observation

```python
from spatial_utils import insert_observation

obs_id = insert_observation(
    date='2020-08-15',
    lat=37.7749,
    lon=-122.4194,
    evi=0.45,
    ndvi=0.52,
    thermal_anomaly=15.3,
    land_surface_temp=305.2,
    wind_speed=12.5,
    elevation=150.0,
    fire_occurred=True,
    vegetation_type_id=1,
    season_id=3,
    data_source='NASA_FIRMS'
)
print(f"Inserted observation: {obs_id}")
```

### Query by Bounding Box

```python
from spatial_utils import query_observations_by_bbox

# California bounding box
observations = query_observations_by_bbox(
    min_lat=32.5,
    min_lon=-124.5,
    max_lat=42.0,
    max_lon=-114.0,
    start_date='2020-01-01',
    end_date='2020-12-31'
)

print(f"Found {len(observations)} observations")
```

### Query Near Point

```python
from spatial_utils import query_observations_near_point

# Find observations within 50km of San Francisco
observations = query_observations_near_point(
    lat=37.7749,
    lon=-122.4194,
    radius_meters=50000,
    start_date='2020-08-01',
    end_date='2020-08-31'
)

for obs in observations:
    print(f"Distance: {obs[-1]/1000:.2f} km")
```

### Get Season Statistics

```python
from spatial_utils import get_fire_statistics_by_season

stats = get_fire_statistics_by_season(2020)

for season in stats:
    print(f"{season[0]}: {season[2]} fires ({season[3]}%)")
```

## Schema Migration Steps

The database is set up in logical steps:

1. **Step 1**: Enable PostGIS extensions
2. **Step 2**: Create lookup tables (seasons, vegetation types)
3. **Step 3**: Create main observations table with partitions
4. **Step 4**: Create spatial and performance indexes

## Integration with Other Branches

### With `ml-data-sources` Branch
The data downloaded by `ml-data-sources` can be imported into this database:

```python
# Example: Import FIRMS data
import pandas as pd
from spatial_utils import insert_observation

df = pd.read_csv('data/firms/firms_CA_MODIS_SP_2020-01-01.csv')

for _, row in df.iterrows():
    insert_observation(
        date=row['acq_date'],
        lat=row['latitude'],
        lon=row['longitude'],
        thermal_anomaly=row['brightness'],
        fire_occurred=True,
        data_source='NASA_FIRMS'
    )
```

### With `user-auth` Branch
Database user management can be integrated with Flask authentication:

```python
# In Flask app
from database.connection import get_db_cursor

@app.route('/api/observations')
@jwt_required()
def get_observations():
    # Query observations using database connection
    pass
```

### With `API-framework` Branch
Expose database queries through REST API endpoints:

```python
# In api-framework
from database.spatial_utils import query_observations_by_bbox

@app.route('/api/observations/bbox')
def observations_bbox():
    data = query_observations_by_bbox(...)
    return jsonify(data)
```

## Performance Notes

- **Partitioning**: Tables are partitioned by year for faster queries
- **Spatial Indexes**: GIST indexes enable fast geographic queries
- **Connection Pooling**: Reuses database connections efficiently
- **Batch Inserts**: Use bulk inserts for large datasets

## Troubleshooting

### PostGIS Not Found
```sql
-- In psql, run:
CREATE EXTENSION postgis;
```

### Connection Refused
- Check PostgreSQL is running: `pg_ctl status`
- Verify credentials in `.env`
- Check firewall settings

### Slow Queries
- Ensure indexes are created (Step 4)
- Run `ANALYZE wildfire_observations;`
- Check query plans with `EXPLAIN ANALYZE`

## Next Steps

1. Import data from `ml-data-sources` branch
2. Create API endpoints in `API-framework` branch
3. Add user permissions from `user-auth` branch
4. Set up QGIS for visualization

## License

Part of the Geo Info Data Visualization project.
