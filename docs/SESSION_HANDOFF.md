# FireScope — Session Handoff

**Stable tag:** `v2.2-stable` (commit `6e5e4e0`, 2026-05-09)
**Live URL:** https://firescope.netlify.app
**API:** https://firescope-api.onrender.com/api

This document is the single source of truth for picking up FireScope work in a fresh session. Read this first, then `README.md`, then jump in.

---

## What v2.2-stable shipped

### Shelters & Evacuation page (was "Evacuation Routes")

1. **Reframed as always-on**, not emergency-only. Dropped the hard-coded "Active Evacuation Order: Zone A" alert. Page reads as "find a shelter near you" anytime.
2. **Shelter data source migrated** off the gutted FEMA NSS layer (10 features nationwide, 0 in CA) to the **CalOES `CA_Shelter_system`** mirror — 8,014 California pre-staged facilities (5,096 dual-purpose / 2,218 evacuation / 699 post-impact). Backend remaps 10-char ArcGIS field names back to the original FEMA NSS schema so the frontend was untouched.
   - File: `backend/routes/shelters.py`
   - Endpoint: `GET /api/shelters?state=CA`
3. **Click-a-shelter routing**: tooltip now has two buttons —
   - **Route on this map** — green polyline drawn inside FireScope via `google.maps.DirectionsService` + `DirectionsRenderer`
   - **Open in Google Maps** — turn-by-turn in a new tab (essential because the FireScope map gets visually busy with 8k shelter clusters)
4. **Live evacuation zones** — new endpoint `GET /api/evacuation-zones` proxies the **Cal OES `CA_EVACUATIONS_PROD`** statewide aggregation feature service. This is the same source Watch Duty consumes; it pulls Genasys PROTECT zones plus county sheriff/EOC feeds. Filtered to active statuses only (Order / Warning / Advisory / Shelter in Place).
   - File: `backend/routes/predict.py` → `evacuation_zones()` route
   - 60 s server cache, gzip, GeoJSON in WGS84
5. **Always-visible centroid pins** for every active zone. Most CA evacuation orders are <1 km polygons (e.g., the current 8 Tulare orders cluster in a ~5 km area near Cutler/Orosi) — at California-wide zoom they would otherwise be sub-pixel.
6. **Red banner + "Show on map" button** appears whenever CA has any active orders. Click → `map.fitBounds()` to all active zone polygons, capped at zoom 13.
7. **Two new toggles** in the map header, both default ON: **Evacuation Zones**, **Active Fires**.
8. **Layer order** in the single `GoogleMapsOverlay`: zone polygons (bottom) → fire perimeters → shelter cluster icons → zone centroid pins (top, never hidden).
9. **Auto-refresh**: zones refresh every 60 s on the page.

### Files touched

```
README.md
docs/SESSION_HANDOFF.md          (this file)
backend/routes/shelters.py        (rewritten — CalOES source + field remap)
backend/routes/predict.py         (added evacuation_zones route)
frontend/src/App.tsx              (nav label rename)
frontend/src/components/evacuation-routes.tsx  (most of the work)
```

### Stable commits to know

| Commit  | What |
|---------|------|
| `be9d1ae` | shelter page reframe + click-to-route |
| `8033842` | `/api/evacuation-zones` proxy + zone polygon layer + toggles |
| `252d718` | shelter source migration off FEMA NSS to CalOES |
| `6e5e4e0` | zone centroid pins + "Show on map" zoom-to-fit (← v2.2-stable) |

---

## How to resume

Fresh-session prompt that picks up cleanly:

> "Let's continue working on FireScope at `~/geo_info_data_visualization`. Read `docs/SESSION_HANDOFF.md` for the v2.2-stable state and the queue of next-up tasks, then start on the top item."

### Verify the stack is healthy

```bash
# Backend (should return 8014 features, all CA, with facility_usage_code)
curl -s "https://firescope-api.onrender.com/api/shelters?state=CA" | jq '.features | length'

# Backend (should return active CA orders/warnings)
curl -s "https://firescope-api.onrender.com/api/evacuation-zones" | jq '.features | length, .features[0].properties.STATUS'

# Frontend bundle is the right one
curl -s https://firescope.netlify.app/ | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1

# CI auto-sync of domain-deployment branch
gh run list --workflow=sync-domain-deployment.yml --limit 3
```

### Local dev (one-line)

```bash
# Backend
cd backend && source .venv/bin/activate && python app.py

# Frontend (separate terminal)
cd frontend && VITE_API_URL=http://localhost:5000/api npm run dev
```

### Production deploy

Push to `main`. CI syncs to `domain-deployment`, Netlify auto-builds with the prod env vars (`VITE_API_URL`, `VITE_GOOGLE_MAPS_API_KEY` are configured at site level, scope = all contexts). No manual override needed.

If you ever need to force a fresh build (e.g., to clear Netlify's build cache):

```bash
netlify api createSiteBuild --data '{"site_id":"4d02944f-31ae-486b-a273-56dfe3d5016b","clear_cache":true}'
```

---

## Next up — queue (priority order)

### 1. Per-zone independent overrides (researcher page)
Originally queued in the prior session memory, still pending.

- State: `zoneOverrides: Map<string, {evi, lst, wind, elevation}>`
- When researcher clicks a zone → sliders show that zone's custom values (or live defaults)
- Adjusting sliders only affects the selected zone's risk color
- Other zones keep their own custom values or live data
- Multiple zones can have different overrides simultaneously
- **Where:** `frontend/src/components/research-page.tsx`

### 2. FIRMS hotspots as polygon zones (not circles)
Convert each FIRMS point into a small polygon sized by FRP (fire radiative power) — red shaded boundaries instead of `ScatterplotLayer` dots. Use `GeoJsonLayer` with generated polygons.

- **Where:** `frontend/src/components/FIRMSMap.tsx`

### 3. Surface evacuation zones on the other maps
Right now zones only render on the Shelters & Evacuation page. Consider an opt-in "Show evacuation zones" toggle on the Dashboard `GoogleRiskMap` and the `risk-map` page so users see active orders without leaving the page they're on.

### 4. "Find shelters near me" geolocation flow
Right now you can route TO a shelter you've already found. Add a one-click "Show 10 nearest shelters to my current location" button that:
- Requests `navigator.geolocation`
- Computes haversine distance to all 8,014 shelters server-side (or sorts client-side)
- Highlights the 10 nearest with a different icon / list view
- Each row has the same Route / Open in Google Maps actions

### 5. Persistent route memory
When a user routes to a shelter and reloads the page, the polyline disappears. Consider persisting the last route target in `localStorage` so it auto-restores.

### 6. Fix `evacuationZones` mock array (cleanup)
`frontend/src/components/evacuation-routes.tsx` line ~25 still has a hard-coded `evacuationZones` array (Zone A / Zone B mock data) used inside a commented-out grid. Either delete it or repurpose it for the now-real Cal OES data.

### 7. Polygon click priority over centroid pin
At zoom 13+, both the polygon and the centroid pin are pickable. Click currently picks whichever deck.gl considers on top (the pin). Either suppress the pin at high zoom or merge the two click handlers so the same tooltip opens regardless.

---

## Architecture reminders (don't break these)

- **Single `GoogleMapsOverlay` per map.** Multiple overlays = multiple canvases = click blocking. The Shelters & Evacuation page bundles zone polygons + fire perimeters + shelter icons + zone pins into one overlay for this reason.
- **ML model** loads once at startup via `_ensure_loaded()` in `backend/ml/inference.py` — never per-prediction.
- **Push to main, CI auto-syncs `domain-deployment`.** The workflow `sync-domain-deployment.yml` handles this — no manual `git push origin main:domain-deployment --force` anymore.
- **Shelters page bottom-up layer order:** zone polygons → fire perimeters → shelter clusters → zone centroid pins. Don't reorder without thinking through what gets hidden.
- **Cal OES feed is "active only".** Cleared zones drop off the upstream layer rather than persisting with an "All Clear" status. Don't try to render historical or cleared zones from this endpoint.

---

## Useful endpoints reference

| Endpoint | What |
|----------|------|
| `GET /api/shelters?state=CA` | 8,014 CA shelters (CalOES mirror), 6 h cache |
| `GET /api/evacuation-zones` | Active CA orders/warnings (Cal OES), 60 s cache |
| `GET /api/fire-perimeters` | NIFC + CAL FIRE active CA fire perimeters, 3 min cache |
| `GET /api/predict-custom` | Per-zone risk recompute with overrides |
| `GET /api/research/risk-by-zone` | County / ZIP / tract / neighborhood risk scores |
