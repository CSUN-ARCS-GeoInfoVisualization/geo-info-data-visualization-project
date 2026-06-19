"""Layer-2 data-quality checks for the training ingest.

Layer 1 (routes/ml_ingest.py `_row_quality_issue`) is per-row range/sanity
validation — it rejects corrupt / out-of-range / out-of-CA / NaN rows before they
are ever appended.

This module is Layer 2: STATISTICAL checks over the accumulated data that a
per-row range check can't catch:

  * Outlier rate  — rows whose feature values are in-range but anomalous vs the
    training baseline (robust z-score on median/MAD). Partial mitigation for
    "wrong but still in range" values.
  * Distribution drift — PSI (Population Stability Index) per feature, recent
    window vs the frozen 2020 baseline. Catches the data slowly shifting over
    time. Drift is INFORMATIONAL (it can be real seasonal change), so the caller
    alerts rather than silently dropping.

Pure + numpy-only (pandas is not installed on the backend). Reads the same
committed CSVs the trainer uses.
"""
from __future__ import annotations

import os
import csv
import random

import numpy as np

FEATURE_COLS = ["evi", "air_temp_encoded", "wind", "humidity", "elevation", "kbdi"]

_DIR = os.path.dirname(os.path.abspath(__file__))
_BASE = os.path.join(_DIR, "training_data", "california_2020_kbdi.csv")
_DAILY = os.path.join(_DIR, "training_data", "california_daily.csv")

# PSI convention: <0.1 stable, 0.1–0.25 moderate shift, >0.25 significant shift.
PSI_THRESHOLD = 0.25
# Robust-z cutoff for calling a single feature value an outlier.
OUTLIER_Z = 5.0
# Fraction of recent rows allowed to be outliers before we flag the feed.
OUTLIER_RATE_THRESHOLD = 0.10
# How many of the most recent daily rows to evaluate for drift/outliers.
RECENT_WINDOW = 120


def load_features(path: str) -> np.ndarray:
    """Read the 6 feature columns from a training CSV into an (N, 6) array.
    Rows with a missing/unparseable feature are skipped (Layer 1 already
    range-checks live ingest; this is defensive for the on-disk file)."""
    rows = []
    if not os.path.exists(path):
        return np.empty((0, len(FEATURE_COLS)))
    with open(path, newline="") as f:
        for d in csv.DictReader(f):
            try:
                vals = [float(d[c]) for c in FEATURE_COLS]
            except (KeyError, ValueError, TypeError):
                continue
            if any(np.isnan(v) for v in vals):
                continue
            rows.append(vals)
    return np.array(rows, dtype=float) if rows else np.empty((0, len(FEATURE_COLS)))


def baseline_stats(X: np.ndarray) -> dict:
    """Per-feature robust center/scale: median and MAD-derived sigma.
    scaled_mad of 0 (a constant feature) becomes NaN so it is skipped in the
    z-score rather than dividing by zero."""
    med = np.median(X, axis=0)
    mad = np.median(np.abs(X - med), axis=0)
    scaled = 1.4826 * mad
    scaled = np.where(scaled == 0, np.nan, scaled)
    return {"median": med, "scaled_mad": scaled}


def outlier_rate(X: np.ndarray, stats: dict, k: float = OUTLIER_Z) -> float:
    """Fraction of rows where ANY feature is more than k robust-sigmas from the
    baseline median. Features with undefined scale (NaN) are ignored."""
    if X.size == 0:
        return 0.0
    z = np.abs(X - stats["median"]) / stats["scaled_mad"]
    row_max = np.nanmax(z, axis=1)
    return float(np.mean(row_max > k))


def psi(expected: np.ndarray, actual: np.ndarray, bins: int = 10) -> float:
    """Population Stability Index of `actual` vs `expected` for one feature.
    Bin edges are the deciles of the expected (baseline) distribution."""
    if expected.size == 0 or actual.size == 0:
        return 0.0
    edges = np.unique(np.percentile(expected, np.linspace(0, 100, bins + 1)))
    if len(edges) < 3:  # near-constant feature — PSI not meaningful
        return 0.0
    e_counts, _ = np.histogram(expected, bins=edges)
    a_counts, _ = np.histogram(actual, bins=edges)
    eps = 1e-4
    e_pct = np.clip(e_counts / max(e_counts.sum(), 1), eps, None)
    a_pct = np.clip(a_counts / max(a_counts.sum(), 1), eps, None)
    return float(np.sum((a_pct - e_pct) * np.log(a_pct / e_pct)))


# Drift is measured EARLIER-daily vs RECENT-daily (same sampler, different time)
# — NOT vs the 2020 base. Comparing the daily feed to the curated 2020 base would
# always show huge PSI because they're sampled differently (uniform random
# no-fire + current season vs the restratified 2020 set); that's a structural
# difference, not a feed regression. Each half needs at least this many rows for
# the PSI to mean anything.
MIN_DRIFT_ROWS = 30


def sample_recent_rows(n: int = 5, window: int = RECENT_WINDOW, daily_path: str = _DAILY) -> list:
    """A small random sample of recently-ingested rows (full dicts incl. label +
    source) so a human can eyeball the data in the weekly digest email."""
    if not os.path.exists(daily_path):
        return []
    with open(daily_path, newline="") as f:
        rows = list(csv.DictReader(f))
    recent = rows[-window:] if len(rows) > window else rows
    if not recent:
        return []
    rng = random.Random(len(recent))  # varies as data grows; not security-sensitive
    return rng.sample(recent, min(n, len(recent)))


def health_report(recent_window: int = RECENT_WINDOW,
                  base_path: str = _BASE, daily_path: str = _DAILY) -> dict:
    """Statistical health of the recent ingest. Returns a JSON-able report;
    `healthy` is False if the outlier rate is high or a feature has drifted.

    - Outliers are measured against the FULL training distribution (base + daily)
      — the data the live model actually learned from.
    - Drift is measured RECENT daily vs EARLIER daily (temporal change in the
      feed itself), which is what "data shifting over months" means.
    """
    base = load_features(base_path)
    daily = load_features(daily_path)
    recent = daily[-recent_window:] if len(daily) > recent_window else daily
    earlier = daily[:-recent_window] if len(daily) > recent_window else np.empty((0, len(FEATURE_COLS)))

    if recent.size == 0:
        return {"healthy": True, "note": "no ingest data yet",
                "base_rows": int(len(base)), "recent_rows": 0,
                "outlier_rate": 0.0, "drift": {}, "drifted_features": [],
                "drift_evaluated": False}

    # Outlier rate vs the full training distribution.
    full = np.vstack([base, daily]) if base.size else daily
    o_rate = outlier_rate(recent, baseline_stats(full))

    # Drift: recent daily vs earlier daily, only when both halves are big enough.
    drift, drifted, drift_evaluated = {}, [], False
    if len(earlier) >= MIN_DRIFT_ROWS and len(recent) >= MIN_DRIFT_ROWS:
        drift_evaluated = True
        for i, name in enumerate(FEATURE_COLS):
            p = psi(earlier[:, i], recent[:, i])
            drift[name] = {"psi": round(p, 4), "drifted": bool(p > PSI_THRESHOLD)}
        drifted = [n for n, v in drift.items() if v["drifted"]]

    healthy = (o_rate <= OUTLIER_RATE_THRESHOLD) and not drifted
    return {
        "healthy": bool(healthy),
        "base_rows": int(len(base)),
        "daily_rows": int(len(daily)),
        "recent_rows": int(len(recent)),
        "earlier_rows": int(len(earlier)),
        "outlier_rate": round(o_rate, 4),
        "outlier_rate_threshold": OUTLIER_RATE_THRESHOLD,
        "psi_threshold": PSI_THRESHOLD,
        "drift_evaluated": drift_evaluated,
        "drift": drift,
        "drifted_features": drifted,
        "sample": sample_recent_rows(),
    }
