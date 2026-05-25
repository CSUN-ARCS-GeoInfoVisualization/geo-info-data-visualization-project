#!/usr/bin/env bash
# Render preDeployCommand entrypoint. Runs Alembic migrations against the
# Render DB before traffic shifts to the new instance. Failure rolls the
# deploy back automatically.
#
# Render's `rootDir: backend` applies to build/start commands but NOT
# preDeploy, so we cd manually. Render's API also strips shell metachars
# like `&&` from inline preDeployCommand, hence this file.
set -euo pipefail

cd "$(dirname "$0")/../backend"
export FLASK_APP="app:create_app"
flask db upgrade
