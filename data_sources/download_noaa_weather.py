"""
Download NOAA weather data for California across 2020 for wildfire prediction.
Key variables: temperature, precipitation, wind speed, humidity
Output files: data/noaa/noaa_weather_CA_<YYYY-MM-DD>.csv
"""

import os
import time
import requests
import pandas as pd
from datetime import date, timedelta
from config import NOAA_API_KEY, NOAA_API_URL, NOAA_DATA_DIR

# NOAA CDO Dataset and location
DATASET_ID = "GHCND"  # Global Historical Climatology Network - Daily
LOCATION_ID = "FIPS:06"  # California FIPS code
WINDOW_DAYS = 365  # NOAA CDO allows up to 1 year per request

# Weather data types relevant for wildfire prediction
DATATYPES = [
    "TMAX",  # Maximum temperature
    "TMIN",  # Minimum temperature
    "PRCP",  # Precipitation
    "AWND",  # Average wind speed
    "WSF2",  # Fastest 2-minute wind speed
    "WSF5",  # Fastest 5-second wind speed
]

def download_chunk(start_dt: date, end_dt: date, offset=0):
    """
    Download weather data for a date range.
    NOAA CDO API has a 1000-result limit, so may need multiple calls with offset.
    """
    start_str = start_dt.strftime("%Y-%m-%d")
    end_str = end_dt.strftime("%Y-%m-%d")

    url = f"{NOAA_API_URL}data"
    headers = {"token": NOAA_API_KEY}
    params = {
        "datasetid": DATASET_ID,
        "locationid": LOCATION_ID,
        "startdate": start_str,
        "enddate": end_str,
        "datatypeid": ",".join(DATATYPES),
        "limit": 1000,  # Max results per request
        "offset": offset,
        "units": "metric"
    }

    print(f"[{start_str} to {end_str}] GET {url} (offset={offset})")
    response = requests.get(url, headers=headers, params=params)
    response.raise_for_status()

    data = response.json()

    if "results" in data and len(data["results"]) > 0:
        df = pd.DataFrame(data["results"])
        return df, data["metadata"]["resultset"]["count"]
    else:
        print(f"  No results")
        return None, 0

def download_full_period(start_dt: date, end_dt: date):
    """
    Download all data for a period, handling pagination if > 1000 results.
    """
    all_data = []
    offset = 1  # NOAA CDO uses 1-based offset

    while True:
        try:
            df, total_count = download_chunk(start_dt, end_dt, offset)
        except Exception as e:
            print(f"  Error at offset {offset}: {e}")
            # Save partial data before failing
            if all_data:
                combined_df = pd.concat(all_data, ignore_index=True)
                start_str = start_dt.strftime("%Y-%m-%d")
                out_name = f"noaa_weather_CA_{start_str}_partial.csv"
                out_path = os.path.join(NOAA_DATA_DIR, out_name)
                combined_df.to_csv(out_path, index=False)
                print(f"  Saved {len(combined_df)} partial rows → {out_path}")
            raise

        if df is None:
            break

        all_data.append(df)
        print(f"  Retrieved {len(df)} rows (total available: {total_count})")

        # Check if we need more pages
        if offset + len(df) - 1 >= total_count:
            break

        offset += 1000
        time.sleep(2.0)  # Increased delay to avoid rate limiting

    if all_data:
        combined_df = pd.concat(all_data, ignore_index=True)
        start_str = start_dt.strftime("%Y-%m-%d")
        out_name = f"noaa_weather_CA_{start_str}.csv"
        out_path = os.path.join(NOAA_DATA_DIR, out_name)
        combined_df.to_csv(out_path, index=False)
        print(f"  Saved {len(combined_df)} total rows → {out_path}")

def main():
    if not NOAA_API_KEY:
        raise SystemExit("Missing NOAA_API_KEY. Set it in .env or config.py.")

    # Download 2020 in monthly chunks to avoid rate limiting
    year = 2020
    for month in range(1, 13):
        # Calculate start and end dates for each month
        start = date(year, month, 1)
        if month == 12:
            end = date(year, 12, 31)
        else:
            end = date(year, month + 1, 1) - timedelta(days=1)

        print(f"\n{'='*60}")
        print(f"Downloading month: {start.strftime('%B %Y')}")
        print(f"{'='*60}")

        try:
            download_full_period(start, end)
            # Longer pause between months to be extra safe with rate limiting
            if month < 12:
                print("  Pausing 3 seconds before next month...")
                time.sleep(3.0)
        except Exception as e:
            print(f"Error downloading {start.strftime('%B %Y')}: {e}")
            print("Continuing with next month...")
            time.sleep(5.0)  # Wait longer after error

    print("\n" + "="*60)
    print("Download complete!")
    print("="*60)

if __name__ == "__main__":
    main()