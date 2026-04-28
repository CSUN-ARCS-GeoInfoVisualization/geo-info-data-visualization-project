"""
One-shot enrichment: read california_2020.csv, look up R per row from
r_cache.json, fetch the 30-day weather window preceding each row's acq_date
from NASA POWER's daily endpoint (same data source as the cache), compute
KBDI via the kbdi module, and write california_2020_kbdi.csv with the
added column.

Using POWER for both climatology and the daily window keeps the training
data on a single, internally consistent source and avoids the per-hour
call limit on Open-Meteo's archive endpoint.

Resume-safe: rows already present in the output CSV (matched by lat+lon+acq_date)
are skipped, so an interrupted run can be resumed.

Run from backend/:
    python -m ml.enrich_kbdi
"""

import csv
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

import requests

from ml.kbdi import kbdi_final, c_to_f, mm_to_in
from ml.build_r_cache import _key as r_key


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SPINUP_DAYS = 30   # length of weather history fed into KBDI iteration
WORKERS     = 8    # parallel weather fetches; POWER tolerates this
CHECKPOINT_EVERY = 50

POWER_URL  = "https://power.larc.nasa.gov/api/temporal/daily/point"
POWER_FILL = -999.0   # POWER's missing-value sentinel

_DIR        = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR   = os.path.join(_DIR, "training_data")
_INPUT_CSV  = os.path.join(_DATA_DIR, "california_2020.csv")
_OUTPUT_CSV = os.path.join(_DATA_DIR, "california_2020_kbdi.csv")
_R_CACHE    = os.path.join(_DATA_DIR, "r_cache.json")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_r_cache() -> dict[str, float]:
    if not os.path.exists(_R_CACHE):
        print(f"ERROR: R cache not found at {_R_CACHE}.")
        print("Run `python -m ml.build_r_cache` first.")
        sys.exit(1)
    with open(_R_CACHE) as f:
        return json.load(f)


def fetch_spinup_window(lat: float, lon: float, acq_date: str) -> list[tuple[float, float]]:
    """
    Fetch the SPINUP_DAYS days preceding (and including) acq_date from NASA
    POWER's daily endpoint. Returns chronological list of (T_max_F, precip_inches).
    """
    end   = datetime.strptime(acq_date, "%Y-%m-%d")
    start = end - timedelta(days=SPINUP_DAYS - 1)

    params = {
        "parameters": "T2M_MAX,PRECTOTCORR",
        "community":  "AG",
        "latitude":   lat,
        "longitude":  lon,
        "start":      start.strftime("%Y%m%d"),
        "end":        end.strftime("%Y%m%d"),
        "format":     "JSON",
    }

    last_err: Exception | None = None
    for attempt in range(4):
        try:
            resp = requests.get(POWER_URL, params=params, timeout=30)
            if resp.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            resp.raise_for_status()
            payload = resp.json() or {}
            param   = payload.get("properties", {}).get("parameter", {})
            tmax_d  = param.get("T2M_MAX")     or {}
            prec_d  = param.get("PRECTOTCORR") or {}
            if not tmax_d or not prec_d:
                raise ValueError("incomplete POWER payload")

            # POWER keys are YYYYMMDD strings; iterate in chronological order
            series: list[tuple[float, float]] = []
            for ymd in sorted(tmax_d.keys()):
                t_c = tmax_d.get(ymd)
                p_mm = prec_d.get(ymd)
                if t_c is None or p_mm is None:
                    continue
                if t_c == POWER_FILL or p_mm == POWER_FILL:
                    continue
                series.append((c_to_f(float(t_c)), mm_to_in(float(p_mm))))

            if len(series) < SPINUP_DAYS // 2:
                raise ValueError(f"too few valid days ({len(series)})")
            return series

        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            last_err = e
            time.sleep(3 * (attempt + 1))
        except Exception as e:
            last_err = e
            break
    raise RuntimeError(f"NASA POWER daily fetch failed: {last_err}")


def load_done_keys() -> set[tuple[str, str, str]]:
    """Set of (lat, lon, acq_date) tuples already present in the output CSV."""
    if not os.path.exists(_OUTPUT_CSV):
        return set()
    done: set[tuple[str, str, str]] = set()
    with open(_OUTPUT_CSV, newline="") as f:
        for row in csv.DictReader(f):
            try:
                done.add((row["lat"], row["lon"], row["acq_date"]))
            except KeyError:
                continue
    return done


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def enrich():
    if not os.path.exists(_INPUT_CSV):
        print(f"ERROR: input CSV not found at {_INPUT_CSV}", file=sys.stderr)
        sys.exit(1)

    r_cache = load_r_cache()

    with open(_INPUT_CSV, newline="") as f:
        reader = csv.DictReader(f)
        in_cols = list(reader.fieldnames or [])
        rows    = list(reader)

    if "kbdi" in in_cols:
        out_cols = in_cols
    else:
        # Insert kbdi just before the label column for readability
        if in_cols and in_cols[-1] == "fire":
            out_cols = in_cols[:-1] + ["kbdi", "fire"]
        else:
            out_cols = in_cols + ["kbdi"]

    done   = load_done_keys()
    fresh  = not os.path.exists(_OUTPUT_CSV)
    out_f  = open(_OUTPUT_CSV, "a", newline="")
    writer = csv.DictWriter(out_f, fieldnames=out_cols)
    if fresh:
        writer.writeheader()

    todo = [r for r in rows if (r["lat"], r["lon"], r["acq_date"]) not in done]

    print(f"Input rows           : {len(rows):,}")
    print(f"Already enriched     : {len(rows) - len(todo):,}")
    print(f"To enrich            : {len(todo):,}")
    print(f"Workers              : {WORKERS}")
    print(f"R cache entries      : {len(r_cache):,}")
    print()

    if not todo:
        print("Nothing to do.")
        out_f.close()
        return

    started = datetime.now()
    failed  = 0
    completed = 0
    pending: list[dict] = []

    def task(row):
        lat = float(row["lat"])
        lon = float(row["lon"])
        date = row["acq_date"]
        r = r_cache.get(r_key(lat, lon))
        if r is None:
            return row, None, "no R in cache"
        try:
            series = fetch_spinup_window(lat, lon, date)
        except Exception as e:
            return row, None, f"weather: {e}"
        try:
            kbdi = kbdi_final(series, r_annual_in=r, initial_kbdi=100.0)
        except Exception as e:
            return row, None, f"kbdi: {e}"
        return row, kbdi, None

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = [ex.submit(task, r) for r in todo]
        for i, fut in enumerate(as_completed(futures), 1):
            row, kbdi, err = fut.result()
            lat = float(row["lat"]); lon = float(row["lon"]); date = row["acq_date"]
            if err is not None or kbdi is None:
                failed += 1
                print(f"  [{i}/{len(todo)}] ({lat:.4f}, {lon:.4f}) {date} -- FAILED: {err}")
                continue

            out = {c: row.get(c, "") for c in out_cols}
            out["kbdi"] = round(kbdi, 2)
            pending.append(out)
            completed += 1

            if completed % CHECKPOINT_EVERY == 0:
                writer.writerows(pending)
                out_f.flush()
                pending.clear()
                print(f"  -- checkpoint: {completed} rows enriched (KBDI={kbdi:.1f}) --")

    if pending:
        writer.writerows(pending)
        out_f.flush()
    out_f.close()

    elapsed = (datetime.now() - started).total_seconds()
    print(f"\nDone. {completed} enriched, {failed} failed in {elapsed:.0f}s.")
    print(f"Output: {_OUTPUT_CSV}")


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    enrich()
