"""
Spatial Join Module

Combines data from multiple sources using spatial and temporal joins.
Creates unified observations by joining fire, weather, and elevation data.
"""

import pandas as pd
import numpy as np
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta


def spatial_nearest_join(points_df: pd.DataFrame,
                         stations_df: pd.DataFrame,
                         max_distance_km: float = 50,
                         lat_col: str = 'latitude',
                         lon_col: str = 'longitude') -> pd.DataFrame:
    """
    Join points to nearest weather stations using haversine distance.
    
    Args:
        points_df: DataFrame with point locations (fires)
        stations_df: DataFrame with weather station locations
        max_distance_km: Maximum distance in km for matching
        lat_col: Name of latitude column
        lon_col: Name of longitude column
    
    Returns:
        DataFrame with joined data (points + nearest station data)
    """
    def haversine_distance(lat1, lon1, lat2, lon2):
        """Calculate great circle distance in kilometers."""
        R = 6371  # Earth radius in kilometers
        
        lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        
        a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
        c = 2 * np.arcsin(np.sqrt(a))
        
        return R * c
    
    # Add station data to points
    results = []
    
    for idx, point in points_df.iterrows():
        point_lat = point[lat_col]
        point_lon = point[lon_col]
        
        # Calculate distances to all stations
        distances = []
        for _, station in stations_df.iterrows():
            dist = haversine_distance(
                point_lat, point_lon,
                station[lat_col], station[lon_col]
            )
            distances.append(dist)
        
        # Find nearest station
        if distances:
            min_dist = min(distances)
            if min_dist <= max_distance_km:
                nearest_idx = distances.index(min_dist)
                nearest_station = stations_df.iloc[nearest_idx]
                
                # Combine point and station data
                result = point.to_dict()
                for col in stations_df.columns:
                    if col not in [lat_col, lon_col]:
                        result[f"station_{col}"] = nearest_station[col]
                result['station_distance_km'] = min_dist
                
                results.append(result)
    
    return pd.DataFrame(results) if results else pd.DataFrame()


def temporal_join(fire_df: pd.DataFrame,
                 weather_df: pd.DataFrame,
                 date_col_fire: str = 'acq_date',
                 date_col_weather: str = 'date',
                 tolerance_days: int = 1) -> pd.DataFrame:
    """
    Join fire and weather data by matching dates.
    
    Args:
        fire_df: DataFrame with fire detections
        weather_df: DataFrame with weather observations
        date_col_fire: Date column name in fire data
        date_col_weather: Date column name in weather data
        tolerance_days: Allow matching within +/- this many days
    
    Returns:
        DataFrame with temporal join
    """
    # Ensure dates are datetime
    fire_df[date_col_fire] = pd.to_datetime(fire_df[date_col_fire])
    weather_df[date_col_weather] = pd.to_datetime(weather_df[date_col_weather])
    
    # Merge on exact date first
    merged = fire_df.merge(
        weather_df,
        left_on=date_col_fire,
        right_on=date_col_weather,
        how='left',
        suffixes=('', '_weather')
    )
    
    # For unmatched records, try tolerance matching
    if tolerance_days > 0:
        unmatched = merged[merged[date_col_weather].isna()]
        
        for idx, fire_row in unmatched.iterrows():
            fire_date = fire_row[date_col_fire]
            
            # Find weather within tolerance
            date_diff = (weather_df[date_col_weather] - fire_date).abs()
            within_tolerance = date_diff <= timedelta(days=tolerance_days)
            
            if within_tolerance.any():
                # Use closest date
                closest_idx = date_diff[within_tolerance].idxmin()
                weather_row = weather_df.loc[closest_idx]
                
                # Update merged data
                for col in weather_df.columns:
                    if col != date_col_weather:
                        merged.at[idx, col] = weather_row[col]
    
    return merged


def join_fire_weather_elevation(firms_df: pd.DataFrame,
                                noaa_df: pd.DataFrame,
                                include_elevation: bool = False) -> pd.DataFrame:
    """
    Join FIRMS fire data with NOAA weather data and optionally elevation.
    
    This is the main integration function that combines all data sources.
    
    Args:
        firms_df: FIRMS fire detection data
        noaa_df: NOAA weather data (should have lat/lon for stations)
        include_elevation: Whether to sample elevation data
    
    Returns:
        DataFrame with joined observations
    """
    print("Starting spatial-temporal join...")
    print(f"  FIRMS records: {len(firms_df):,}")
    print(f"  NOAA records: {len(noaa_df):,}")
    
    # Step 1: Prepare NOAA data - ensure it has station locations
    if 'latitude' not in noaa_df.columns or 'longitude' not in noaa_df.columns:
        print("Warning: NOAA data missing lat/lon. Weather data will not be joined.")
        joined_df = firms_df.copy()
    else:
        # Get unique weather stations with their locations
        weather_stations = noaa_df[['station', 'latitude', 'longitude']].drop_duplicates()
        
        print(f"  Weather stations: {len(weather_stations)}")
        
        # Step 2: Spatial join - find nearest weather station for each fire
        print("  Performing spatial join...")
        spatially_joined = spatial_nearest_join(
            firms_df,
            weather_stations,
            max_distance_km=50
        )
        
        print(f"  Spatially matched records: {len(spatially_joined):,}")
        
        # Step 3: Temporal join - match by date
        print("  Performing temporal join...")
        
        # Prepare weather data with all variables
        weather_with_data = noaa_df.copy()
        
        joined_df = temporal_join(
            spatially_joined,
            weather_with_data,
            date_col_fire='acq_date',
            date_col_weather='date',
            tolerance_days=1
        )
        
        print(f"  Temporally matched records: {len(joined_df):,}")
    
    # Step 4: Add elevation if requested
    if include_elevation:
        print("  Sampling elevation data...")
        try:
            from .data_loader import sample_elevation_at_points
            joined_df = sample_elevation_at_points(joined_df)
        except Exception as e:
            print(f"  Error sampling elevation: {e}")
            joined_df['elevation'] = None
    
    return joined_df


def create_unified_observations(firms_df: pd.DataFrame,
                               noaa_df: Optional[pd.DataFrame] = None,
                               include_elevation: bool = False,
                               fire_only: bool = True) -> pd.DataFrame:
    """
    Create unified observation dataset from multiple sources.
    
    Args:
        firms_df: FIRMS fire detection data
        noaa_df: Optional NOAA weather data
        include_elevation: Whether to include elevation data
        fire_only: If True, only include fire observations
    
    Returns:
        DataFrame ready for database insertion
    """
    print("Creating unified observations...")
    
    # If no weather data, just use FIRMS
    if noaa_df is None or len(noaa_df) == 0:
        print("  No weather data provided, using FIRMS only")
        unified_df = firms_df.copy()
        
        # Add placeholder columns for weather
        unified_df['TMAX'] = None
        unified_df['TMIN'] = None
        unified_df['AWND'] = None
        unified_df['WSF2'] = None
        unified_df['WSF5'] = None
        unified_df['PRCP'] = None
    else:
        # Join all data sources
        unified_df = join_fire_weather_elevation(
            firms_df,
            noaa_df,
            include_elevation=include_elevation
        )
    
    # Ensure required columns exist
    required_cols = ['acq_date', 'latitude', 'longitude']
    for col in required_cols:
        if col not in unified_df.columns:
            raise ValueError(f"Missing required column: {col}")
    
    # Mark all as fire observations (from FIRMS)
    unified_df['fire_occurred'] = True
    
    print(f"  Created {len(unified_df):,} unified observations")
    
    return unified_df


def create_negative_samples(positive_df: pd.DataFrame,
                          noaa_df: pd.DataFrame,
                          sample_ratio: float = 0.5) -> pd.DataFrame:
    """
    Create negative samples (no fire) from weather station data.
    
    This helps balance the dataset for ML training.
    
    Args:
        positive_df: DataFrame with fire observations
        noaa_df: NOAA weather data
        sample_ratio: Ratio of negative to positive samples
    
    Returns:
        DataFrame with negative samples
    """
    print(f"Creating negative samples (ratio: {sample_ratio})...")
    
    # Get dates and locations from positive samples
    fire_dates = set(positive_df['acq_date'].dt.date)
    
    # Filter NOAA data to same date range
    noaa_df['date'] = pd.to_datetime(noaa_df['date'])
    noaa_in_range = noaa_df[noaa_df['date'].dt.date.isin(fire_dates)]
    
    # Sample negative examples
    n_negative = int(len(positive_df) * sample_ratio)
    
    if len(noaa_in_range) < n_negative:
        negative_samples = noaa_in_range.copy()
    else:
        negative_samples = noaa_in_range.sample(n=n_negative, random_state=42)
    
    # Mark as non-fire
    negative_samples['fire_occurred'] = False
    
    # Rename date column to match FIRMS
    negative_samples = negative_samples.rename(columns={'date': 'acq_date'})
    
    print(f"  Created {len(negative_samples):,} negative samples")
    
    return negative_samples


def combine_positive_negative_samples(positive_df: pd.DataFrame,
                                      negative_df: pd.DataFrame) -> pd.DataFrame:
    """
    Combine positive and negative samples into balanced dataset.
    
    Args:
        positive_df: DataFrame with fire observations
        negative_df: DataFrame with non-fire observations
    
    Returns:
        Combined and shuffled DataFrame
    """
    # Ensure both have same columns
    all_cols = set(positive_df.columns) | set(negative_df.columns)
    
    for col in all_cols:
        if col not in positive_df.columns:
            positive_df[col] = None
        if col not in negative_df.columns:
            negative_df[col] = None
    
    # Combine
    combined = pd.concat([positive_df, negative_df], ignore_index=True)
    
    # Shuffle
    combined = combined.sample(frac=1, random_state=42).reset_index(drop=True)
    
    print(f"Combined dataset: {len(combined):,} observations")
    print(f"  Fire: {combined['fire_occurred'].sum():,} ({combined['fire_occurred'].mean()*100:.1f}%)")
    print(f"  No fire: {(~combined['fire_occurred']).sum():,} ({(~combined['fire_occurred']).mean()*100:.1f}%)")
    
    return combined


# Module test
if __name__ == "__main__":
    print("=== Spatial Join Test ===\n")
    
    # Test haversine distance
    print("1. Testing spatial nearest join...")
    
    # Sample fire locations
    fires = pd.DataFrame({
        'acq_date': ['2020-08-15', '2020-08-15'],
        'latitude': [37.7749, 38.5816],
        'longitude': [-122.4194, -121.4944]
    })
    
    # Sample weather stations
    stations = pd.DataFrame({
        'station': ['STATION_A', 'STATION_B'],
        'latitude': [37.7749, 39.0],
        'longitude': [-122.4, -121.0],
        'TMAX': [30.5, 32.1],
        'AWND': [5.5, 3.2]
    })
    
    joined = spatial_nearest_join(fires, stations, max_distance_km=100)
    print(f"   Input fires: {len(fires)}")
    print(f"   Joined records: {len(joined)}")
    if len(joined) > 0:
        print(f"   Columns: {list(joined.columns)}")
    
    print("\n2. Testing temporal join...")
    
    weather = pd.DataFrame({
        'station': ['STATION_A', 'STATION_A'],
        'date': ['2020-08-15', '2020-08-16'],
        'TMAX': [30.5, 31.2],
        'AWND': [5.5, 4.8]
    })
    
    temp_joined = temporal_join(fires, weather, tolerance_days=1)
    print(f"   Fire records: {len(fires)}")
    print(f"   Weather records: {len(weather)}")
    print(f"   Joined records: {len(temp_joined)}")
    
    print("\n=== Spatial Join Test Complete ===")

