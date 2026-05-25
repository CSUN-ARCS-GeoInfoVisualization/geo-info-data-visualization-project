# FireScope — Session Handoff

**Stable tag:** `v2.8-stable` (commit `f7fa324`, 2026-05-25)
**Live URL:** https://firescope.dev (custom domain, HTTPS) · https://firescope.netlify.app
**API:** https://firescope-api.onrender.com/api
**GitHub Release:** https://github.com/CSUN-ARCS-GeoInfoVisualization/geo-info-data-visualization-project/releases/tag/v2.8-stable

This document is the single source of truth for picking up FireScope work in a fresh session. Read this first, then `README.md`, then jump in.

---

## What v2.8-stable adds (on top of v2.7)

### Custom domain + production email pipeline

1. **`firescope.dev`** purchased on Porkbun, DNS pointed at Netlify (`ALIAS @ → apex-loadbalancer.netlify.com`, `CNAME www → firescope.netlify.app`). Both apex and `www` serve HTTPS via Let's Encrypt; `www` 301s to apex.
2. **Resend on the domain** — `alerts@firescope.dev` verified with DKIM TXT + SPF TXT + SPF MX records in Porkbun DNS. Render env now carries `RESEND_API_KEY`, `SENDER_EMAIL`, `SENDER_NAME`, `EMAIL_PROVIDER=resend`.
3. **`flask db upgrade` on every deploy** — Render's `preDeployCommand` runs it before traffic shifts. A `backend/__init__.py` sys-path shim makes `from models import db` resolve both when the gunicorn `startCommand` runs from `backend/` (uses `rootDir`) and when `flask db upgrade` runs from project root during preDeploy (where `rootDir` is ignored). Failed migrations roll the deploy back automatically.

### Alerts system — three pipelines end-to-end

| Channel | Endpoint | GHA cron | Cadence | Per-event behavior |
|---|---|---|---|---|
| **High Risk Zone** | `POST /api/internal/alerts/high-risk` | `alerts-high-risk.yml` | `*/30 * * * *` | Email when any of the user's saved locations crosses tier 0.70 (High) across any of the 4 zone types. Body lists county / ZIP / neighborhood / census tract risk per location. |
| **Breaking Fire News** | `POST /api/internal/alerts/breaking-news` | `alerts-breaking-news.yml` | `0 * * * *` | Up to 8 newest `is_breaking=true` articles since the user's last news send. Source: `news_articles` table (NWS Red Flag Warnings + GNews feed). |
| **Evacuation** | `POST /api/internal/alerts/evacuation` | `alerts-evacuation.yml` | `*/10 * * * *` | Ray-casting PIP of each saved location against CalOES active zones. One email per (user × zone). Body: zone name, county, `CRITICAL_INFO`, `PUBLIC_INFO`, plus the 3 nearest **open** shelters by haversine. Red banner for ORDER, amber for WARNING. |

Auth on all three: `X-Internal-Token` header compared against the `INTERNAL_CRON_TOKEN` env var (stored both on Render and as a GitHub Actions repo secret). Endpoints `401` on missing/wrong token.

**Dedup model.** `alert_activity.state_signature` is a SHA-256 hash of the alert state. The cron skips re-sending only when the signature is unchanged:

- High-risk: `(tier_bucket, sorted_at_risk_location_ids)` — a tier jump or a new at-risk location both produce a fresh hash and re-fire.
- Breaking news: sorted article IDs in the current batch — no new article = no email.
- Evacuation: `evac:{ZONE_ID}` — each new active zone triggers exactly one email per affected user, never repeats for the same zone.

**Perf short-circuit on quiet days.** When CalOES has zero active zones the evac cron returns immediately without scanning users or fetching the 8014-row shelters payload — drops the response from ~20 s to ~200 ms.

### Single source of truth for risk numbers

The map's cached zone-risk data (`/api/research/risk-by-county` + `/api/research/risk-by-zone/<type>`) is now the canonical risk for every surface on the site:

4. **`backend/data/zone_resolver.py`** — pure-Python ray-casting PIP against the boundary GeoJSON files; resolves (lat, lon) → county / ZIP / neighborhood / census tract. CA county polygons come from `backend/data/boundaries/counties.json` (TIGER-derived, 416 KB).
5. **`backend/routes/research.get_cached_zone_risk(zone_type, zone_id)`** — internal lookup that hits the same `_zone_risk_cache` chain the public endpoints serve from. Memory → Postgres → fresh compute fallback. Microseconds on hit.
6. **`GET /api/me/locations/<id>/risk-by-all-zones`** — for a saved location, returns the cached risk for all four zone types in one shot. Lazily resolves and persists the four zone IDs onto `user_locations` (`county_fips`, `zip_code`, `neighborhood_id`, `census_tract_id`).
7. **`GET /api/me/locations?include=risk`** — inlines the four-zone risk on every row, **eliminating the dashboard's risk-fetch waterfall** (badge + 'My Locations' widget + 7-day chart now render with the locations list, ~3× faster than the pre-1B parallel-per-location fetch).

### Frontend — alerts UI + zone-aware risk display

8. **`notification-settings.tsx` full rewrite** — strips the localStorage shim, slider, blackout / pause-until / phone fields. Down from 548 → 280 lines. Master switch + three channel toggles + contact-email override, wired to `GET/PUT /api/me/notifications`. The High Risk toggle is gated by saved-location count: enabling it with zero locations pops a Dialog with a clickable "location" link that switches the settings tab to Locations.
9. **`my-locations.tsx`** — zone-aware risk display. Pill selector (Counties / ZIP / Neighborhood / Census Tract) drives which zone's risk shows on every card; defaults to county.
10. **Dashboard widgets follow the map's zone selector.** Lifted `GoogleRiskMap`'s zone dropdown to Dashboard state — changing it now also re-renders the "Current Risk Level" badge, the "My Locations" sidebar widget, and the 7-Day Forecast baseline against whichever zone you picked. Contextual notes appear when you go off Counties (grey note for saved-location users, amber note for default-LA users since we can't resolve ZIP/neighborhood/tract without a saved point).
11. **`saved-locations-widget.tsx` + `risk-chart.tsx` + dashboard badge** all moved off `/predict` / `/predict/batch` and onto the cached zone data — the badges, the sidebar list, the chart's day-0 baseline, the side panel on the Locations page, and the alert email body all show **bit-identical numbers** for the same zone.

### Hygiene

12. **680 lines of orphan dead code removed.** `FirePerimetersLayer.tsx`, `map-placeholder.tsx`, `settings-panel.tsx`, `PredictionPanel.tsx`, `ui/PredictionConditionCard.tsx` — verified via grep + GitNexus audit (including dynamic imports). Build still green.

### Files touched in v2.8

```
README.md
docs/SESSION_HANDOFF.md            (this file)
render.yaml                        (preDeployCommand)
backend/__init__.py                (sys.path shim)
backend/models.py                  (NotificationPreference channel toggles, UserLocation zone IDs, AlertActivity.state_signature)
backend/data/zone_resolver.py      (NEW — pure-Python PIP)
backend/data/boundaries/counties.json  (NEW — CA county polygons)
backend/routes/research.py         (get_cached_zone_risk)
backend/routes/locations.py        (/risk-by-all-zones + ?include=risk)
backend/routes/notifications.py    (channel toggles in serialize/parse, opted_in handler)
backend/routes/internal_alerts.py  (NEW — the cron-triggered dispatcher for all 3 channels)
frontend/src/services/AuthService.ts  (NotificationPreference shape)
frontend/src/components/notification-settings.tsx  (full rewrite)
frontend/src/components/my-locations.tsx           (zone-aware)
frontend/src/components/saved-locations-widget.tsx (cached lookup, inlined risk)
frontend/src/components/risk-chart.tsx             (cached baseline, follows zoneKey)
frontend/src/components/GoogleRiskMap.tsx          (controlled zoneLevel)
frontend/src/components/dashboard.tsx              (lifted zone state, contextual notes)
.github/workflows/alerts-high-risk.yml      (NEW — every 30 min)
.github/workflows/alerts-breaking-news.yml  (NEW — hourly)
.github/workflows/alerts-evacuation.yml     (NEW — every 10 min)
migrations/versions/b9c0d1e2f3a4_alert_channels_and_location_zone_ids.py  (NEW)
migrations/versions/c0d1e2f3a4b5_alert_state_signature.py                 (NEW)
scripts/predeploy.sh                (helper for Render preDeploy)
```

### Runbook — DO NOT manually clear zone_risk_cache

**Forbidden:** `DELETE FROM zone_risk_cache;` or any psql/SQLA invalidation of those four rows. It causes a thundering-herd recompute storm that exhausts the SQLAlchemy pool and looks like a full outage from the user side (`/health` and `/login` block behind 30-second pool timeouts while gunicorn workers wait for free connections).

**Allowed instead:**

```bash
bash scripts/refresh-zone-cache.sh
```

That script hits each `/risk-by-*` endpoint sequentially (not in parallel), waits for each compute to finish before triggering the next, and bails on the first failure. Once it finishes the cache is warm; user requests serve from it instantly.

If you really need to drop the cached payloads (schema change, label scheme change), run the refresh script **first** so the new compute is already running, then invalidate — that way no user ever sees a cold-cache request.

The DB pool was bumped to `pool_size=20, max_overflow=30, pool_pre_ping=True, pool_recycle=300` in `backend/config.py` so a single cold zone won't starve everyone, but the script discipline is the durable fix — don't rely on the pool ceiling alone.

### Verify the v2.8 alerts stack is healthy

```bash
# 1. Domain + SSL
curl -sI https://firescope.dev | head -1
# → HTTP/2 200

# 2. Resend domain verified
# Visit https://resend.com/domains — firescope.dev should be green.

# 3. Cron endpoints respond (replace TOKEN with the INTERNAL_CRON_TOKEN secret)
for path in high-risk breaking-news evacuation; do
  curl -s -X POST "https://firescope-api.onrender.com/api/internal/alerts/$path" \
    -H "X-Internal-Token: $TOKEN" \
    -w "$path  HTTP=%{http_code}  %{time_total}s\n" -o /dev/null
done

# 4. GHA workflows scheduled + last runs
for wf in alerts-high-risk.yml alerts-breaking-news.yml alerts-evacuation.yml; do
  echo "--- $wf ---"
  gh run list --workflow=$wf --limit 2
done

# 5. Risk numbers consistent across map ↔ side panel ↔ alert email
curl -s https://firescope-api.onrender.com/api/research/risk-by-county \
  | python3 -c "import json,sys; d=json.load(sys.stdin)['counties']; print('LA:', d['Los Angeles']['risk_score'], d['Los Angeles']['label'])"
# Saved-location lookup for the same county should produce the same risk_score:
# curl -H "Authorization: Bearer $JWT" \
#   https://firescope-api.onrender.com/api/me/locations/<id>/risk-by-all-zones | jq '.county'
```

---

## What v2.7-stable adds (on top of v2.6)

### Site-wide performance overhaul

The single largest perf work in the project's history. After v2.7 every zone-risk endpoint returns in < 1 s, and 11 of 16 public endpoints clear 500 ms.

1. **Universal `endpoint_cache`** — DB-backed (Postgres) 3-tier cache (memory → Postgres → live), single-flight compute, ETag/304, and pre-compressed **Brotli** bodies. Survives Render redeploys, so a cold container still serves cached payloads at the first request instead of recomputing the 60–150 s zone-risk pipeline. Applied to 7 public endpoints (`fire-perimeters`, `evacuation-zones`, `shelters`, `calfire/incidents`, `news`, history endpoints, and the 4 zone-risk endpoints via the older `_zone_risk_cache` integration).
2. **Permanently warmed historical data** — `backfill-history.yml` is a one-time `workflow_dispatch` action that hydrates every year of `history/perimeters` and `history/dins` into `endpoint_cache`. The daily cron no longer wastes upstream quota re-warming immutable historical years (only fire-perimeters / evacuation-zones / shelters / news now get daily re-warmed).
3. **Single-flight compute** — concurrent requests for the same zone now share one computation instead of stampeding the slow path.
4. **Self-healing legacy cache entries** — `_serve_from_entry` detects the older `{data, expires}` cache format and rebuilds the new `body/etag` form in place (was 500ing on `KeyError: 'body'` for any cache row written before the format migration).
5. **Weak ETag matching** — survives Cloudflare/Render edge rewriting strong→weak with the `:br` suffix, so 304s actually fire instead of devolving to full 200s.
6. **orjson + per-endpoint `Cache-Control`** — large GeoJSON payloads serialize 2-3× faster.

### Frontend polish

7. **Air temperature in Fahrenheit** across all zone popups (Dashboard map, Risk Map, Research page sliders). The model still takes Kelvin internally; the UI converts at the display boundary.
8. **NaN fix in zone popups** (`.lst → .air_temp_encoded`) plus the v2.6 humidity and KBDI rows surface in the popup with correct labels.
9. **Zone-overlay flicker eliminated** — overlay create/update split + ref-stable click handlers on the Dashboard map.

### Operations

10. **GHA daily pre-warm cron** (`daily-prewarm.yml`, `0 6 * * *` UTC) hits the 4 zone endpoints + tile caches every morning so the first user after the Render cache rolls always gets the warm path.
11. **CI auto-sync** of `main → domain-deployment` runs on every push to main (`sync-domain-deployment.yml`). Never force-push to `domain-deployment` manually.
12. **`render.yaml` gunicorn timeout** bumped to 90 s so cold zone recomputes can complete (subsequent requests are served from cache).
13. **`data_quality` flag** on every zone payload + frontend "approx" badge when IDW fallbacks are in play.

### Files touched in v2.7

```
README.md
docs/SESSION_HANDOFF.md           (this file)
backend/models.py                  (endpoint_cache, feature_cache_kbdi tables)
backend/routes/research.py         (universal cache integration, single-flight, ETag)
backend/routes/predict.py          (calfire/incidents, fire-perimeters cache)
backend/routes/history.py          (one-shot backfill route, dins cache-key fix)
backend/routes/shelters.py         (10min DB / 5min memory freshness)
backend/routes/news.py             (endpoint_cache)
backend/ml/inference.py            (6-arg signature)
frontend/src/components/risk-map.tsx, GoogleRiskMap.tsx, research-page.tsx
frontend/src/components/dashboard.tsx
.github/workflows/daily-prewarm.yml, backfill-history.yml
migrations/versions/...endpoint_cache, feature_cache_kbdi
render.yaml
```

### Verify the v2.7 stack is healthy

```bash
# Health
curl -s https://firescope-api.onrender.com/health
# → {"status":"ok"}

# All 4 zone endpoints — should each return 200 in <1s when cache is warm
for path in "research/risk-by-county" "research/risk-by-zone/zip-codes" \
            "research/risk-by-zone/neighborhoods" "research/risk-by-zone/census-tracts"; do
  curl -s -o /dev/null -w "$path  HTTP=%{http_code}  %{time_total}s\n" \
       --max-time 30 "https://firescope-api.onrender.com/api/$path"
done

# DINS with year (was the cache-key-too-long endpoint pre-v2.7)
curl -s -o /dev/null -w "dins  HTTP=%{http_code}  size=%{size_download}B  %{time_total}s\n" \
     "https://firescope-api.onrender.com/api/history/dins?year=2024"

# Daily cron last run
gh run list --workflow=daily-prewarm.yml --limit 3
```

---

## Predecessor releases

| Tag | Date | Headline |
|---|---|---|
| **v2.8-stable** | 2026-05-25 | Full alerts system (3 channels) + custom domain `firescope.dev` + Resend email + cached-zone single source of truth across map / badge / widget / email (this section) |
| **v2.7-stable** | 2026-05-21 | Site-wide perf overhaul — 16 endpoints under 1 s, 11 under 500 ms |
| **v2.6-v2-merged** | 2026-05-20 | Sania's calibrated KBDI random forest + KBDI slider + SHAP attribution charts + spatial-block CV |
| **v2.5-inputs-only** | 2026-05-20 | Real EVI (GEE) + real elevation (USGS 3DEP) + per-tile DB cache + IDW safety net for cold-tile fetches |
| **v2.4-stable** | 2026-05-20 | Self-healing `sync-domain-deployment` workflow + dropped news-sourced fire-perimeter circles (polygon-only) |
| **v2.3-stable** | 2026-05-09 | Real per-year DINS from CAL FIRE `POSTFIRE_MASTER_DATA_SHARE`, per-fire damage breakdown, About-page provenance honesty pass |
| **v2.2-stable** | 2026-05-09 | Shelters & Evacuation page rewrite (CalOES source) + active `CA_EVACUATIONS_PROD` zones with always-visible pins |

Older tag annotations (`git tag -l --format='%(refname:short)  %(subject)'`) carry the per-release detail.

---

## How to resume

Fresh-session prompt:

> "Let's continue working on FireScope at `~/geo_info_data_visualization`. Read `docs/SESSION_HANDOFF.md` for the v2.7-stable state and the next-up queue, then start on the top item."

### Local dev (one-line each)

```bash
# Backend
cd backend && source .venv/bin/activate && python app.py

# Frontend (separate terminal)
cd frontend && VITE_API_URL=http://localhost:5000/api npm run dev
```

### Production deploy

Push to `main`. CI auto-syncs `domain-deployment`, Netlify auto-builds. No manual deploys.

Force-rebuild Netlify (rare — clears edge cache):

```bash
netlify api createSiteBuild --data '{"site_id":"4d02944f-31ae-486b-a273-56dfe3d5016b","clear_cache":true}'
```

Manual Render redeploy (rare):

```bash
curl -X POST "https://api.render.com/deploy/srv-d71dltgule4c73cqkbj0?key=IW-X7ztdGiA"
```

---

## Next up — queue (priority order)

### 1. Per-zone independent overrides (researcher page)
Originally queued from v2.2. Now blocked behind a 19-step plan saved local-only — see the project's working notes; do not commit that plan into this repo.

- State: `zoneOverrides: Map<string, {evi, lst, wind, humidity, elevation, kbdi}>`
- Researcher clicks a zone → sliders show that zone's saved snapshot (or live defaults)
- Adjusting sliders only affects the selected zone's risk color
- Multiple zones may carry independent overrides simultaneously
- **Where:** `frontend/src/components/research-page.tsx`

### 2. FIRMS hotspots as polygon zones (not circles)
Convert each FIRMS point into a small polygon sized by FRP (fire radiative power). Use `GeoJsonLayer` with generated polygons instead of `ScatterplotLayer` dots.

- **Where:** `frontend/src/components/FIRMSMap.tsx`

### 3. Surface evacuation zones on the other maps
Zones currently render only on the Shelters & Evacuation page. Add an opt-in "Show evacuation zones" toggle on the Dashboard `GoogleRiskMap` and `risk-map` so users see active orders without leaving the page.

### 4. "Find shelters near me" geolocation flow
One-click "Show 10 nearest shelters to my current location":
- `navigator.geolocation` → coords
- Haversine sort over the 8,014 shelters (client-side is fine at this size)
- Highlight 10 nearest with a different icon / list view
- Each row keeps the Route / Open-in-Google-Maps actions

### 5. Persistent route memory
Last route target → `localStorage` so reload restores the polyline.

### 6. Delete dead static `POSTFIRE_MASTER_DATA_trimmed.geojson` (~8 MB)
`frontend/public/Data/POSTFIRE_MASTER_DATA_trimmed.geojson` is still in the tree but no longer referenced — the History page fetches DINS from `/api/history/dins?year=YYYY`. Removing it shaves 8 MB off every Netlify deploy.

```bash
grep -rn POSTFIRE_MASTER_DATA_trimmed frontend/src/ backend/   # verify empty
git rm frontend/public/Data/POSTFIRE_MASTER_DATA_trimmed.geojson
```

### 7. Fix `evacuationZones` mock array (cleanup)
`frontend/src/components/evacuation-routes.tsx` ~line 25 still has the Zone A / Zone B mock array inside a commented-out grid. Delete or repurpose.

### 8. Polygon click priority over centroid pin
At zoom 13+, both the polygon and the centroid pin are pickable. Either suppress the pin at high zoom or merge the click handlers so the same tooltip opens regardless.

### 9. Email digest real risk scores
`backend/services/email/sender.py:189` currently stubs `risk_score=0, risk_level="N/A"` per monitored area in daily/weekly digests. Replace with a `get_zone_risk(scope, zone_id)` helper that's the single source of truth used by both digest and Research page. (Tracked in the same local-only plan as item #1 above.)

---

## Architecture reminders (don't break these)

- **Single `GoogleMapsOverlay` per map.** Multiple overlays = multiple canvases = click blocking.
- **ML model** loads once at startup via `_ensure_loaded()` in `backend/ml/inference.py` — never per-prediction. Now a 6-arg signature; do not call with 5.
- **Push to main, CI auto-syncs `domain-deployment`.** The workflow `sync-domain-deployment.yml` handles this. Never force-push `domain-deployment`.
- **Shelters page bottom-up layer order:** zone polygons → fire perimeters → shelter clusters → zone centroid pins. Don't reorder without thinking through what gets hidden.
- **Cal OES feed is "active only".** Cleared zones drop off the upstream rather than persisting with "All Clear".
- **`endpoint_cache` payload format** is `{body, body_br, etag, content_type, computed_at}`. The older `{data, expires}` shape will be self-healed on first read after v2.7, but new writes must produce the new shape — never write a raw payload into `endpoint_cache` without going through `_build_cache_entry`.
- **Air temperature display unit** is Fahrenheit in the UI, Kelvin (via `air_temp_encoded = (°C + 273.15) / 0.02`) in the model. Convert at the render boundary, not anywhere else.

---

## Useful endpoints reference

| Endpoint | What |
|---|---|
| `GET /health` | Liveness — `{"status":"ok"}` |
| `GET /api/shelters?state=CA` | 8,014 CA shelters (CalOES mirror), 10 min DB / 5 min memory cache |
| `GET /api/evacuation-zones` | Active CA orders/warnings (Cal OES), 60 s cache |
| `GET /api/fire-perimeters` | NIFC + CAL FIRE active CA fire perimeters, 3 min cache |
| `GET /api/calfire/incidents` | CAL FIRE active-incident list, `endpoint_cache`-backed |
| `GET /api/history/perimeters?year=YYYY` | Per-year CAL FIRE historical perimeters, permanently warmed |
| `GET /api/history/perimeters/years` | Available year list |
| `GET /api/history/dins?year=YYYY` | CAL FIRE DINS structure damage 2013→present, permanently warmed |
| `GET /api/news` | Allowlisted fire news feed, daily-warmed |
| `POST /api/predict-custom` | Per-zone risk recompute with overrides (6 features) |
| `POST /api/predict` | Lat/lon risk lookup |
| `GET /api/research/risk-by-county` | County risk payload (cached) |
| `GET /api/research/risk-by-zone/<zone>` | `zip-codes` / `neighborhoods` / `census-tracts` risk payloads |
| `GET /api/research/boundaries/<name>` | Static boundary GeoJSON (no `counties` — counties geometry rides on `risk-by-county`) |
| `GET /api/research/fire-data` | (Researcher/Admin) FIRMS hotspots |
| `GET /api/research/risk-grid` | (Researcher/Admin) Grid risk recompute |
| `POST /api/login` / `POST /api/register` | JWT auth |
