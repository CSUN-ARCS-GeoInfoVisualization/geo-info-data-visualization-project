"""Reproducible benchmark harness for the ICTAI paper.

Trains the three compared models on the frozen evaluation set and reports
discrimination/probabilistic metrics, bootstrap 95% confidence intervals on
held-out AUROC (per model and on the accuracy GAP), and the per-feature
physical-direction violation magnitudes used by the gate.

Models (identical features / standardization / data; differ only as stated):
  - Unconstrained GBDT  : HistGradientBoosting (no monotone constraints) + isotonic
  - Monotonic GBDT (ours): HistGradientBoosting (monotone constraints)    + isotonic
  - Calibrated RF        : RandomForest (300 trees, balanced)             + sigmoid

Pure csv + numpy + scikit-learn (no pandas). Fully seeded.

    python -m ml.experiments.benchmark
"""
from __future__ import annotations

import os
import csv
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import roc_auc_score, average_precision_score, brier_score_loss

from ml.train_monotonic import (
    FEATURE_COLS, MONOTONIC_CST, HGB_PARAMS,
    train_monotonic, validate_monotonicity,
)

SEED = 42
N_BOOT = 2000
_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                     "training_data", "california_2020_kbdi.csv")


def load_xy(path=_DATA):
    X, y = [], []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            try:
                row = [float(r[c]) for c in FEATURE_COLS]
                lab = int(float(r["fire"]))
            except (KeyError, ValueError):
                continue
            if any(np.isnan(v) for v in row):
                continue
            # apply the paper's wind sanity check to the frozen eval set too
            if row[FEATURE_COLS.index("wind")] <= 0:
                continue
            X.append(row); y.append(lab)
    return np.array(X, float), np.array(y, int)


def _fit_unconstrained(Xtr, ytr):
    scaler = StandardScaler().fit(Xtr)
    base = HistGradientBoostingClassifier(monotonic_cst=[0] * len(FEATURE_COLS), **HGB_PARAMS)
    model = CalibratedClassifierCV(estimator=base, method="isotonic", cv=5)
    model.fit(scaler.transform(Xtr), ytr)
    return model, scaler


def _fit_rf(Xtr, ytr):
    scaler = StandardScaler().fit(Xtr)
    base = RandomForestClassifier(n_estimators=300, class_weight="balanced", random_state=SEED)
    model = CalibratedClassifierCV(estimator=base, method="sigmoid", cv=5)
    model.fit(scaler.transform(Xtr), ytr)
    return model, scaler


def _proba(model, scaler, X):
    return model.predict_proba(scaler.transform(X))[:, 1]


def _metrics(p, y):
    return {
        "auroc": roc_auc_score(y, p),
        "auprc": average_precision_score(y, p),
        "brier": brier_score_loss(y, p),
    }


def _bootstrap_auroc(p, y, n=N_BOOT, seed=SEED):
    rng = np.random.default_rng(seed)
    n_obs = len(y)
    vals = []
    for _ in range(n):
        idx = rng.integers(0, n_obs, n_obs)
        if len(np.unique(y[idx])) < 2:
            continue
        vals.append(roc_auc_score(y[idx], p[idx]))
    lo, hi = np.percentile(vals, [2.5, 97.5])
    return float(lo), float(hi)


def _bootstrap_gap(p_base, p_ours, y, n=N_BOOT, seed=SEED):
    """Paired bootstrap CI on AUROC(best baseline) - AUROC(ours)."""
    rng = np.random.default_rng(seed)
    n_obs = len(y); diffs = []
    for _ in range(n):
        idx = rng.integers(0, n_obs, n_obs)
        if len(np.unique(y[idx])) < 2:
            continue
        diffs.append(roc_auc_score(y[idx], p_base[idx]) - roc_auc_score(y[idx], p_ours[idx]))
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    return float(np.mean(diffs)), float(lo), float(hi)


def main():
    X, y = load_xy()
    print(f"frozen eval set: {len(y)} rows ({int(y.sum())} fire / {int((1-y).sum())} no-fire), "
          f"{100*y.mean():.1f}% positive")
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.20, stratify=y, random_state=SEED)

    models = {
        "Unconstrained GBDT": _fit_unconstrained(Xtr, ytr),
        "Monotonic GBDT (ours)": train_monotonic(Xtr, ytr),
        "Calibrated RF": _fit_rf(Xtr, ytr),
    }

    probs, rows = {}, {}
    for name, (m, s) in models.items():
        p = _proba(m, s, Xte)
        probs[name] = p
        mt = _metrics(p, yte)
        lo, hi = _bootstrap_auroc(p, yte)
        viol = validate_monotonicity(m, s)
        n_viol = sum(0 if v["ok"] else 1 for v in viol.values())
        rows[name] = {**mt, "auroc_lo": lo, "auroc_hi": hi, "viol": viol, "n_viol": n_viol}

    print("\n=== Held-out metrics (test n={}) ===".format(len(yte)))
    print(f"{'Model':24} {'AUROC':>7} {'95% CI':>16} {'AUPRC':>7} {'Brier':>7} {'#viol':>6}")
    for name, r in rows.items():
        print(f"{name:24} {r['auroc']:.3f} "
              f"[{r['auroc_lo']:.3f},{r['auroc_hi']:.3f}]".rjust(17)
              + f" {r['auprc']:.3f}".rjust(8) + f" {r['brier']:.3f}".rjust(8)
              + f" {r['n_viol']:>6}")

    # Gap CI: best baseline AUROC vs ours
    base_name = max(("Unconstrained GBDT", "Calibrated RF"), key=lambda n: rows[n]["auroc"])
    g, glo, ghi = _bootstrap_gap(probs[base_name], probs["Monotonic GBDT (ours)"], yte)
    print(f"\nAUROC gap (best baseline = {base_name} minus ours): "
          f"{g:.3f}  95% CI [{glo:.3f}, {ghi:.3f}]  (CI excludes 0: {glo > 0})")

    print("\n=== Per-feature direction violation v_i ===")
    print(f"{'Feature':16} " + " ".join(f"{n.split()[0]:>14}" for n in rows))
    for i, feat in enumerate(FEATURE_COLS):
        if MONOTONIC_CST[i] == 0:
            continue
        cells = " ".join(f"{rows[n]['viol'][feat]['max_violation']:>14.3f}" for n in rows)
        print(f"{feat:16} {cells}")


if __name__ == "__main__":
    main()
