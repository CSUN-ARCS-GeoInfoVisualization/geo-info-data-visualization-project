"""
Data Loader Module

Loads preprocessed data from parquet files and GeoTIFF rasters.
Handles file validation and provides consistent interfaces for each data source.
"""

import os
import pandas as pd
import geopandas as gpd
from pathlib import Path
from typing import Optional, Dict, List
import warnings

warnings.filterwarnings('ignore')


class DataPaths:
    """Centralized path management for preprocessed data."""
    
    BASE_DIR = Path(__file__).parent.parent
    DATA_DIR = BASE_DIR / "data"
    
    # Cleaned data paths
    CLEANED_DIR = DATA_DIR / "cleaned"
    FIRMS_CLEANED = CLEANED_DIR / "firms_cleaned.parquet"
    NOAA_CLEANED = CLEANED_DIR / "noaa_cleaned.parquet"
    
    # Aligned data paths
    ALIGNED_DIR = DATA_DIR / "aligned"
    FIRMS_ALIGNED = ALIGNED_DIR / "firms_aligned.parquet"
    NOAA_ALIGNED = ALIGNED_DIR / "noaa_aligned.parquet"
    USGS_ALIGNED_DIR = ALIGNED_DIR / "usgs"
    
    # Summary paths
    SUMMARY_DIR = DATA_DIR / "summaries"
    FIRMS_SUMMARY = SUMMARY_DIR / "firms_summary.json"
    NOAA_SUMMARY = SUMMARY_DIR / "noaa_summary.json"
    USGS_SUMMARY = SUMMARY_DIR / "usgs_summary.json"
    
    @classmethod
    def ensure_directories(cls):
        """Ensure all required directories exist."""
        cls.CLEANED_DIR.mkdir(parents=True, exist_ok=True)
        cls.ALIGNED_DIR.mkdir(parents=True, exist_ok=True)
        cls.USGS_ALIGNED_DIR.mkdir(parents=True, exist_ok=True)
        cls.SUMMARY_DIR.mkdir(parents=True, exist_ok=True)


def check_preprocessed_data_availability() -> Dict[str, bool]:
    """
    Check which preprocessed data files are available.
    
    Returns:
        Dictionary with availability status for each data source
    """
    availability = {
        'firms_cleaned': DataPaths.FIRMS_CLEANED.exists(),
        'firms_aligned': DataPaths.FIRMS_ALIGNED.exists(),
        'noaa_cleaned': DataPaths.NOAA_CLEANED.exists(),
        'noaa_aligned': DataPaths.NOAA_ALIGNED.exists(),
        'usgs_aligned': DataPaths.USGS_ALIGNED_DIR.exists(),
    }
    
    # Check for at least one USGS tile
    if availability['usgs_aligned']:
        usgs_tiles = list(DataPaths.USGS_ALIGNED_DIR.glob("*.tif"))
        availability['usgs_tiles_count'] = len(usgs_tiles)
        availability['usgs_aligned'] = len(usgs_tiles) > 0
    else:
        availability['usgs_tiles_count'] = 0
    
    return availability


def load_firms_data(aligned: bool = True, 
                   date_range: Optional[tuple] = None,
                   bbox: Optional[tuple] = None) -> pd.DataFrame:
    """
    Load NASA FIRMS fire detection data.
    
    Args:
        aligned: If True, load aligned data (EPSG:3310), else load cleaned data
        date_range: Optional tuple of (start_date, end_date) as strings
        bbox: Optional tuple of (min_lon, min_lat, max_lon, max_lat)
    
    Returns:
        DataFrame with FIRMS fire detection data
    """
    file_path = DataPaths.FIRMS_ALIGNED if aligned else DataPaths.FIRMS_CLEANED
    
    if not file_path.exists():
        raise FileNotFoundError(
            f"FIRMS data not found at {file_path}. "
            f"Please run preprocessing pipeline first."
        )
    
    print(f"Loading FIRMS data from {file_path}...")
    df = pd.read_parquet(file_path)
    
    # Convert acq_date to datetime if not already
    if 'acq_date' in df.columns and df['acq_date'].dtype == 'object':
        df['acq_date'] = pd.to_datetime(df['acq_date'])
    
    # Apply date range filter
    if date_range:
        start_date, end_date = date_range
        df = df[(df['acq_date'] >= start_date) & (df['acq_date'] <= end_date)]
    
    # Apply bounding box filter (for non-aligned data)
    if bbox and not aligned:
        min_lon, min_lat, max_lon, max_lat = bbox
        df = df[
            (df['longitude'] >= min_lon) & 
            (df['longitude'] <= max_lon) &
            (df['latitude'] >= min_lat) & 
            (df['latitude'] <= max_lat)
        ]
    
    print(f"Loaded {len(df):,} FIRMS fire detections")
    return df


def load_noaa_data(aligned: bool = True,
                  date_range: Optional[tuple] = None,
                  stations: Optional[List[str]] = None) -> pd.DataFrame:
    """
    Load NOAA weather observation data.
    
    Args:
        aligned: If True, load aligned data, else load cleaned data
        date_range: Optional tuple of (start_date, end_date) as strings
        stations: Optional list of station IDs to filter
    
    Returns:
        DataFrame with NOAA weather data (wide format with columns for each variable)
    """
    file_path = DataPaths.NOAA_ALIGNED if aligned else DataPaths.NOAA_CLEANED
    
    if not file_path.exists():
        raise FileNotFoundError(
            f"NOAA data not found at {file_path}. "
            f"Please run preprocessing pipeline first."
        )
    
    print(f"Loading NOAA data from {file_path}...")
    df = pd.read_parquet(file_path)
    
    # Convert date to datetime if not already
    if 'date' in df.columns and df['date'].dtype == 'object':
        df['date'] = pd.to_datetime(df['date'])
    
    # Apply date range filter
    if date_range:
        start_date, end_date = date_range
        df = df[(df['date'] >= start_date) & (df['date'] <= end_date)]
    
    # Apply station filter
    if stations:
        df = df[df['station'].isin(stations)]
    
    print(f"Loaded {len(df):,} NOAA weather observations from {df['station'].nunique()} stations")
    return df


def load_usgs_elevation(tile_name: Optional[str] = None,
                       bbox: Optional[tuple] = None) -> Optional[object]:
    """
    Load USGS elevation data from GeoTIFF files.
    
    Args:
        tile_name: Optional specific tile filename to load
        bbox: Optional bounding box to load (min_lon, min_lat, max_lon, max_lat)
    
    Returns:
        Rasterio dataset object or None if no tiles available
        
    Note:
        For elevation lookup at specific points, use sample_elevation_at_points()
    """
    if not DataPaths.USGS_ALIGNED_DIR.exists():
        print("USGS aligned data directory not found.")
        return None
    
    usgs_tiles = list(DataPaths.USGS_ALIGNED_DIR.glob("*.tif"))
    
    if not usgs_tiles:
        print("No USGS elevation tiles found.")
        return None
    
    print(f"Found {len(usgs_tiles)} USGS elevation tiles")
    
    if tile_name:
        # Load specific tile
        tile_path = DataPaths.USGS_ALIGNED_DIR / tile_name
        if tile_path.exists():
            import rasterio
            return rasterio.open(tile_path)
        else:
            print(f"Tile {tile_name} not found")
            return None
    
    # Return list of all tile paths
    return usgs_tiles


def sample_elevation_at_points(points_df: pd.DataFrame, 
                               lat_col: str = 'latitude',
                               lon_col: str = 'longitude') -> pd.DataFrame:
    """
    Sample elevation values at point locations from USGS tiles.
    
    Args:
        points_df: DataFrame with latitude/longitude columns
        lat_col: Name of latitude column
        lon_col: Name of longitude column
    
    Returns:
        DataFrame with added 'elevation' column
    """
    try:
        import rasterio
        from rasterio.transform import rowcol
    except ImportError:
        print("Rasterio not installed. Cannot sample elevation.")
        return points_df
    
    usgs_tiles = load_usgs_elevation()
    
    if not usgs_tiles:
        print("No USGS tiles available for elevation sampling")
        points_df['elevation'] = None
        return points_df
    
    # Initialize elevation column
    elevations = [None] * len(points_df)
    
    # Try to sample from each tile
    for tile_path in usgs_tiles:
        with rasterio.open(tile_path) as src:
            for idx, row in points_df.iterrows():
                if elevations[idx] is not None:
                    continue  # Already found elevation for this point
                
                lon = row[lon_col]
                lat = row[lat_col]
                
                # Check if point is within tile bounds
                if (src.bounds.left <= lon <= src.bounds.right and
                    src.bounds.bottom <= lat <= src.bounds.top):
                    
                    # Sample elevation
                    try:
                        py, px = src.index(lon, lat)
                        elevation_value = src.read(1)[py, px]
                        
                        # Check for nodata value
                        if elevation_value != src.nodata and elevation_value != -9999:
                            elevations[idx] = float(elevation_value)
                    except:
                        continue
    
    points_df['elevation'] = elevations
    
    non_null_count = sum(1 for e in elevations if e is not None)
    print(f"Sampled elevation for {non_null_count:,} / {len(points_df):,} points "
          f"({non_null_count/len(points_df)*100:.1f}%)")
    
    return points_df


def get_data_summary() -> Dict[str, any]:
    """
    Get summary statistics for all available preprocessed data.
    
    Returns:
        Dictionary with summary information
    """
    availability = check_preprocessed_data_availability()
    
    summary = {
        'availability': availability,
        'data_sources': {}
    }
    
    # Load summaries if available
    try:
        if DataPaths.FIRMS_SUMMARY.exists():
            import json
            with open(DataPaths.FIRMS_SUMMARY) as f:
                summary['data_sources']['firms'] = json.load(f)
    except:
        pass
    
    try:
        if DataPaths.NOAA_SUMMARY.exists():
            import json
            with open(DataPaths.NOAA_SUMMARY) as f:
                summary['data_sources']['noaa'] = json.load(f)
    except:
        pass
    
    try:
        if DataPaths.USGS_SUMMARY.exists():
            import json
            with open(DataPaths.USGS_SUMMARY) as f:
                summary['data_sources']['usgs'] = json.load(f)
    except:
        pass
    
    return summary


# Module test
if __name__ == "__main__":
    print("=== Data Loader Test ===\n")
    
    # Check availability
    print("1. Checking data availability...")
    availability = check_preprocessed_data_availability()
    for key, value in availability.items():
        status = "✓" if value else "✗"
        print(f"  {status} {key}: {value}")
    
    print("\n2. Loading FIRMS data (sample)...")
    try:
        firms_df = load_firms_data(aligned=True)
        print(f"   Shape: {firms_df.shape}")
        print(f"   Columns: {list(firms_df.columns)}")
        print(f"   Date range: {firms_df['acq_date'].min()} to {firms_df['acq_date'].max()}")
    except Exception as e:
        print(f"   Error: {e}")
    
    print("\n3. Loading NOAA data (sample)...")
    try:
        noaa_df = load_noaa_data(aligned=True)
        print(f"   Shape: {noaa_df.shape}")
        print(f"   Columns: {list(noaa_df.columns)}")
        if 'date' in noaa_df.columns:
            print(f"   Date range: {noaa_df['date'].min()} to {noaa_df['date'].max()}")
    except Exception as e:
        print(f"   Error: {e}")
    
    print("\n4. Checking USGS tiles...")
    try:
        usgs_tiles = load_usgs_elevation()
        if usgs_tiles:
            print(f"   Found {len(usgs_tiles)} tiles")
        else:
            print("   No tiles available")
    except Exception as e:
        print(f"   Error: {e}")
    
    print("\n=== Data Loader Test Complete ===")

