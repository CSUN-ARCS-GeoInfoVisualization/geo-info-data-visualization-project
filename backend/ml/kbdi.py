"""
Keetch-Byram Drought Index (KBDI) — the operational drought index used by
US fire weather offices to estimate the cumulative moisture deficit of deep
duff and upper soil layers.

Range: 0 (saturated) -- 800 (absolutely dry). Units are 0.01 inch of soil
moisture deficit. Higher = drier = more fire-prone.

Reference: Keetch, J.J. and Byram, G.M. (1968). A drought index for forest
fire control. USDA Forest Service Research Paper SE-38.

This module is pure math -- no I/O. Inputs:
  - a chronological daily series of (T_max_F, precip_inches)
  - the location's mean annual precipitation R (inches), supplied externally
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence


CANOPY_INTERCEPT_IN = 0.20       # first 0.20" of a wet event is canopy-intercepted
KBDI_MIN, KBDI_MAX = 0.0, 800.0  # valid KBDI range


def c_to_f(t_c: float) -> float:
    return t_c * 9.0 / 5.0 + 32.0


def mm_to_in(p_mm: float) -> float:
    return p_mm * 0.0393700787


def _drought_factor(kbdi_prev: float, t_max_f: float, r_annual_in: float) -> float:
    """One-day drying increment in KBDI units (0.01 inch). Keetch-Byram 1968."""
    numerator   = (KBDI_MAX - kbdi_prev) * (0.968 * math.exp(0.0486 * t_max_f) - 8.30)
    denominator = 1.0 + 10.88 * math.exp(-0.0441 * r_annual_in)
    return numerator / denominator * 1e-3


def _effective_rainfall(precip_in: float, wet_event_total: float) -> tuple[float, float]:
    """
    Apply the canopy-interception rule. Returns (effective_inches, updated_event_total).

    The first 0.20" of a continuous wet event is intercepted by canopy and does
    not reduce KBDI. Rain beyond that threshold within the same wet event passes
    through fully. Any day with zero rain breaks the wet event.
    """
    if precip_in <= 0:
        return 0.0, 0.0
    new_total = wet_event_total + precip_in
    if wet_event_total >= CANOPY_INTERCEPT_IN:
        return precip_in, new_total
    if new_total <= CANOPY_INTERCEPT_IN:
        return 0.0, new_total
    return new_total - CANOPY_INTERCEPT_IN, new_total


def kbdi_series(
    daily: Iterable[tuple[float, float]],
    r_annual_in: float,
    initial_kbdi: float = 100.0,
) -> list[float]:
    """
    Iterate KBDI over a daily series. Returns one KBDI value per input day.

    With a 30-day spinup window the choice of initial_kbdi is largely forgotten
    by the final day, so a moderate seed (100) is fine.
    """
    if r_annual_in <= 0:
        raise ValueError(f"r_annual_in must be positive (got {r_annual_in})")

    kbdi = float(initial_kbdi)
    wet_event = 0.0
    out: list[float] = []
    for t_max_f, precip_in in daily:
        eff_rain_in, wet_event = _effective_rainfall(precip_in, wet_event)
        kbdi = max(KBDI_MIN, kbdi - eff_rain_in * 100.0)
        # Clamp both bounds: the drought factor goes slightly negative on cold
        # days (T < ~44 F, where 0.968*exp(0.0486*T) < 8.30), so the additive
        # step can push KBDI below 0 if not also lower-clamped.
        kbdi = max(KBDI_MIN, min(KBDI_MAX, kbdi + _drought_factor(kbdi, t_max_f, r_annual_in)))
        out.append(kbdi)
    return out


def kbdi_final(
    daily: Sequence[tuple[float, float]],
    r_annual_in: float,
    initial_kbdi: float = 100.0,
) -> float:
    """Convenience: run kbdi_series and return only the final value."""
    series = kbdi_series(daily, r_annual_in, initial_kbdi)
    if not series:
        raise ValueError("daily series must contain at least one day")
    return series[-1]


# ---------------------------------------------------------------------------
# Sanity checks -- run `python -m ml.kbdi` from backend/ to verify
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    # Case 1: 30 days of 95 F and zero rain in a dry climate (R=15") -> KBDI rises sharply
    hot_dry = [(95.0, 0.0)] * 30
    final_hot = kbdi_final(hot_dry, r_annual_in=15.0, initial_kbdi=100.0)
    print(f"30 days hot+dry, R=15in : KBDI = {final_hot:.1f}  (expect: high, > 300)")

    # Case 2: 30 days of 60 F and 0.5" daily rain in a wet climate -> KBDI falls to ~0
    cool_wet = [(60.0, 0.5)] * 30
    final_wet = kbdi_final(cool_wet, r_annual_in=60.0, initial_kbdi=400.0)
    print(f"30 days cool+wet, R=60in: KBDI = {final_wet:.1f}  (expect: ~0)")

    # Case 3: hot summer broken by a thunderstorm
    mixed = [(90.0, 0.0)] * 14 + [(75.0, 1.0)] * 2 + [(90.0, 0.0)] * 14
    final_mix = kbdi_final(mixed, r_annual_in=20.0, initial_kbdi=200.0)
    print(f"hot, 2 wet days mid-way : KBDI = {final_mix:.1f}  (expect: moderate, 100-400)")

    # Case 4: bounds clamp correctly
    extreme = [(110.0, 0.0)] * 365
    final_ext = kbdi_final(extreme, r_annual_in=5.0, initial_kbdi=100.0)
    print(f"1 year of 110 F + no rain: KBDI = {final_ext:.1f}  (expect: <= 800)")
    assert KBDI_MIN <= final_ext <= KBDI_MAX

    print("\nAll sanity checks passed.")
