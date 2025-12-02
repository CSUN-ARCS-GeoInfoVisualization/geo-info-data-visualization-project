# Quick Start: Data Integration

Get the data integration layer running in 5 minutes!

## Prerequisites Checklist

Before starting, ensure you have:

- [ ] **Preprocessed data** in `data/aligned/` directory
  ```bash
  ls data/aligned/  # Should show firms_aligned.parquet, noaa_aligned.parquet
  ```

- [ ] **Database running** with tables created
  ```bash
  psql -U postgres -d wildfire_prediction -c "\dt"
  ```

- [ ] **Dependencies installed**
  ```bash
  pip install pandas geopandas psycopg2 rasterio
  ```

## Quick Start Commands

### 1. Check Everything is Ready

```bash
cd integration
python run_integration.py --check-only
```

✅ All checks should pass

### 2. Test with Small Sample (1 week)

```bash
python run_integration.py --date-start 2020-08-01 --date-end 2020-08-07
```

⏱️ Should complete in ~30 seconds

### 3. Verify Data in Database

```sql
-- In psql
SELECT COUNT(*) FROM wildfire_observations;
SELECT fire_occurred, COUNT(*) FROM wildfire_observations GROUP BY fire_occurred;
```

### 4. Run Full Integration

```bash
python run_integration.py
```

⏱️ May take 5-15 minutes depending on data volume

## Common Commands

**Specific date range:**
```bash
python run_integration.py --date-start 2020-01-01 --date-end 2020-12-31
```

**With elevation data:**
```bash
python run_integration.py --include-elevation
```

**Larger batch size (faster):**
```bash
python run_integration.py --batch-size 2000
```

**With checkpoint (resumable):**
```bash
python run_integration.py --checkpoint progress.txt
```

**Generate ML training data:**
```bash
python run_integration.py --with-negatives --include-elevation
```

## If Something Goes Wrong

### "Preprocessed data not found"
```bash
# Run preprocessing first
cd preprocessing
python validate_and_clean.py
python align_crs.py
```

### "Database connection failed"
```bash
# Check PostgreSQL is running
pg_ctl status  # or: sudo service postgresql status

# Test connection
psql -U postgres -d wildfire_prediction
```

### "Module not found"
```bash
# Install dependencies
cd integration
pip install -r requirements.txt
```

## What Gets Created

After successful integration:

✅ **wildfire_observations** table populated with:
- Fire detections from FIRMS
- Weather data from NOAA
- Elevation data from USGS (if available)
- Computed fields (season, vegetation type)

✅ **Ready for**:
- API development
- Map visualization  
- ML model training
- Data analysis

## Next Steps

1. **Verify data quality**
   ```sql
   SELECT 
       COUNT(*) as total,
       SUM(CASE WHEN fire_occurred THEN 1 ELSE 0 END) as fires,
       COUNT(DISTINCT observation_date) as unique_dates
   FROM wildfire_observations;
   ```

2. **Export for ML**
   ```python
   import pandas as pd
   from database.connection import get_db_cursor
   
   with get_db_cursor() as cur:
       df = pd.read_sql("SELECT * FROM wildfire_observations LIMIT 1000", cur.connection)
   df.to_csv('sample_data.csv')
   ```

3. **Query spatial data**
   ```python
   from database.spatial_utils import query_observations_near_point
   
   observations = query_observations_near_point(
       lat=37.7749, lon=-122.4194,  # San Francisco
       radius_meters=50000,          # 50km
       start_date='2020-08-01',
       end_date='2020-08-31'
   )
   ```

## Full Documentation

- **Complete Guide**: `integration/INTEGRATION_GUIDE.md`
- **API Documentation**: `integration/README.md`
- **Architecture**: `DATA_INTEGRATION_SUMMARY.md`
- **Database Schema**: `database/README.md`

## Testing

Run the test suite to verify everything works:

```bash
cd integration
python test_integration.py
```

All tests should pass ✅

---

**Need Help?** Check the full documentation or contact the development team.

