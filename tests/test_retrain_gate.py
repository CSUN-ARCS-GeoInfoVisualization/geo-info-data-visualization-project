"""Gate-decision logic tests (pure, no model/data needed).

The decision function is the load-bearing policy: physics is a hard gate; metric
regression only blocks promotion when the current production model is itself
physically sound.
"""
import sys
import os

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))

from ml.retrain_and_gate import decide  # noqa: E402

GOOD = {"auroc": 0.90, "brier": 0.12}
GREAT = {"auroc": 0.97, "brier": 0.05}


def test_physics_failure_blocks_even_if_more_accurate():
    promote, reasons = decide(GREAT, False, ["wind", "humidity"], GOOD, True)
    assert promote is False and "FAILS physics" in reasons[0]


def test_first_model_promotes_when_physics_ok():
    promote, reasons = decide(GOOD, True, [], None, None)
    assert promote is True and "no production model" in reasons[0]


def test_promotes_over_physically_broken_production_despite_lower_accuracy():
    # candidate physics-ok but LOWER accuracy; production physics-broken -> promote
    promote, reasons = decide(GOOD, True, [], GREAT, False)
    assert promote is True and "FAILS physics" in reasons[0]


def test_blocks_accuracy_regression_when_production_is_sound():
    # both physics-ok; candidate AUROC regresses beyond tolerance -> reject
    promote, reasons = decide({"auroc": 0.90, "brier": 0.06}, True, [], {"auroc": 0.96, "brier": 0.05}, True)
    assert promote is False and any("AUROC regressed" in r for r in reasons)


def test_promotes_improvement_when_production_is_sound():
    promote, reasons = decide({"auroc": 0.97, "brier": 0.05}, True, [], {"auroc": 0.96, "brier": 0.05}, True)
    assert promote is True and "clears physics + metric gate" in reasons[-1]


def test_within_tolerance_promotes():
    # tiny regression within AUROC_TOL/BRIER_TOL is allowed
    promote, _ = decide({"auroc": 0.957, "brier": 0.053}, True, [], {"auroc": 0.96, "brier": 0.05}, True)
    assert promote is True


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print(f"PASS {name}")
    print("ALL PASSED")
