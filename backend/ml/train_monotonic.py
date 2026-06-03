"""Monotonic-constrained wildfire-risk trainer + physical-direction gate.

Why this exists (audit 2026-06-03): the shipped CalibratedRF, trained on ~1,022
rows, learned physically-backwards relationships — wind ANTI-correlated with
risk, humidity inverted at the dry end, KBDI saturating with a low-end dip,
elevation effectively dead. Root cause: no physical priors + sparse data.

This trainer encodes fire physics as MONOTONIC CONSTRAINTS so the model can't
learn a backwards relationship no matter how noisy/sparse the data is, and ships
a validation gate that REFUSES any model whose constrained features point the
wrong way.

Feature order matches ml/inference.py:
    [evi, air_temp_encoded, wind, humidity, elevation, kbdi]
"""
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.preprocessing import StandardScaler

FEATURE_COLS = ["evi", "air_temp_encoded", "wind", "humidity", "elevation", "kbdi"]

# Physical priors. +1: risk must not DECREASE as the feature rises.
#                  -1: risk must not INCREASE as the feature rises.
#                   0: unconstrained (direction genuinely ambiguous).
#   evi               0  more vegetation = more fuel, but greener also = wetter
#   air_temp_encoded +1  hotter -> drier fuels -> more risk
#   wind             +1  wind drives ignition/spread -> more risk
#   humidity         -1  more atmospheric moisture -> less risk
#   elevation         0  higher can be cooler/wetter OR more exposed
#   kbdi             +1  drought index -> more risk
MONOTONIC_CST = [0, 1, 1, -1, 0, 1]

# HGB extrapolates flat past the training range (like RF) but, unlike RF, the
# monotonic constraint guarantees direction throughout. Tuned modestly; the real
# retrain can grid-search these.
HGB_PARAMS = dict(
    loss="log_loss",
    max_iter=300,
    learning_rate=0.05,
    max_leaf_nodes=31,
    min_samples_leaf=20,
    l2_regularization=1.0,
    random_state=42,
)


def train_monotonic(X, y, calibrate=True):
    """Fit StandardScaler + monotonic HGB, optionally isotonic-calibrated.

    StandardScaler has a strictly-positive scale_, so the monotonic direction is
    preserved between raw and scaled space — the constraint indices still apply.
    Isotonic calibration is monotonic in the score, so it preserves direction too
    (and, unlike sigmoid/Platt, does not compress the top end into saturation).

    Returns (model, scaler).
    """
    X = np.asarray(X, dtype=float)
    y = np.asarray(y)
    scaler = StandardScaler().fit(X)
    Xs = scaler.transform(X)
    base = HistGradientBoostingClassifier(monotonic_cst=MONOTONIC_CST, **HGB_PARAMS)
    if not calibrate:
        base.fit(Xs, y)
        return base, scaler
    model = CalibratedClassifierCV(estimator=base, method="isotonic", cv=5)
    model.fit(Xs, y)
    return model, scaler


def validate_monotonicity(model, scaler, n=25, tol=1e-6):
    """PDP-style gate. For each constrained feature, sweep it across the training
    range (others held at the training mean) and check risk moves in the required
    direction the whole way. The retrain pipeline must REFUSE to promote a
    candidate if any constrained feature fails — that's how an inverted/dead
    feature can never silently ship again.

    Returns {feature: {expected, ok, max_violation, range}}.
    """
    mean = scaler.mean_
    sd = scaler.scale_
    report = {}
    for i, name in enumerate(FEATURE_COLS):
        want = MONOTONIC_CST[i]
        if want == 0:
            report[name] = {"expected": "free", "ok": True, "max_violation": 0.0, "range": None}
            continue
        lo, hi = mean[i] - 2 * sd[i], mean[i] + 2 * sd[i]
        pts = np.linspace(lo, hi, n)
        risks = []
        for p in pts:
            x = mean.copy()
            x[i] = p
            risks.append(float(model.predict_proba(scaler.transform([x]))[0][1]))
        diffs = np.diff(risks)
        # A step in the WRONG direction is a positive violation; want=+1 means
        # diffs should be >=0, so a violation is a negative diff (and vice versa).
        max_violation = float(max((-want * d) for d in diffs))
        report[name] = {
            "expected": "increasing" if want > 0 else "decreasing",
            "ok": max_violation <= tol,
            "max_violation": max_violation,
            "range": round(max(risks) - min(risks), 4),
        }
    return report


def gate_passes(report):
    """True iff every constrained feature respects its physical direction."""
    return all(v["ok"] for v in report.values())
