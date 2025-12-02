"""
Bulk Loader Module

Provides efficient bulk insertion of observations into the database.
Uses batch inserts with progress tracking and error handling.
"""

import sys
import os
from typing import List, Dict, Any, Optional
from datetime import datetime

# Add parent directory to path to import database modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

try:
    from database.connection import get_db_cursor
except ImportError:
    print("Warning: Could not import database.connection. Database operations will fail.")
    get_db_cursor = None


def validate_batch(observations: List[Dict[str, Any]]) -> tuple:
    """
    Validate a batch of observations before insertion.
    
    Args:
        observations: List of observation dictionaries
    
    Returns:
        Tuple of (valid_observations, invalid_count, error_messages)
    """
    valid_observations = []
    errors = []
    
    for idx, obs in enumerate(observations):
        # Check required fields
        required_fields = ['observation_date', 'latitude', 'longitude', 'fire_occurred']
        missing_fields = [f for f in required_fields if f not in obs or obs[f] is None]
        
        if missing_fields:
            errors.append(f"Row {idx}: Missing required fields: {missing_fields}")
            continue
        
        # Validate lat/lon ranges
        if not (-90 <= obs['latitude'] <= 90):
            errors.append(f"Row {idx}: Invalid latitude: {obs['latitude']}")
            continue
        
        if not (-180 <= obs['longitude'] <= 180):
            errors.append(f"Row {idx}: Invalid longitude: {obs['longitude']}")
            continue
        
        valid_observations.append(obs)
    
    return valid_observations, len(observations) - len(valid_observations), errors


def bulk_insert_observations(observations: List[Dict[str, Any]], 
                            batch_size: int = 1000,
                            commit_frequency: int = 5000) -> Dict[str, int]:
    """
    Bulk insert observations into the database.
    
    Args:
        observations: List of observation dictionaries
        batch_size: Number of records to insert per batch
        commit_frequency: Commit after this many successful inserts
    
    Returns:
        Dictionary with statistics (inserted, failed, total)
    """
    if get_db_cursor is None:
        print("Error: Database connection not available")
        return {'inserted': 0, 'failed': len(observations), 'total': len(observations)}
    
    stats = {
        'inserted': 0,
        'failed': 0,
        'total': len(observations)
    }
    
    # SQL for bulk insert using execute_values
    insert_sql = """
        INSERT INTO wildfire_observations (
            observation_date, location, evi, ndvi, thermal_anomaly,
            land_surface_temp, wind_speed, elevation, fire_occurred,
            vegetation_type_id, season_id, data_source
        ) VALUES %s
        ON CONFLICT DO NOTHING
    """
    
    try:
        from psycopg2.extras import execute_values
        
        with get_db_cursor() as cur:
            # Process in batches
            for i in range(0, len(observations), batch_size):
                batch = observations[i:i + batch_size]
                
                # Prepare values for batch
                values = []
                for obs in batch:
                    values.append((
                        obs['observation_date'],
                        f"POINT({obs['longitude']} {obs['latitude']})",
                        obs.get('evi'),
                        obs.get('ndvi'),
                        obs.get('thermal_anomaly'),
                        obs.get('land_surface_temp'),
                        obs.get('wind_speed'),
                        obs.get('elevation'),
                        obs['fire_occurred'],
                        obs.get('vegetation_type_id'),
                        obs.get('season_id'),
                        obs.get('data_source', 'UNKNOWN')
                    ))
                
                # Use execute_values for efficient batch insert
                try:
                    # Modify SQL to use ST_GeogFromText for the location
                    batch_insert_sql = """
                        INSERT INTO wildfire_observations (
                            observation_date, location, evi, ndvi, thermal_anomaly,
                            land_surface_temp, wind_speed, elevation, fire_occurred,
                            vegetation_type_id, season_id, data_source
                        ) VALUES %s
                        ON CONFLICT DO NOTHING
                    """
                    
                    # Convert values to proper format
                    formatted_values = [
                        (
                            obs['observation_date'],
                            f"SRID=4326;POINT({obs['longitude']} {obs['latitude']})",
                            obs.get('evi'),
                            obs.get('ndvi'),
                            obs.get('thermal_anomaly'),
                            obs.get('land_surface_temp'),
                            obs.get('wind_speed'),
                            obs.get('elevation'),
                            obs['fire_occurred'],
                            obs.get('vegetation_type_id'),
                            obs.get('season_id'),
                            obs.get('data_source', 'UNKNOWN')
                        )
                        for obs in batch
                    ]
                    
                    # Execute batch insert using execute_batch instead of execute_values
                    # because we need to use ST_GeogFromText
                    single_insert_sql = """
                        INSERT INTO wildfire_observations (
                            observation_date, location, evi, ndvi, thermal_anomaly,
                            land_surface_temp, wind_speed, elevation, fire_occurred,
                            vegetation_type_id, season_id, data_source
                        ) VALUES (
                            %s, ST_GeogFromText(%s), %s, %s, %s,
                            %s, %s, %s, %s, %s, %s, %s
                        )
                        ON CONFLICT DO NOTHING
                    """
                    
                    for obs in batch:
                        try:
                            cur.execute(single_insert_sql, (
                                obs['observation_date'],
                                f"POINT({obs['longitude']} {obs['latitude']})",
                                obs.get('evi'),
                                obs.get('ndvi'),
                                obs.get('thermal_anomaly'),
                                obs.get('land_surface_temp'),
                                obs.get('wind_speed'),
                                obs.get('elevation'),
                                obs['fire_occurred'],
                                obs.get('vegetation_type_id'),
                                obs.get('season_id'),
                                obs.get('data_source', 'UNKNOWN')
                            ))
                            stats['inserted'] += 1
                        except Exception as e:
                            stats['failed'] += 1
                            # Continue with next record
                            continue
                    
                    # Commit periodically
                    if stats['inserted'] % commit_frequency == 0:
                        cur.connection.commit()
                        
                except Exception as e:
                    print(f"Error inserting batch {i//batch_size + 1}: {e}")
                    stats['failed'] += len(batch)
            
            # Final commit
            cur.connection.commit()
            
    except Exception as e:
        print(f"Error in bulk insert: {e}")
        stats['failed'] = stats['total'] - stats['inserted']
    
    return stats


def insert_with_progress(observations: List[Dict[str, Any]],
                        batch_size: int = 1000,
                        show_progress: bool = True) -> Dict[str, int]:
    """
    Insert observations with progress bar.
    
    Args:
        observations: List of observation dictionaries
        batch_size: Number of records per batch
        show_progress: Whether to show progress output
    
    Returns:
        Dictionary with statistics
    """
    if show_progress:
        print(f"Inserting {len(observations):,} observations...")
        print(f"Using batch size: {batch_size}")
    
    start_time = datetime.now()
    
    # Validate first
    if show_progress:
        print("Validating observations...")
    
    valid_obs, invalid_count, errors = validate_batch(observations)
    
    if show_progress:
        print(f"Valid observations: {len(valid_obs):,}")
        if invalid_count > 0:
            print(f"Invalid observations: {invalid_count}")
            if errors and len(errors) <= 10:
                for error in errors[:10]:
                    print(f"  - {error}")
    
    # Insert
    if show_progress:
        print("Inserting into database...")
    
    stats = bulk_insert_observations(valid_obs, batch_size=batch_size)
    
    # Calculate duration
    duration = (datetime.now() - start_time).total_seconds()
    
    if show_progress:
        print(f"\n=== Insertion Complete ===")
        print(f"Total records: {stats['total']:,}")
        print(f"Inserted: {stats['inserted']:,}")
        print(f"Failed: {stats['failed']:,}")
        print(f"Duration: {duration:.2f} seconds")
        if stats['inserted'] > 0:
            print(f"Rate: {stats['inserted']/duration:.0f} records/second")
    
    return stats


def insert_observations_incremental(observations: List[Dict[str, Any]],
                                    checkpoint_file: Optional[str] = None,
                                    batch_size: int = 1000) -> Dict[str, int]:
    """
    Insert observations with checkpoint support for resumability.
    
    Args:
        observations: List of observation dictionaries
        checkpoint_file: Path to checkpoint file (saves progress)
        batch_size: Number of records per batch
    
    Returns:
        Dictionary with statistics
    """
    start_idx = 0
    
    # Load checkpoint if exists
    if checkpoint_file and os.path.exists(checkpoint_file):
        try:
            with open(checkpoint_file, 'r') as f:
                start_idx = int(f.read().strip())
            print(f"Resuming from record {start_idx:,}")
        except:
            pass
    
    stats = {
        'inserted': 0,
        'failed': 0,
        'total': len(observations)
    }
    
    # Insert remaining observations
    remaining = observations[start_idx:]
    batch_stats = insert_with_progress(remaining, batch_size=batch_size)
    
    stats['inserted'] = batch_stats['inserted']
    stats['failed'] = batch_stats['failed']
    
    # Update checkpoint
    if checkpoint_file:
        with open(checkpoint_file, 'w') as f:
            f.write(str(len(observations)))
    
    return stats


def get_insertion_statistics(start_date: str = None, 
                            end_date: str = None,
                            data_source: str = None) -> Dict[str, Any]:
    """
    Get statistics about inserted observations.
    
    Args:
        start_date: Optional start date filter
        end_date: Optional end date filter
        data_source: Optional data source filter
    
    Returns:
        Dictionary with statistics
    """
    if get_db_cursor is None:
        return {}
    
    sql = """
        SELECT 
            COUNT(*) as total_observations,
            COUNT(DISTINCT observation_date) as unique_dates,
            MIN(observation_date) as earliest_date,
            MAX(observation_date) as latest_date,
            SUM(CASE WHEN fire_occurred THEN 1 ELSE 0 END) as fire_count,
            COUNT(DISTINCT data_source) as data_sources
        FROM wildfire_observations
        WHERE 1=1
    """
    
    params = []
    
    if start_date:
        sql += " AND observation_date >= %s"
        params.append(start_date)
    
    if end_date:
        sql += " AND observation_date <= %s"
        params.append(end_date)
    
    if data_source:
        sql += " AND data_source = %s"
        params.append(data_source)
    
    try:
        with get_db_cursor() as cur:
            cur.execute(sql, params)
            result = cur.fetchone()
            
            if result:
                return {
                    'total_observations': result[0],
                    'unique_dates': result[1],
                    'earliest_date': result[2],
                    'latest_date': result[3],
                    'fire_count': result[4],
                    'data_sources': result[5]
                }
    except Exception as e:
        print(f"Error getting statistics: {e}")
    
    return {}


# Module test
if __name__ == "__main__":
    print("=== Bulk Loader Test ===\n")
    
    # Test validation
    print("1. Testing batch validation...")
    test_observations = [
        {
            'observation_date': '2020-08-15',
            'latitude': 37.7749,
            'longitude': -122.4194,
            'fire_occurred': True,
            'season_id': 3
        },
        {
            'observation_date': '2020-08-16',
            'latitude': None,  # Invalid
            'longitude': -122.4194,
            'fire_occurred': False,
            'season_id': 3
        },
        {
            'observation_date': '2020-08-17',
            'latitude': 38.5,
            'longitude': -121.5,
            'fire_occurred': False,
            'season_id': 3
        }
    ]
    
    valid_obs, invalid_count, errors = validate_batch(test_observations)
    print(f"   Total: {len(test_observations)}")
    print(f"   Valid: {len(valid_obs)}")
    print(f"   Invalid: {invalid_count}")
    if errors:
        for error in errors:
            print(f"   - {error}")
    
    print("\n2. Testing database statistics...")
    stats = get_insertion_statistics()
    if stats:
        print(f"   Current database statistics:")
        for key, value in stats.items():
            print(f"     {key}: {value}")
    else:
        print("   No database connection or no data")
    
    print("\n=== Bulk Loader Test Complete ===")

