"""
CRS Alignment Module
Reprojects all datasets to a common California Albers projection (EPSG:3310)
"""

import json
import pandas as pd
import geopandas as gpd
import rasterio
from rasterio.warp import calculate_default_transform, reproject, Resampling
from pathlib import Path
import numpy as np


class CRSAligner:
    """Align coordinate reference systems across all datasets"""

    def __init__(self, schema_path: str = "schema.json"):
        with open(schema_path, 'r') as f:
            self.schema = json.load(f)
        self.target_crs = f"EPSG:{self.schema['target_crs']['epsg']}"

    def align_firms(self, input_path: str, output_path: str) -> gpd.GeoDataFrame:
        """Convert FIRMS data to California Albers projection"""

        print(f"\n Aligning FIRMS CRS to {self.target_crs}...")

        # Load cleaned data
        df = pd.read_parquet(input_path)
        print(f"  Loaded {len(df):,} fire detections")

        # Create GeoDataFrame from lat/lon
        gdf = gpd.GeoDataFrame(
            df,
            geometry=gpd.points_from_xy(df.longitude, df.latitude),
            crs="EPSG:4326"  # WGS84
        )

        # Reproject to target CRS
        gdf_proj = gdf.to_crs(self.target_crs)

        # Add projected coordinates as columns
        gdf_proj['x'] = gdf_proj.geometry.x
        gdf_proj['y'] = gdf_proj.geometry.y

        # Save
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        gdf_proj.to_parquet(output_path, index=False)

        print(f"   Reprojected to {self.target_crs}")
        print(f"   Saved: {output_path}")
        print(f"  Bounds: X({gdf_proj.x.min():.0f}, {gdf_proj.x.max():.0f}) Y({gdf_proj.y.min():.0f}, {gdf_proj.y.max():.0f})")

        return gdf_proj

    def align_noaa(self, input_path: str, output_path: str, stations_file: str = None) -> pd.DataFrame:
        """
        Align NOAA weather data with station coordinates
        Note: NOAA data is station-based, so we need station locations
        """

        print(f"\n Preparing NOAA data for spatial alignment...")

        # Load cleaned data
        df = pd.read_parquet(input_path)
        print(f"  Loaded {len(df):,} weather observations")

        # For now, save as-is. Spatial alignment requires station metadata
        # which would come from NOAA stations API
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        df.to_parquet(output_path, index=False)

        print(f"   Saved: {output_path}")
        print(f"   Note: Spatial join with station locations needed for full CRS alignment")
        print(f"     Stations: {df['station'].nunique()}")

        return df

    def align_usgs_tile(self, input_path: str, output_path: str) -> bool:
        """Reproject a USGS DEM tile to California Albers"""

        print(f"  Processing {Path(input_path).name}...")

        try:
            with rasterio.open(input_path) as src:
                # Calculate transform for target CRS
                transform, width, height = calculate_default_transform(
                    src.crs,
                    self.target_crs,
                    src.width,
                    src.height,
                    *src.bounds
                )

                # Update metadata
                kwargs = src.meta.copy()
                kwargs.update({
                    'crs': self.target_crs,
                    'transform': transform,
                    'width': width,
                    'height': height
                })

                # Create output directory
                output_path = Path(output_path)
                output_path.parent.mkdir(parents=True, exist_ok=True)

                # Reproject
                with rasterio.open(output_path, 'w', **kwargs) as dst:
                    for i in range(1, src.count + 1):
                        reproject(
                            source=rasterio.band(src, i),
                            destination=rasterio.band(dst, i),
                            src_transform=src.transform,
                            src_crs=src.crs,
                            dst_transform=transform,
                            dst_crs=self.target_crs,
                            resampling=Resampling.bilinear
                        )

                print(f"     Reprojected {Path(input_path).name}")
                return True

        except Exception as e:
            print(f"    ✗ Failed: {e}")
            return False

    def align_all_usgs_tiles(self, input_dir: str, output_dir: str) -> int:
        """Reproject all USGS DEM tiles"""

        print(f"\n Aligning USGS DEM tiles to {self.target_crs}...")

        input_path = Path(input_dir)
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        # Find valid tiles
        tile_files = [f for f in input_path.glob('*.tif')
                     if f.stat().st_size > 1024*1024]  # > 1MB

        if not tile_files:
            print("   No valid USGS tiles found")
            return 0

        print(f"  Found {len(tile_files)} tiles to reproject")

        success_count = 0
        for tile_file in tile_files:
            output_file = output_path / tile_file.name
            if self.align_usgs_tile(str(tile_file), str(output_file)):
                success_count += 1

        print(f"\n   Successfully reprojected {success_count}/{len(tile_files)} tiles")
        return success_count


class SpatialJoiner:
    """Join datasets spatially after CRS alignment"""

    def __init__(self, aligned_data_dir: str = "../data/aligned"):
        self.data_dir = Path(aligned_data_dir)

    def create_spatial_grid(self, cell_size: float = 10000) -> gpd.GeoDataFrame:
        """
        Create a spatial grid over California in the target CRS
        cell_size: grid cell size in meters (default 10km)
        """

        print(f"\n Creating spatial grid ({cell_size/1000:.0f}km cells)...")

        # Load FIRMS data to get spatial extent
        firms_path = self.data_dir / "firms_aligned.parquet"
        if not firms_path.exists():
            raise FileNotFoundError("FIRMS aligned data not found")

        gdf = gpd.read_parquet(firms_path)

        # Get bounds
        minx, miny, maxx, maxy = gdf.total_bounds

        # Create grid
        grid_cells = []
        x_coords = np.arange(minx, maxx, cell_size)
        y_coords = np.arange(miny, maxy, cell_size)

        for i, x in enumerate(x_coords):
            for j, y in enumerate(y_coords):
                from shapely.geometry import box
                cell = box(x, y, x + cell_size, y + cell_size)
                grid_cells.append({
                    'grid_id': f"{i}_{j}",
                    'x_index': i,
                    'y_index': j,
                    'geometry': cell
                })

        grid_gdf = gpd.GeoDataFrame(grid_cells, crs=gdf.crs)

        print(f"  Created {len(grid_gdf):,} grid cells")
        print(f"  Grid extent: {len(x_coords)} x {len(y_coords)}")

        return grid_gdf


def main():
    """Run CRS alignment pipeline"""

    import sys
    sys.path.append('../data_sources')
    from config import USGS_DATA_DIR

    print("=" * 60)
    print("   CRS ALIGNMENT PIPELINE")
    print("=" * 60)

    cleaned_dir = Path("../data/cleaned")
    aligned_dir = Path("../data/aligned")
    aligned_dir.mkdir(parents=True, exist_ok=True)

    aligner = CRSAligner()

    # Align FIRMS
    try:
        firms_input = cleaned_dir / "firms_cleaned.parquet"
        firms_output = aligned_dir / "firms_aligned.parquet"
        if firms_input.exists():
            aligner.align_firms(str(firms_input), str(firms_output))
        else:
            print(f"\n FIRMS cleaned data not found: {firms_input}")
    except Exception as e:
        print(f" FIRMS alignment failed: {e}")

    # Align NOAA
    try:
        noaa_input = cleaned_dir / "noaa_cleaned.parquet"
        noaa_output = aligned_dir / "noaa_aligned.parquet"
        if noaa_input.exists():
            aligner.align_noaa(str(noaa_input), str(noaa_output))
        else:
            print(f"\n NOAA cleaned data not found: {noaa_input}")
    except Exception as e:
        print(f" NOAA alignment failed: {e}")

    # Align USGS tiles
    try:
        usgs_output = aligned_dir / "usgs"
        aligner.align_all_usgs_tiles(USGS_DATA_DIR, str(usgs_output))
    except Exception as e:
        print(f" USGS alignment failed: {e}")

    print("\n" + "="*60)
    print(" CRS alignment complete!")
    print("=" * 60)
    print(f"\nTarget CRS: EPSG:3310 (NAD83 / California Albers)")
    print(f"Aligned data: {aligned_dir}")


if __name__ == "__main__":
    main()
