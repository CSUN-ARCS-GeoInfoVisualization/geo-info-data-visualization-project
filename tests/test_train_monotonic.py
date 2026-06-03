"""Proves the monotonic trainer fixes the inverted/dead-feature problem.

Runs on SYNTHETIC data so it needs none of the blocked real training CSV. The
synthetic generator deliberately injects a SPURIOUS wind signal (wind weakly
ANTI-correlated with fire, mimicking what the 1,022-row real dataset did) so we
can show:
  - an UNCONSTRAINED model learns wind backwards (violates physics), but
  - the MONOTONIC model is guaranteed to respect every physical direction.
"""
import sys
import os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))

import numpy as np  # noqa: E402
from ml.train_monotonic import (  # noqa: E402
    train_monotonic, validate_monotonicity, gate_passes, FEATURE_COLS, MONOTONIC_CST,
)
from sklearn.ensemble import HistGradientBoostingClassifier  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402


def _synthetic(n=3000, seed=0):
    """Physical fire signal + a spurious anti-wind term + noise.

    True drivers: hotter / drier / more drought -> more fire. Wind is given a
    weak NEGATIVE coefficient on purpose to reproduce the real data's pathology.
    """
    rng = np.random.default_rng(seed)
    evi = rng.uniform(0, 1, n)
    air = rng.normal(14783, 322, n)
    wind = rng.uniform(0, 15, n)
    hum = rng.uniform(5, 95, n)
    elev = rng.uniform(0, 3000, n)
    kbdi = rng.uniform(0, 800, n)
    z = (
        2.2 * ((air - 14783) / 322)
        - 1.8 * ((hum - 50) / 25)
        + 2.0 * ((kbdi - 400) / 230)
        - 0.4 * ((wind - 7) / 4)        # <- spurious backwards wind signal
        + rng.normal(0, 0.5, n)
    )
    p = 1 / (1 + np.exp(-z))
    y = (rng.uniform(0, 1, n) < p).astype(int)
    X = np.column_stack([evi, air, wind, hum, elev, kbdi])
    return X, y


def test_monotonic_model_respects_all_physical_directions():
    X, y = _synthetic()
    model, scaler = train_monotonic(X, y)
    report = validate_monotonicity(model, scaler)
    for name, v in report.items():
        print(f"{name:18s} expect={v['expected']:10s} ok={v['ok']} "
              f"max_violation={v['max_violation']:.4f} range={v['range']}")
    assert gate_passes(report), f"monotonic model violated physics: {report}"
    # wind is constrained increasing despite the spurious anti-correlation
    assert report["wind"]["ok"] and report["wind"]["expected"] == "increasing"
    # humidity constrained decreasing
    assert report["humidity"]["ok"] and report["humidity"]["expected"] == "decreasing"


def test_unconstrained_model_can_violate_physics():
    """Sanity check that the gate isn't vacuous: the same data WITHOUT constraints
    learns wind backwards, which the gate would reject."""
    X, y = _synthetic()
    scaler = StandardScaler().fit(X)
    free = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05,
                                          min_samples_leaf=20, random_state=42)
    free.fit(scaler.transform(X), y)
    report = validate_monotonicity(free, scaler)
    # wind should fail (model learned the spurious negative slope)
    print("unconstrained wind:", report["wind"])
    assert not report["wind"]["ok"], "expected unconstrained model to violate wind physics"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            print(f"\n--- {name} ---")
            fn()
            print(f"PASS {name}")
    print("\nALL PASSED")
