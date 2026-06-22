"""Regenerate the paper's Table 1 (predictive quality + consistency, random 80/20
held-out AND spatial-block CV) and Table 2 (per-feature direction violations),
from the frozen evaluation set. Single source of truth for the paper numbers.

    python -m ml.experiments.full_tables
"""
from __future__ import annotations

import os
import csv
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import (
    roc_auc_score, average_precision_score, brier_score_loss, log_loss,
    accuracy_score, f1_score,
)

from ml.train_monotonic import (
    FEATURE_COLS, MONOTONIC_CST, HGB_PARAMS, train_monotonic, validate_monotonicity,
)

SEED = 42
_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                     "training_data", "california_2020_kbdi.csv")


def load(path=_DATA):
    X, y, ll = [], [], []
    for r in csv.DictReader(open(path, newline="")):
        try:
            row = [float(r[c]) for c in FEATURE_COLS]; lab = int(float(r["fire"]))
            lat, lon = float(r["lat"]), float(r["lon"])
        except (KeyError, ValueError):
            continue
        if any(np.isnan(v) for v in row) or row[FEATURE_COLS.index("wind")] <= 0:
            continue
        X.append(row); y.append(lab); ll.append((lat, lon))
    return np.array(X, float), np.array(y, int), np.array(ll, float)


def ece(p, y, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    e = 0.0
    for i in range(bins):
        m = (p >= edges[i]) & (p < edges[i + 1]) if i < bins - 1 else (p >= edges[i]) & (p <= edges[i + 1])
        if m.sum() == 0:
            continue
        e += (m.sum() / len(p)) * abs(y[m].mean() - p[m].mean())
    return float(e)


def make_models():
    unc = lambda: CalibratedClassifierCV(
        estimator=HistGradientBoostingClassifier(monotonic_cst=[0]*len(FEATURE_COLS), **HGB_PARAMS),
        method="isotonic", cv=5)
    rf = lambda: CalibratedClassifierCV(
        estimator=RandomForestClassifier(n_estimators=300, class_weight="balanced", random_state=SEED),
        method="sigmoid", cv=5)
    return {"Unconstrained GBDT": ("unc", unc), "Monotonic GBDT (ours)": ("ours", None),
            "Calibrated RF": ("rf", rf)}


def fit(kind, factory, Xtr, ytr):
    if kind == "ours":
        return train_monotonic(Xtr, ytr)
    scaler = StandardScaler().fit(Xtr)
    m = factory(); m.fit(scaler.transform(Xtr), ytr)
    return m, scaler


def proba(m, s, X):
    return m.predict_proba(s.transform(X))[:, 1]


def metrics(p, y):
    pred = (p >= 0.5).astype(int)
    return dict(auroc=roc_auc_score(y, p), auprc=average_precision_score(y, p),
                brier=brier_score_loss(y, p), logloss=log_loss(y, p),
                acc=accuracy_score(y, pred), f1=f1_score(y, pred), ece=ece(p, y))


def spatial_blocks(latlon, cell=0.5):
    keys = {}
    for i, (la, lo) in enumerate(latlon):
        keys.setdefault((round(la/cell), round(lo/cell)), []).append(i)
    return list(keys.values())


def spatial_cv(kind, factory, X, y, latlon, folds=5):
    blocks = spatial_blocks(latlon)
    rng = np.random.default_rng(SEED); rng.shuffle(blocks)
    fold_of = {}
    for bi, blk in enumerate(blocks):
        for idx in blk:
            fold_of[idx] = bi % folds
    ps = np.zeros(len(y)); ys = np.array(y)
    for f in range(folds):
        te = np.array([i for i in range(len(y)) if fold_of[i] == f])
        tr = np.array([i for i in range(len(y)) if fold_of[i] != f])
        if len(te) == 0 or len(np.unique(y[tr])) < 2:
            continue
        m, s = fit(kind, factory, X[tr], y[tr])
        ps[te] = proba(m, s, X[te])
    return dict(auroc=roc_auc_score(ys, ps), auprc=average_precision_score(ys, ps),
                brier=brier_score_loss(ys, ps)), len(blocks)


def main():
    X, y, latlon = load()
    print(f"frozen eval set: {len(y)} rows ({int(y.sum())} fire / {int((1-y).sum())} no-fire), "
          f"{100*y.mean():.1f}% positive\n")
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.20, stratify=y, random_state=SEED)
    models = make_models()

    print("=== TABLE 1: random 80/20 held-out ===")
    print(f"{'Model':24}{'AUROC':>7}{'AUPRC':>7}{'Brier':>7}{'LogL':>7}{'Acc':>7}{'F1':>7}{'ECE':>7}")
    fitted = {}
    for name, (kind, fac) in models.items():
        m, s = fit(kind, fac, Xtr, ytr); fitted[name] = (m, s)
        r = metrics(proba(m, s, Xte), yte)
        print(f"{name:24}{r['auroc']:>7.3f}{r['auprc']:>7.3f}{r['brier']:>7.3f}"
              f"{r['logloss']:>7.3f}{r['acc']:>7.3f}{r['f1']:>7.3f}{r['ece']:>7.3f}")

    print("\n=== TABLE 1: spatial-block CV ===")
    print(f"{'Model':24}{'AUROC':>7}{'AUPRC':>7}{'Brier':>7}{'Viol':>6}")
    nblocks = None
    for name, (kind, fac) in models.items():
        r, nblocks = spatial_cv(kind, fac, X, y, latlon)
        m, s = fitted[name]
        nv = sum(0 if v["ok"] else 1 for v in validate_monotonicity(m, s).values())
        print(f"{name:24}{r['auroc']:>7.3f}{r['auprc']:>7.3f}{r['brier']:>7.3f}{nv:>6}")
    print(f"(spatial blocks: {nblocks}, 5 folds, cell=0.5deg)")

    print("\n=== TABLE 2: per-feature direction violation v_i ===")
    print(f"{'Feature':18}" + "".join(f"{n.split()[0]:>16}" for n in models))
    reps = {n: validate_monotonicity(*fitted[n]) for n in models}
    for i, feat in enumerate(FEATURE_COLS):
        if MONOTONIC_CST[i] == 0:
            continue
        print(f"{feat:18}" + "".join(f"{reps[n][feat]['max_violation']:>16.3f}" for n in models))


if __name__ == "__main__":
    main()
