# Data Integration Guide

Complete guide for integrating ML data sources with the core database.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step-by-Step Integration](#step-by-step-integration)
4. [Verification](#verification)
5. [Troubleshooting](#troubleshooting)
6. [Next Steps](#next-steps)

## Overview

This guide walks you through the complete process of integrating preprocessed ML data sources (FIRMS, NOAA, USGS) with the PostgreSQL + PostGIS database.

**Time Required**: 30-60 minutes (depending on data volume)

**What You'll Achieve**:
- ✓ Fire detection data in database
- ✓ Weather data linked to fire observations
- ✓ Elevation data integrated
- ✓ Ready for API and visualization

## Prerequisites

### 1. Completed Preprocessing

Ensure you've run the preprocessing pipeline:

```bash
cd preprocessing
python validate_and_clean.py
python align_crs.py
```

**Expected output**: Cleaned and aligned parquet files in `data/aligned/`

### 2. Database Setup

Ensure the database is set up and running:

```bash
cd database
python migrations/run_migration.py
```

**Expected output**: Tables created with spatial indexes

### 3. Environment Configuration

Create or verify `.env` file in project root:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=wildfire_prediction
DB_USER=postgres
DB_PASSWORD=your_password
```

### 4. Python Dependencies

Install integration requirements:

```bash
cd integration
pip install -r requirements.txt
```

## Step-by-Step Integration

### Step 1: Verify Prerequisites

Run the prerequisite check:

```bash
cd integration
python run_integration.py --check-only
```

**Expected Output**:
```
=== Checking Prerequisites ===

Preprocessed Data:
  ✓ firms_cleaned: True
  ✓ firms_aligned: True
  ✓ noaa_cleaned: True
  ✓ noaa_aligned: True
  ✓ usgs_aligned: True
    USGS tiles: 2

Database Connection:
  ✓ Database connection OK

✓ All prerequisites met!
```

**If any checks fail**, see [Troubleshooting](#troubleshooting) section.

### Step 2: Test with Small Sample

Start with a small date range to test:

```bash
python run_integration.py \
    --date-start 2020-08-01 \
    --date-end 2020-08-07
```

**Expected Output**:
```
======================================================================
GEO INFO DATA INTEGRATION PIPELINE
======================================================================

STEP 1: Loading FIRMS Fire Detection Data
✓ Loaded 1,234 fire detections

STEP 2: Loading NOAA Weather Data
✓ Loaded 5,678 weather observations

STEP 3: Creating Unified Observations
✓ Created 1,234 unified observations

STEP 4: Mapping to Database Schema
✓ Mapped 1,234 observations

STEP 5: Inserting into Database
Inserting 1,234 observations...
[████████████████████████████████████████] 100%
✓ Inserted 1,234 / 1,234 (0 failed)

======================================================================
✓ Integration pipeline completed successfully!
======================================================================
```

### Step 3: Verify Sample Data

Check the database:

```python
# In Python
from database.spatial_utils import query_observations_by_bbox

# Query California
observations = query_observations_by_bbox(
    min_lat=32.0, min_lon=-125.0,
    max_lat=42.5, max_lon=-113.0,
    start_date='2020-08-01',
    end_date='2020-08-07'
)

print(f"Found {len(observations)} observations")
```

Or use SQL:

```sql
-- In psql
SELECT COUNT(*) FROM wildfire_observations 
WHERE observation_date BETWEEN '2020-08-01' AND '2020-08-07';

-- Check fire occurrences
SELECT 
    fire_occurred, 
    COUNT(*) as count 
FROM wildfire_observations 
GROUP BY fire_occurred;
```

### Step 4: Full Integration (All Available Data)

Once verified, integrate all data:

```bash
python run_integration.py \
    --batch-size 2000 \
    --checkpoint integration_progress.txt
```

**Note**: This may take 10-30 minutes depending on data volume.

**With elevation** (slower but more complete):

```bash
python run_integration.py \
    --include-elevation \
    --batch-size 1000 \
    --checkpoint integration_progress.txt
```

### Step 5: Add Negative Samples for ML (Optional)

If you're training ML models, include non-fire observations:

```bash
python run_integration.py \
    --with-negatives \
    --include-elevation
```

This creates a balanced dataset with fire and non-fire observations.

## Verification

### Check Integration Statistics

```python
from integration.bulk_loader import get_insertion_statistics

stats = get_insertion_statistics()

print("Database Statistics:")
print(f"  Total observations: {stats['total_observations']:,}")
print(f"  Fire count: {stats['fire_count']:,}")
print(f"  Date range: {stats['earliest_date']} to {stats['latest_date']}")
print(f"  Data sources: {stats['data_sources']}")
```

### Verify Data Quality

**Check for NULL values**:

```sql
SELECT 
    COUNT(*) as total,
    COUNT(evi) as has_evi,
    COUNT(ndvi) as has_ndvi,
    COUNT(elevation) as has_elevation,
    COUNT(wind_speed) as has_wind,
    COUNT(land_surface_temp) as has_temp
FROM wildfire_observations;
```

**Check spatial distribution**:

```sql
SELECT 
    COUNT(*) as count,
    ST_AsText(ST_Centroid(ST_Collect(location::geometry))) as centroid
FROM wildfire_observations;
```

**Check seasonal distribution**:

```sql
SELECT 
    s.season_name,
    COUNT(*) as observations,
    SUM(CASE WHEN fire_occurred THEN 1 ELSE 0 END) as fires
FROM wildfire_observations w
JOIN seasons s ON w.season_id = s.season_id
GROUP BY s.season_name, s.season_id
ORDER BY s.season_id;
```

### Run Integration Tests

```bash
cd integration
python test_integration.py
```

**Expected Output**:
```
======================================================================
INTEGRATION TEST SUITE
======================================================================

TEST 1: Data Loader Module
✓ Data Loader tests PASSED

TEST 2: Field Mapper Module
✓ Field Mapper tests PASSED

TEST 3: Spatial Join Module
✓ Spatial Join tests PASSED

TEST 4: Bulk Loader Module
✓ Bulk Loader tests PASSED

TEST 5: Complete Integration Pipeline
✓ Integration Pipeline tests PASSED

======================================================================
TEST SUMMARY
======================================================================
  ✓ PASS: Data Loader
  ✓ PASS: Field Mapper
  ✓ PASS: Spatial Join
  ✓ PASS: Bulk Loader
  ✓ PASS: Integration Pipeline

Results: 5/5 tests passed

🎉 All tests PASSED!
```

## Troubleshooting

### Issue: "FIRMS data not found"

**Cause**: Preprocessing not completed

**Solution**:
```bash
cd preprocessing
python validate_and_clean.py
python align_crs.py
```

### Issue: "Database connection failed"

**Cause**: Database not running or wrong credentials

**Solutions**:

1. Check PostgreSQL is running:
   ```bash
   # Windows
   pg_ctl status
   
   # Linux/Mac
   sudo service postgresql status
   ```

2. Verify credentials in `.env` file

3. Test connection manually:
   ```bash
   psql -U postgres -d wildfire_prediction
   ```

### Issue: "Spatial join taking too long"

**Cause**: Large dataset with many weather stations

**Solutions**:

1. Process in smaller date ranges:
   ```bash
   python run_integration.py --date-start 2020-01-01 --date-end 2020-03-31
   python run_integration.py --date-start 2020-04-01 --date-end 2020-06-30
   # etc.
   ```

2. Reduce spatial join radius in `config.py`:
   ```python
   DEFAULT_MAX_DISTANCE_KM = 25  # Instead of 50
   ```

### Issue: "Memory error"

**Cause**: Loading too much data at once

**Solutions**:

1. Reduce batch size:
   ```bash
   python run_integration.py --batch-size 500
   ```

2. Process in date ranges (see above)

3. Close other applications to free memory

### Issue: "Elevation sampling failed"

**Cause**: USGS tiles not available

**Solution**: This is optional, continue without elevation:
```bash
python run_integration.py  # Without --include-elevation flag
```

Or download tiles:
```bash
cd data_sources
python download_usgs_dem.py
```

### Issue: "Duplicate key errors"

**Cause**: Running integration multiple times

**Solution**: Integration uses `ON CONFLICT DO NOTHING`, so duplicates are automatically skipped. This is normal behavior.

To start fresh:
```sql
-- In psql
TRUNCATE wildfire_observations CASCADE;
```

## Next Steps

### 1. API Integration

Expose the data through REST API:

```python
# In API framework
from database.spatial_utils import query_observations_by_bbox

@app.route('/api/observations/bbox')
def get_observations():
    data = query_observations_by_bbox(
        min_lat=request.args.get('min_lat'),
        min_lon=request.args.get('min_lon'),
        max_lat=request.args.get('max_lat'),
        max_lon=request.args.get('max_lon')
    )
    return jsonify(data)
```

### 2. Visualization

Use the integrated data for map visualization:

```python
# Query data for map
from database.spatial_utils import query_observations_near_point

# Get observations near a location
obs = query_observations_near_point(
    lat=37.7749,
    lon=-122.4194,
    radius_meters=50000,  # 50km
    start_date='2020-08-01',
    end_date='2020-08-31'
)
```

### 3. ML Model Training

Export integrated data for ML:

```python
# Export training data
import pandas as pd
from database.connection import get_db_cursor

sql = """
    SELECT 
        observation_date,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        evi, ndvi, thermal_anomaly,
        land_surface_temp, wind_speed, elevation,
        fire_occurred, season_id, vegetation_type_id
    FROM wildfire_observations
    WHERE observation_date BETWEEN '2020-01-01' AND '2020-12-31'
"""

with get_db_cursor() as cur:
    df = pd.read_sql(sql, cur.connection)

# Save for ML training
df.to_parquet('ml_training_data.parquet')
```

### 4. Scheduled Updates

Set up periodic integration for new data:

**Windows Task Scheduler** or **Linux cron**:

```bash
# Run daily at 2 AM
0 2 * * * cd /path/to/project/integration && python run_integration.py --date-start $(date -d "yesterday" +\%Y-\%m-\%d) --date-end $(date +\%Y-\%m-\%d)
```

### 5. Monitoring

Monitor integration health:

```python
# Create monitoring script
from integration.bulk_loader import get_insertion_statistics

stats = get_insertion_statistics()

# Send alerts if no data in last 7 days
from datetime import datetime, timedelta
last_date = datetime.strptime(stats['latest_date'], '%Y-%m-%d')

if datetime.now() - last_date > timedelta(days=7):
    print("⚠ Warning: No data in last 7 days!")
```

## Summary

You've now successfully integrated ML data sources with the core database! The system is ready for:

- ✅ API development
- ✅ Map visualization
- ✅ ML model training
- ✅ Data analysis and reporting

For more details, see:
- [Integration README](README.md) - Complete module documentation
- [Database README](../database/README.md) - Database schema and queries
- [SRS Document](../software-requirements-specification.md) - System requirements

---

**Questions or Issues?**  
Contact the development team or file an issue in the project repository.

