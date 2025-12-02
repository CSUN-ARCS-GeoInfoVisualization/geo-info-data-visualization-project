"""
Integration Configuration

Configuration settings for the data integration layer.
"""

import os
from pathlib import Path


class IntegrationConfig:
    """Configuration for data integration."""
    
    # Paths
    BASE_DIR = Path(__file__).parent.parent
    DATA_DIR = BASE_DIR / "data"
    
    # Data source paths
    FIRMS_ALIGNED = DATA_DIR / "aligned" / "firms_aligned.parquet"
    NOAA_ALIGNED = DATA_DIR / "aligned" / "noaa_aligned.parquet"
    USGS_ALIGNED_DIR = DATA_DIR / "aligned" / "usgs"
    
    # Integration settings
    DEFAULT_BATCH_SIZE = 1000
    DEFAULT_COMMIT_FREQUENCY = 5000
    DEFAULT_MAX_DISTANCE_KM = 50  # For spatial joins
    DEFAULT_TEMPORAL_TOLERANCE_DAYS = 1
    
    # California bounds
    CA_MIN_LAT = 32.0
    CA_MAX_LAT = 42.5
    CA_MIN_LON = -125.0
    CA_MAX_LON = -113.0
    
    # Validation ranges
    VALID_EVI_RANGE = (-1.0, 1.0)
    VALID_NDVI_RANGE = (-1.0, 1.0)
    VALID_WIND_SPEED_MIN = 0.0
    VALID_ELEVATION_RANGE = (-100, 4500)
    
    # Season definitions (month ranges)
    SEASONS = {
        1: {'name': 'Winter', 'months': [12, 1, 2]},
        2: {'name': 'Spring', 'months': [3, 4, 5]},
        3: {'name': 'Summer', 'months': [6, 7, 8]},
        4: {'name': 'Fall', 'months': [9, 10, 11]}
    }
    
    # Vegetation type thresholds
    VEGETATION_THRESHOLDS = {
        'barren': 0.1,
        'urban': 0.2,
        'grass': 0.35,
        'shrub': 0.5,
        'forest': 0.5,
        'forest_elevation': 1500  # Minimum elevation for forest classification
    }
    
    # Data source identifiers
    DATA_SOURCES = {
        'firms': 'NASA_FIRMS',
        'noaa': 'NOAA_GHCND',
        'usgs': 'USGS_3DEP',
        'combined': 'INTEGRATED'
    }
    
    # Database settings (from environment or defaults)
    DB_HOST = os.getenv('DB_HOST', 'localhost')
    DB_PORT = os.getenv('DB_PORT', '5432')
    DB_NAME = os.getenv('DB_NAME', 'wildfire_prediction')
    DB_USER = os.getenv('DB_USER', 'postgres')
    DB_PASSWORD = os.getenv('DB_PASSWORD', '')
    
    @classmethod
    def get_season_name(cls, season_id: int) -> str:
        """Get season name from ID."""
        return cls.SEASONS.get(season_id, {}).get('name', 'Unknown')
    
    @classmethod
    def validate_california_bounds(cls, lat: float, lon: float) -> bool:
        """Check if coordinates are within California bounds."""
        return (cls.CA_MIN_LAT <= lat <= cls.CA_MAX_LAT and
                cls.CA_MIN_LON <= lon <= cls.CA_MAX_LON)
    
    @classmethod
    def validate_evi(cls, evi: float) -> bool:
        """Validate EVI value."""
        return cls.VALID_EVI_RANGE[0] <= evi <= cls.VALID_EVI_RANGE[1]
    
    @classmethod
    def validate_ndvi(cls, ndvi: float) -> bool:
        """Validate NDVI value."""
        return cls.VALID_NDVI_RANGE[0] <= ndvi <= cls.VALID_NDVI_RANGE[1]


# Export singleton instance
config = IntegrationConfig()

