"""
Simple test script to verify preprocessing functionality
Run this to check if the preprocessing pipeline will work
"""

import sys
import json
from pathlib import Path

# Add data_sources to path
sys.path.append('../data_sources')

def check_dependencies():
    """Check if required packages are installed"""
    print("="*60)
    print("CHECKING DEPENDENCIES")
    print("="*60)

    required = {
        'pandas': 'Data manipulation',
        'numpy': 'Numerical operations',
        'geopandas': 'Geospatial data (CRITICAL)',
        'rasterio': 'Raster data (CRITICAL)',
        'shapely': 'Geometries (CRITICAL)',
        'matplotlib': 'Plotting',
        'seaborn': 'Statistical plots'
    }

    missing = []
    for pkg, desc in required.items():
        try:
            __import__(pkg)
            print(f"OK {pkg:15s} - {desc}")
        except ImportError:
            print(f"MISSING {pkg:15s} - {desc}")
            missing.append(pkg)

    if missing:
        print(f"\nInstall missing packages:")
        print(f"pip install {' '.join(missing)}")
        return False
    else:
        print("\nAll dependencies installed!")
        return True

def check_data_availability():
    """Check if downloaded data exists"""
    print("\n" + "="*60)
    print("CHECKING DATA AVAILABILITY")
    print("="*60)

    from config import FIRMS_DATA_DIR, NOAA_DATA_DIR, USGS_DATA_DIR

    # Check FIRMS
    firms_files = list(Path(FIRMS_DATA_DIR).glob('*.csv'))
    firms_ok = len(firms_files) >= 37
    print(f"FIRMS:  {len(firms_files)}/37 files - {'OK' if firms_ok else 'INCOMPLETE'}")

    # Check NOAA
    noaa_files = list(Path(NOAA_DATA_DIR).glob('*.csv'))
    noaa_ok = len(noaa_files) >= 12
    print(f"NOAA:   {len(noaa_files)}/12 files - {'OK' if noaa_ok else 'INCOMPLETE'}")

    # Check USGS
    usgs_files = [f for f in Path(USGS_DATA_DIR).glob('*.tif') if f.stat().st_size > 1024*1024]
    usgs_ok = len(usgs_files) >= 2
    print(f"USGS:   {len(usgs_files)}/12 tiles - {'OK' if usgs_ok else 'PARTIAL'}")

    return firms_ok and noaa_ok

def test_schema_load():
    """Test schema loading"""
    print("\n" + "="*60)
    print("TESTING SCHEMA")
    print("="*60)

    try:
        with open('schema.json', 'r') as f:
            schema = json.load(f)

        print(f"OK Schema loaded")
        print(f"   Target CRS: EPSG:{schema['target_crs']['epsg']}")
        print(f"   Firms CRS: {schema['firms']['crs']}")
        print(f"   NOAA CRS: {schema['noaa']['crs']}")
        print(f"   USGS CRS: {schema['usgs']['crs']}")
        return True
    except Exception as e:
        print(f"ERROR Schema loading failed: {e}")
        return False

def test_data_loading():
    """Test if we can load sample data"""
    print("\n" + "="*60)
    print("TESTING DATA LOADING")
    print("="*60)

    import pandas as pd
    from config import FIRMS_DATA_DIR, NOAA_DATA_DIR

    try:
        # Test FIRMS
        firms_file = list(Path(FIRMS_DATA_DIR).glob('*.csv'))[0]
        firms_df = pd.read_csv(firms_file)
        print(f"OK FIRMS data loads - {len(firms_df)} rows")
        print(f"   Columns: {list(firms_df.columns[:5])}...")

        # Test NOAA
        noaa_file = list(Path(NOAA_DATA_DIR).glob('*.csv'))[0]
        noaa_df = pd.read_csv(noaa_file)
        print(f"OK NOAA data loads - {len(noaa_df)} rows")
        print(f"   Columns: {list(noaa_df.columns)}")

        return True
    except Exception as e:
        print(f"ERROR Data loading failed: {e}")
        return False

def main():
    """Run all tests"""
    print("\n")
    print("#"*60)
    print("#  PREPROCESSING PIPELINE FUNCTIONALITY CHECK")
    print("#"*60)
    print()

    results = {}

    # Test 1: Dependencies
    results['dependencies'] = check_dependencies()

    # Test 2: Data availability
    results['data'] = check_data_availability()

    # Test 3: Schema
    results['schema'] = test_schema_load()

    # Test 4: Data loading (requires pandas)
    if results['dependencies']:
        results['loading'] = test_data_loading()

    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)

    for test, passed in results.items():
        status = "PASS" if passed else "FAIL"
        print(f"{test.upper():20s}: {status}")

    all_passed = all(results.values())

    if all_passed:
        print("\nREADY TO RUN PREPROCESSING!")
        print("Next steps:")
        print("  1. python validate_and_clean.py")
        print("  2. python align_crs.py")
        print("  3. python summaries.py")
        print("\nOr use the Jupyter notebook:")
        print("  jupyter notebook preprocessing_pipeline.ipynb")
    else:
        print("\nNOT READY - Fix issues above first")
        if not results.get('dependencies'):
            print("\nInstall missing packages first!")

    return all_passed

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
