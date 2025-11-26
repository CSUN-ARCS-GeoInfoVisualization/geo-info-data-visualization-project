"""
Test script to verify database setup and connection.
Run this after setup to ensure everything is working.
"""

from connection import test_connection
from spatial_utils import insert_observation, query_observations_near_point

def main():
    print("=" * 60)
    print("DATABASE CONNECTION TEST")
    print("=" * 60)
    print()
    
    # Test 1: Connection
    print("[Test 1/3] Testing database connection...")
    if not test_connection():
        print("✗ Connection test failed!")
        print("Please check your .env file and PostgreSQL installation.")
        return False
    print("✓ Connection test passed!")
    print()
    
    # Test 2: Insert data
    print("[Test 2/3] Testing data insertion...")
    try:
        obs_id = insert_observation(
            date='2020-08-15',
            lat=37.7749,  # San Francisco
            lon=-122.4194,
            evi=0.45,
            ndvi=0.52,
            thermal_anomaly=15.3,
            land_surface_temp=305.2,
            wind_speed=12.5,
            elevation=150.0,
            fire_occurred=True,
            season_id=3,  # Summer
            vegetation_type_id=1,  # Shrubland
            data_source='TEST_SETUP'
        )
        
        if obs_id:
            print(f"✓ Successfully inserted observation with ID: {obs_id}")
        else:
            print("✗ Failed to insert observation")
            return False
    except Exception as e:
        print(f"✗ Insert test failed: {e}")
        return False
    print()
    
    # Test 3: Query data
    print("[Test 3/3] Testing spatial query...")
    try:
        results = query_observations_near_point(
            lat=37.7749,
            lon=-122.4194,
            radius_meters=100000,  # 100km radius
            start_date='2020-01-01',
            end_date='2020-12-31'
        )
        
        print(f"✓ Found {len(results)} observation(s) within 100km of San Francisco")
        
        if len(results) > 0:
            print("\nSample observation:")
            obs = results[0]
            print(f"  - Date: {obs[1]}")
            print(f"  - Location: ({obs[2]:.4f}, {obs[3]:.4f})")
            print(f"  - Fire occurred: {obs[10]}")
            print(f"  - Distance: {obs[11]/1000:.2f} km")
    except Exception as e:
        print(f"✗ Query test failed: {e}")
        return False
    print()
    
    # Summary
    print("=" * 60)
    print("ALL TESTS PASSED! ✓")
    print("=" * 60)
    print()
    print("Your database is ready to use!")
    print()
    print("Available tables:")
    print("  - wildfire_observations (partitioned by year)")
    print("  - seasons")
    print("  - vegetation_types")
    print()
    print("Next steps:")
    print("  1. Import data from ml-data-sources branch")
    print("  2. Integrate with API-framework branch")
    print("  3. Add authentication from user-auth branch")
    print()
    
    return True

if __name__ == '__main__':
    success = main()
    exit(0 if success else 1)
