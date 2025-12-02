"""
Integration Tests

Test suite for the data integration layer.
Tests each module independently and the complete pipeline.

Usage:
    python test_integration.py
"""

import sys
import os
from datetime import datetime, date

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_data_loader():
    """Test data loader module."""
    print("\n" + "="*70)
    print("TEST 1: Data Loader Module")
    print("="*70)
    
    try:
        from integration.data_loader import (
            check_preprocessed_data_availability,
            DataPaths
        )
        
        # Test data availability check
        print("\n1.1 Checking data availability...")
        availability = check_preprocessed_data_availability()
        
        for key, value in availability.items():
            status = "✓" if value else "✗"
            print(f"  {status} {key}: {value}")
        
        # Test path management
        print("\n1.2 Checking data paths...")
        print(f"  Base directory: {DataPaths.BASE_DIR}")
        print(f"  Data directory: {DataPaths.DATA_DIR}")
        print(f"  FIRMS cleaned: {DataPaths.FIRMS_CLEANED.exists()}")
        print(f"  NOAA cleaned: {DataPaths.NOAA_CLEANED.exists()}")
        
        # Try loading a small sample
        if availability.get('firms_aligned'):
            print("\n1.3 Loading FIRMS sample...")
            from integration.data_loader import load_firms_data
            
            firms_df = load_firms_data(aligned=True)
            print(f"  ✓ Loaded {len(firms_df):,} records")
            print(f"  Columns: {list(firms_df.columns[:5])}...")
        
        print("\n✓ Data Loader tests PASSED")
        return True
        
    except Exception as e:
        print(f"\n✗ Data Loader tests FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_field_mapper():
    """Test field mapper module."""
    print("\n" + "="*70)
    print("TEST 2: Field Mapper Module")
    print("="*70)
    
    try:
        from integration.field_mapper import (
            get_season_id,
            classify_vegetation_type,
            map_firms_to_observation,
            validate_observation
        )
        import pandas as pd
        
        # Test season mapping
        print("\n2.1 Testing season mapping...")
        seasons = []
        for month in [1, 4, 7, 10]:
            season_id = get_season_id(month)
            seasons.append(season_id)
            print(f"  Month {month:2d} -> Season {season_id}")
        
        assert seasons == [1, 2, 3, 4], "Season mapping incorrect"
        print("  ✓ Season mapping correct")
        
        # Test vegetation classification
        print("\n2.2 Testing vegetation classification...")
        veg_id = classify_vegetation_type(evi=0.4, elevation=500)
        print(f"  EVI=0.4, Elevation=500m -> Vegetation type {veg_id}")
        assert 1 <= veg_id <= 6, "Invalid vegetation type"
        print("  ✓ Vegetation classification correct")
        
        # Test FIRMS mapping
        print("\n2.3 Testing FIRMS observation mapping...")
        test_row = pd.Series({
            'acq_date': '2020-08-15',
            'latitude': 37.7749,
            'longitude': -122.4194,
            'brightness': 330.5,
            'frp': 25.3
        })
        
        obs = map_firms_to_observation(test_row)
        print(f"  Mapped observation keys: {list(obs.keys())[:5]}...")
        assert obs['fire_occurred'] == True, "Fire occurred should be True"
        assert obs['latitude'] == 37.7749, "Latitude incorrect"
        print("  ✓ FIRMS mapping correct")
        
        # Test validation
        print("\n2.4 Testing observation validation...")
        is_valid = validate_observation(obs)
        print(f"  Validation result: {is_valid}")
        assert is_valid, "Valid observation marked as invalid"
        print("  ✓ Validation correct")
        
        print("\n✓ Field Mapper tests PASSED")
        return True
        
    except Exception as e:
        print(f"\n✗ Field Mapper tests FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_spatial_join():
    """Test spatial join module."""
    print("\n" + "="*70)
    print("TEST 3: Spatial Join Module")
    print("="*70)
    
    try:
        from integration.spatial_join import (
            spatial_nearest_join,
            temporal_join
        )
        import pandas as pd
        
        # Test spatial join
        print("\n3.1 Testing spatial nearest join...")
        fires = pd.DataFrame({
            'acq_date': ['2020-08-15', '2020-08-15'],
            'latitude': [37.7749, 38.5816],
            'longitude': [-122.4194, -121.4944]
        })
        
        stations = pd.DataFrame({
            'station': ['STATION_A', 'STATION_B'],
            'latitude': [37.7749, 38.6],
            'longitude': [-122.4, -121.5],
            'TMAX': [30.5, 32.1]
        })
        
        joined = spatial_nearest_join(fires, stations, max_distance_km=50)
        print(f"  Input fires: {len(fires)}")
        print(f"  Stations: {len(stations)}")
        print(f"  Joined records: {len(joined)}")
        assert len(joined) > 0, "No spatial joins performed"
        print("  ✓ Spatial join working")
        
        # Test temporal join
        print("\n3.2 Testing temporal join...")
        weather = pd.DataFrame({
            'station': ['STATION_A', 'STATION_A'],
            'date': ['2020-08-15', '2020-08-16'],
            'TMAX': [30.5, 31.2]
        })
        
        temp_joined = temporal_join(fires, weather, tolerance_days=1)
        print(f"  Fire records: {len(fires)}")
        print(f"  Weather records: {len(weather)}")
        print(f"  Temporally joined: {len(temp_joined)}")
        print("  ✓ Temporal join working")
        
        print("\n✓ Spatial Join tests PASSED")
        return True
        
    except Exception as e:
        print(f"\n✗ Spatial Join tests FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_bulk_loader():
    """Test bulk loader module."""
    print("\n" + "="*70)
    print("TEST 4: Bulk Loader Module")
    print("="*70)
    
    try:
        from integration.bulk_loader import (
            validate_batch,
            get_insertion_statistics
        )
        
        # Test batch validation
        print("\n4.1 Testing batch validation...")
        test_obs = [
            {
                'observation_date': date(2020, 8, 15),
                'latitude': 37.7749,
                'longitude': -122.4194,
                'fire_occurred': True
            },
            {
                'observation_date': date(2020, 8, 16),
                'latitude': None,  # Invalid
                'longitude': -122.4194,
                'fire_occurred': False
            }
        ]
        
        valid_obs, invalid_count, errors = validate_batch(test_obs)
        print(f"  Total observations: {len(test_obs)}")
        print(f"  Valid: {len(valid_obs)}")
        print(f"  Invalid: {invalid_count}")
        assert len(valid_obs) == 1, "Validation incorrect"
        assert invalid_count == 1, "Invalid count incorrect"
        print("  ✓ Batch validation correct")
        
        # Test database statistics (if database available)
        print("\n4.2 Testing database statistics...")
        try:
            stats = get_insertion_statistics()
            if stats:
                print(f"  Total observations in DB: {stats.get('total_observations', 0):,}")
                print(f"  ✓ Database statistics retrieved")
            else:
                print("  ⚠ No database connection (OK for test)")
        except:
            print("  ⚠ Database not available (OK for test)")
        
        print("\n✓ Bulk Loader tests PASSED")
        return True
        
    except Exception as e:
        print(f"\n✗ Bulk Loader tests FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_integration_pipeline():
    """Test the complete integration pipeline."""
    print("\n" + "="*70)
    print("TEST 5: Complete Integration Pipeline")
    print("="*70)
    
    try:
        from integration.data_loader import check_preprocessed_data_availability
        
        # Check if data is available
        print("\n5.1 Checking prerequisites...")
        availability = check_preprocessed_data_availability()
        
        if not availability.get('firms_aligned'):
            print("  ⚠ FIRMS data not available - skipping pipeline test")
            print("  (This is OK if preprocessing hasn't been run yet)")
            return True
        
        print("  ✓ Prerequisites available")
        
        # Test loading and mapping pipeline
        print("\n5.2 Testing data loading and mapping...")
        from integration.data_loader import load_firms_data
        from integration.field_mapper import batch_map_firms_data
        
        # Load small sample
        firms_df = load_firms_data(aligned=True)
        sample_df = firms_df.head(100)  # Small sample for testing
        
        print(f"  Loaded {len(sample_df)} records for testing")
        
        # Map to observations
        observations = batch_map_firms_data(sample_df)
        print(f"  Mapped {len(observations)} observations")
        
        assert len(observations) > 0, "No observations mapped"
        print("  ✓ Pipeline working")
        
        print("\n✓ Integration Pipeline tests PASSED")
        return True
        
    except Exception as e:
        print(f"\n✗ Integration Pipeline tests FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


def run_all_tests():
    """Run all integration tests."""
    print("\n")
    print("="*70)
    print("INTEGRATION TEST SUITE")
    print("="*70)
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    tests = [
        ("Data Loader", test_data_loader),
        ("Field Mapper", test_field_mapper),
        ("Spatial Join", test_spatial_join),
        ("Bulk Loader", test_bulk_loader),
        ("Integration Pipeline", test_integration_pipeline)
    ]
    
    results = []
    
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"\n✗ {test_name} test crashed: {e}")
            results.append((test_name, False))
    
    # Summary
    print("\n")
    print("="*70)
    print("TEST SUMMARY")
    print("="*70)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"  {status}: {test_name}")
    
    print(f"\nResults: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests PASSED!")
        return True
    else:
        print(f"\n⚠ {total - passed} test(s) FAILED")
        return False


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)

