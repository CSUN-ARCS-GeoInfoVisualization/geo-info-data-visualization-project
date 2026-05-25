#!/usr/bin/env bash
# Safely refresh the zone-risk cache without starving the DB pool.
#
# WHY THIS EXISTS: the obvious path — `DELETE FROM zone_risk_cache; let
# users re-trigger recompute` — causes a thundering-herd recompute storm
# that exhausts the SQLAlchemy connection pool, blocks /health and /login
# behind 30s pool timeouts, and looks like a full outage from the user's
# side. (Happened once. Don't do it again.)
#
# This script does the safe thing:
#   1. Hits each /risk-by-* endpoint in SEQUENCE (not parallel) so each
#      one finishes its compute before the next starts.
#   2. Times each request so we can see if anything's drifting toward
#      gunicorn's 90s timeout.
#   3. Bails on the first failure so we don't push past a sick service.
#
# Use this BEFORE any DB-level cache invalidation. If you only need new
# labels/colors to propagate without invalidating, prefer waiting for
# the daily-prewarm.yml GHA cron to roll the cache naturally.
#
# Usage:
#   bash scripts/refresh-zone-cache.sh
#
# Optional env:
#   API_BASE   override the prod URL (default: https://firescope-api.onrender.com)

set -euo pipefail

API_BASE="${API_BASE:-https://firescope-api.onrender.com}"
ENDPOINTS=(
  "research/risk-by-county"
  "research/risk-by-zone/zip-codes"
  "research/risk-by-zone/neighborhoods"
  "research/risk-by-zone/census-tracts"
)

echo "Refreshing zone-risk cache via $API_BASE ..."
for path in "${ENDPOINTS[@]}"; do
  printf "  %-44s " "$path"
  RESP=$(curl -sS --max-time 180 -o /dev/null -w "HTTP=%{http_code}  time=%{time_total}s" "$API_BASE/api/$path")
  echo "$RESP"
  # Bail if anything but 200 OK — don't compound a partial outage.
  CODE=$(echo "$RESP" | grep -oE 'HTTP=[0-9]+' | cut -d= -f2)
  if [ "$CODE" != "200" ]; then
    echo "::error::$path returned HTTP $CODE — stopping refresh chain"
    exit 1
  fi
done
echo "All four zone caches refreshed. Cache is warm; next user requests will hit the cached payload."
