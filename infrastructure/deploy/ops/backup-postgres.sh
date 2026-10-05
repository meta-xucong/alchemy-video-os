#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be supplied by the secret manager}"
: "${BACKUP_DIR:?BACKUP_DIR must be an explicit private directory}"
mkdir -p -- "$BACKUP_DIR"
case "$BACKUP_DIR" in /|/tmp|/var/tmp|"$HOME") echo "refusing unsafe BACKUP_DIR" >&2; exit 2;; esac
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/postgres-$stamp.dump"
umask 077
pg_dump --format=custom --no-owner --file="$target" "$DATABASE_URL"
sha256sum "$target" > "$target.sha256"
echo "created=$target"
