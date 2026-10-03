#!/usr/bin/env bash
# Container start: network isolation for agent commands, then the app.
set -e
/app/egress.sh || true
mkdir -p "${DATA_DIR:-/data}/projects" "${DATA_DIR:-/data}/backups"
chmod 711 "${DATA_DIR:-/data}" "${DATA_DIR:-/data}/projects"
chmod 700 "${DATA_DIR:-/data}/backups"
exec "$@"
