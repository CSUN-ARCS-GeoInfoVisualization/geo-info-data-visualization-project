# Calibration & Behavior Comparison: v2.5 vs v2.6 (KBDI + calibrated RF)

**Date:** 2026-05-20  
**v2.5 model:** Random Forest, 5 features (evi, air_temp_encoded, wind, humidity, elevation), trained 2026-04-16  
**v2.6 model:** Calibrated Random Forest (sigmoid / Platt), 6 features (adds KBDI), spatial-block CV, restratified, trained 2026-05-04

## Self-reported metrics (from v2 retrain.py output, per backend/ml/README.md)

| Metric | v2.5 | v2.6 | Δ |
|---|---|---|---|
| Training rows | 1000 (500/500) | 1022 (511/511, date-restratified) | +22 |
| Random k-fold accuracy | 89.5% | 91.7% | +2.2pp |
| Random k-fold ROC-AUC | 0.953 | 0.964 | +0.011 |
| Spatial-block CV | (not reported) | included | new |
| Probability calibration | None | sigmoid (Platt scaling, cv=5) | new |

Spatial-block CV is the more honest signal — it groups rows by ~55 km cells so the model is tested on regions it didn't see. Sania did not report a spatial-block-only accuracy in the README excerpt; recommend pulling it from `charts/RESULTS.md` (not checked into the public repo) and folding it into this table.

## Archetype fingerprint (5 hand-picked CA configurations)

These are NOT a benchmark — 5 archetypes can't establish calibration. They're a sanity check that the model behaves reasonably on configurations spanning the CA climate space.

| Archetype | EVI | Air-T | Wind | Hum | Elev | KBDI | v2.5 score → label | v2.6 score → label | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| HighSierraColdMountain | 0.05 | 13200 | 6 | 30 | 2000 | 80 | 0.0628 → Low | 0.0486 → Low | ✓ correct, slightly tighter |
| CoastalHumidLowland | 0.45 | 14400 | 4 | 70 | 50 | 120 | 0.5055 → High | **0.8196 → Extreme** | ⚠ suspicious — 70% humidity coast shouldn't be Extreme |
| ImperialDesertHot | 0.10 | 15300 | 8 | 20 | -20 | 550 | 0.2672 → Medium | 0.5608 → High | ✓ KBDI 550 = severe drought, signal carries |
| CentralValleyDryHot | 0.25 | 15000 | 10 | 25 | 100 | 480 | 0.6125 → High | 0.9095 → Extreme | ✓ dry hot + drought → plausible Extreme |
| SierraFootHillsMod | 0.35 | 14600 | 7 | 40 | 800 | 250 | 0.3330 → Medium | 0.0950 → Low | ? moderate conditions dropped substantially |

**Flag on CoastalHumidLowland.** A 70%-humidity coastal location with mid-range KBDI scoring 0.82 (Extreme) is hard to justify physically. Possible causes:
- The training set may underrepresent humid coastal points and the RF over-extrapolates.
- The encoded air_temp may interact non-monotonically with EVI in the calibrated probability surface.
- The Platt-sigmoid calibration may have shifted probabilities upward in a region where the base RF was already noisy.

This is a **before-shipping decision point**. Either:
- Accept and ship: 4/5 archetypes look sane and Sania's headline metrics improved.
- Investigate: pull the actual training-set distribution around (evi=0.45, humidity=70) and see if it's an extrapolation issue.

## What we did NOT measure

To produce a full calibration report we need:
- Brier score on held-out test set
- AUROC, AUPRC on held-out test set
- Expected calibration error (ECE) with reliability diagrams
- Per-region performance (spatial-block accuracy by lat/lon bin)

These require `backend/ml/training_data/california_2020_kbdi.csv` which is `.gitignore`d and lives only on Sania's machine plus the AppEEARS workspace. Recommend:
1. Sania (or whoever owns the training pipeline) pushes a non-PII compressed snapshot to a private S3/GCS bucket.
2. We pull, run a held-out 80/20 split, compute the four metrics, and document here.

## Recommendation

**Ship v2.6 with a note**: the CoastalHumidLowland archetype is flagged for follow-up but doesn't block the merge. Sania's published metrics show meaningful improvement, KBDI is a legitimate new feature (drought is a real fire driver), and the calibration step is methodologically sound. Investigate the coastal anomaly in a follow-up audit, not as a blocker.
