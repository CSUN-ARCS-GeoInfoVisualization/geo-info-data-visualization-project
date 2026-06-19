# ML Module

Wildfire risk model integrated into the prediction API. The model loads once on the first request and is cached in memory for all subsequent calls.

## How it works

`inference.py` exposes a single function:

```python
predict_from_features(evi, air_temp_encoded, wind, humidity, elevation, kbdi) -> dict
```

The prediction route (`routes/predict.py`) calls this with live data fetched per-request:

| Feature | Live source | Fallback |
|---|---|---|
| `evi` | NASA AppEEARS (spring composite, ~May 1) | nearest sample location |
| `air_temp_encoded` | Open-Meteo air temperature, encoded | nearest sample location |
| `wind` | Open-Meteo current wind speed | nearest sample location |
| `humidity` | Open-Meteo relative humidity | nearest sample location |
| `elevation` | Open-Elevation API | nearest sample location |
| `kbdi` | NASA POWER 30-day window via `data/live_kbdi.py` | 200.0 (mid-range) |

The nearest fallback location is selected using great-circle (haversine) distance, not Euclidean degrees.

## Model details

| Property | Value |
|---|---|
| Algorithm | Monotonicity-constrained `HistGradientBoostingClassifier`, isotonic-calibrated |
| Trainer | `train_monotonic.py` (model) + `retrain_and_gate.py` (gated promotion) |
| File | `models/wildfire_model_predictive.pkl` |
| Training data | Rolling: `training_data/california_2020_kbdi.csv` base + `training_data/california_daily.csv` (grown daily by the FIRMS ingest cron), de-duped |
| Evaluation | 80/20 stratified held-out split; promotion gated on physics (monotonicity) + AUROC/Brier non-regression |
| Metrics | See `models/RETRAIN_LOG.md` and `models/model_metadata.json` (last promotion 2026-06-03: held-out AUROC ≈ 0.888) |
| Features | EVI, air temperature (encoded), wind speed, humidity, elevation, KBDI |
| Output | Risk probability (0–1) + 5-tier NFDRS label (Low / Moderate / High / Very High / Extreme) |

The model is trained with **monotonic constraints** (`monotonic_cst=[0,1,1,-1,0,1]` for EVI, air temp, wind, humidity, elevation, KBDI) so risk can only rise with temperature, wind, and drought and fall with humidity — it can never learn a physically-backwards relationship. It is then wrapped in `CalibratedClassifierCV` with **isotonic** regression (`cv=5`) so `predict_proba` returns calibrated probabilities; the 5-tier thresholds in `inference.py` correspond to empirical fire frequencies rather than raw scores.

**Promotion gate.** Before any retrained candidate replaces the live model it must pass two checks (`retrain_and_gate.py`): (1) a hard PDP physical-direction check (`validate_monotonicity` sweeps each constrained feature across its range and requires it to move the correct direction), then (2) held-out AUROC and Brier must not regress versus the current model. A model that fails physics is never shipped, even if its raw accuracy looks higher.

## Feature encoding

| Feature | Encoding | Notes |
|---|---|---|
| `evi` | Scaled float (0–1) | Spring EVI composite (May 1 target); MODIS scale factor 0.0001 applied |
| `air_temp_encoded` | `(T_celsius + 273.15) / 0.02` | Air temperature from Open-Meteo |
| `wind` | m/s (float) | Open-Meteo 10m wind speed |
| `humidity` | % (0–100) | Open-Meteo relative humidity at 2m |
| `elevation` | meters (float) | Open-Elevation terrain height |
| `kbdi` | Float (0–800) | Keetch–Byram Drought Index — cumulative deep-soil moisture deficit over the prior 30 days, in units of 0.01 inch |

## Training pipeline

`build_dataset.py` builds the base training CSV from scratch:

1. **Fire points** — fetched from NASA FIRMS area API (MODIS_SP, California bounding box, 2020)
2. **No-fire points** — randomly sampled within California, at least 50 km from any fire detection (haversine), assigned random 2020 dates to avoid seasonal bias
3. **EVI** — fetched via NASA AppEEARS batch API; spring composite (closest to May 1) used as pre-season fuel load indicator; task ID saved to `.appeears_task_id` to allow resume on network failure
4. **Weather** — historical Open-Meteo data per point (wind, temperature, humidity); 4-attempt retry with backoff
5. **Elevation** — Open-Elevation per point

`enrich_kbdi.py` adds the KBDI column:

6. **R climatology** — `build_r_cache.py` precomputes per-cell mean annual precipitation from NASA POWER and saves it to `r_cache.json`
7. **KBDI** — for each row, fetch the 30-day daily weather window preceding `acq_date` from NASA POWER, look up R from the cache, then run `kbdi.py` (pure-math implementation of Keetch–Byram 1968) to compute the index. Resume-safe — already-enriched rows are skipped on re-run.

`restratify_dates.py` rebalances the no-fire date distribution so the model can't trivially learn "summer = fire."

`retrain.py` trains the calibrated Random Forest, runs both random and spatial CV, saves model + scaler, and auto-generates charts and `charts/RESULTS.md`.

## Files

```
ml/
├── inference.py          # predict_from_features() — loads model, scales features, returns score
├── build_dataset.py      # Base training pipeline (FIRMS + AppEEARS + Open-Meteo + Open-Elevation)
├── kbdi.py               # Pure-math Keetch–Byram Drought Index (Keetch & Byram 1968)
├── build_r_cache.py      # Precompute per-cell mean annual precipitation from NASA POWER
├── enrich_kbdi.py        # Add KBDI column to the training CSV using r_cache + POWER 30-day windows
├── restratify_dates.py   # Rebalance no-fire date distribution to remove seasonal bias
├── retrain.py            # Calibrated RF training, random + spatial CV, chart + summary generation
├── charts/
│   ├── RESULTS.md             # Auto-generated metrics summary
│   ├── confusion_matrix.png
│   ├── roc_curve.png
│   ├── metrics_bar.png
│   ├── feature_distributions.png
│   └── calibration_curve.png  # Predicted vs observed fire frequency, before/after sigmoid calibration
└── models/
    ├── wildfire_model_predictive.pkl    # Current live model: monotonic HGB + isotonic calibration
    ├── wildfire_scaler_predictive.pkl   # Fitted StandardScaler
    └── model_metadata.json              # Feature column order + train timestamp
```
