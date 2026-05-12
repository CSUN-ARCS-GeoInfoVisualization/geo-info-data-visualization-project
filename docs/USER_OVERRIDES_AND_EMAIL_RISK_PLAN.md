# Plan: Per-User Saved Overrides + Real Risk Scores in Email/Research

Created: 2026-05-12
Status: APPROVED — not yet started
Owner: Ido (IdoCohen560)

## Goals

1. Let every signed-in user **save risk-override snapshots** (the slider values they tried) so they can revisit/reapply/delete them later.
2. Extend overrides from **county-only** to **all four zone levels**: county, ZIP code, neighborhood, census tract.
3. Resolve the `backend/services/email/sender.py:189` TODO so daily/weekly digest emails carry **real** `risk_score` + `risk_level` per monitored area.
4. Make sure the **Research page** uses the exact same join, so the numbers a user sees in email and on Research match.

## State of play (audited 2026-05-12)

- `/api/predict-custom` (backend/routes/predict.py:220) exists, accepts overrides, returns score — **stateless, saves nothing**.
- Frontend: only `CountyRiskOverlay.tsx` has an `overrides` prop. `ZipCodeRiskOverlay`, `NeighborhoodRiskOverlay`, `CensusTractRiskOverlay` have **none**.
- Two parallel SQLAlchemy stacks coexist:
  - `backend/models.py` (Flask-SQLAlchemy `db.Model`) — main app
  - `backend/services/email/models.py` (SQLAlchemy `Base`) — email subsystem (owns `UserMonitoredArea`)
- Email digest currently stubs `risk_score=0, risk_level="N/A"` for every monitored area.

## Open uncertainty (resolve before coding)

**Which User table owns auth at request time?** `models.User` vs `email/models.User` look duplicated.
- Blocks: where to FK the new `UserOverride` table, and how `user_id` is resolved in `/api/predict-custom`.
- Resolves with: `grep -rn "current_user\|g.user\|jwt" backend/routes/predict.py backend/routes/alerts.py`.
- Default tiebreak (if both are real): attach to `models.User` (main app), add a shim FK for the email digest path.

## Plan — 19 atomic steps

1. Create `UserOverride` table: `id, user_id, scope ('county'|'zip'|'neighborhood'|'tract'), zone_id, zone_name, evi, lst, wind, humidity, elevation, risk_score, label, created_at, note`.
2. Add Alembic migration for `UserOverride`.
3. Resolve the duplicate-User question (see uncertainty above) and pick the FK target.
4. Add `POST /api/overrides` — saves a snapshot (calls `predict_from_features` internally so `risk_score`+`label` are stored at save time).
5. Add `GET /api/overrides` — list current user's overrides, filterable by `scope`.
6. Add `DELETE /api/overrides/:id` — owner-only delete.
7. Add `overrides` prop + `onSaveOverride` callback to `ZipCodeRiskOverlay.tsx` (mirror `CountyRiskOverlay`).
8. Same for `NeighborhoodRiskOverlay.tsx`.
9. Same for `CensusTractRiskOverlay.tsx`.
10. Settings/Research page: "Save override" button next to sliders that POSTs current values + clicked zone.
11. Settings/Research page: "My saved overrides" panel — list, delete, click-to-reapply.
12. Backend helper `get_zone_risk(scope, zone_id)` — single source of truth that hits the right cached predictor per scope. Used by both email join and Research page.
13. Fix `backend/services/email/sender.py:189` TODO — replace `risk_score=0, risk_level="N/A"` stub with `get_zone_risk(area.scope, area.zone_id)` per monitored area. Apply to **both** daily and weekly digest paths.
14. **Load-bearing**: extend `UserMonitoredArea` to carry `scope` + `zone_id` (currently only `area_name` + `area_geojson`). Without this, the email join has no structural key.
15. Migration for `UserMonitoredArea.scope` + `zone_id` columns (+ backfill strategy for existing rows).
16. Research page: replace any local risk computation with the same `get_zone_risk` helper so monitored-area numbers match email exactly.
17. Tests:
    - Override CRUD round-trip (save → list → delete).
    - Email digest produces non-zero `risk_score` for a seeded user+area at each scope (county/zip/neighborhood/tract).
    - Research page renders the same score the email contains for the same zone.
18. Re-run `npx gitnexus analyze` once committed so the code graph is fresh.
19. Ship as logical PRs:
    - PR-A: table + migration + routes (steps 1–6, 12)
    - PR-B: overlay overrides + UI (steps 7–11)
    - PR-C: monitored-area schema + email join + research join + tests (steps 13–17)

## Definition of done

- Signed-in user can save an override at any of the 4 zone levels and see it in a history panel.
- User can delete a saved override; deletes are owner-scoped.
- Daily digest email shows the real current risk score per monitored area for that area's zone level.
- Research page shows the same number for the same zone.
- All new code paths covered by tests at each of the 4 scopes.

## Next-session resume checklist

1. Read this file.
2. Run the User-table grep (step 3) and write the answer at the bottom of this file under "Resolved decisions".
3. Begin at step 1 (table) — do not start UI work before backend round-trips.

## Resolved decisions

_(append answers here as they're locked in — keep this file the single source of truth for this initiative)_
