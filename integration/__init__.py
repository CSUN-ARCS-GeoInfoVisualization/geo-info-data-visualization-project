"""
Data Integration Layer

This module integrates preprocessed ML data sources with the core database.
It provides utilities to load, transform, and insert data from:
- NASA FIRMS fire detection data
- NOAA weather observations
- USGS elevation data

The integration layer handles:
1. Reading preprocessed parquet and GeoTIFF files
2. Field mapping between ML data and database schema
3. Spatial joins to combine multiple data sources
4. Bulk inserts for efficient database loading
5. Season and vegetation type classification
"""

__version__ = "1.0.0"
__author__ = "Geo Info Data Visualization Team"

from .data_loader import (
    load_firms_data,
    load_noaa_data,
    load_usgs_elevation,
    check_preprocessed_data_availability
)

from .field_mapper import (
    map_firms_to_observation,
    map_noaa_to_observation,
    get_season_id,
    classify_vegetation_type
)

from .bulk_loader import (
    bulk_insert_observations,
    insert_with_progress,
    validate_batch
)

from .spatial_join import (
    join_fire_weather_elevation,
    create_unified_observations,
    spatial_nearest_join
)

__all__ = [
    'load_firms_data',
    'load_noaa_data',
    'load_usgs_elevation',
    'check_preprocessed_data_availability',
    'map_firms_to_observation',
    'map_noaa_to_observation',
    'get_season_id',
    'classify_vegetation_type',
    'bulk_insert_observations',
    'insert_with_progress',
    'validate_batch',
    'join_fire_weather_elevation',
    'create_unified_observations',
    'spatial_nearest_join'
]

