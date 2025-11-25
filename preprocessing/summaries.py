"""
Generate data summaries and statistics for cleaned datasets
"""

import pandas as pd
import geopandas as gpd
import numpy as np
from pathlib import Path
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime


class DataSummarizer:
    """Generate summaries and statistics for wildfire datasets"""

    def __init__(self, cleaned_data_dir: str = "../data/cleaned"):
        self.data_dir = Path(cleaned_data_dir)

    def summarize_firms(self) -> pd.DataFrame:
        """Generate summary statistics for FIRMS fire data"""

        firms_path = self.data_dir / "firms_cleaned.parquet"
        if not firms_path.exists():
            raise FileNotFoundError(f"FIRMS data not found: {firms_path}")

        print("Validating Generating FIRMS summary...")
        df = pd.read_parquet(firms_path)

        # Overall statistics
        summary = {
            'total_detections': len(df),
            'date_range': f"{df['acq_date'].min()} to {df['acq_date'].max()}",
            'total_days': (df['acq_date'].max() - df['acq_date'].min()).days + 1,
            'unique_dates': df['acq_date'].nunique(),
            'avg_detections_per_day': len(df) / df['acq_date'].nunique(),
            'spatial_extent': {
                'min_lat': float(df['latitude'].min()),
                'max_lat': float(df['latitude'].max()),
                'min_lon': float(df['longitude'].min()),
                'max_lon': float(df['longitude'].max())
            }
        }

        # Brightness statistics
        if 'brightness' in df.columns:
            summary['brightness'] = {
                'mean': float(df['brightness'].mean()),
                'median': float(df['brightness'].median()),
                'std': float(df['brightness'].std()),
                'min': float(df['brightness'].min()),
                'max': float(df['brightness'].max())
            }

        # FRP statistics
        if 'frp' in df.columns:
            summary['frp'] = {
                'mean': float(df['frp'].mean()),
                'median': float(df['frp'].median()),
                'std': float(df['frp'].std()),
                'min': float(df['frp'].min()),
                'max': float(df['frp'].max()),
                'total': float(df['frp'].sum())
            }

        # Confidence distribution
        if 'confidence' in df.columns:
            summary['confidence_distribution'] = df['confidence'].value_counts().to_dict()

        # Temporal patterns
        daily_counts = df.groupby('acq_date').size()
        summary['temporal'] = {
            'max_detections_day': daily_counts.max(),
            'max_detections_date': str(daily_counts.idxmax()),
            'median_daily_detections': float(daily_counts.median())
        }

        # Monthly aggregation
        df['month'] = df['acq_date'].dt.to_period('M')
        monthly_counts = df.groupby('month').size()
        summary['monthly_detections'] = monthly_counts.to_dict()

        print(f"  Total detections: {summary['total_detections']:,}")
        print(f"  Date range: {summary['date_range']}")
        print(f"  Peak day: {summary['temporal']['max_detections_date']} ({summary['temporal']['max_detections_day']:,} detections)")

        return pd.DataFrame([summary])

    def summarize_noaa(self) -> pd.DataFrame:
        """Generate summary statistics for NOAA weather data"""

        noaa_path = self.data_dir / "noaa_cleaned.parquet"
        if not noaa_path.exists():
            raise FileNotFoundError(f"NOAA data not found: {noaa_path}")

        print("\n= Generating NOAA summary...")
        df = pd.read_parquet(noaa_path)

        # Overall statistics
        summary = {
            'total_records': len(df),
            'date_range': f"{df['date'].min()} to {df['date'].max()}",
            'total_days': (df['date'].max() - df['date'].min()).days + 1,
            'unique_dates': df['date'].nunique(),
            'unique_stations': df['station'].nunique()
        }

        # Per-variable statistics
        variables = ['TMAX', 'TMIN', 'PRCP', 'AWND', 'WSF2', 'WSF5']
        variable_stats = {}

        for var in variables:
            if var in df.columns:
                var_data = df[var].dropna()
                if len(var_data) > 0:
                    variable_stats[var] = {
                        'count': int((~df[var].isnull()).sum()),
                        'coverage': float((~df[var].isnull()).sum() / len(df)),
                        'mean': float(var_data.mean()),
                        'median': float(var_data.median()),
                        'std': float(var_data.std()),
                        'min': float(var_data.min()),
                        'max': float(var_data.max())
                    }

        summary['variables'] = variable_stats

        # Completeness by date
        daily_completeness = df.groupby('date').apply(
            lambda x: (~x[variables].isnull()).sum().sum() / (len(variables) * len(x))
        )
        summary['data_completeness'] = {
            'mean': float(daily_completeness.mean()),
            'median': float(daily_completeness.median()),
            'min': float(daily_completeness.min())
        }

        print(f"  Total records: {summary['total_records']:,}")
        print(f"  Date range: {summary['date_range']}")
        print(f"  Unique stations: {summary['unique_stations']}")
        print(f"  Average completeness: {summary['data_completeness']['mean']:.1%}")

        for var, stats in variable_stats.items():
            print(f"    {var}: {stats['count']:,} obs (coverage: {stats['coverage']:.1%})")

        return pd.DataFrame([summary])

    def summarize_usgs(self, tiles_dir: str) -> pd.DataFrame:
        """Generate summary statistics for USGS DEM tiles"""

        tiles_path = Path(tiles_dir)
        tile_files = [f for f in tiles_path.glob('*.tif')
                     if f.stat().st_size > 1024*1024]  # > 1MB

        if not tile_files:
            raise FileNotFoundError(f"No valid USGS tiles found in {tiles_dir}")

        print("\n= Generating USGS DEM summary...")

        import rasterio

        tile_summaries = []

        for tile_file in tile_files:
            with rasterio.open(tile_file) as src:
                # Read data
                data = src.read(1, masked=True)
                valid_data = data[data != -9999]  # Remove nodata

                tile_summary = {
                    'filename': tile_file.name,
                    'crs': str(src.crs),
                    'width': src.width,
                    'height': src.height,
                    'resolution': src.res,
                    'bounds': src.bounds,
                    'elevation_min': float(valid_data.min()) if len(valid_data) > 0 else None,
                    'elevation_max': float(valid_data.max()) if len(valid_data) > 0 else None,
                    'elevation_mean': float(valid_data.mean()) if len(valid_data) > 0 else None,
                    'elevation_std': float(valid_data.std()) if len(valid_data) > 0 else None,
                    'valid_pixels': int((~data.mask).sum()),
                    'total_pixels': data.size,
                    'coverage': float((~data.mask).sum() / data.size)
                }

                tile_summaries.append(tile_summary)

        summary_df = pd.DataFrame(tile_summaries)

        print(f"  Total tiles: {len(tile_summaries)}")
        print(f"  Elevation range: {summary_df['elevation_min'].min():.1f}m to {summary_df['elevation_max'].max():.1f}m")
        print(f"  Average coverage: {summary_df['coverage'].mean():.1%}")

        return summary_df

    def generate_all_summaries(self, usgs_dir: str = None):
        """Generate all data summaries"""

        print("=" * 60)
        print("   GENERATING DATA SUMMARIES")
        print("Validating"*60 + "\n")

        summaries = {}

        # FIRMS
        try:
            summaries['firms'] = self.summarize_firms()
        except Exception as e:
            print(f"L FIRMS summary failed: {e}")

        # NOAA
        try:
            summaries['noaa'] = self.summarize_noaa()
        except Exception as e:
            print(f"L NOAA summary failed: {e}")

        # USGS
        if usgs_dir:
            try:
                summaries['usgs'] = self.summarize_usgs(usgs_dir)
            except Exception as e:
                print(f"L USGS summary failed: {e}")

        print("\n" + "="*60)
        print(" Summary generation complete!")
        print("=" * 60)

        return summaries


def main():
    """Generate summaries for all datasets"""

    import sys
    sys.path.append('../data_sources')
    from config import USGS_DATA_DIR

    summarizer = DataSummarizer()
    summaries = summarizer.generate_all_summaries(usgs_dir=USGS_DATA_DIR)

    # Save summaries
    output_dir = Path("../data/summaries")
    output_dir.mkdir(parents=True, exist_ok=True)

    for name, summary_df in summaries.items():
        output_path = output_dir / f"{name}_summary.json"
        if isinstance(summary_df, pd.DataFrame):
            summary_df.to_json(output_path, orient='records', indent=2)
            print(f"\n= Saved {name} summary to {output_path}")


if __name__ == "__main__":
    main()
