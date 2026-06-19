"""Gated retrain: train the monotonic candidate on the rolling dataset, evaluate
it, and promote it to production ONLY if it clears the gate.

Gate (in order):
  1. PHYSICS (hard, non-negotiable): every constrained feature must point the
     right way (ml.train_monotonic.validate_monotonicity). A physically-wrong
     model never ships, no matter how good its accuracy looks.
  2. METRICS vs the current production model on a held-out split:
       - AUROC must not regress by more than AUROC_TOL
       - Brier must not regress by more than BRIER_TOL
     BUT: if the current production model itself FAILS physics, metric
     regression is waived for the first physics-passing candidate — we refuse to
     keep a physically-broken model on accuracy grounds.

On promotion: archive the current model to models/archive/, write the new model
+ scaler + metadata, and append a RETRAIN_LOG.md entry. This module makes no
network calls and never auto-commits — the caller (CI workflow) decides that.

Usage:
    python -m ml.retrain_and_gate            # evaluate + promote if it passes
    python -m ml.retrain_and_gate --dry-run  # evaluate only, never write
"""
import os
import sys
import json
import shutil
import argparse

import numpy as np
import pandas as pd
import joblib
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, brier_score_loss, accuracy_score

from ml.train_monotonic import (
    train_monotonic, validate_monotonicity, gate_passes, FEATURE_COLS, MONOTONIC_CST,
)

_DIR = os.path.dirname(os.path.abspath(__file__))
_MODELS_DIR = os.path.join(_DIR, "models")
_ARCHIVE_DIR = os.path.join(_MODELS_DIR, "archive")
_TRAIN_DIR = os.path.join(_DIR, "training_data")
_MODEL_OUT = os.path.join(_MODELS_DIR, "wildfire_model_predictive.pkl")
_SCALER_OUT = os.path.join(_MODELS_DIR, "wildfire_scaler_predictive.pkl")
_META_OUT = os.path.join(_MODELS_DIR, "model_metadata.json")
_LOG = os.path.join(_MODELS_DIR, "RETRAIN_LOG.md")

# Both committed to the repo (zero DB cost-risk). The frozen 2020 base never
# changes; the daily file is appended by the ingest cron. _load_dataset() unions
# them and de-dups.
_BASE = os.path.join(_TRAIN_DIR, "california_2020_kbdi.csv")
_DAILY = os.path.join(_TRAIN_DIR, "california_daily.csv")

AUROC_TOL = 0.005
BRIER_TOL = 0.005


_DB_COLS = FEATURE_COLS + ["fire"]


def _load_dataset():
    """Union the frozen 2020 base CSV with the daily-appended CSV (both committed
    to the repo). De-dups identical rows so a re-ingested point can't double-count.
    Returns (df, description)."""
    frames, parts = [], []
    for path in (_BASE, _DAILY):
        if os.path.exists(path):
            d = pd.read_csv(path)
            if set(_DB_COLS).issubset(d.columns) and len(d):
                frames.append(d[_DB_COLS])
                parts.append(f"{os.path.basename(path)}({len(d)})")

    if not frames:
        raise FileNotFoundError(f"no training data found at {_BASE} or {_DAILY}")
    df = pd.concat(frames, ignore_index=True).dropna(subset=_DB_COLS).drop_duplicates()

    # Wind sanity check. A provider field-name bug recorded wind == 0 on a block of
    # ingested rows; being in-range AND constant, it evades the statistical outlier
    # monitor, so we exclude it here before training/evaluation. Real wind (archive
    # daily-max or live) is always > 0, so this drops exactly the corrupted rows.
    before = len(df)
    df = df[df["wind"] > 0].reset_index(drop=True)
    dropped_wind = before - len(df)
    desc = " + ".join(parts)
    if dropped_wind:
        desc += f" -{dropped_wind} wind<=0"
    return df, desc


def decide(cand_m, cand_phys_ok, cand_bad_features, prod_m, prod_phys_ok):
    """Pure gate decision. Returns (promote: bool, reasons: list[str]).

    Order: physics is the hard gate; metric regression only matters when the
    current production model is itself physically sound.
    """
    if not cand_phys_ok:
        return False, [f"candidate FAILS physics ({', '.join(cand_bad_features)})"]
    if prod_m is None:
        return True, ["no production model present — promoting first physics-passing candidate"]
    if prod_phys_ok is False:
        return True, ["production model FAILS physics — metric-regression waived, "
                      "promoting physically-correct candidate"]
    auroc_ok = cand_m["auroc"] >= prod_m["auroc"] - AUROC_TOL
    brier_ok = cand_m["brier"] <= prod_m["brier"] + BRIER_TOL
    reasons = []
    if not auroc_ok:
        reasons.append(f"AUROC regressed {prod_m['auroc']:.4f} -> {cand_m['auroc']:.4f}")
    if not brier_ok:
        reasons.append(f"Brier regressed {prod_m['brier']:.4f} -> {cand_m['brier']:.4f}")
    if auroc_ok and brier_ok:
        reasons.append("candidate clears physics + metric gate")
    return (auroc_ok and brier_ok), reasons


def _metrics(model, scaler, X, y):
    p = model.predict_proba(scaler.transform(X))[:, 1]
    return {
        "auroc": float(roc_auc_score(y, p)),
        "brier": float(brier_score_loss(y, p)),
        "acc": float(accuracy_score(y, (p >= 0.5))),
    }


def evaluate(now_iso):
    """Train a candidate and return a decision dict. Pure — writes nothing."""
    df, dataset_desc = _load_dataset()
    X = df[FEATURE_COLS].values
    y = df["fire"].values
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)

    # Candidate trained on the train split (honest held-out eval).
    cand, cand_scaler = train_monotonic(Xtr, ytr)
    cand_m = _metrics(cand, cand_scaler, Xte, yte)
    cand_phys = validate_monotonicity(cand, cand_scaler)
    cand_phys_ok = gate_passes(cand_phys)

    # Current production model, evaluated on the SAME held-out split.
    prod_m, prod_phys_ok = None, None
    if os.path.exists(_MODEL_OUT) and os.path.exists(_SCALER_OUT):
        pm = joblib.load(_MODEL_OUT)
        ps = joblib.load(_SCALER_OUT)
        prod_m = _metrics(pm, ps, Xte, yte)
        prod_phys_ok = gate_passes(validate_monotonicity(pm, ps))

    bad = [n for n, v in cand_phys.items() if not v["ok"]]
    promote, reasons = decide(cand_m, cand_phys_ok, bad, prod_m, prod_phys_ok)

    return {
        "when": now_iso,
        "dataset": dataset_desc,
        "rows": int(len(df)),
        "candidate": {"metrics": cand_m, "physics_ok": cand_phys_ok, "physics": cand_phys},
        "production": {"metrics": prod_m, "physics_ok": prod_phys_ok},
        "promote": promote,
        "reasons": reasons,
        # carry the fitted full-data model for promotion (re-fit on ALL rows)
        "_full_fit": (X, y),
    }


def _append_log(decision):
    head = "# Retrain Log\n\n" if not os.path.exists(_LOG) else ""
    c = decision["candidate"]["metrics"]
    p = decision["production"]["metrics"]
    line = (
        f"## {decision['when']} — {'PROMOTED' if decision['promote'] else 'REJECTED'}\n"
        f"- dataset: {decision['dataset']} ({decision['rows']} rows)\n"
        f"- candidate: AUROC={c['auroc']:.4f} Brier={c['brier']:.4f} physics_ok={decision['candidate']['physics_ok']}\n"
        f"- production: {'AUROC=%.4f Brier=%.4f physics_ok=%s' % (p['auroc'], p['brier'], decision['production']['physics_ok']) if p else 'none'}\n"
        f"- reasons: {'; '.join(decision['reasons'])}\n\n"
    )
    with open(_LOG, "a") as f:
        f.write(head + line)


def promote(decision, now_iso):
    """Archive current production, refit the candidate on ALL rows, write it."""
    os.makedirs(_ARCHIVE_DIR, exist_ok=True)
    stamp = now_iso.replace(":", "").replace("-", "")[:13]
    if os.path.exists(_MODEL_OUT):
        shutil.copy2(_MODEL_OUT, os.path.join(_ARCHIVE_DIR, f"model_{stamp}.pkl"))
        shutil.copy2(_SCALER_OUT, os.path.join(_ARCHIVE_DIR, f"scaler_{stamp}.pkl"))
        # keep only the newest 3 archived models
        archived = sorted(f for f in os.listdir(_ARCHIVE_DIR) if f.startswith("model_"))
        for old in archived[:-3]:
            os.remove(os.path.join(_ARCHIVE_DIR, old))
            sc = old.replace("model_", "scaler_")
            if os.path.exists(os.path.join(_ARCHIVE_DIR, sc)):
                os.remove(os.path.join(_ARCHIVE_DIR, sc))

    X, y = decision["_full_fit"]
    model, scaler = train_monotonic(X, y)  # final model uses ALL rows
    joblib.dump(model, _MODEL_OUT)
    joblib.dump(scaler, _SCALER_OUT)
    meta = {
        "model_type": "monotonic_hgb_isotonic",
        "feature_cols": FEATURE_COLS,
        "monotonic_cst": MONOTONIC_CST,
        "trained_at": now_iso,
        "dataset": decision["dataset"],
        "rows": decision["rows"],
        "heldout_auroc": decision["candidate"]["metrics"]["auroc"],
    }
    with open(_META_OUT, "w") as f:
        json.dump(meta, f, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="evaluate only; never write")
    ap.add_argument("--now", default=None, help="ISO timestamp (CI passes this; scripts can't call datetime here)")
    args = ap.parse_args()
    now_iso = args.now or "1970-01-01T00:00:00"

    d = evaluate(now_iso)
    c = d["candidate"]["metrics"]
    print(f"dataset={d['dataset']} rows={d['rows']}")
    print(f"candidate: AUROC={c['auroc']:.4f} Brier={c['brier']:.4f} physics_ok={d['candidate']['physics_ok']}")
    if d["production"]["metrics"]:
        p = d["production"]["metrics"]
        print(f"production: AUROC={p['auroc']:.4f} Brier={p['brier']:.4f} physics_ok={d['production']['physics_ok']}")
    print("DECISION:", "PROMOTE" if d["promote"] else "REJECT", "—", "; ".join(d["reasons"]))

    if args.dry_run:
        print("(dry-run — no files written)")
        return 0
    _append_log(d)
    if d["promote"]:
        promote(d, now_iso)
        print("Promoted candidate to production + archived previous + logged.")
    else:
        print("Kept production. Logged rejection.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
