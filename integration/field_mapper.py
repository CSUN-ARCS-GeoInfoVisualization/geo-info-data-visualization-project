"""
Field Mapper Module

Maps fields from ML data sources to the database schema.
Handles data transformations, unit conversions, and lookup table mappings.
"""

from datetime import datetime
from typing import Optional, Dict, Any
import pandas as pd


def get_season_id(month: int) -> int:
    """
    Get season ID based on month.
    
    Seasons:
    - Winter (ID: 1): December - February (12, 1, 2)
    - Spring (ID: 2): March - May (3, 4, 5)
    - Summer (ID: 3): June - August (6, 7, 8)
    - Fall (ID: 4): September - November (9, 10, 11)
    
    Args:
        month: Month number (1-12)
    
    Returns:
        Season ID (1-4)
    """
    if month in [12, 1, 2]:
        return 1  # Winter
    elif month in [3, 4, 5]:
        return 2  # Spring
    elif month in [6, 7, 8]:
        return 3  # Summer
    elif month in [9, 10, 11]:
        return 4  # Fall
    else:
        raise ValueError(f"Invalid month: {month}")


def classify_vegetation_type(evi: Optional[float] = None,
                             ndvi: Optional[float] = None,
                             elevation: Optional[float] = None) -> int:
    """
    Classify vegetation type based on available environmental data.
    
    Simplified classification based on vegetation indices:
    - SHRUB (1): High indices (0.3-0.6), typical of chaparral
    - GRASS (2): Moderate indices (0.2-0.4), seasonal variation
    - FOREST (3): Very high indices (>0.5), high elevation
    - AGRIC (4): Moderate-high indices (0.4-0.6), regular patterns
    - URBAN (5): Low indices (<0.2)
    - BARREN (6): Very low/negative indices (<0.1)
    
    Args:
        evi: Enhanced Vegetation Index (-1 to 1)
        ndvi: Normalized Difference Vegetation Index (-1 to 1)
        elevation: Elevation in meters
    
    Returns:
        Vegetation type ID (1-6)
    """
    # Use EVI if available, otherwise NDVI
    vi = evi if evi is not None else ndvi
    
    if vi is None:
        return 6  # Default to BARREN if no data
    
    # Simple classification logic
    if vi < 0.1:
        return 6  # BARREN
    elif vi < 0.2:
        return 5  # URBAN
    elif vi < 0.35:
        return 2  # GRASS
    elif vi < 0.5:
        # Check elevation for forest vs shrub
        if elevation and elevation > 1000:
            return 3  # FOREST
        else:
            return 1  # SHRUB
    else:  # vi >= 0.5
        if elevation and elevation > 1500:
            return 3  # FOREST
        else:
            return 4  # AGRIC (could be irrigated/managed vegetation)


def map_firms_to_observation(row: pd.Series, 
                             include_weather: bool = False,
                             include_elevation: bool = False) -> Dict[str, Any]:
    """
    Map FIRMS fire detection data to database observation format.
    
    Args:
        row: DataFrame row with FIRMS data
        include_weather: If True, include weather fields (from spatial join)
        include_elevation: If True, include elevation field
    
    Returns:
        Dictionary ready for database insertion
    """
    # Parse date
    if isinstance(row['acq_date'], str):
        obs_date = datetime.strptime(row['acq_date'], '%Y-%m-%d').date()
    else:
        obs_date = row['acq_date'].date() if hasattr(row['acq_date'], 'date') else row['acq_date']
    
    # Get month for season
    if hasattr(obs_date, 'month'):
        month = obs_date.month
    else:
        month = pd.to_datetime(obs_date).month
    
    # Base observation from FIRMS
    observation = {
        'observation_date': obs_date,
        'latitude': row['latitude'],
        'longitude': row['longitude'],
        'thermal_anomaly': row.get('brightness'),  # Brightness as thermal anomaly
        'fire_occurred': True,  # FIRMS detections are fire occurrences
        'season_id': get_season_id(month),
        'data_source': 'NASA_FIRMS',
        # Fields not in FIRMS data
        'evi': None,
        'ndvi': None,
        'land_surface_temp': None,
        'wind_speed': None,
        'elevation': None,
        'vegetation_type_id': None
    }
    
    # Add FRP if available (can be used as additional thermal measure)
    if 'frp' in row and pd.notna(row['frp']):
        # Store FRP in a custom field or use it to enhance thermal_anomaly
        # For now, we'll keep brightness as thermal_anomaly
        pass
    
    # Include weather data if available (from spatial join)
    if include_weather:
        if 'TMAX' in row and pd.notna(row['TMAX']):
            observation['land_surface_temp'] = row['TMAX'] + 273.15  # Convert C to K
        
        if 'AWND' in row and pd.notna(row['AWND']):
            observation['wind_speed'] = row['AWND']
        elif 'WSF2' in row and pd.notna(row['WSF2']):
            observation['wind_speed'] = row['WSF2']
    
    # Include elevation if available
    if include_elevation and 'elevation' in row and pd.notna(row['elevation']):
        observation['elevation'] = row['elevation']
    
    # Classify vegetation type based on available data
    observation['vegetation_type_id'] = classify_vegetation_type(
        evi=observation['evi'],
        ndvi=observation['ndvi'],
        elevation=observation['elevation']
    )
    
    return observation


def map_noaa_to_observation(row: pd.Series, 
                            fire_occurred: bool = False) -> Dict[str, Any]:
    """
    Map NOAA weather data to database observation format.
    
    Note: NOAA data typically needs to be spatially joined with fire data
    to create complete observations.
    
    Args:
        row: DataFrame row with NOAA data (wide format with TMAX, TMIN, etc.)
        fire_occurred: Whether fire occurred at this location/date
    
    Returns:
        Dictionary ready for database insertion
    """
    # Parse date
    if isinstance(row['date'], str):
        obs_date = datetime.strptime(row['date'], '%Y-%m-%d').date()
    else:
        obs_date = row['date'].date() if hasattr(row['date'], 'date') else row['date']
    
    # Get month for season
    if hasattr(obs_date, 'month'):
        month = obs_date.month
    else:
        month = pd.to_datetime(obs_date).month
    
    # Base observation from NOAA
    observation = {
        'observation_date': obs_date,
        'latitude': row.get('latitude'),
        'longitude': row.get('longitude'),
        'fire_occurred': fire_occurred,
        'season_id': get_season_id(month),
        'data_source': 'NOAA_GHCND',
        # Weather fields
        'wind_speed': None,
        'land_surface_temp': None,
        # Fields not in NOAA data
        'evi': None,
        'ndvi': None,
        'thermal_anomaly': None,
        'elevation': None,
        'vegetation_type_id': None
    }
    
    # Map NOAA weather variables
    if 'TMAX' in row and pd.notna(row['TMAX']):
        # Convert Celsius to Kelvin for consistency
        observation['land_surface_temp'] = row['TMAX'] + 273.15
    elif 'TMIN' in row and pd.notna(row['TMIN']):
        # Use TMIN if TMAX not available
        observation['land_surface_temp'] = row['TMIN'] + 273.15
    
    # Wind speed (prioritize average wind, then fastest 2-min, then fastest 5-sec)
    if 'AWND' in row and pd.notna(row['AWND']):
        observation['wind_speed'] = row['AWND']
    elif 'WSF2' in row and pd.notna(row['WSF2']):
        observation['wind_speed'] = row['WSF2']
    elif 'WSF5' in row and pd.notna(row['WSF5']):
        observation['wind_speed'] = row['WSF5']
    
    # Classify vegetation type
    observation['vegetation_type_id'] = classify_vegetation_type(
        evi=observation['evi'],
        ndvi=observation['ndvi'],
        elevation=observation['elevation']
    )
    
    return observation


def validate_observation(obs: Dict[str, Any]) -> bool:
    """
    Validate observation data before database insertion.
    
    Args:
        obs: Observation dictionary
    
    Returns:
        True if valid, False otherwise
    """
    # Required fields
    if not obs.get('observation_date'):
        return False
    
    if obs.get('latitude') is None or obs.get('longitude') is None:
        return False
    
    if obs.get('fire_occurred') is None:
        return False
    
    # Validate ranges
    lat = obs.get('latitude')
    lon = obs.get('longitude')
    
    if not (-90 <= lat <= 90):
        return False
    
    if not (-180 <= lon <= 180):
        return False
    
    # California bounds check
    if not (32.0 <= lat <= 42.5):
        return False
    
    if not (-125.0 <= lon <= -113.0):
        return False
    
    # Validate EVI/NDVI if present
    if obs.get('evi') is not None:
        if not (-1 <= obs['evi'] <= 1):
            return False
    
    if obs.get('ndvi') is not None:
        if not (-1 <= obs['ndvi'] <= 1):
            return False
    
    # Validate wind speed if present
    if obs.get('wind_speed') is not None:
        if obs['wind_speed'] < 0:
            return False
    
    return True


def batch_map_firms_data(firms_df: pd.DataFrame,
                        include_weather: bool = False,
                        include_elevation: bool = False) -> list:
    """
    Map multiple FIRMS records to observation format.
    
    Args:
        firms_df: DataFrame with FIRMS data
        include_weather: If True, include weather fields
        include_elevation: If True, include elevation field
    
    Returns:
        List of observation dictionaries
    """
    observations = []
    
    for idx, row in firms_df.iterrows():
        try:
            obs = map_firms_to_observation(row, include_weather, include_elevation)
            if validate_observation(obs):
                observations.append(obs)
        except Exception as e:
            print(f"Error mapping row {idx}: {e}")
            continue
    
    return observations


def batch_map_noaa_data(noaa_df: pd.DataFrame,
                       fire_occurred: bool = False) -> list:
    """
    Map multiple NOAA records to observation format.
    
    Args:
        noaa_df: DataFrame with NOAA data
        fire_occurred: Whether fire occurred
    
    Returns:
        List of observation dictionaries
    """
    observations = []
    
    for idx, row in noaa_df.iterrows():
        try:
            obs = map_noaa_to_observation(row, fire_occurred)
            if validate_observation(obs):
                observations.append(obs)
        except Exception as e:
            print(f"Error mapping row {idx}: {e}")
            continue
    
    return observations


# Module test
if __name__ == "__main__":
    print("=== Field Mapper Test ===\n")
    
    # Test season mapping
    print("1. Testing season mapping...")
    for month in range(1, 13):
        season_id = get_season_id(month)
        season_names = {1: "Winter", 2: "Spring", 3: "Summer", 4: "Fall"}
        print(f"   Month {month:2d} -> Season {season_id} ({season_names[season_id]})")
    
    # Test vegetation classification
    print("\n2. Testing vegetation classification...")
    test_cases = [
        (0.05, None, None, "Barren"),
        (0.15, None, None, "Urban"),
        (0.25, None, None, "Grass"),
        (0.40, None, 500, "Shrub"),
        (0.45, None, 1500, "Forest"),
        (0.60, None, 2000, "Forest"),
    ]
    
    for evi, ndvi, elev, expected in test_cases:
        veg_id = classify_vegetation_type(evi, ndvi, elev)
        veg_names = {1: "Shrub", 2: "Grass", 3: "Forest", 4: "Agric", 5: "Urban", 6: "Barren"}
        print(f"   EVI={evi:.2f}, Elev={elev} -> {veg_names[veg_id]} (expected: {expected})")
    
    # Test FIRMS mapping
    print("\n3. Testing FIRMS data mapping...")
    firms_sample = pd.DataFrame([{
        'acq_date': '2020-08-15',
        'latitude': 37.7749,
        'longitude': -122.4194,
        'brightness': 330.5,
        'frp': 25.3,
        'confidence': 'high'
    }])
    
    obs = map_firms_to_observation(firms_sample.iloc[0])
    print(f"   Mapped FIRMS observation:")
    for key, value in obs.items():
        print(f"     {key}: {value}")
    
    print(f"\n   Validation: {'PASS' if validate_observation(obs) else 'FAIL'}")
    
    print("\n=== Field Mapper Test Complete ===")

