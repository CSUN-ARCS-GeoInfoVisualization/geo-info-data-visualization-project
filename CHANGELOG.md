# Changelog

All notable changes to FireScope are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The authoritative working notes live in
[`docs/SESSION_HANDOFF.md`](docs/SESSION_HANDOFF.md).

## [3.2-stable] — 2026-06-19

### Added
- **Data-quality gate on every ingested row** (`routes/ml_ingest.py`): physical-range/sanity checks,
  a low-confidence FIRMS label filter, no-fire verification (reject points inside an active NIFC
  perimeter or near a fire in a 3-day window), a California-land mask on no-fire sampling, and
  **cross-source weather corroboration** (Open-Meteo vs MET Norway — drop grossly-disagreeing
  points). Rejected rows are quarantined to `training_data/quarantine.csv`.
- **Weekly data-quality monitors**: outlier rate (robust z) + distribution drift (PSI, recent vs
  earlier ingest) via `POST /api/internal/ml/data-health` (weekly digest with a random row sample);
  `POST /api/internal/ml/backtest` scores recent real fires against the live model (alerts on low
  recall); `POST /api/internal/ml/feature-audit` cross-validates cached elevation vs an independent
  DEM. Email alerts via `POST /api/internal/ml/alert` (feed-outage detection in the daily run too).
- **Weekly gated auto-promotion** (`.github/workflows/weekly-promote.yml`, Sunday night): retrains on
  the full rolling dataset and promotes only if the candidate clears the physics + AUROC/Brier gate;
  archives the previous model, deploys, and emails the owner (`POST /api/internal/ml/promotion-email`).
  Manual promotion any day before Sunday is preserved.
- About page (Settings → About): documented the model, scoring, live inputs, data-quality
  safeguards, and the weekly monitoring + auto-promotion.
- **Constant/dead-feature detector** (`ml/data_quality.constant_features`): flags any feature whose
  values are ≥95% identical in the recent window (a flatlined feature that, being in-range, evades
  the outlier monitor). Surfaced in the data-health report + email.

### Fixed
- **Dead wind feature**: `_features_for` read the wrong key (`wind` vs Open-Meteo's `wind_speed`), so
  wind was recorded as `0.0` on every ingested row. Now records real wind (ingest path only). A
  **wind sanity check** in `retrain_and_gate._load_dataset` also excludes the historical zero-wind
  rows (`wind <= 0`) from the training/evaluation union so they cannot degrade auto-promotion.
- **Navbar stacking**: header z-index is set inline (this build doesn't compile Tailwind arbitrary
  `z-[…]`), and `<main>` is isolated, so the sticky nav stays above all map overlays on every page.
- Removed stale "random forest" wording from current model descriptions, GitHub docs, and the
  website (the live model is the monotonic HistGradientBoosting + isotonic classifier; version
  history retains its original wording).

### Changed
- Shelters & Evacuation: surface CalOES shelter-in-place orders; "Show on map" buttons render only
  when there's something to show; directions live only on open-shelter cards (not evacuation zones).
- Ingest point-loop budget 55s → 35s for headroom (added perimeter load + wider FIRMS fetch +
  per-point cross-source call).

## [3.1-stable] — 2026-06-03

### Added
- **Monotonic risk model (promoted to production)** — `HistGradientBoostingClassifier` with
  monotonic constraints `[0,1,1,-1,0,1]` over `[evi, air_temp, wind, humidity, elevation, kbdi]`,
  isotonic-calibrated, behind a **PDP physical-direction gate** that rejects any candidate whose
  constrained features point the wrong way. Replaces the CalibratedRF that had learned backwards
  relationships (wind anti-correlated, humidity inverted, KBDI saturating, dead EVI slider).
- **Continuous daily retraining, entirely in GitHub** — dataset committed in-repo (zero DB
  cost-risk); `daily-retrain.yml` ingests FIRMS detections → appends → gated retrain → promote.
- **Per-user saved zone overrides** (researcher page) — `user_overrides` table, 24h TTL,
  "Save for 24 hours" button, reset this/all zones, 20-zone shared total cap across all 4 zone
  types, EVI slider fixed to 0–1.
- **Active-fire accuracy** — `/api/fire-perimeters` shows only real active fires (WF type, not out,
  <100% contained, current ≤14 days): 77 → 7. Enriched fire popups; active-fire totals on the
  dashboard and Shelters & Evac.

### Changed
- Evacuation header splits **orders vs warnings**; 7-day active-only filter drops stale/`**TEST**`
  zones; real cause surfaced via `NOTES`/`EDIT_DATE`. Shelters are OPEN-only with a 5-min refetch.

### Fixed
- **Cache durability** — root-caused a 13-day stale-feed freeze: `endpoint_cache.computed_at` froze
  at first insert. Timestamps now advance on every write; dirty transactions roll back before save;
  a force-recompute backstop logs any stale row.
- **Deploy reliability** — `restart-after-backend-deploy.yml` calls the Render restart API because a
  "live" deploy does not reliably restart gunicorn (old workers served stale code).
- **Typecheck gate** — added `frontend/tsconfig.json` + `scripts/typecheck-gate.cjs` to `npm run
  build`, blocking the undefined-reference crash class that white-screened the app post-login.

## [3.0-stable]

### Added
- **Fourth alert channel — wildfires in your county** — per-county bundled CAL FIRE incident alerts
  every 10 min, change-driven SHA-256 dedup, one-final-"fully contained" email then silence.
- **Universal one-click email unsubscribe** — RFC 8058 `List-Unsubscribe` native Gmail/Apple button,
  per-channel footer links, HMAC-token-authed public endpoint.
- **Breaking-news pipeline cleanup** — NWS title cleaning, per-user CA-county filter, two-pass
  cross-source dedupe, live CAL FIRE containment enrichment.

### Changed
- Fire-perimeter map auto-retires contained fires; high-risk alerts capped at 20 locations.
- Email shell hardened to be Gmail-bulletproof (table-based, hex colors, hosted PNG markers).

## [2.9-stable]

### Changed
- **Canonical NFDRS 5-tier risk model** — replaced the custom 9-tier scale with the standard National
  Fire Danger Rating System bands (Low / Moderate / High / Very High / Extreme), wired through a
  single source of truth across every polygon overlay and the email renderer.
### Added
- **Shelters & Evacuation page rebuild** — ref-based overlay (no flicker), OPEN-only shelters,
  independent shelter/zone/fire popups, status banners with fit-to-bounds.
- **Researcher shelter overlay** toggle; **county-match + pickable-fire + shelter-opened** alert
  improvements; evac cron moved to in-process cache reads (20–90 s → 0.5–5 s).

## [2.8-stable] — and earlier

- Four alert channels and the Resend email pipeline; 5-tier risk palette; map and history surfaces.
- **v2.7 / v2.6 model evolution** — moved from KNN/uncalibrated RF to a sigmoid-calibrated Random
  Forest over 6 features (adds **KBDI** drought index), real MODIS EVI via Google Earth Engine +
  USGS elevation, date-restratified negatives, spatial-block cross-validation, and SHAP attribution.
  Headline: 91.7% accuracy / ROC-AUC 0.964 on the spatial-CV regime.

See [`docs/SESSION_HANDOFF.md`](docs/SESSION_HANDOFF.md) for the full per-release detail.
