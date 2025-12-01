"""
Feature Engineering Pipeline for Wildfire Prediction
Creates temporal, spatial, weather, and terrain features from cleaned datasets.
"""

import json
import pandas as pd
import numpy as np
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

try:
    import geopandas as gpd
    import rasterio
    from rasterio.transform import xy
    from scipy.spatial import cKDTree
    from shapely.geometry import Point
    GEOSPATIAL_AVAILABLE = True
except ImportError:
    GEOSPATIAL_AVAILABLE = False
    print("Warning: geopandas/rasterio/scipy not installed. Some features unavailable.")


class FeatureEngineer:
    """Generates features for wildfire prediction from multi-source data"""

    def __init__(self, schema_path: str = "schema.json"):
        with open(schema_path, 'r') as f:
            self.schema = json.load(f)
        self.features_created = []

    def create_temporal_features(self, df: pd.DataFrame, date_col: str = 'acq_date') -> pd.DataFrame:
        """Create temporal features from date column"""

        print("Creating temporal features...")
        df = df.copy()

        # Ensure datetime type
        df[date_col] = pd.to_datetime(df[date_col])

        # Basic time features
        df['year'] = df[date_col].dt.year
        df['month'] = df[date_col].dt.month
        df['day'] = df[date_col].dt.day
        df['day_of_year'] = df[date_col].dt.dayofyear
        df['week_of_year'] = df[date_col].dt.isocalendar().week
        df['day_of_week'] = df[date_col].dt.dayofweek
        df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)

        # Season (meteorological)
        df['season'] = df['month'].apply(self._get_season)

        # Fire season indicator for California (typically May-October)
        df['is_fire_season'] = df['month'].isin([5, 6, 7, 8, 9, 10]).astype(int)

        # Cyclical encodings for periodic features
        df['month_sin'] = np.sin(2 * np.pi * df['month'] / 12)
        df['month_cos'] = np.cos(2 * np.pi * df['month'] / 12)
        df['day_of_year_sin'] = np.sin(2 * np.pi * df['day_of_year'] / 365)
        df['day_of_year_cos'] = np.cos(2 * np.pi * df['day_of_year'] / 365)

        temporal_features = [
            'year', 'month', 'day', 'day_of_year', 'week_of_year',
            'day_of_week', 'is_weekend', 'season', 'is_fire_season',
            'month_sin', 'month_cos', 'day_of_year_sin', 'day_of_year_cos'
        ]

        self.features_created.extend(temporal_features)
        print(f"  Created {len(temporal_features)} temporal features")

        return df

    def create_spatial_features(self, df: pd.DataFrame,
                               lat_col: str = 'latitude',
                               lon_col: str = 'longitude') -> pd.DataFrame:
        """Create spatial features from coordinates"""

        print("Creating spatial features...")
        df = df.copy()

        # Distance from coast (approximate - Pacific coast at ~-120 to -124 longitude)
        df['distance_from_coast'] = np.abs(df[lon_col] + 120)

        # Regional classification based on latitude/longitude
        df['region'] = df.apply(
            lambda row: self._classify_california_region(row[lat_col], row[lon_col]),
            axis=1
        )

        # Latitude/longitude bins for spatial aggregation
        df['lat_bin'] = pd.cut(df[lat_col], bins=20, labels=False)
        df['lon_bin'] = pd.cut(df[lon_col], bins=20, labels=False)
        df['spatial_cell'] = df['lat_bin'] * 100 + df['lon_bin']

        # Radial distance from state center (approximate: 37°N, 119.5°W)
        center_lat, center_lon = 37.0, -119.5
        df['distance_from_center'] = np.sqrt(
            (df[lat_col] - center_lat)**2 + (df[lon_col] - center_lon)**2
        )

        spatial_features = [
            'distance_from_coast', 'region', 'lat_bin', 'lon_bin',
            'spatial_cell', 'distance_from_center'
        ]

        self.features_created.extend(spatial_features)
        print(f"  Created {len(spatial_features)} spatial features")

        return df

    def create_fire_intensity_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create features from fire detection attributes"""

        print("Creating fire intensity features...")
        df = df.copy()

        # Log-transformed FRP (Fire Radiative Power)
        if 'frp' in df.columns:
            df['frp_log'] = np.log1p(df['frp'])
            df['frp_squared'] = df['frp'] ** 2

            # FRP categories
            df['frp_category'] = pd.cut(
                df['frp'],
                bins=[0, 10, 50, 100, 500, np.inf],
                labels=['very_low', 'low', 'medium', 'high', 'very_high']
            )

        # Brightness features
        if 'brightness' in df.columns:
            df['brightness_log'] = np.log1p(df['brightness'])
            df['brightness_normalized'] = (df['brightness'] - df['brightness'].mean()) / df['brightness'].std()

        # Confidence encoding
        if 'confidence' in df.columns:
            confidence_map = {'low': 0, 'nominal': 1, 'high': 2}
            df['confidence_encoded'] = df['confidence'].map(confidence_map)

        # Composite fire intensity score
        if 'frp' in df.columns and 'brightness' in df.columns and 'confidence' in df.columns:
            df['fire_intensity_score'] = (
                df['frp_log'] * 0.5 +
                df['brightness_normalized'] * 0.3 +
                df['confidence_encoded'] * 0.2
            )

        intensity_features = [col for col in df.columns if col not in self.features_created and
                             col.startswith(('frp', 'brightness', 'confidence', 'fire_intensity'))]

        self.features_created.extend(intensity_features)
        print(f"  Created {len(intensity_features)} fire intensity features")

        return df

    def create_weather_features(self, weather_df: pd.DataFrame) -> pd.DataFrame:
        """Create derived weather features from NOAA data"""

        print("Creating weather features...")
        df = weather_df.copy()

        # Temperature features
        if 'TMAX' in df.columns and 'TMIN' in df.columns:
            df['temp_range'] = df['TMAX'] - df['TMIN']
            df['temp_avg'] = (df['TMAX'] + df['TMIN']) / 2

        # Drought indicator (low precipitation)
        if 'PRCP' in df.columns:
            df['is_dry_day'] = (df['PRCP'] < 1.0).astype(int)
            df['prcp_log'] = np.log1p(df['PRCP'])

        # Wind features
        if 'AWND' in df.columns:
            df['is_windy'] = (df['AWND'] > 10).astype(int)
            df['wind_squared'] = df['AWND'] ** 2

        # Composite fire weather index (simplified)
        if all(col in df.columns for col in ['TMAX', 'PRCP', 'AWND']):
            # Higher temp, lower precipitation, higher wind = higher fire risk
            df['fire_weather_index'] = (
                (df['TMAX'] / 10) +  # Normalize temperature
                (1 / (df['PRCP'] + 1)) +  # Inverse precipitation (avoid div by 0)
                (df['AWND'] / 5)  # Normalize wind
            )

        weather_features = [col for col in df.columns if col not in weather_df.columns]

        print(f"  Created {len(weather_features)} weather features")

        return df

    def create_rolling_features(self, df: pd.DataFrame,
                               group_cols: List[str],
                               value_cols: List[str],
                               windows: List[int] = [3, 7, 14, 30]) -> pd.DataFrame:
        """Create rolling window features for time series"""

        print(f"Creating rolling window features (windows: {windows})...")
        df = df.copy()
        df = df.sort_values(['date'] if 'date' in df.columns else ['acq_date'])

        for window in windows:
            for col in value_cols:
                if col in df.columns:
                    # Rolling mean
                    df[f'{col}_rolling_mean_{window}d'] = df.groupby(group_cols)[col].transform(
                        lambda x: x.rolling(window, min_periods=1).mean()
                    )

                    # Rolling std
                    df[f'{col}_rolling_std_{window}d'] = df.groupby(group_cols)[col].transform(
                        lambda x: x.rolling(window, min_periods=1).std()
                    )

                    # Rolling max
                    df[f'{col}_rolling_max_{window}d'] = df.groupby(group_cols)[col].transform(
                        lambda x: x.rolling(window, min_periods=1).max()
                    )

        rolling_features = [col for col in df.columns if 'rolling' in col]
        print(f"  Created {len(rolling_features)} rolling features")

        return df

    def create_lag_features(self, df: pd.DataFrame,
                           group_cols: List[str],
                           value_cols: List[str],
                           lags: List[int] = [1, 3, 7]) -> pd.DataFrame:
        """Create lagged features for time series prediction"""

        print(f"Creating lag features (lags: {lags})...")
        df = df.copy()
        df = df.sort_values(['date'] if 'date' in df.columns else ['acq_date'])

        for lag in lags:
            for col in value_cols:
                if col in df.columns:
                    df[f'{col}_lag_{lag}d'] = df.groupby(group_cols)[col].shift(lag)

        lag_features = [col for col in df.columns if 'lag' in col]
        print(f"  Created {len(lag_features)} lag features")

        return df

    def add_elevation_features(self, df: pd.DataFrame,
                              dem_tiles_dir: str,
                              lat_col: str = 'latitude',
                              lon_col: str = 'longitude') -> pd.DataFrame:
        """Extract elevation and terrain features from DEM tiles"""

        if not GEOSPATIAL_AVAILABLE:
            print("Warning: Skipping elevation features (geospatial libraries not available)")
            return df

        print("Adding elevation features from DEM tiles...")
        df = df.copy()

        tiles_path = Path(dem_tiles_dir)
        tile_files = sorted([f for f in tiles_path.glob('*.tif')
                            if f.stat().st_size > 1024*1024])  # > 1MB

        if not tile_files:
            print("  Warning: No valid DEM tiles found")
            return df

        # Initialize elevation column
        df['elevation'] = np.nan

        # Process each tile
        for tile_file in tile_files:
            try:
                with rasterio.open(tile_file) as src:
                    # Get tile bounds
                    bounds = src.bounds

                    # Find points within this tile
                    mask = (
                        (df[lat_col] >= bounds.bottom) &
                        (df[lat_col] <= bounds.top) &
                        (df[lon_col] >= bounds.left) &
                        (df[lon_col] <= bounds.right)
                    )

                    if mask.sum() == 0:
                        continue

                    # Sample elevation for points in this tile
                    for idx in df[mask].index:
                        lat, lon = df.loc[idx, lat_col], df.loc[idx, lon_col]

                        # Convert lat/lon to pixel coordinates
                        try:
                            row, col = src.index(lon, lat)

                            # Check bounds
                            if 0 <= row < src.height and 0 <= col < src.width:
                                elevation = src.read(1)[row, col]

                                # Ignore nodata values
                                if elevation != -9999:
                                    df.loc[idx, 'elevation'] = elevation
                        except:
                            continue

            except Exception as e:
                print(f"  Warning: Error processing {tile_file.name}: {e}")
                continue

        # Create elevation-based features
        valid_elevation = df['elevation'].notna()
        print(f"  Extracted elevation for {valid_elevation.sum():,} / {len(df):,} points")

        if valid_elevation.sum() > 0:
            # Elevation categories
            df['elevation_category'] = pd.cut(
                df['elevation'],
                bins=[-np.inf, 500, 1000, 1500, 2000, np.inf],
                labels=['lowland', 'foothill', 'mid_mountain', 'high_mountain', 'alpine']
            )

            # Log elevation (shift to handle negative values)
            min_elev = df['elevation'].min()
            df['elevation_log'] = np.log1p(df['elevation'] - min_elev + 1)

            # Normalized elevation
            df['elevation_normalized'] = (df['elevation'] - df['elevation'].mean()) / df['elevation'].std()

        elevation_features = ['elevation', 'elevation_category', 'elevation_log', 'elevation_normalized']
        print(f"  Created {len(elevation_features)} elevation features")

        return df

    def create_aggregated_fire_features(self, df: pd.DataFrame,
                                       spatial_col: str = 'spatial_cell',
                                       temporal_col: str = 'acq_date') -> pd.DataFrame:
        """Create aggregated fire activity features by location and time"""

        print("Creating aggregated fire activity features...")
        df = df.copy()

        # Daily fire counts per spatial cell
        daily_counts = df.groupby([spatial_col, temporal_col]).size().reset_index(name='daily_fire_count')
        df = df.merge(daily_counts, on=[spatial_col, temporal_col], how='left')

        # Historical fire activity in this location
        if 'frp' in df.columns:
            spatial_stats = df.groupby(spatial_col).agg({
                'frp': ['mean', 'max', 'std', 'count']
            }).reset_index()
            spatial_stats.columns = [spatial_col, 'location_frp_mean', 'location_frp_max',
                                    'location_frp_std', 'location_fire_count']
            df = df.merge(spatial_stats, on=spatial_col, how='left')

        # Days since last fire in this location
        df = df.sort_values([spatial_col, temporal_col])
        df['days_since_last_fire'] = df.groupby(spatial_col)[temporal_col].diff().dt.days
        df['days_since_last_fire'] = df['days_since_last_fire'].fillna(0)

        agg_features = [col for col in df.columns if col.startswith(('daily_', 'location_', 'days_since'))]
        print(f"  Created {len(agg_features)} aggregated features")

        return df

    @staticmethod
    def _get_season(month: int) -> str:
        """Get meteorological season from month"""
        if month in [12, 1, 2]:
            return 'winter'
        elif month in [3, 4, 5]:
            return 'spring'
        elif month in [6, 7, 8]:
            return 'summer'
        else:
            return 'fall'

    @staticmethod
    def _classify_california_region(lat: float, lon: float) -> str:
        """Classify location into California regions"""
        # Simplified regional classification
        if lat >= 40:
            return 'northern'
        elif lat >= 37:
            return 'northern_central'
        elif lat >= 35:
            return 'central'
        elif lat >= 34:
            return 'southern_central'
        else:
            return 'southern'


class FeaturePipeline:
    """End-to-end feature engineering pipeline"""

    def __init__(self, cleaned_data_dir: str = "../data/cleaned",
                 schema_path: str = "schema.json"):
        self.cleaned_data_dir = Path(cleaned_data_dir)
        self.engineer = FeatureEngineer(schema_path)

    def process_firms_features(self,
                              output_path: str,
                              dem_tiles_dir: Optional[str] = None) -> pd.DataFrame:
        """Create all features for FIRMS fire detection data"""

        print("\n" + "="*60)
        print("  PROCESSING FIRMS FEATURES")
        print("="*60 + "\n")

        # Load cleaned FIRMS data
        firms_path = self.cleaned_data_dir / "firms_cleaned.parquet"
        if not firms_path.exists():
            raise FileNotFoundError(f"Cleaned FIRMS data not found: {firms_path}")

        print(f"Loading FIRMS data from {firms_path}...")
        df = pd.read_parquet(firms_path)
        print(f"  Loaded {len(df):,} fire detections\n")

        # Create features
        df = self.engineer.create_temporal_features(df, 'acq_date')
        df = self.engineer.create_spatial_features(df, 'latitude', 'longitude')
        df = self.engineer.create_fire_intensity_features(df)
        df = self.engineer.create_aggregated_fire_features(df, 'spatial_cell', 'acq_date')

        # Add elevation features if DEM tiles available
        if dem_tiles_dir:
            df = self.engineer.add_elevation_features(df, dem_tiles_dir, 'latitude', 'longitude')

        # Save processed features
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(output_path, index=False)

        print(f"\nFIRMS features saved: {output_path}")
        print(f"  Total features: {len(df.columns)}")
        print(f"  Total records: {len(df):,}")

        return df

    def process_weather_features(self, output_path: str) -> pd.DataFrame:
        """Create all features for NOAA weather data"""

        print("\n" + "="*60)
        print("  PROCESSING WEATHER FEATURES")
        print("="*60 + "\n")

        # Load cleaned NOAA data
        noaa_path = self.cleaned_data_dir / "noaa_cleaned.parquet"
        if not noaa_path.exists():
            raise FileNotFoundError(f"Cleaned NOAA data not found: {noaa_path}")

        print(f"Loading NOAA data from {noaa_path}...")
        df = pd.read_parquet(noaa_path)
        print(f"  Loaded {len(df):,} weather records\n")

        # Create features
        df = self.engineer.create_temporal_features(df, 'date')
        df = self.engineer.create_weather_features(df)

        # Create rolling features for weather variables
        weather_vars = ['TMAX', 'TMIN', 'PRCP', 'AWND']
        available_vars = [v for v in weather_vars if v in df.columns]

        if available_vars:
            df = self.engineer.create_rolling_features(
                df,
                group_cols=['station'],
                value_cols=available_vars,
                windows=[3, 7, 14, 30]
            )

            df = self.engineer.create_lag_features(
                df,
                group_cols=['station'],
                value_cols=available_vars,
                lags=[1, 3, 7]
            )

        # Save processed features
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(output_path, index=False)

        print(f"\nWeather features saved: {output_path}")
        print(f"  Total features: {len(df.columns)}")
        print(f"  Total records: {len(df):,}")

        return df

    def create_merged_dataset(self,
                            firms_features_path: str,
                            weather_features_path: str,
                            output_path: str) -> pd.DataFrame:
        """Merge FIRMS and weather features into final dataset"""

        print("\n" + "="*60)
        print("  MERGING FIRMS AND WEATHER FEATURES")
        print("="*60 + "\n")

        # Load feature datasets
        print("Loading feature datasets...")
        firms_df = pd.read_parquet(firms_features_path)
        weather_df = pd.read_parquet(weather_features_path)

        print(f"  FIRMS: {len(firms_df):,} records")
        print(f"  Weather: {len(weather_df):,} records\n")

        # Prepare for merge
        firms_df['date'] = pd.to_datetime(firms_df['acq_date']).dt.date
        weather_df['date'] = pd.to_datetime(weather_df['date']).dt.date

        # For weather: aggregate by date (average across stations)
        print("Aggregating weather data by date...")
        weather_cols = [col for col in weather_df.columns if col != 'station' and col != 'date']
        weather_daily = weather_df.groupby('date')[weather_cols].mean().reset_index()

        print(f"  Aggregated to {len(weather_daily):,} daily records\n")

        # Merge on date
        print("Merging datasets...")
        merged_df = firms_df.merge(weather_daily, on='date', how='left', suffixes=('', '_weather'))

        print(f"  Merged dataset: {len(merged_df):,} records")
        print(f"  Total features: {len(merged_df.columns)}\n")

        # Save merged dataset
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        merged_df.to_parquet(output_path, index=False)

        print(f"Merged dataset saved: {output_path}")

        # Summary statistics
        print("\nFeature summary:")
        print(f"  Fire features: {len([c for c in merged_df.columns if any(x in c for x in ['frp', 'brightness', 'confidence'])])}")
        print(f"  Weather features: {len([c for c in merged_df.columns if any(x in c for x in ['TMAX', 'TMIN', 'PRCP', 'AWND'])])}")
        print(f"  Temporal features: {len([c for c in merged_df.columns if any(x in c for x in ['month', 'day', 'season', 'year'])])}")
        print(f"  Spatial features: {len([c for c in merged_df.columns if any(x in c for x in ['lat', 'lon', 'region', 'elevation'])])}")

        return merged_df


def main():
    """Run complete feature engineering pipeline"""

    import sys
    sys.path.append('../data_sources')
    from config import USGS_DATA_DIR

    print("="*60)
    print("   FEATURE ENGINEERING PIPELINE")
    print("="*60)

    # Create output directory
    output_dir = Path("../data/features")
    output_dir.mkdir(parents=True, exist_ok=True)

    # Initialize pipeline
    pipeline = FeaturePipeline(cleaned_data_dir="../data/cleaned")

    # Process FIRMS features
    try:
        firms_features = pipeline.process_firms_features(
            output_path=output_dir / "firms_features.parquet",
            dem_tiles_dir=USGS_DATA_DIR
        )
    except Exception as e:
        print(f"\nERROR: FIRMS feature processing failed: {e}")
        firms_features = None

    # Process weather features
    try:
        weather_features = pipeline.process_weather_features(
            output_path=output_dir / "weather_features.parquet"
        )
    except Exception as e:
        print(f"\nERROR: Weather feature processing failed: {e}")
        weather_features = None

    # Create merged dataset
    if firms_features is not None and weather_features is not None:
        try:
            merged_dataset = pipeline.create_merged_dataset(
                firms_features_path=output_dir / "firms_features.parquet",
                weather_features_path=output_dir / "weather_features.parquet",
                output_path=output_dir / "wildfire_ml_dataset.parquet"
            )
        except Exception as e:
            print(f"\nERROR: Dataset merge failed: {e}")

    print("\n" + "="*60)
    print("Feature engineering pipeline complete!")
    print("="*60)


if __name__ == "__main__":
    main()
