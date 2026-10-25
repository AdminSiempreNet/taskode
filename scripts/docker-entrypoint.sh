#!/bin/sh
# Validate production settings, then apply pending migrations before serving: /api/health rejects a stale schema.
set -eu
if [ "${CHECK_PRODUCTION:-false}" = "true" ]; then node dist/check-production.cjs; fi
node dist/migrate.cjs
exec node server.js
