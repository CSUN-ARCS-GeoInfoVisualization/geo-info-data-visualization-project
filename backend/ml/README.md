# ML Module

Wildfire risk model integrated into the prediction API. The model loads once on the first request and is cached in memory for all subsequent calls.

## How it works

`inference.py` exposes a single function:

```python
predict_from_features(evi, air_temp_encoded, wind, humidity, elevation) -> dict
```

`air_temp_encoded` is air temperature in the legacy MODIS-LST encoding `(°C + 273.15) / 0.02`. The parameter name keeps the original training schema so old models keep loading; only the source changed (Open-Meteo air temperature instead of MODIS LST).

The prediction route (`routes/predict.py`) calls this with live data fetched per-request:

| Feature | Live source | Fallback |
|---|---|---|
| `evi` | NASA AppEEARS (spring composite, ~May 1) | nearest sample location |
| `lst` | Open-Meteo air temperature, encoded | nearest sample location |
| `wind` | Open-Meteo current wind speed | nearest sample location |
| `humidity` | Open-Meteo relative humidity | nearest sample location |
| `elevation` | Open-Elevation API | nearest sample location |

The nearest fallback location is selected using great-circle (haversine) distance, not Euclidean degrees.

## Model details

| Property | Value |
|---|---|
| Algorithm | Random Forest (300 trees, `class_weight=balanced`) |
| File | `models/wildfire_model_predictive.pkl` |
| Training data | 1,000 samples — 500 FIRMS fire detections, 500 generated no-fire points (California, 2020) |
| Evaluation | 10-fold stratified cross-validation |
| Accuracy | 89.5% |
| ROC-AUC | 0.953 |
| Features | EVI, air-temp-encoded, wind speed, humidity, elevation |
| Output | Risk probability (0–1) + label (Low / Medium / High / Extreme) — thresholds at 0.25 / 0.50 / 0.75 |

Schema and training metadata are recorded in `models/model_metadata.json`.

## Feature encoding

| Feature | Encoding | Notes |
|---|---|---|
| `evi` | Scaled float (0–1) | Spring EVI composite (May 1 target); MODIS scale factor 0.0001 applied |
| `air_temp_encoded` | `(T_celsius + 273.15) / 0.02` | Air temperature from Open-Meteo — **not** MODIS Land Surface Temperature; the encoding is retained for model compatibility |
| `wind` | m/s (float) | Open-Meteo 10m wind speed |
| `humidity` | % (0–100) | Open-Meteo relative humidity at 2m |
| `elevation` | meters (float) | Open-Elevation terrain height |

## Training pipeline

`build_dataset.py` builds the training CSV from scratch:

1. **Fire points** — fetched from NASA FIRMS area API (MODIS_SP, California bounding box, 2020)
2. **No-fire points** — randomly sampled within California, at least 50 km from any fire detection (haversine), assigned random 2020 dates to avoid seasonal bias
3. **EVI** — fetched via NASA AppEEARS batch API; spring composite (closest to May 1) used as pre-season fuel load indicator; task ID saved to `.appeears_task_id` to allow resume on network failure
4. **Weather** — historical Open-Meteo data per point (wind, temperature, humidity); 4-attempt retry with backoff
5. **Elevation** — Open-Elevation per point

`retrain.py` trains the Random Forest, evaluates with stratified k-fold CV, and writes the model + scaler + `model_metadata.json` into `models/`.

## Files

```
ml/
├── inference.py          # predict_from_features() — loads model, scales features, returns score
├── build_dataset.py      # Full training data pipeline (FIRMS + AppEEARS + Open-Meteo)
├── retrain.py            # Model training, evaluation, metadata generation
└── models/
    ├── wildfire_model_predictive.pkl    # Trained RandomForest classifier
    ├── wildfire_scaler_predictive.pkl   # Fitted StandardScaler
    └── model_metadata.json              # Feature columns, training date, data year
```
