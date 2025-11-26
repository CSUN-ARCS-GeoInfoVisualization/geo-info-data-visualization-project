# Quick Setup Guide - Core Database Branch

## What This Branch Contains

The `core-database` branch includes a complete PostgreSQL + PostGIS database implementation for the wildfire prediction system, written entirely in Python with SQL schema files.

### Files Created

```
database/
  config.py                           # Database configuration (follows ml-data-sources pattern)
  connection.py                       # Connection pooling and context managers
  spatial_utils.py                    # PostGIS helper functions for spatial queries
  requirements.txt                    # Python dependencies
  README.md                          # Full documentation
  SETUP_GUIDE.md                     # This file
  schema/                            # SQL schema files (step-by-step)
    step_01_create_database.sql    # PostGIS extensions
    step_02_lookup_tables.sql      # Seasons, vegetation types
    step_03_main_observations.sql  # Main spatial table with partitions
    step_04_spatial_indexes.sql    # GIST spatial indexes
  migrations/
    __init__.py
    run_migration.py               # Python script to run migrations

.env.example                           # Environment configuration template
```

## Quick Start (5 Steps)

### 1. Install PostgreSQL + PostGIS

**Windows:** Download from https://www.postgresql.org/download/windows/

### 2. Create Database

```bash
psql -U postgres
CREATE DATABASE wildfire_prediction;
\q
```

### 3. Install Python Dependencies

```bash
cd database
pip install -r requirements.txt
```

### 4. Configure Environment

Copy `.env.example` to `.env` and edit:
```
DB_PASSWORD=your_password
```

### 5. Run Migrations

```bash
cd migrations
python run_migration.py
```

## What Gets Created

### Tables
- **wildfire_observations** (partitioned by year 2013-2025)
  - Spatial column: `location GEOGRAPHY(POINT, 4326)`
  - Environmental features: EVI, NDVI, thermal anomaly, LST, wind, elevation
  - Fire occurrence: boolean
  - Computed columns: year, month, day_of_year

- **seasons** - Winter, Spring, Summer, Fall lookup table
- **vegetation_types** - EPA ecosystem classifications

### Spatial Indexes
- GIST indexes on location for fast geographic queries
- Date indexes for temporal queries
- Composite indexes for common query patterns

## Integration Points

### With ml-data-sources Branch
```python
# Import downloaded data into database
from spatial_utils import insert_observation
import pandas as pd

df = pd.read_csv('data/firms/firms_CA_MODIS_SP_2020-01-01.csv')
for _, row in df.iterrows():
    insert_observation(date=row['acq_date'], lat=row['latitude'], ...)
```

### With API-framework Branch
```python
# Expose database queries as REST endpoints
from database.spatial_utils import query_observations_by_bbox

@app.route('/api/observations')
def get_observations():
    return jsonify(query_observations_by_bbox(...))
```

### With user-auth Branch
```python
# Add authentication to database queries
from database.connection import get_db_cursor

@jwt_required()
def protected_query():
    with get_db_cursor() as cur:
        cur.execute("SELECT ...")
```

## Testing the Setup

```python
# Test connection
from connection import test_connection
test_connection()

# Insert test observation
from spatial_utils import insert_observation
obs_id = insert_observation(
    date='2020-08-15',
    lat=37.7749,
    lon=-122.4194,
    fire_occurred=True
)

# Query near point
from spatial_utils import query_observations_near_point
results = query_observations_near_point(37.7749, -122.4194, 50000)
print(f"Found {len(results)} observations")
```

## Step-by-Step Migration System

You can run migrations incrementally to show progress:

```bash
# Run only step 1 (PostGIS setup)
python run_migration.py --start 1 --end 1

# Run steps 2-3 (tables)
python run_migration.py --start 2 --end 3

# Run step 4 (indexes)
python run_migration.py --start 4 --end 4
```

## Key Features

- **PostGIS Spatial Support** - Geographic queries with GEOGRAPHY type
- **Table Partitioning** - Partitioned by year for performance
- **Python-Based** - Follows existing branch patterns
- **Connection Pooling** - Efficient database connections
- **Spatial Utilities** - Helper functions for common operations
- **Step-by-Step Setup** - Run migrations incrementally

## Next Steps

1. Database schema created
2. Import data from ml-data-sources branch
3. Create API endpoints in API-framework
4. Add authentication from user-auth
5. Set up QGIS for visualization

## Troubleshooting

**PostGIS not found:**
```sql
CREATE EXTENSION postgis;
```

**Connection error:**
- Check PostgreSQL is running
- Verify `.env` credentials
- Check port 5432 is open

**Import error:**
```bash
# Make sure you're in the database directory
cd database
python -c "from connection import test_connection; test_connection()"
```

## Documentation

See `README.md` for complete documentation including:
- Full schema details
- All SQL files explained
- Usage examples
- Performance tuning
- Integration guides
