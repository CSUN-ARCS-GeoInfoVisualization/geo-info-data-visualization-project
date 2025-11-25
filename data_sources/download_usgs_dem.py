"""
Download USGS DEM (Digital Elevation Model) data for California.
DEM is static terrain/elevation data - downloads once, not time-series.
Output: GeoTIFF files in data/usgs/
"""

import os
import requests
from pathlib import Path
from config import CA_BBOX_W, CA_BBOX_S, CA_BBOX_E, CA_BBOX_N, USGS_DATA_DIR

# USGS 3DEP (3D Elevation Program) API
# No API key needed for public DEM data
USGS_3DEP_API = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"

# Resolution options (in meters):
# 1m (1/3 arc-second) - highest quality, large files
# 10m (1/3 arc-second resampled)
# 30m (1 arc-second) - good balance
RESOLUTION = 30  # meters per pixel

def download_dem_tile(bbox, resolution=30, output_name="california_dem.tif"):
    """
    Download DEM GeoTIFF for a bounding box.
    bbox format: (min_lon, min_lat, max_lon, max_lat)
    """
    min_lon, min_lat, max_lon, max_lat = bbox

    # Calculate approximate pixel dimensions based on resolution
    # Rough conversion: 1 degree ≈ 111 km at equator
    width = int((max_lon - min_lon) * 111000 / resolution)
    height = int((max_lat - min_lat) * 111000 / resolution)

    # USGS API has a size limit - cap at 4096x4096 pixels
    MAX_PIXELS = 4096
    if width > MAX_PIXELS or height > MAX_PIXELS:
        scale_factor = max(width / MAX_PIXELS, height / MAX_PIXELS)
        width = int(width / scale_factor)
        height = int(height / scale_factor)
        actual_resolution = resolution * scale_factor
        print(f"  (Auto-adjusted resolution to ~{actual_resolution:.0f}m to fit API limits)")

    params = {
        'bbox': f"{min_lon},{min_lat},{max_lon},{max_lat}",
        'bboxSR': 4326,  # WGS84
        'size': f"{width},{height}",
        'imageSR': 4326,
        'format': 'tiff',
        'pixelType': 'F32',  # 32-bit float for elevation
        'noDataInterpretation': 'esriNoDataMatchAny',
        'interpolation': '+RSP_BilinearInterpolation',
        'f': 'image'
    }

    print(f"Downloading DEM for bbox: {bbox}")
    print(f"Resolution: {resolution}m, Size: {width}x{height} pixels")
    print(f"URL: {USGS_3DEP_API}")

    try:
        response = requests.get(USGS_3DEP_API, params=params, stream=True, timeout=300)
        response.raise_for_status()

        output_path = os.path.join(USGS_DATA_DIR, output_name)

        # Download with progress
        total_size = int(response.headers.get('content-length', 0))
        with open(output_path, 'wb') as f:
            downloaded = 0
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0:
                    progress = (downloaded / total_size) * 100
                    print(f"  Progress: {progress:.1f}%", end='\r')

        print(f"\n Saved: {output_path}")
        print(f"  File size: {os.path.getsize(output_path) / (1024**2):.1f} MB")
        return output_path

    except requests.exceptions.RequestException as e:
        print(f"Error downloading DEM: {e}")
        return None

def download_california_dem_tiles():
    """
    Download California DEM in smaller tiles to avoid API size limits.
    Split CA into a 4x3 grid (12 tiles) to keep each tile manageable.
    """
    # Grid dimensions (4 columns x 3 rows = 12 tiles)
    cols = 4
    rows = 3

    lon_step = (CA_BBOX_E - CA_BBOX_W) / cols
    lat_step = (CA_BBOX_N - CA_BBOX_S) / rows

    tiles = {}
    for row in range(rows):
        for col in range(cols):
            min_lon = CA_BBOX_W + (col * lon_step)
            max_lon = CA_BBOX_W + ((col + 1) * lon_step)
            min_lat = CA_BBOX_S + (row * lat_step)
            max_lat = CA_BBOX_S + ((row + 1) * lat_step)

            filename = f"california_dem_r{row}_c{col}.tif"
            tiles[filename] = (min_lon, min_lat, max_lon, max_lat)

    successful = 0
    failed = 0

    for filename, bbox in tiles.items():
        print(f"\n{'='*60}")
        print(f"Downloading: {filename}")
        print(f"{'='*60}")
        result = download_dem_tile(bbox, resolution=RESOLUTION, output_name=filename)
        if result:
            successful += 1
        else:
            failed += 1

    print(f"\n{'='*60}")
    print(f"Tile download summary: {successful} successful, {failed} failed")
    print(f"{'='*60}")

def download_full_california_dem():
    """
    Download entire California as one file (WARNING: very large file ~1-2GB).
    Uses exact bbox from config.
    """
    ca_bbox = (CA_BBOX_W, CA_BBOX_S, CA_BBOX_E, CA_BBOX_N)
    download_dem_tile(ca_bbox, resolution=RESOLUTION, output_name="california_full_dem.tif")

def main():
    os.makedirs(USGS_DATA_DIR, exist_ok=True)

    print("USGS DEM Download for California")
    print(f"Resolution: {RESOLUTION}m per pixel")
    print(f"Output directory: {USGS_DATA_DIR}\n")

    # Option 1: Download as tiles (recommended - smaller files)
    print("Downloading California DEM in tiles...")
    download_california_dem_tiles()

    # Option 2: Download entire state as one file (uncomment if needed)
    # print("\nDownloading full California DEM (large file)...")
    # download_full_california_dem()

    print("\n" + "="*60)
    print("DEM download complete!")
    print("="*60)
    print("\nTo use these files:")
    print("  - Load in QGIS, ArcGIS, or Python (rasterio/gdal)")
    print("  - Elevation values are in meters above sea level")
    print("  - NoData values represent water/invalid areas")

if __name__ == "__main__":
    main()