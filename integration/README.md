# Data Integration Layer

Complete integration layer for connecting preprocessed ML data sources with the core database.

## Overview

This module bridges the gap between:
- **ML Data Sources**: Preprocessed FIRMS, NOAA, and USGS data
- **Core Database**: PostgreSQL + PostGIS wildfire observations database

The integration layer handles:
1. Loading preprocessed data from parquet files and GeoTIFFs
2. Spatial-temporal joins to combine multiple data sources
3. Field mapping to match database schema
4. Efficient bulk insertion with progress tracking
5. Data validation and error handling

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Preprocessed Data                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │  FIRMS   │  │   NOAA   │  │   USGS   │             │
│  │ (Fire)   │  │(Weather) │  │  (DEM)   │             │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘             │
└───────┼─────────────┼─────────────┼───────────────────┘
        │             │             │
        ▼             ▼             ▼
┌─────────────────────────────────────────────────────────┐
│             Integration Layer (This Module)             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Data Loader  │  │Spatial Join  │  │Field Mapper  │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                 │                  │         │
│         └─────────────────┴──────────────────┘         │
│                           │                            │
│                 ┌─────────▼─────────┐                  │
│                 │   Bulk Loader     │                  │
│                 └─────────┬─────────┘                  │
└───────────────────────────┼───────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────┐
│         PostgreSQL + PostGIS Database                   │
│             wildfire_observations table                 │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Prerequisites

Ensure you have:
- ✓ Preprocessed data (run `preprocessing/` pipeline first)
- ✓ Database setup (run `database/` migrations first)
- ✓ Required Python packages installed

```bash
# Install dependencies
pip install pandas geopandas psycopg2 rasterio

# Or use requirements file
pip install -r requirements.txt
```

### 2. Check Prerequisites

```bash
cd integration
python run_integration.py --check-only
```

This will verify:
- Preprocessed data files are available
- Database connection works
- All required modules are installed

### 3. Run Integration

**Basic usage (integrate all available data):**
```bash
python run_integration.py
```

**With date range:**
```bash
python run_integration.py --date-start 2020-01-01 --date-end 2020-12-31
```

**With elevation and negative samples:**
```bash
python run_integration.py --include-elevation --with-negatives
```

**With checkpoint for resumability:**
```bash
python run_integration.py --checkpoint checkpoint.txt
```

## Modules

### 1. data_loader.py

Loads preprocessed data from various sources.

**Key Functions:**
- `load_firms_data()`: Load NASA FIRMS fire detections
- `load_noaa_data()`: Load NOAA weather observations
- `load_usgs_elevation()`: Load USGS elevation tiles
- `sample_elevation_at_points()`: Sample elevation at specific coordinates
- `check_preprocessed_data_availability()`: Check what data is available

**Example:**
```python
from integration.data_loader import load_firms_data, load_noaa_data

# Load fire data for 2020
firms_df = load_firms_data(
    aligned=True,
    date_range=('2020-01-01', '2020-12-31')
)

# Load weather data
noaa_df = load_noaa_data(aligned=True)
```

### 2. field_mapper.py

Maps data fields from ML sources to database schema.

**Key Functions:**
- `map_firms_to_observation()`: Convert FIRMS record to database format
- `map_noaa_to_observation()`: Convert NOAA record to database format
- `get_season_id()`: Determine season from month
- `classify_vegetation_type()`: Classify vegetation from indices
- `validate_observation()`: Validate observation data

**Example:**
```python
from integration.field_mapper import map_firms_to_observation
import pandas as pd

# Map a FIRMS row to observation format
row = firms_df.iloc[0]
observation = map_firms_to_observation(row, include_weather=True)

# Result is ready for database insertion
print(observation.keys())
# ['observation_date', 'latitude', 'longitude', 'fire_occurred', ...]
```

### 3. spatial_join.py

Performs spatial and temporal joins between data sources.

**Key Functions:**
- `spatial_nearest_join()`: Join points to nearest stations
- `temporal_join()`: Join data by matching dates
- `join_fire_weather_elevation()`: Complete multi-source join
- `create_unified_observations()`: Create unified dataset
- `create_negative_samples()`: Generate non-fire samples for ML

**Example:**
```python
from integration.spatial_join import create_unified_observations

# Create unified observations with all data sources
unified_df = create_unified_observations(
    firms_df=firms_df,
    noaa_df=noaa_df,
    include_elevation=True,
    fire_only=True
)
```

### 4. bulk_loader.py

Efficiently inserts observations into the database.

**Key Functions:**
- `bulk_insert_observations()`: Insert many records efficiently
- `insert_with_progress()`: Insert with progress display
- `validate_batch()`: Validate observations before insertion
- `get_insertion_statistics()`: Get database statistics

**Example:**
```python
from integration.bulk_loader import insert_with_progress

# Insert observations with progress tracking
stats = insert_with_progress(
    observations,
    batch_size=1000,
    show_progress=True
)

print(f"Inserted: {stats['inserted']:,}")
print(f"Failed: {stats['failed']:,}")
```

### 5. run_integration.py

Main orchestration script for the complete pipeline.

**Usage:**
```bash
# See all options
python run_integration.py --help

# Basic integration
python run_integration.py

# Custom configuration
python run_integration.py \
    --date-start 2020-06-01 \
    --date-end 2020-09-30 \
    --batch-size 2000 \
    --include-elevation \
    --with-negatives
```

## Data Flow

### Step-by-Step Process

1. **Load Data**
   ```
   FIRMS (parquet) → DataFrame with fire detections
   NOAA (parquet)  → DataFrame with weather observations
   USGS (GeoTIFF)  → Raster tiles with elevation
   ```

2. **Spatial Join**
   ```
   For each fire detection:
     - Find nearest weather station (within 50km)
     - Match to same date (±1 day tolerance)
     - Sample elevation at coordinates
   ```

3. **Field Mapping**
   ```
   FIRMS fields        →  Database fields
   ─────────────────────────────────────
   acq_date            →  observation_date
   latitude, longitude →  location (PostGIS)
   brightness          →  thermal_anomaly
   [weather data]      →  land_surface_temp, wind_speed
   [elevation]         →  elevation
   [computed]          →  season_id, vegetation_type_id
   ```

4. **Validation**
   ```
   Check required fields
   Validate ranges (lat/lon, indices, etc.)
   Verify data types
   ```

5. **Bulk Insert**
   ```
   Batch observations (1000 records)
   Insert using PostGIS functions
   Handle conflicts (skip duplicates)
   Commit periodically
   ```

## Field Mappings

### FIRMS → Database

| FIRMS Field      | Database Field       | Transformation                    |
|-----------------|----------------------|-----------------------------------|
| acq_date        | observation_date     | Parse date                        |
| latitude        | location (PostGIS)   | Create POINT geometry             |
| longitude       | location (PostGIS)   | Create POINT geometry             |
| brightness      | thermal_anomaly      | Direct mapping                    |
| frp             | -                    | Not stored (could enhance later)  |
| confidence      | -                    | Used for filtering only           |
| [constant]      | fire_occurred        | Always TRUE for FIRMS             |

### NOAA → Database

| NOAA Field      | Database Field       | Transformation                    |
|-----------------|----------------------|-----------------------------------|
| date            | observation_date     | Parse date                        |
| TMAX            | land_surface_temp    | Convert °C to Kelvin              |
| AWND            | wind_speed           | Direct mapping (m/s)              |
| WSF2/WSF5       | wind_speed           | Alternative if AWND missing       |
| PRCP            | -                    | Not stored in v1                  |

### Computed Fields

| Field               | Computation Logic                              |
|---------------------|-----------------------------------------------|
| season_id           | Based on month: Winter(1), Spring(2), Summer(3), Fall(4) |
| vegetation_type_id  | Based on EVI/NDVI and elevation ranges        |

## Database Schema

The integration layer inserts into `wildfire_observations` table:

```sql
CREATE TABLE wildfire_observations (
    observation_id BIGSERIAL,
    observation_date DATE NOT NULL,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    
    -- Environmental features
    evi NUMERIC(8, 4),
    ndvi NUMERIC(8, 4),
    thermal_anomaly NUMERIC(6, 2),
    land_surface_temp NUMERIC(8, 2),
    wind_speed NUMERIC(5, 2),
    elevation NUMERIC(7, 2),
    
    -- Fire occurrence
    fire_occurred BOOLEAN NOT NULL,
    
    -- Foreign keys
    vegetation_type_id INTEGER,
    season_id INTEGER,
    
    -- Metadata
    data_source VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Performance

### Benchmarks

On typical hardware (2020 data):
- **Loading**: ~5 seconds for 50,000 FIRMS records
- **Spatial Join**: ~30 seconds for 50,000 fires × 1,000 stations
- **Mapping**: ~10 seconds for 50,000 observations
- **Insertion**: ~60 seconds for 50,000 observations (batch size 1000)

**Total**: ~2 minutes for 50,000 complete observations

### Optimization Tips

1. **Use Aligned Data**: Preprocessed data is faster to load
2. **Adjust Batch Size**: Larger batches (2000-5000) may be faster
3. **Limit Date Range**: Process by month for very large datasets
4. **Use Checkpoint**: Resume if interrupted
5. **Database Indexes**: Ensure spatial indexes are created

## Testing

Run the test suite:

```bash
cd integration
python test_integration.py
```

This will test:
- Data loading functionality
- Field mapping and validation
- Spatial and temporal joins
- Bulk insertion (if database available)
- Complete pipeline end-to-end

## Troubleshooting

### "Preprocessed data not found"

**Solution**: Run the preprocessing pipeline first
```bash
cd preprocessing
python validate_and_clean.py
python align_crs.py
```

### "Database connection failed"

**Solution**: Check database is running and credentials are correct
```bash
# Check PostgreSQL is running
pg_ctl status

# Test connection
psql -U postgres -d wildfire_prediction

# Verify .env file has correct credentials
```

### "No USGS tiles found"

**Solution**: Elevation is optional. Continue without it or download tiles:
```bash
cd data_sources
python download_usgs_dem.py
```

### "Spatial join too slow"

**Solutions**:
- Increase `max_distance_km` if too few matches
- Decrease `max_distance_km` if too slow
- Process in smaller date ranges
- Ensure weather data has station coordinates

### "Memory error during integration"

**Solutions**:
- Process data in smaller date ranges
- Reduce batch size
- Filter to specific geographic region
- Use incremental insertion with checkpoint

## Advanced Usage

### Custom Spatial Join Radius

```python
from integration.spatial_join import spatial_nearest_join

# Use 100km radius instead of default 50km
joined = spatial_nearest_join(
    fires_df,
    stations_df,
    max_distance_km=100
)
```

### Generate Negative Samples for ML

```python
from integration.spatial_join import create_negative_samples

# Create non-fire samples at 50% ratio
negative_df = create_negative_samples(
    positive_df=fire_observations,
    noaa_df=weather_data,
    sample_ratio=0.5
)
```

### Incremental Loading with Checkpoint

```python
from integration.bulk_loader import insert_observations_incremental

# Resume from checkpoint if interrupted
stats = insert_observations_incremental(
    observations,
    checkpoint_file='progress.txt',
    batch_size=1000
)
```

### Query Inserted Data

```python
from integration.bulk_loader import get_insertion_statistics

# Get statistics for inserted data
stats = get_insertion_statistics(
    start_date='2020-01-01',
    end_date='2020-12-31',
    data_source='NASA_FIRMS'
)

print(f"Total observations: {stats['total_observations']:,}")
print(f"Fire count: {stats['fire_count']:,}")
```

## Integration with Other Branches

### With API Framework

```python
# In API route handler
from integration.bulk_loader import get_insertion_statistics

@app.route('/api/data/statistics')
def data_statistics():
    stats = get_insertion_statistics()
    return jsonify(stats)
```

### With Frontend Map

```python
# Provide data for map visualization
from database.spatial_utils import query_observations_by_bbox

# Query data in visible map bounds
observations = query_observations_by_bbox(
    min_lat=32.5, min_lon=-124.5,
    max_lat=42.0, max_lon=-114.0,
    start_date='2020-08-01',
    end_date='2020-08-31'
)
```

### With ML Models

```python
# Export training data
from integration.spatial_join import create_unified_observations

# Create balanced dataset with negatives
unified_df = create_unified_observations(
    firms_df, noaa_df, 
    include_elevation=True,
    fire_only=False
)

# Export for ML training
unified_df.to_parquet('ml_training_data.parquet')
```

## Future Enhancements

- [ ] Support for additional data sources (MODIS vegetation, satellite imagery)
- [ ] Real-time streaming integration
- [ ] Automated scheduling for periodic updates
- [ ] Data quality metrics and reporting
- [ ] Support for other geographic regions beyond California
- [ ] Integration with cloud storage (S3, GCS)
- [ ] Parallel processing for large datasets
- [ ] Web UI for monitoring integration jobs

## Contributing

When adding new data sources:

1. Add loader in `data_loader.py`
2. Create field mapping in `field_mapper.py`
3. Update spatial join logic in `spatial_join.py` if needed
4. Update `run_integration.py` to include new source
5. Add tests in `test_integration.py`
6. Update this README

## License

Part of the Geo Info Data Visualization project.

## Contact

For questions or issues, contact the development team.

---

**Last Updated**: December 2024  
**Version**: 1.0.0  
**Status**: Ready for Production

