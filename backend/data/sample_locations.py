"""
Hardcoded sample California locations with pre-extracted feature values.

Feature values are derived from the 2020 cleaned training dataset
(clean_data_2020.csv) used to train the predictive model.

Feature encoding:
    EVI       — Raw MODIS Enhanced Vegetation Index pixel value
    LST       — (T_celsius + 273.15) / 0.02  (matches training data encoding)
    Wind      — Wind speed in m/s
    Elevation — Average terrain elevation in meters

LST reference:
     0°C  →  13657.5
    10°C  →  14157.5
    20°C  →  14657.5
    30°C  →  15157.5
"""

SAMPLE_LOCATIONS = [
    {
        "name": "High Sierra — Mountain Ridge",
        "lat": 37.5200,
        "lon": -119.2700,
        "evi": 0,
        "lst": 13200,    # ≈ -8.7°C  (cold mountain winter)
        "wind": 6.0,
        "elevation": 2000.0,
        "note": "High elevation, cold, low wind — matches Fire=0 training data",
    },
    {
        "name": "Coastal San Francisco",
        "lat": 37.7749,
        "lon": -122.4194,
        "evi": 1200,
        "lst": 13800,    # ≈ 2.9°C   (cool coastal)
        "wind": 5.0,
        "elevation": 16.0,
        "note": "Coastal, cool, moderate vegetation",
    },
    {
        "name": "Sacramento Valley",
        "lat": 38.5816,
        "lon": -121.4944,
        "evi": 600,
        "lst": 13500,    # ≈ -3.6°C  (winter valley)
        "wind": 4.0,
        "elevation": 9.0,
        "note": "Flat valley, low wind",
    },
    {
        "name": "Los Angeles Foothills",
        "lat": 34.1900,
        "lon": -118.1300,
        "evi": 800,
        "lst": 13900,    # ≈ 5.0°C
        "wind": 7.0,
        "elevation": 420.0,
        "note": "Foothill chaparral, moderate wind",
    },
    {
        "name": "San Diego Backcountry",
        "lat": 32.9000,
        "lon": -116.7000,
        "evi": 500,
        "lst": 14000,    # ≈ 7.0°C
        "wind": 7.0,
        "elevation": 550.0,
        "note": "Dry shrubland, intermittent wind",
    },
    {
        "name": "NorCal Fire Zone — Trinity County",
        "lat": 41.1875,
        "lon": -123.4208,
        "evi": 0,
        "lst": 14055,    # ≈ 7.95°C  — direct match to Fire=1 training record
        "wind": 8.0,
        "elevation": 987.76,
        "note": "Matches Fire=1 record in clean_data_2020.csv",
    },
    {
        "name": "Altadena — Bobcat Fire Origin",
        "lat": 34.2375,
        "lon": -118.0958,
        "evi": 0,
        "lst": 14196,    # ≈ 10.77°C — direct match to Fire=1 training record
        "wind": 10.0,
        "elevation": 61.45,
        "note": "Matches Fire=1 record in clean_data_2020.csv",
    },
    {
        "name": "Dry Mountain Chaparral — Peak Season",
        "lat": 34.5000,
        "lon": -118.5000,
        "evi": 0,
        "lst": 14196,    # ≈ 10.77°C
        "wind": 12.0,    # High Diablo/Santa Ana wind
        "elevation": 800.0,
        "note": "High wind, warm, exposed ridge",
    },
]
