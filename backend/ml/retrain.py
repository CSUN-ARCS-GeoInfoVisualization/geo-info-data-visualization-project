"""
Retrain the wildfire risk model on the dataset built by build_dataset.py.

Loads ml/training_data/california_2020.csv, trains a RandomForestClassifier,
evaluates with 10-fold stratified CV, then writes new model/scaler pkl files
(backing up the originals first).

Improvements over the previous KNN model:
  - Random Forest handles non-linear boundaries better than KNN
  - class_weight='balanced' handles any class imbalance automatically
  - Outputs feature importances so you can see what actually matters
  - Adds humidity as a 5th feature

Run from backend/:
    python -m ml.retrain
"""

import os
import sys
import shutil
from datetime import datetime

import numpy as np
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    confusion_matrix,
    classification_report,
)

_DIR        = os.path.dirname(os.path.abspath(__file__))
_DATA_PATH  = os.path.join(_DIR, "training_data", "california_2020.csv")
_MODELS_DIR = os.path.join(_DIR, "models")
_MODEL_OUT  = os.path.join(_MODELS_DIR, "wildfire_model_predictive.pkl")
_SCALER_OUT = os.path.join(_MODELS_DIR, "wildfire_scaler_predictive.pkl")

FEATURE_COLS = ["evi", "lst", "wind", "humidity", "elevation"]
LABEL_COL    = "fire"

RF_PARAMS = dict(
    n_estimators=300,
    max_depth=None,
    min_samples_split=5,
    min_samples_leaf=2,
    max_features="sqrt",
    class_weight="balanced",
    random_state=42,
    n_jobs=-1,
)


def load_data() -> tuple[np.ndarray, np.ndarray]:
    import csv
    rows = []
    with open(_DATA_PATH, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                features = [float(row[c]) for c in FEATURE_COLS]
                label    = int(row[LABEL_COL])
                rows.append(features + [label])
            except (KeyError, ValueError):
                continue

    arr = np.array(rows)
    X   = arr[:, :-1]
    y   = arr[:, -1].astype(int)
    return X, y


def print_section(title: str):
    w = 60
    print(f"\n{'=' * w}\n  {title}\n{'=' * w}")


def backup_existing():
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    for path in [_MODEL_OUT, _SCALER_OUT]:
        if os.path.exists(path):
            backup = path.replace(".pkl", f"_backup_{ts}.pkl")
            shutil.copy2(path, backup)
            print(f"  Backed up {os.path.basename(path)} -> {os.path.basename(backup)}")


def retrain():
    # ── Load data ──────────────────────────────────────────────────────
    print(f"Loading dataset from {_DATA_PATH} ...")
    if not os.path.exists(_DATA_PATH):
        print("ERROR: dataset not found. Run build_dataset.py first.")
        sys.exit(1)

    X, y = load_data()
    n_samples = len(y)
    n_fire    = int((y == 1).sum())
    n_nofire  = int((y == 0).sum())

    print_section("DATASET SUMMARY")
    print(f"  Total samples : {n_samples:,}")
    print(f"  Fire (1)      : {n_fire:,}  ({100 * n_fire / n_samples:.1f}%)")
    print(f"  No fire (0)   : {n_nofire:,}  ({100 * n_nofire / n_samples:.1f}%)")
    print(f"  Features      : {FEATURE_COLS}")

    print("\n  Feature statistics (raw):")
    print(f"  {'Feature':<12} {'Mean':>10} {'Std':>10} {'Min':>10} {'Max':>10}")
    print(f"  {'-' * 52}")
    for i, name in enumerate(FEATURE_COLS):
        col = X[:, i]
        print(f"  {name:<12} {col.mean():>10.2f} {col.std():>10.2f} "
              f"{col.min():>10.2f} {col.max():>10.2f}")

    if n_samples < 50:
        print("\nERROR: too few samples. Run build_dataset.py to collect more data.")
        sys.exit(1)

    # ── Scale features ─────────────────────────────────────────────────
    # Random Forest doesn't require scaling, but we keep the scaler so
    # inference.py has a consistent interface if the algorithm changes later.
    print_section("SCALING")
    scaler   = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    print("  StandardScaler fitted.")

    # ── 10-fold cross-validation ───────────────────────────────────────
    print_section("10-FOLD STRATIFIED CROSS-VALIDATION")
    cv         = StratifiedKFold(n_splits=min(10, n_samples // 10), shuffle=True, random_state=42)
    eval_model = RandomForestClassifier(**RF_PARAMS)

    print("  Running CV (this takes a few minutes)...")
    y_pred  = cross_val_predict(eval_model, X_scaled, y, cv=cv, method="predict",       n_jobs=-1)
    y_proba = cross_val_predict(eval_model, X_scaled, y, cv=cv, method="predict_proba", n_jobs=-1)

    acc  = accuracy_score(y, y_pred)
    prec = precision_score(y, y_pred, zero_division=0)
    rec  = recall_score(y, y_pred, zero_division=0)
    f1   = f1_score(y, y_pred, zero_division=0)
    auc  = roc_auc_score(y, y_proba[:, 1])
    cm   = confusion_matrix(y, y_pred)
    tn, fp, fn, tp = cm.ravel()

    print(f"\n  Accuracy    : {acc:.4f}  ({acc * 100:.2f}%)")
    print(f"  Precision   : {prec:.4f}")
    print(f"  Recall      : {rec:.4f}")
    print(f"  F1 Score    : {f1:.4f}")
    print(f"  ROC-AUC     : {auc:.4f}")
    print(f"  Specificity : {tn / (tn + fp):.4f}")

    print("\n  Confusion Matrix:")
    print(f"               Pred 0    Pred 1")
    print(f"  Actual 0  : {cm[0,0]:>8,}  {cm[0,1]:>8,}")
    print(f"  Actual 1  : {cm[1,0]:>8,}  {cm[1,1]:>8,}")

    print("\n  Classification report:")
    print(classification_report(y, y_pred, target_names=["No Fire", "Fire"]))

    # ── Train final model on full dataset ──────────────────────────────
    print_section("TRAINING FINAL MODEL")
    model = RandomForestClassifier(**RF_PARAMS)
    model.fit(X_scaled, y)
    print(f"  Trained RandomForest on {n_samples:,} samples.")

    # ── Feature importances ────────────────────────────────────────────
    print_section("FEATURE IMPORTANCES")
    importances = model.feature_importances_
    for name, imp in sorted(zip(FEATURE_COLS, importances), key=lambda x: -x[1]):
        bar = "#" * int(imp * 40)
        print(f"  {name:<12} {imp:.4f}  {bar}")

    # ── Save ───────────────────────────────────────────────────────────
    print_section("SAVING MODEL")
    backup_existing()
    os.makedirs(_MODELS_DIR, exist_ok=True)
    joblib.dump(model,  _MODEL_OUT)
    joblib.dump(scaler, _SCALER_OUT)
    print(f"  Model  saved -> {_MODEL_OUT}")
    print(f"  Scaler saved -> {_SCALER_OUT}")
    print("\nRetrain complete.\n")


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    retrain()
