# ML Module

Pre-trained wildfire risk model integrated into the prediction API. No additional setup is required — the model files are bundled and load automatically on the first request.

## How it works

`inference.py` exposes a single function:

```python
predict_from_features(evi, lst, wind, elevation) -> dict
```

The prediction route (`routes/predict.py`) calls this with feature values looked up from the nearest hardcoded sample location in `data/sample_locations.py`.

## Model details

| Property | Value |
|---|---|
| File | `models/wildfire_model_predictive.pkl` |
| Horizon | 7-day fire risk prediction |
| Features | EVI, LST, wind speed, elevation |
| Output | Risk probability (0–1) + label (Low / Medium / High / Extreme) |

**Feature encoding:**
- `EVI` — Raw MODIS Enhanced Vegetation Index pixel value
- `LST` — Land surface temperature: `(T_celsius + 273.15) / 0.02`
- `Wind` — Wind speed in m/s
- `Elevation` — Average terrain elevation in meters

## Sample data

`data/sample_locations.py` contains 8 hardcoded California locations with pre-extracted feature values derived from the 2020 training dataset. When a prediction request comes in, the nearest location by (lat, lon) distance is selected and its features are fed to the model.

This is a placeholder until live satellite (EVI/elevation GeoTIFF) and weather (Open-Meteo) data sources are wired up.

## Files

```
ml/
├── inference.py        # predict_from_features() — loads model, scales features, returns score
└── models/
    ├── wildfire_model_predictive.pkl   # Trained classifier
    └── wildfire_scaler_predictive.pkl  # Fitted StandardScaler
```
