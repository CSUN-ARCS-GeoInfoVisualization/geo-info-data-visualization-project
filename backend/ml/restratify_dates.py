"""
Re-stratify no-fire dates to match the monthly distribution of fire dates,
eliminating the seasonal confound between classes.

The original `build_dataset.py` assigns each no-fire row a uniformly random
2020 date, while fire rows carry real MODIS detection dates that cluster in
August-October. That asymmetry lets the model use any seasonal feature
(KBDI, temperature, humidity) to discriminate by month rather than by
location-specific risk -- inflating apparent skill.

This script reads california_2020.csv, replaces each no-fire row's
acq_date with a date drawn from the empirical fire-month distribution
(same year, random day in the chosen month), refetches the date-dependent
weather features (wind, humidity, air_temp_encoded), and writes the
modified dataset back. EVI, elevation, lat/lon stay as-is.

The original CSV is backed up to california_2020_unstratified.csv.bak
before overwriting.

Run from backend/:
    python -m ml.restratify_dates
"""

from __future__ import annotations

import csv
import os
import random
import shutil
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from ml.build_dataset import fetch_weather_historical


SEED = 42
WORKERS = 4   # conservative -- Open-Meteo's hourly limit is the constraint here

_DIR = os.path.dirname(os.path.abspath(__file__))
_CSV = os.path.join(_DIR, "training_data", "california_2020.csv")
_BAK = os.path.join(_DIR, "training_data", "california_2020_unstratified.csv.bak")


def _days_in_month(year: int, month: int) -> int:
    if month in (1, 3, 5, 7, 8, 10, 12):
        return 31
    if month in (4, 6, 9, 11):
        return 30
    leap = (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)
    return 29 if leap else 28


def _random_day_in_month(year: int, month: int, rng: random.Random) -> str:
    return f"{year:04d}-{month:02d}-{rng.randint(1, _days_in_month(year, month)):02d}"


def _refetch_one(row: dict) -> tuple[dict, bool]:
    lat = float(row["lat"])
    lon = float(row["lon"])
    w = fetch_weather_historical(lat, lon, row["acq_date"])
    if w is None:
        return row, False
    row["wind"]             = round(w["wind"], 3)
    row["humidity"]         = round(w["humidity"], 1)
    row["air_temp_encoded"] = round((w["temperature_celsius"] + 273.15) / 0.02, 2)
    return row, True


def main() -> None:
    if not os.path.exists(_CSV):
        print(f"ERROR: {_CSV} not found", file=sys.stderr)
        sys.exit(1)

    rng = random.Random(SEED)

    with open(_CSV, newline="") as f:
        reader = csv.DictReader(f)
        cols = list(reader.fieldnames or [])
        rows = list(reader)

    fires    = [r for r in rows if int(r["fire"]) == 1]
    nofires  = [r for r in rows if int(r["fire"]) == 0]

    fire_months = Counter(int(r["acq_date"][5:7]) for r in fires)
    months_pop  = list(fire_months.keys())
    months_w    = [fire_months[m] for m in months_pop]
    total = sum(months_w)
    print(f"Fire-month distribution ({len(fires)} rows):")
    for m in sorted(fire_months):
        print(f"  month {m:>2}: {fire_months[m]:>4}  ({100*fire_months[m]/total:5.1f}%)")
    print(f"\nNo-fire rows to restratify: {len(nofires)}")

    # Back up the original CSV before we touch it
    if not os.path.exists(_BAK):
        shutil.copy2(_CSV, _BAK)
        print(f"Backed up original to {_BAK}")
    else:
        print(f"Backup already exists at {_BAK} (left untouched)")

    # Resample dates for each no-fire row using a weighted draw on fire-month freq
    for r in nofires:
        m = rng.choices(months_pop, weights=months_w, k=1)[0]
        r["acq_date"] = _random_day_in_month(2020, m, rng)

    new_dist = Counter(int(r["acq_date"][5:7]) for r in nofires)
    print(f"\nNew no-fire month distribution:")
    for m in sorted(new_dist):
        print(f"  month {m:>2}: {new_dist[m]:>4}  ({100*new_dist[m]/len(nofires):5.1f}%)")

    # Refetch weather for new dates -- only the no-fire rows changed
    print(f"\nRefetching weather for {len(nofires)} no-fire rows ({WORKERS} workers)...")
    failed: list[dict] = []
    succeeded = 0
    started = datetime.now()
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = {ex.submit(_refetch_one, r): r for r in nofires}
        for i, fut in enumerate(as_completed(futures), 1):
            row, ok = fut.result()
            if ok:
                succeeded += 1
            else:
                failed.append(row)
            if i % 50 == 0:
                print(f"  {i}/{len(nofires)} (ok={succeeded}, failed={len(failed)})")
    elapsed = (datetime.now() - started).total_seconds()
    print(f"Refetch complete: {succeeded} ok, {len(failed)} failed in {elapsed:.0f}s")

    # Drop failed rows and write everything back
    failed_ids = {id(r) for r in failed}
    keep = [r for r in rows if id(r) not in failed_ids]

    with open(_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(keep)

    print(f"\nWrote {len(keep)} rows to {_CSV}")
    print(f"  fire    : {sum(1 for r in keep if int(r['fire']) == 1)}")
    print(f"  no-fire : {sum(1 for r in keep if int(r['fire']) == 0)}")


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    main()
