"""
Spatial utility functions for working with PostGIS geography data.
"""

from connection import get_db_cursor


def create_point(latitude, longitude):
    """Create a PostGIS geography point from lat/lon coordinates.
    
    Args:
        latitude: Latitude in decimal degrees
        longitude: Longitude in decimal degrees
    
    Returns:
        PostGIS geography point string
    """
    return f"ST_GeogFromText('POINT({longitude} {latitude})')"


def insert_observation(date, lat, lon, evi=None, ndvi=None, thermal_anomaly=None,
                      land_surface_temp=None, wind_speed=None, elevation=None,
                      fire_occurred=False, vegetation_type_id=None, season_id=None,
                      data_source=None):
    """Insert a single wildfire observation into the database.
    
    Args:
        date: Observation date (YYYY-MM-DD string or date object)
        lat: Latitude
        lon: Longitude
        evi: Enhanced Vegetation Index (-1 to 1)
        ndvi: Normalized Difference Vegetation Index (-1 to 1)
        thermal_anomaly: Thermal anomaly level
        land_surface_temp: Land surface temperature
        wind_speed: Wind speed
        elevation: Elevation in meters
        fire_occurred: Boolean indicating fire occurrence
        vegetation_type_id: Foreign key to vegetation_types table
        season_id: Foreign key to seasons table
        data_source: Source of the data
    
    Returns:
        observation_id if successful, None otherwise
    """
    sql = """
        INSERT INTO wildfire_observations (
            observation_date, location, evi, ndvi, thermal_anomaly,
            land_surface_temp, wind_speed, elevation, fire_occurred,
            vegetation_type_id, season_id, data_source
        ) VALUES (
            %s, ST_GeogFromText('POINT(%s %s)'), %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s
        ) RETURNING observation_id;
    """
    
    try:
        with get_db_cursor() as cur:
            cur.execute(sql, (
                date, lon, lat, evi, ndvi, thermal_anomaly,
                land_surface_temp, wind_speed, elevation, fire_occurred,
                vegetation_type_id, season_id, data_source
            ))
            result = cur.fetchone()
            return result[0] if result else None
    except Exception as e:
        print(f"Error inserting observation: {e}")
        return None


def query_observations_by_bbox(min_lat, min_lon, max_lat, max_lon, start_date=None, end_date=None):
    """Query observations within a bounding box.
    
    Args:
        min_lat: Minimum latitude
        min_lon: Minimum longitude
        max_lat: Maximum latitude
        max_lon: Maximum longitude
        start_date: Optional start date filter
        end_date: Optional end date filter
    
    Returns:
        List of observation records
    """
    sql = """
        SELECT 
            observation_id,
            observation_date,
            ST_Y(location::geometry) as latitude,
            ST_X(location::geometry) as longitude,
            evi, ndvi, thermal_anomaly, land_surface_temp,
            wind_speed, elevation, fire_occurred
        FROM wildfire_observations
        WHERE location && ST_MakeEnvelope(%s, %s, %s, %s, 4326)::geography
    """
    
    params = [min_lon, min_lat, max_lon, max_lat]
    
    if start_date:
        sql += " AND observation_date >= %s"
        params.append(start_date)
    
    if end_date:
        sql += " AND observation_date <= %s"
        params.append(end_date)
    
    try:
        with get_db_cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()
    except Exception as e:
        print(f"Error querying observations: {e}")
        return []


def query_observations_near_point(lat, lon, radius_meters, start_date=None, end_date=None):
    """Query observations within a radius of a point.
    
    Args:
        lat: Center point latitude
        lon: Center point longitude
        radius_meters: Radius in meters
        start_date: Optional start date filter
        end_date: Optional end date filter
    
    Returns:
        List of observation records with distance
    """
    sql = """
        SELECT 
            observation_id,
            observation_date,
            ST_Y(location::geometry) as latitude,
            ST_X(location::geometry) as longitude,
            evi, ndvi, thermal_anomaly, land_surface_temp,
            wind_speed, elevation, fire_occurred,
            ST_Distance(location, ST_GeogFromText('POINT(%s %s)')) as distance_meters
        FROM wildfire_observations
        WHERE ST_DWithin(location, ST_GeogFromText('POINT(%s %s)'), %s)
    """
    
    params = [lon, lat, lon, lat, radius_meters]
    
    if start_date:
        sql += " AND observation_date >= %s"
        params.append(start_date)
    
    if end_date:
        sql += " AND observation_date <= %s"
        params.append(end_date)
    
    sql += " ORDER BY distance_meters"
    
    try:
        with get_db_cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()
    except Exception as e:
        print(f"Error querying observations: {e}")
        return []


def get_fire_statistics_by_season(year):
    """Get fire statistics grouped by season for a given year.
    
    Args:
        year: Year to analyze
    
    Returns:
        List of season statistics
    """
    sql = """
        SELECT 
            s.season_name,
            COUNT(*) as total_observations,
            SUM(CASE WHEN w.fire_occurred THEN 1 ELSE 0 END) as fire_count,
            ROUND(AVG(CASE WHEN w.fire_occurred THEN 1.0 ELSE 0.0 END) * 100, 2) as fire_percentage,
            ROUND(AVG(w.thermal_anomaly), 2) as avg_thermal_anomaly,
            ROUND(AVG(w.wind_speed), 2) as avg_wind_speed
        FROM wildfire_observations w
        JOIN seasons s ON w.season_id = s.season_id
        WHERE w.year = %s
        GROUP BY s.season_name, s.start_month
        ORDER BY s.start_month
    """
    
    try:
        with get_db_cursor() as cur:
            cur.execute(sql, (year,))
            return cur.fetchall()
    except Exception as e:
        print(f"Error getting season statistics: {e}")
        return []
