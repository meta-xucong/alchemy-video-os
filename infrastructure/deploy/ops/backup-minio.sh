#!/usr/bin/env bash
set -euo pipefail

: "${MINIO_ALIAS:?MINIO_ALIAS must name an authenticated mc alias}"
: "${MINIO_BUCKET:?MINIO_BUCKET must be explicit}"
: "${BACKUP_DIR:?BACKUP_DIR must be an explicit private directory}"
mkdir -p -- "$BACKUP_DIR"
case "$BACKUP_DIR" in /|/tmp|/var/tmp|"$HOME") echo "refusing unsafe BACKUP_DIR" >&2; exit 2;; esac
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/minio-$stamp"
umask 077
mc mirror --overwrite "$MINIO_ALIAS/$MINIO_BUCKET" "$target"
find "$target" -type f -print0 | sort -z | xargs -0 sha256sum > "$target.sha256"
echo "created=$target"
