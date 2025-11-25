"""
Data Validation and Cleaning Pipeline
Validates and cleans FIRMS, NOAA, and USGS data according to schema definitions.
"""

import json
import pandas as pd
import numpy as np
from pathlib import Path
from typing import Dict, List, Tuple
import warnings
warnings.filterwarnings('ignore')

try:
    import geopandas as gpd
    import rasterio
    GEOSPATIAL_AVAILABLE = True
except ImportError:
    GEOSPATIAL_AVAILABLE = False
    print("Warning: geopandas/rasterio not installed. Some features unavailable.")


class DataValidator:
    """Validates data against schema definitions"""

    def __init__(self, schema_path: str = "schema.json"):
        with open(schema_path, 'r') as f:
            self.schema = json.load(f)

    def validate_firms(self, df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict]:
        """Validate and clean FIRMS fire detection data"""

        print("Validating FIRMS data...")
        schema = self.schema['firms']
        issues = {
            'missing_columns': [],
            'invalid_values': [],
            'out_of_range': [],
            'removed_rows': 0
        }

        initial_rows = len(df)

        # Check required columns
        missing_cols = set(schema['required_columns']) - set(df.columns)
        if missing_cols:
            issues['missing_columns'] = list(missing_cols)
            print(f"  Warning: Missing columns: {missing_cols}")

        # Convert data types
        df['acq_date'] = pd.to_datetime(df['acq_date'], errors='coerce')
        df['latitude'] = pd.to_numeric(df['latitude'], errors='coerce')
        df['longitude'] = pd.to_numeric(df['longitude'], errors='coerce')
        df['brightness'] = pd.to_numeric(df['brightness'], errors='coerce')
        df['frp'] = pd.to_numeric(df['frp'], errors='coerce')

        # Remove rows with null coordinates or dates
        null_mask = df[['latitude', 'longitude', 'acq_date']].isnull().any(axis=1)
        if null_mask.sum() > 0:
            issues['invalid_values'].append(f"{null_mask.sum()} rows with null coordinates/dates")
            df = df[~null_mask]

        # Validate coordinate ranges
        ranges = schema['valid_ranges']
        lat_valid = (df['latitude'] >= ranges['latitude'][0]) & (df['latitude'] <= ranges['latitude'][1])
        lon_valid = (df['longitude'] >= ranges['longitude'][0]) & (df['longitude'] <= ranges['longitude'][1])

        invalid_coords = ~(lat_valid & lon_valid)
        if invalid_coords.sum() > 0:
            issues['out_of_range'].append(f"{invalid_coords.sum()} rows with invalid coordinates")
            df = df[~invalid_coords]

        # Validate brightness and FRP
        if 'brightness' in df.columns:
            bright_valid = (df['brightness'] >= ranges['brightness'][0]) & (df['brightness'] <= ranges['brightness'][1])
            df = df[bright_valid]

        if 'frp' in df.columns:
            frp_valid = (df['frp'] >= ranges['frp'][0]) & (df['frp'] <= ranges['frp'][1])
            df = df[frp_valid]

        # Standardize confidence levels
        if 'confidence' in df.columns:
            df['confidence'] = df['confidence'].astype(str).str.lower()
            valid_confidence = df['confidence'].isin(schema['confidence_levels'])
            df = df[valid_confidence]

        # Remove duplicates
        before_dedup = len(df)
        df = df.drop_duplicates(subset=['latitude', 'longitude', 'acq_date', 'acq_time'])
        duplicates_removed = before_dedup - len(df)
        if duplicates_removed > 0:
            issues['invalid_values'].append(f"{duplicates_removed} duplicate rows removed")

        issues['removed_rows'] = initial_rows - len(df)

        print(f"  Validated {len(df):,} rows ({issues['removed_rows']:,} removed)")
        if issues['out_of_range']:
            for issue in issues['out_of_range']:
                print(f"    - {issue}")

        return df, issues

    def validate_noaa(self, df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict]:
        """Validate and clean NOAA weather data"""

        print("Validating NOAA data...")
        schema = self.schema['noaa']
        issues = {
            'missing_columns': [],
            'invalid_values': [],
            'out_of_range': [],
            'removed_rows': 0
        }

        initial_rows = len(df)

        # Check required columns
        missing_cols = set(schema['required_columns']) - set(df.columns)
        if missing_cols:
            issues['missing_columns'] = list(missing_cols)
            print(f"  Warning: Missing columns: {missing_cols}")

        # Convert data types
        df['date'] = pd.to_datetime(df['date'], errors='coerce')
        df['value'] = pd.to_numeric(df['value'], errors='coerce')

        # Remove null values
        null_mask = df[['date', 'datatype', 'value']].isnull().any(axis=1)
        if null_mask.sum() > 0:
            issues['invalid_values'].append(f"{null_mask.sum()} rows with null values")
            df = df[~null_mask]

        # Validate data types
        valid_datatypes = df['datatype'].isin(schema['data_types'])
        if (~valid_datatypes).sum() > 0:
            issues['invalid_values'].append(f"{(~valid_datatypes).sum()} rows with invalid datatypes")
            df = df[valid_datatypes]

        # Validate value ranges per datatype
        valid_mask = pd.Series(True, index=df.index)
        ranges = schema['valid_ranges']

        for dtype in schema['data_types']:
            if dtype in ranges:
                dtype_mask = df['datatype'] == dtype
                min_val, max_val = ranges[dtype]
                value_valid = (df.loc[dtype_mask, 'value'] >= min_val) & (df.loc[dtype_mask, 'value'] <= max_val)

                if (~value_valid).sum() > 0:
                    issues['out_of_range'].append(f"{(~value_valid).sum()} {dtype} values out of range")
                    valid_mask.loc[dtype_mask] = value_valid

        df = df[valid_mask]

        # Remove duplicates
        before_dedup = len(df)
        df = df.drop_duplicates(subset=['station', 'date', 'datatype'])
        duplicates_removed = before_dedup - len(df)
        if duplicates_removed > 0:
            issues['invalid_values'].append(f"{duplicates_removed} duplicate rows removed")

        issues['removed_rows'] = initial_rows - len(df)

        print(f"  Validated {len(df):,} rows ({issues['removed_rows']:,} removed)")
        if issues['out_of_range']:
            for issue in issues['out_of_range']:
                print(f"    - {issue}")

        return df, issues

    def validate_usgs_tile(self, tile_path: str) -> Tuple[bool, Dict]:
        """Validate USGS DEM tile"""

        if not GEOSPATIAL_AVAILABLE:
            return False, {'valid': False, 'errors': ['rasterio not available']}

        schema = self.schema['usgs']
        issues = {
            'valid': True,
            'errors': []
        }

        try:
            with rasterio.open(tile_path) as src:
                # Check CRS
                if src.crs is None:
                    issues['errors'].append("No CRS defined")
                    issues['valid'] = False

                # Check bounds
                bounds = src.bounds
                ca_bounds = schema['california_bounds']

                if not (bounds.left >= ca_bounds['min_lon'] - 1 and
                       bounds.right <= ca_bounds['max_lon'] + 1 and
                       bounds.bottom >= ca_bounds['min_lat'] - 1 and
                       bounds.top <= ca_bounds['max_lat'] + 1):
                    issues['errors'].append("Bounds outside California")
                    issues['valid'] = False

                # Sample data to check ranges
                data = src.read(1, masked=True)
                valid_data = data[data != schema['nodata_value']]

                if len(valid_data) == 0:
                    issues['errors'].append("No valid elevation data")
                    issues['valid'] = False
                else:
                    min_elev = float(valid_data.min())
                    max_elev = float(valid_data.max())

                    elev_range = schema['valid_ranges']['elevation']
                    if min_elev < elev_range[0] or max_elev > elev_range[1]:
                        issues['errors'].append(f"Elevation out of range: {min_elev:.1f} to {max_elev:.1f}")
                        issues['valid'] = False

        except Exception as e:
            issues['valid'] = False
            issues['errors'].append(str(e))

        return issues['valid'], issues


class DataCleaner:
    """Cleans and prepares data for analysis"""

    def __init__(self, schema_path: str = "schema.json"):
        with open(schema_path, 'r') as f:
            self.schema = json.load(f)
        self.validator = DataValidator(schema_path)

    def clean_firms_data(self, input_dir: str, output_path: str) -> pd.DataFrame:
        """Load, validate, and clean all FIRMS data"""

        print("\nLoading FIRMS data...")
        input_path = Path(input_dir)
        files = sorted(input_path.glob('*.csv'))

        if not files:
            raise FileNotFoundError(f"No FIRMS CSV files found in {input_dir}")

        print(f"  Found {len(files)} files")

        # Load all files
        dfs = []
        for f in files:
            df = pd.read_csv(f)
            dfs.append(df)

        combined_df = pd.concat(dfs, ignore_index=True)
        print(f"  Loaded {len(combined_df):,} total rows")

        # Validate and clean
        cleaned_df, issues = self.validator.validate_firms(combined_df)

        # Save cleaned data
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        cleaned_df.to_parquet(output_path, index=False)

        print(f"Cleaned FIRMS data saved: {output_path}")
        print(f"  Final records: {len(cleaned_df):,}")

        return cleaned_df

    def clean_noaa_data(self, input_dir: str, output_path: str) -> pd.DataFrame:
        """Load, validate, and clean all NOAA data"""

        print("\nLoading NOAA data...")
        input_path = Path(input_dir)
        files = sorted(input_path.glob('*.csv'))

        if not files:
            raise FileNotFoundError(f"No NOAA CSV files found in {input_dir}")

        print(f"  Found {len(files)} files")

        # Load all files
        dfs = []
        for f in files:
            df = pd.read_csv(f)
            dfs.append(df)

        combined_df = pd.concat(dfs, ignore_index=True)
        print(f"  Loaded {len(combined_df):,} total rows")

        # Validate and clean
        cleaned_df, issues = self.validator.validate_noaa(combined_df)

        # Pivot to wide format for easier analysis
        print("\nPivoting NOAA data to wide format...")
        pivoted_df = cleaned_df.pivot_table(
            index=['station', 'date'],
            columns='datatype',
            values='value',
            aggfunc='mean'  # Average if multiple readings per station/day
        ).reset_index()

        print(f"  Pivoted shape: {pivoted_df.shape}")

        # Save cleaned data
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        pivoted_df.to_parquet(output_path, index=False)

        print(f"Cleaned NOAA data saved: {output_path}")
        print(f"  Final records: {len(pivoted_df):,}")
        print(f"  Columns: {list(pivoted_df.columns)}")

        return pivoted_df

    def validate_usgs_tiles(self, input_dir: str) -> List[str]:
        """Validate all USGS DEM tiles"""

        print("\nValidating USGS DEM tiles...")
        input_path = Path(input_dir)
        files = sorted(input_path.glob('*.tif'))

        if not files:
            print("  Warning: No USGS TIF files found")
            return []

        valid_tiles = []
        for f in files:
            # Skip small files (likely errors)
            if f.stat().st_size < 1024 * 1024:  # < 1MB
                print(f"  x {f.name}: Too small (likely error file)")
                continue

            is_valid, issues = self.validator.validate_usgs_tile(str(f))

            if is_valid:
                print(f"  OK {f.name}: Valid")
                valid_tiles.append(str(f))
            else:
                print(f"  x {f.name}: {', '.join(issues['errors'])}")

        print(f"\nValidated {len(valid_tiles)}/{len(files)} tiles")
        return valid_tiles


def main():
    """Run data validation and cleaning pipeline"""

    import sys
    sys.path.append('../data_sources')
    from config import FIRMS_DATA_DIR, NOAA_DATA_DIR, USGS_DATA_DIR

    print("="*60)
    print("   DATA VALIDATION AND CLEANING PIPELINE")
    print("="*60)

    # Create output directory
    output_dir = Path("../data/cleaned")
    output_dir.mkdir(parents=True, exist_ok=True)

    cleaner = DataCleaner()

    # Clean FIRMS data
    try:
        firms_df = cleaner.clean_firms_data(
            input_dir=FIRMS_DATA_DIR,
            output_path=output_dir / "firms_cleaned.parquet"
        )
    except Exception as e:
        print(f"ERROR: FIRMS cleaning failed: {e}")

    # Clean NOAA data
    try:
        noaa_df = cleaner.clean_noaa_data(
            input_dir=NOAA_DATA_DIR,
            output_path=output_dir / "noaa_cleaned.parquet"
        )
    except Exception as e:
        print(f"ERROR: NOAA cleaning failed: {e}")

    # Validate USGS tiles
    try:
        valid_tiles = cleaner.validate_usgs_tiles(input_dir=USGS_DATA_DIR)
    except Exception as e:
        print(f"ERROR: USGS validation failed: {e}")

    print("\n" + "="*60)
    print("Data cleaning pipeline complete!")
    print("="*60)


if __name__ == "__main__":
    main()
