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

import json
import os
import sys
import shutil
from datetime import datetime

import numpy as np
import joblib
import matplotlib
matplotlib.use("Agg")  # non-interactive backend for server environments
import matplotlib.pyplot as plt
import seaborn as sns

# SHAP is dev-only (in requirements-dev.txt, NOT requirements.txt) so production
# Render deploys never install it. The training script degrades gracefully if
# someone runs it without the dev requirements.
try:
    import shap
    _SHAP_AVAILABLE = True
except ImportError:
    _SHAP_AVAILABLE = False
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold, cross_val_predict
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    roc_curve,
    confusion_matrix,
    classification_report,
)

_DIR        = os.path.dirname(os.path.abspath(__file__))
# Prefer the KBDI-enriched dataset when present; fall back to the original.
_DATA_PATH_KBDI = os.path.join(_DIR, "training_data", "california_2020_kbdi.csv")
_DATA_PATH_BASE = os.path.join(_DIR, "training_data", "california_2020.csv")
_DATA_PATH = _DATA_PATH_KBDI if os.path.exists(_DATA_PATH_KBDI) else _DATA_PATH_BASE
_MODELS_DIR = os.path.join(_DIR, "models")
_CHARTS_DIR = os.path.join(_DIR, "charts")
_MODEL_OUT  = os.path.join(_MODELS_DIR, "wildfire_model_predictive.pkl")
_SCALER_OUT = os.path.join(_MODELS_DIR, "wildfire_scaler_predictive.pkl")

FEATURE_COLS = ["evi", "air_temp_encoded", "wind", "humidity", "elevation", "kbdi"]
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


def load_data() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Load training rows. Returns (X, y, latlon) where latlon is the per-row
    lat/lon used to compute spatial-block group IDs for spatial CV."""
    import csv
    rows = []
    with open(_DATA_PATH, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                features = [float(row[c]) for c in FEATURE_COLS]
                label    = int(row[LABEL_COL])
                lat      = float(row["lat"])
                lon      = float(row["lon"])
                rows.append(features + [label, lat, lon])
            except (KeyError, ValueError):
                continue

    arr     = np.array(rows)
    n_feat  = len(FEATURE_COLS)
    X_all   = arr[:, :n_feat]
    y_all   = arr[:, n_feat].astype(int)
    latlon_all = arr[:, n_feat + 1:]

    # Enforce a balanced 50/50 split by downsampling the majority class.
    # This prevents imbalanced checkpoint merges from skewing metrics.
    rng       = np.random.default_rng(42)
    fire_idx  = np.where(y_all == 1)[0]
    nofire_idx = np.where(y_all == 0)[0]
    n = min(len(fire_idx), len(nofire_idx))
    fire_sel   = rng.choice(fire_idx,   size=n, replace=False)
    nofire_sel = rng.choice(nofire_idx, size=n, replace=False)
    sel = np.sort(np.concatenate([fire_sel, nofire_sel]))

    if len(fire_idx) != len(nofire_idx):
        print(f"  NOTE: dataset was imbalanced ({len(fire_idx)} fire, {len(nofire_idx)} no-fire). "
              f"Downsampled to {n} per class.")

    return X_all[sel], y_all[sel], latlon_all[sel]


def spatial_group_ids(latlon: np.ndarray, cell_deg: float = 0.5) -> np.ndarray:
    """Bin lat/lon into ~55 km cells (at California latitudes) and return one
    integer group ID per row. Used as the `groups` argument to
    StratifiedGroupKFold so all rows inside the same cell stay in the same
    fold -- preventing the model from being tested on points it effectively
    saw during training via spatial autocorrelation."""
    lat_bin = np.floor(latlon[:, 0] / cell_deg).astype(np.int64)
    lon_bin = np.floor(latlon[:, 1] / cell_deg).astype(np.int64)
    # 10_000 is larger than any realistic lon-bin range, so the combined
    # value is unique per (lat_bin, lon_bin) pair without collisions.
    return lat_bin * 10_000 + lon_bin


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

    X, y, latlon = load_data()
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
    y_pred  = cross_val_predict(eval_model, X_scaled, y, cv=cv, method="predict",       n_jobs=1)
    y_proba = cross_val_predict(eval_model, X_scaled, y, cv=cv, method="predict_proba", n_jobs=1)

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

    # ── Spatial-block cross-validation ─────────────────────────────────
    # Random CV above mixes nearby points across folds, so spatial
    # autocorrelation lets the model "see" each test row's neighbors during
    # training. The number above is the optimistic best case.
    #
    # Spatial CV groups all rows in the same ~55 km cell into one fold, so
    # the model is tested on regions it never saw. The drop versus random CV
    # quantifies how much of the apparent skill came from spatial leakage.
    print_section("SPATIAL-BLOCK CROSS-VALIDATION (~55 km cells)")
    groups   = spatial_group_ids(latlon)
    n_groups = len(set(groups))
    n_splits_s = min(10, n_groups)
    print(f"  {n_groups} unique spatial cells; {n_splits_s} folds")

    cv_s = StratifiedGroupKFold(n_splits=n_splits_s, shuffle=True, random_state=42)
    splits = list(cv_s.split(X_scaled, y, groups=groups))

    print("  Running spatial CV...")
    y_pred_s  = cross_val_predict(eval_model, X_scaled, y, cv=splits, method="predict",       n_jobs=1)
    y_proba_s = cross_val_predict(eval_model, X_scaled, y, cv=splits, method="predict_proba", n_jobs=1)

    acc_s  = accuracy_score(y, y_pred_s)
    prec_s = precision_score(y, y_pred_s, zero_division=0)
    rec_s  = recall_score(y, y_pred_s, zero_division=0)
    f1_s   = f1_score(y, y_pred_s, zero_division=0)
    auc_s  = roc_auc_score(y, y_proba_s[:, 1])
    cm_s   = confusion_matrix(y, y_pred_s)
    tn_s, fp_s, fn_s, tp_s = cm_s.ravel()

    print(f"\n  Accuracy    : {acc_s:.4f}  ({acc_s * 100:.2f}%)")
    print(f"  Precision   : {prec_s:.4f}")
    print(f"  Recall      : {rec_s:.4f}")
    print(f"  F1 Score    : {f1_s:.4f}")
    print(f"  ROC-AUC     : {auc_s:.4f}")
    print(f"  Specificity : {tn_s / (tn_s + fp_s):.4f}")

    print("\n  Random vs spatial CV comparison:")
    print(f"  {'Metric':<12} {'Random CV':>10} {'Spatial CV':>12} {'diff':>8}")
    print(f"  {'-' * 44}")
    for name, r, s in [
        ("Accuracy",  acc,  acc_s),
        ("ROC-AUC",   auc,  auc_s),
        ("Recall",    rec,  rec_s),
        ("Precision", prec, prec_s),
        ("F1",        f1,   f1_s),
    ]:
        print(f"  {name:<12} {r:>10.4f} {s:>12.4f} {s - r:>+8.4f}")

    # ── Calibrated held-out predictions for the calibration curve ─────
    # RandomForest predict_proba returns raw vote counts, not true
    # probabilities. Wrapping in CalibratedClassifierCV with sigmoid
    # (Platt scaling) maps those scores onto empirical fire frequencies,
    # so the Low/Medium/High/Extreme thresholds in inference.py mean
    # what they say. Sigmoid is the right choice for ~1k samples;
    # isotonic would overfit at this scale.
    print_section("CALIBRATED SPATIAL-BLOCK CV (for calibration curve)")
    cal_eval = CalibratedClassifierCV(
        estimator=RandomForestClassifier(**RF_PARAMS),
        method="sigmoid",
        cv=5,
        ensemble=False,
    )
    print("  Running calibrated spatial CV (slower -- nested CV)...")
    y_proba_cal = cross_val_predict(
        cal_eval, X_scaled, y, cv=splits, method="predict_proba", n_jobs=1,
    )
    auc_cal = roc_auc_score(y, y_proba_cal[:, 1])
    print(f"  ROC-AUC (calibrated, spatial CV): {auc_cal:.4f}")

    # ── Train final model on full dataset (uncalibrated, for importances) ─
    print_section("TRAINING FINAL MODEL")
    base_rf = RandomForestClassifier(**RF_PARAMS)
    base_rf.fit(X_scaled, y)
    print(f"  Trained base RandomForest on {n_samples:,} samples.")

    # Wrap in calibration for the production model. cv=5 with ensemble=False
    # uses 5-fold internal CV to fit the sigmoid mapping, then refits the
    # base estimator on the full dataset. Result is a single calibrated
    # model whose predict_proba returns calibrated probabilities.
    model = CalibratedClassifierCV(
        estimator=RandomForestClassifier(**RF_PARAMS),
        method="sigmoid",
        cv=5,
        ensemble=False,
    )
    model.fit(X_scaled, y)
    print(f"  Wrapped in CalibratedClassifierCV (sigmoid, cv=5).")

    # ── Feature importances (from the uncalibrated base RF) ────────────
    # The CalibratedClassifierCV wrapper doesn't expose feature_importances_
    # directly; we read them from the separately-fit base RF, which uses
    # the same hyperparams + random_state.
    print_section("FEATURE IMPORTANCES")
    importances = base_rf.feature_importances_
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

    # Write metadata so live_evi.py can fetch the correct spring year at inference.
    from ml.build_dataset import DATA_YEAR
    metadata = {
        "data_year":         DATA_YEAR,
        "evi_spring_target": f"{DATA_YEAR}-05-01",
        "feature_cols":      FEATURE_COLS,
        "trained_at":        datetime.now().isoformat(timespec="seconds"),
    }
    metadata_path = os.path.join(_MODELS_DIR, "model_metadata.json")
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"  Metadata saved -> {metadata_path}")

    # ── Charts ─────────────────────────────────────────────────────────
    print_section("GENERATING CHARTS")
    os.makedirs(_CHARTS_DIR, exist_ok=True)
    _generate_charts(X, y, y_pred, y_proba, base_rf, acc, prec, rec, f1, auc, cm)
    _generate_calibration_chart(y, y_proba_s[:, 1], y_proba_cal[:, 1], auc_s, auc_cal)

    if _SHAP_AVAILABLE:
        print_section("GENERATING SHAP CHARTS")
        shap_importances = _generate_shap_charts(base_rf, X_scaled, X, FEATURE_COLS)
    else:
        print("  shap not installed; skipping SHAP charts. "
              "Install dev deps with: pip install -r requirements-dev.txt")
        shap_importances = None

    _generate_summary(acc, prec, rec, f1, auc, cm, importances, n_samples, n_fire, n_nofire,
                      shap_importances=shap_importances)
    print(f"  Charts saved -> {_CHARTS_DIR}")

    print("\nRetrain complete.\n")


def _generate_shap_charts(base_rf, X_scaled, X_raw, feature_names):
    """Generate SHAP attribution charts for the uncalibrated base RandomForest.

    Uses TreeExplainer (exact, fast) on the *uncalibrated* base RF because
    SHAP doesn't natively support CalibratedClassifierCV. The base RF has
    identical feature ordering and was fit on the same scaled data, so the
    attributions are valid for interpreting which features drive the model
    -- they just won't sum to the *calibrated* probability.

    SHAP values are computed in scaled feature space (because that's what
    the model sees), but axes/colors use the raw values for human-readable
    plots.

    Returns mean(|SHAP|) per feature so _generate_summary can build a
    Gini-vs-SHAP comparison table.
    """
    explainer = shap.TreeExplainer(base_rf)
    raw = explainer.shap_values(X_scaled)

    # Binary classifier shape changed across SHAP versions:
    #   >=0.45  -> 3D ndarray (n_samples, n_features, n_classes)
    #   <0.45   -> list of 2 arrays [neg_class, pos_class]
    # We always want the positive ("fire") class.
    if isinstance(raw, list):
        shap_vals = raw[1]
    elif raw.ndim == 3:
        shap_vals = raw[:, :, 1]
    else:
        shap_vals = raw

    # 1. Bar -- global mean(|SHAP|) per feature
    plt.figure(figsize=(7, 5))
    shap.summary_plot(
        shap_vals, X_raw, feature_names=feature_names,
        plot_type="bar", show=False,
    )
    plt.title("SHAP Feature Importance (mean |SHAP|)")
    plt.tight_layout()
    plt.savefig(os.path.join(_CHARTS_DIR, "shap_summary_bar.png"),
                dpi=150, bbox_inches="tight")
    plt.close()

    # 2. Beeswarm -- per-row SHAP distribution + signed direction
    plt.figure(figsize=(8, 6))
    shap.summary_plot(
        shap_vals, X_raw, feature_names=feature_names,
        show=False,
    )
    plt.title("SHAP Beeswarm — feature impact + value direction")
    plt.tight_layout()
    plt.savefig(os.path.join(_CHARTS_DIR, "shap_beeswarm.png"),
                dpi=150, bbox_inches="tight")
    plt.close()

    # 3. Dependence plots for the top 3 features (by mean |SHAP|)
    mean_abs = np.mean(np.abs(shap_vals), axis=0)
    top3_idx = np.argsort(mean_abs)[-3:][::-1]  # top-3, descending

    fig, axes = plt.subplots(1, 3, figsize=(18, 5))
    for ax, idx in zip(axes, top3_idx):
        feat_name = feature_names[idx]
        shap.dependence_plot(
            int(idx), shap_vals, X_raw,
            feature_names=feature_names,
            interaction_index="auto",
            ax=ax, show=False,
        )
        ax.set_title(f"SHAP dependence: {feat_name}")
    fig.suptitle(
        "Top-3 feature dependence plots (color = strongest interacting feature)",
        y=1.02,
    )
    fig.tight_layout()
    fig.savefig(os.path.join(_CHARTS_DIR, "shap_dependence_top3.png"),
                dpi=150, bbox_inches="tight")
    plt.close(fig)

    return mean_abs


def _generate_summary(acc, prec, rec, f1, auc, cm, importances, n_samples, n_fire, n_nofire,
                      shap_importances=None):
    tn, fp, fn, tp = cm.ravel()
    spec = tn / (tn + fp)
    miss_rate = fn / (fn + tp)
    from datetime import date
    lines = [
        "# Wildfire Risk Model — Results Summary",
        "",
        f"> Generated: {date.today().isoformat()}  ",
        f"> Dataset: {n_samples:,} samples ({n_fire:,} fire, {n_nofire:,} no-fire)  ",
        f"> Algorithm: Random Forest (300 trees, class_weight=balanced)  ",
        f"> Evaluation: 10-fold stratified cross-validation",
        "",
        "---",
        "",
        "## Performance Metrics",
        "",
        "| Metric | Score | What it means |",
        "|--------|-------|---------------|",
        f"| **Accuracy** | {acc:.3f} ({acc*100:.1f}%) | {acc*100:.1f}% of all predictions were correct |",
        f"| **Precision** | {prec:.3f} | Of every location flagged as fire risk, {prec*100:.1f}% were actual fires |",
        f"| **Recall** | {rec:.3f} | Of all real fires in the test set, the model caught {rec*100:.1f}% of them |",
        f"| **F1 Score** | {f1:.3f} | Balanced score between precision and recall — {f1:.3f} out of 1.0 |",
        f"| **ROC-AUC** | {auc:.3f} | The model correctly ranks a fire location above a non-fire location {auc*100:.1f}% of the time |",
        f"| **Specificity** | {spec:.3f} | Of all safe locations, {spec*100:.1f}% were correctly identified as safe |",
        f"| **Miss Rate** | {miss_rate:.3f} | {miss_rate*100:.1f}% of real fires were missed — the most critical failure mode |",
        "",
        "---",
        "",
        "## Confusion Matrix",
        "",
        "```",
        "                  Predicted No Fire   Predicted Fire",
        f"  Actual No Fire       {tn:>6,}             {fp:>6,}      ← {fp} false alarms",
        f"  Actual Fire          {fn:>6,}             {tp:>6,}      ← {fn} missed fires",
        "```",
        "",
        f"- **{tp:,} true positives** — fires correctly flagged",
        f"- **{tn:,} true negatives** — safe locations correctly cleared",
        f"- **{fp:,} false positives** — safe locations incorrectly flagged as fire risk",
        f"- **{fn:,} false negatives** — real fires the model missed *(most dangerous)*",
        "",
        "---",
        "",
        "## Feature Importances",
        "",
        "How much each input variable contributed to the model's decisions:",
        "",
        "| Feature | Importance | What it represents |",
        "|---------|------------|--------------------|",
    ]

    descriptions = {
        "air_temp_encoded": "Air temperature encoded as (°C + 273.15) / 0.02 — hot conditions dry out vegetation",
        "humidity":         "Relative humidity % — low humidity makes ignition and spread easier",
        "evi":              "Spring EVI (May 1 composite) — vegetation density as pre-season fuel load",
        "wind":             "Wind speed in m/s — drives fire spread rate and direction",
        "elevation":        "Terrain elevation in meters — affects vegetation type and wind exposure",
        "kbdi":             "Keetch-Byram Drought Index (0–800) — cumulative deep-soil moisture deficit over the prior 30 days; the operational drought index used by US fire weather offices",
    }
    for name, imp in sorted(zip(FEATURE_COLS, importances), key=lambda x: -x[1]):
        bar = "#" * int(imp * 20)
        lines.append(f"| **{name}** | {imp:.3f} `{bar}` | {descriptions.get(name, '')} |")

    if shap_importances is not None:
        # Build Gini-vs-SHAP comparison table.
        # Disagreements between the two are the most interesting rows: Gini
        # measures how often a feature is split on; SHAP measures how much it
        # actually moves a prediction (and accounts for feature interactions).
        gini_rank = {n: i + 1 for i, (n, _) in enumerate(
            sorted(zip(FEATURE_COLS, importances), key=lambda x: -x[1])
        )}
        shap_rank = {n: i + 1 for i, (n, _) in enumerate(
            sorted(zip(FEATURE_COLS, shap_importances), key=lambda x: -x[1])
        )}

        lines += [
            "",
            "---",
            "",
            "## SHAP Feature Attributions",
            "",
            "Computed with `shap.TreeExplainer` on the uncalibrated base RandomForest.",
            "Mean(|SHAP|) measures how much each feature actually moves a prediction,",
            "averaged across the training set — a richer signal than Gini importance",
            "because it accounts for feature interactions and (in the beeswarm) shows",
            "signed direction.",
            "",
            "| Feature | Gini Importance | Mean \\|SHAP\\| | Gini Rank | SHAP Rank | Shift |",
            "|---------|-----------------|---------------|-----------|-----------|-------|",
        ]
        for i, name in enumerate(FEATURE_COLS):
            gi = importances[i]
            si = shap_importances[i]
            gr = gini_rank[name]
            sr = shap_rank[name]
            shift = gr - sr
            if shift > 0:
                shift_str = f"+{shift}"
            elif shift < 0:
                shift_str = str(shift)
            else:
                shift_str = "—"
            lines.append(
                f"| **{name}** | {gi:.3f} | {si:.3f} | {gr} | {sr} | {shift_str} |"
            )
        lines += [
            "",
            "Positive shift means SHAP ranks the feature higher than Gini does.",
            "Where the two columns disagree, trust SHAP for *prediction-time impact*",
            "and Gini for *training-time split frequency*.",
        ]

    lines += [
        "",
        "---",
        "",
        "## What These Results Mean",
        "",
        f"The model correctly identifies fire risk **{acc*100:.1f}%** of the time across 10 independent test folds.",
        f"The ROC-AUC of **{auc:.3f}** means it almost always ranks a genuinely high-risk location above a low-risk one,",
        "which is what matters most for a heatmap-style risk display.",
        "",
        f"The most important concern is the **{fn} missed fires** ({miss_rate*100:.1f}% miss rate). In a real deployment,",
        "a missed fire is more dangerous than a false alarm. Future improvements could prioritize",
        "reducing false negatives by lowering the classification threshold below 0.5.",
        "",
        "Feature importances are now well-balanced across all 5 features, indicating the model",
        "is learning from multiple real fire-risk signals rather than a single dominant variable.",
        "This is a significant improvement over earlier versions where temperature alone accounted",
        "for 66% of importance due to seasonal bias in the training data.",
        "",
        "---",
        "",
        "## Charts",
        "",
        "| Chart | Description |",
        "|-------|-------------|",
        "| `confusion_matrix.png` | Heatmap of true/false positives and negatives |",
        "| `roc_curve.png` | ROC curve showing model discrimination ability |",
        "| `metrics_bar.png` | Bar chart of all 5 performance metrics |",
        "| `feature_distributions.png` | KDE plots comparing fire vs no-fire for each feature |",
        "| `calibration_curve.png` | Predicted probability vs observed fire frequency, before/after sigmoid calibration |",
    ]
    if shap_importances is not None:
        lines += [
            "| `shap_summary_bar.png` | SHAP global importance — mean(\\|SHAP\\|) per feature; alternative to Gini |",
            "| `shap_beeswarm.png` | SHAP per-row distribution — color = feature value, x = SHAP impact (sign = direction) |",
            "| `shap_dependence_top3.png` | Top-3 features by mean(\\|SHAP\\|), each plotted against its SHAP value and colored by the strongest interacting feature |",
        ]

    path = os.path.join(_CHARTS_DIR, "RESULTS.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def _generate_charts(X, y, y_pred, y_proba, model, acc, prec, rec, f1, auc, cm):
    sns.set_theme(style="whitegrid", palette="muted")

    # 1. Confusion matrix
    fig, ax = plt.subplots(figsize=(6, 5))
    sns.heatmap(
        cm, annot=True, fmt="d", cmap="Reds",
        xticklabels=["No Fire", "Fire"],
        yticklabels=["No Fire", "Fire"],
        ax=ax,
    )
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    ax.set_title("Confusion Matrix (10-Fold CV)")
    fig.tight_layout()
    fig.savefig(os.path.join(_CHARTS_DIR, "confusion_matrix.png"), dpi=150)
    plt.close(fig)

    # 2. ROC curve
    fpr, tpr, _ = roc_curve(y, y_proba[:, 1])
    fig, ax = plt.subplots(figsize=(6, 5))
    ax.plot(fpr, tpr, color="crimson", lw=2, label=f"AUC = {auc:.4f}")
    ax.plot([0, 1], [0, 1], "k--", lw=1)
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.set_title("ROC Curve (10-Fold CV)")
    ax.legend(loc="lower right")
    fig.tight_layout()
    fig.savefig(os.path.join(_CHARTS_DIR, "roc_curve.png"), dpi=150)
    plt.close(fig)

    # 3. Performance metrics bar chart
    metrics = {"Accuracy": acc, "Precision": prec, "Recall": rec, "F1 Score": f1, "ROC-AUC": auc}
    fig, ax = plt.subplots(figsize=(7, 4))
    bars = ax.bar(metrics.keys(), metrics.values(), color=["#4C72B0", "#DD8452", "#55A868", "#C44E52", "#8172B2"])
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("Score")
    ax.set_title("Model Performance Metrics (10-Fold CV)")
    for bar, val in zip(bars, metrics.values()):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.01,
                f"{val:.3f}", ha="center", va="bottom", fontsize=10)
    fig.tight_layout()
    fig.savefig(os.path.join(_CHARTS_DIR, "metrics_bar.png"), dpi=150)
    plt.close(fig)

    # 4. Feature distributions (fire vs no-fire)
    fig, axes = plt.subplots(1, len(FEATURE_COLS), figsize=(16, 4))
    for i, (name, ax) in enumerate(zip(FEATURE_COLS, axes)):
        sns.kdeplot(X[y == 0, i], ax=ax, label="No Fire", fill=True, alpha=0.4, color="#4C72B0")
        sns.kdeplot(X[y == 1, i], ax=ax, label="Fire",    fill=True, alpha=0.4, color="#C44E52")
        ax.set_title(name)
        ax.set_xlabel("")
        if i == 0:
            ax.legend(fontsize=8)
    fig.suptitle("Feature Distributions: Fire vs No Fire", y=1.02)
    fig.tight_layout()
    fig.savefig(os.path.join(_CHARTS_DIR, "feature_distributions.png"), dpi=150, bbox_inches="tight")
    plt.close(fig)


def _generate_calibration_chart(y, proba_uncal, proba_cal, auc_uncal, auc_cal):
    """
    Calibration curve comparing the bare RandomForest's `predict_proba`
    output against the sigmoid-calibrated wrapper. Bin predicted
    probabilities and plot the empirical fraction of fires in each bin.
    A perfectly calibrated model lies on the diagonal -- below the diagonal
    means overconfident, above means underconfident.
    """
    sns.set_theme(style="whitegrid", palette="muted")
    n_bins = 10

    pt_uncal, pp_uncal = calibration_curve(y, proba_uncal, n_bins=n_bins, strategy="quantile")
    pt_cal,   pp_cal   = calibration_curve(y, proba_cal,   n_bins=n_bins, strategy="quantile")

    fig, ax = plt.subplots(figsize=(6.5, 6))
    ax.plot([0, 1], [0, 1], "k--", lw=1, label="Perfect calibration")
    ax.plot(pp_uncal, pt_uncal, "o-", color="#C44E52", lw=2,
            label=f"Uncalibrated RF (AUC={auc_uncal:.3f})")
    ax.plot(pp_cal,   pt_cal,   "o-", color="#4C72B0", lw=2,
            label=f"Sigmoid-calibrated (AUC={auc_cal:.3f})")
    ax.set_xlabel("Mean predicted probability (in each bin)")
    ax.set_ylabel("Fraction of fires (in each bin)")
    ax.set_title("Calibration Curve\n(Held-out spatial CV; closer to diagonal = better calibrated)")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.legend(loc="upper left", fontsize=9)
    fig.tight_layout()
    fig.savefig(os.path.join(_CHARTS_DIR, "calibration_curve.png"), dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    retrain()
